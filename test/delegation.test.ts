/**
 * Delegation-chain verification, offline. The issuer mints a real multi-hop chain (controller → a0 → a1 → a2) onto
 * a fake op-recording gatekeeper; the verifier walks it root→leaf. Covers the happy path and the ways a chain must
 * fail: narrowed-away authority, a missing/out-of-order hop, a non-presenter leaf, a revoked mid-chain hop, a
 * forged widening, and attenuation refusal at issuance. No live node; the live equivalent is
 * scripts/e2e-archon-delegate.ts.
 *
 * @verifies DC-1, DC-2, DC-3, DC-4, DC-5, AC-8
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier, attenuates } from '../src/index.ts';
import type { AAC, Capability, Signer } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:vendor.example';

// A monotonically narrowing chain of capabilities: root ⊇ mid ⊇ leaf.
const ROOT: Capability = { actions: ['read', 'write'], resources: ['res:a', 'res:b'], constraints: { audience: [V] }, delegable: true };
const MID: Capability = { actions: ['read'], resources: ['res:a', 'res:b'], constraints: { audience: [V] }, delegable: true };
const LEAF: Capability = { actions: ['read'], resources: ['res:a'], constraints: { audience: [V] } };

async function chainWorld() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };

  const controller = await issuer.mintAgent();
  const a0 = await issuer.mintAgent();
  const a1 = await issuer.mintAgent();
  const a2 = await issuer.mintAgent();
  const vrc = await issuer.mintRelationship(controller, a0.did);
  const root = await issuer.mintAuthorization(controller, a0.did, vrc.did, ROOT, { assuranceLevel: 'controller-vouched' });
  const d1 = await issuer.mintDelegation(a0, root.credential, a1.did, MID);
  const d2 = await issuer.mintDelegation(a1, d1.credential, a2.did, LEAF);

  const chain = [root.credential, d1.credential, d2.credential];
  const pres = issuer.present(a2, { challenge: 'n', audience: V, credentials: chain });
  const req = { nonce: 'n', audience: V, action: 'read', resource: 'res:a' };
  return { gk, issuer, deps, controller, a0, a1, a2, vrc, root, d1, d2, chain, pres, req };
}

/** Store a raw (possibly invalid) AAC asset signed by `delegator`, bypassing the issuer's attenuation guard. */
async function forgeAac(gk: any, delegator: Signer, buildBody: (did: string) => object): Promise<AAC> {
  const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64url');
  const did = await gk.createDID({ registration: { type: 'asset' }, controller: delegator.did, data: { pending: true } });
  const body = buildBody(did);
  const proofValue = b64(cipher.signHash(cipher.hashJSON(body), delegator.privateJwk as any));
  const cred = { ...body, proof: { type: 'EcdsaSecp256k1Signature2019', created: new Date().toISOString(), verificationMethod: `${delegator.did}#key-1`, proofPurpose: 'authentication', proofValue } } as AAC;
  await gk.updateDID({ did, doc: { didDocumentData: cred } });
  return cred;
}

// ── tests ────────────────────────────────────────────────────────────────

// @verifies DC-1, DC-2, DC-3, DC-4, DC-5
test('a complete 3-hop chain verifies end-to-end, offline', async () => {
  const { deps, pres, req } = await chainWorld();
  assert.deepEqual(await verifyPresentation(pres, req, deps), { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies AC-8
test('the leaf cannot exercise authority its parents narrowed away', async () => {
  const { deps, pres, req } = await chainWorld();
  assert.equal((await verifyPresentation(pres, { ...req, action: 'write' }, deps)).reason, 'authorization'); // write dropped at the mid hop
  assert.equal((await verifyPresentation(pres, { ...req, resource: 'res:b' }, deps)).reason, 'authorization'); // res:b dropped at the leaf
});

// @verifies DC-2
test('a missing / out-of-order hop is denied', async () => {
  const { issuer, deps, a2, root, d2, req } = await chainWorld();
  const gap = issuer.present(a2, { challenge: 'n', audience: V, credentials: [root.credential, d2.credential] }); // d1 omitted
  assert.equal((await verifyPresentation(gap, req, deps)).reason, 'chain-linkage');
});

// @verifies DC-3
test('a chain whose leaf is not the presenter is denied', async () => {
  const { issuer, deps, a1, chain, req } = await chainWorld();
  const wrongHolder = issuer.present(a1, { challenge: 'n', audience: V, credentials: chain }); // a1 presents a chain whose leaf is a2
  assert.equal((await verifyPresentation(wrongHolder, req, deps)).reason, 'holder-mismatch');
});

// @verifies DC-5
test('revoking a mid-chain hop denies the whole chain, fail-closed', async () => {
  const { issuer, deps, a0, d1, pres, req } = await chainWorld();
  assert.equal(await issuer.revoke(d1.did, a0), true); // a0 controls the d1 asset
  assert.equal((await verifyPresentation(pres, req, deps)).reason, 'revoked');
});

// @verifies AC-8
test('issuance refuses widening (the one hard invariant)', async () => {
  const { issuer, a0, a1, root } = await chainWorld();
  await assert.rejects(() => issuer.mintDelegation(a0, root.credential, a1.did, { ...ROOT, actions: ['read', 'write', 'delete'] }), /widens/);
});

// @verifies DC-4
// Blocking delegation is an anti-pattern: a `delegable: false` parent is advisory, not a gate. Delegating from it
// is permitted (as long as it still attenuates), and the resulting chain VERIFIES — bounded by attenuation +
// revocation, not by refusing to delegate.
test('delegation from a `delegable: false` parent is permitted and verifies', async () => {
  const { issuer, deps, controller, a0, a1, a2, vrc } = await chainWorld();
  const rootND = await issuer.mintAuthorization(controller, a0.did, vrc.did, { ...ROOT, delegable: false }, { assuranceLevel: 'controller-vouched' });
  const d1 = await issuer.mintDelegation(a0, rootND.credential, a1.did, MID); // not blocked
  const d2 = await issuer.mintDelegation(a1, d1.credential, a2.did, LEAF);
  const pres = issuer.present(a2, { challenge: 'n', audience: V, credentials: [rootND.credential, d1.credential, d2.credential] });
  const res = await verifyPresentation(pres, { nonce: 'n', audience: V, action: 'read', resource: 'res:a' }, deps);
  assert.deepEqual(res, { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies AC-8
test('the verifier rejects a forged widening chain (not only the issuer)', async () => {
  const { gk, issuer, deps, a1, a2, root, d1, req } = await chainWorld();
  const forged = await forgeAac(gk, a1, (did) => ({
    id: did, type: ['VerifiableCredential', 'AgentAuthorizationCredential'], issuer: a1.did,
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2099-01-01T00:00:00Z',
    credentialSubject: { id: a2.did, authorization: { actions: ['read', 'write'], resources: ['res:a'], constraints: { audience: [V] }, parent: d1.did } },
  }));
  const pres = issuer.present(a2, { challenge: 'n', audience: V, credentials: [root.credential, d1.credential, forged] });
  assert.equal((await verifyPresentation(pres, req, deps)).reason, 'attenuation'); // 'write' widens the mid hop
});

// @verifies AC-8
test('attenuates() enforces monotonic narrowing per dimension', () => {
  const P: Capability = { actions: ['read', 'write'], resources: ['a', 'b'], constraints: { audience: ['V'], notAfter: '2027-01-01T00:00:00Z', maxInvocations: 5 } };
  assert.equal(attenuates({ actions: ['read'], resources: ['a'], constraints: { audience: ['V'], notAfter: '2026-06-01T00:00:00Z', maxInvocations: 3 } }, P), true);
  assert.equal(attenuates({ actions: ['read', 'delete'], resources: ['a'], constraints: P.constraints }, P), false); // wider action
  assert.equal(attenuates({ actions: ['read'], resources: ['a', 'c'], constraints: P.constraints }, P), false); // wider resource
  assert.equal(attenuates({ actions: ['read'], resources: ['a'], constraints: { audience: ['V', 'W'], notAfter: P.constraints!.notAfter, maxInvocations: 5 } }, P), false); // loosened audience
  assert.equal(attenuates({ actions: ['read'], resources: ['a'], constraints: { audience: ['V'], notAfter: '2028-01-01T00:00:00Z', maxInvocations: 5 } }, P), false); // later expiry
  assert.equal(attenuates({ actions: ['read'], resources: ['a'], constraints: { audience: ['V'], notAfter: P.constraints!.notAfter, maxInvocations: 9 } }, P), false); // higher cap
});
