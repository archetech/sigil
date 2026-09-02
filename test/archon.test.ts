/**
 * Live-adapter tests: the two seams wired to real Archon libraries (`createArchonResolver` over a stubbed
 * gatekeeper document; `createArchonSignatureVerifier` over a real `@didcid/cipher`). Where verify.test.ts
 * exercises the anchor logic against in-memory fakes, this exercises the SAME logic against Archon's real
 * `EcdsaSecp256k1Signature2019` crypto (JCS canonicalization + ECDSA secp256k1) and the real DID-document
 * shape — so a happy path here means Sigil verifies exactly what Archon signs.
 *
 * @verifies R2, R10, AC-3, AC-7
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { AAC, VRC, Proof, Presentation, VerifyRequest } from '../src/index.ts';
import type { GatekeeperLike, GatekeeperDidDocument } from '../src/archon/resolver.ts';

const cipher = new Cipher();
const CREATED = '2026-05-01T00:00:00Z';
const vmOf = (did: string): string => `${did}#key-1`;

// One real secp256k1 keypair per DID.
const keys = new Map<string, ReturnType<typeof cipher.generateRandomJwk>>();
const keypair = (did: string) => {
  let k = keys.get(did);
  if (!k) { k = cipher.generateRandomJwk(); keys.set(did, k); }
  return k;
};

/** Sign a proof-less object as Archon does: hashJSON(JCS) → ECDSA → base64url(compact-hex). */
function realSign(body: unknown, signerDid: string): Proof {
  const msgHash = cipher.hashJSON(body);
  const sigHex = cipher.signHash(msgHash, keypair(signerDid).privateJwk);
  return {
    type: 'EcdsaSecp256k1Signature2019',
    created: CREATED,
    verificationMethod: vmOf(signerDid),
    proofPurpose: 'assertionMethod',
    proofValue: Buffer.from(sigHex, 'hex').toString('base64url'),
  };
}
const signCred = <T extends object>(body: T, signerDid: string): T & { proof: Proof } => ({ ...body, proof: realSign(body, signerDid) });

// ── a stub gatekeeper returning real DID-document shapes ───────────────────
function makeGatekeeper() {
  const docs = new Map<string, GatekeeperDidDocument>();
  return {
    agent: (did: string): void => void docs.set(did, {
      didDocument: { verificationMethod: [{ id: vmOf(did), publicKeyJwk: keypair(did).publicJwk }] },
      didDocumentMetadata: { deactivated: false },
    }),
    asset: (did: string, data: unknown): void => void docs.set(did, { didDocumentData: data, didDocumentMetadata: { deactivated: false } }),
    deactivate: (did: string): void => { const d = docs.get(did); if (d) d.didDocumentMetadata = { deactivated: true }; },
    gk: { async resolveDID(did: string): Promise<GatekeeperDidDocument> { const d = docs.get(did); if (!d) throw new Error('not found'); return d; } } as GatekeeperLike,
  };
}

const CONTROLLER = 'did:cid:controllerA';
const AGENT = 'did:cid:agentA';
const VENDOR = 'did:web:vendor.example';
const VRC_ID = 'did:cid:vrc1';
const AAC_ID = 'did:cid:aac1';

function world() {
  const g = makeGatekeeper();
  g.agent(CONTROLLER);
  g.agent(AGENT);

  const vrc: VRC = signCred({ id: VRC_ID, type: ['VerifiableCredential', 'VerifiableRelationshipCredential'], issuer: CONTROLLER, credentialSubject: { id: AGENT } }, CONTROLLER);
  g.asset(VRC_ID, vrc);

  const aac: AAC = signCred({
    id: AAC_ID,
    type: ['VerifiableCredential', 'AgentAuthorizationCredential'],
    issuer: CONTROLLER,
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2027-01-01T00:00:00Z',
    credentialSubject: {
      id: AGENT,
      relationship: VRC_ID,
      authorization: { actions: ['invoke:catalog.search'], resources: ['res:catalog'], constraints: { audience: [VENDOR] } },
      assuranceLevel: 'controller-vouched',
    },
  }, CONTROLLER);
  g.asset(AAC_ID, aac);

  const holderBody = { holder: AGENT, challenge: 'nonce-xyz', audience: VENDOR };
  const pres: Presentation = { ...holderBody, credentials: [aac], proof: realSign(holderBody, AGENT) };

  const req: VerifyRequest = { nonce: 'nonce-xyz', audience: VENDOR, action: 'invoke:catalog.search', resource: 'res:catalog', now: '2026-06-01T00:00:00Z' };
  const deps = { resolver: createArchonResolver(g.gk), signatures: createArchonSignatureVerifier(cipher) };
  return { g, aac, vrc, pres, req, deps };
}

// ── tests ──────────────────────────────────────────────────────────────────

// @verifies AC-3
test('signature adapter verifies a real EcdsaSecp256k1 proof and rejects tampering', async () => {
  const sigs = createArchonSignatureVerifier(cipher);
  const body = { hello: 'world', n: 42 };
  const proof = realSign(body, 'did:cid:signer');
  const key = keypair('did:cid:signer').publicJwk;

  assert.equal(await sigs.verify(body, proof, key), true);
  assert.equal(await sigs.verify({ ...body, n: 43 }, proof, key), false); // tampered payload
  assert.equal(await sigs.verify(body, { ...proof, proofValue: Buffer.from('00'.repeat(64), 'hex').toString('base64url') }, key), false); // tampered sig
  assert.equal(await sigs.verify(body, proof, keypair('did:cid:other').publicJwk), false); // wrong key
});

// @verifies R2, R10, AC-7
test('resolver adapter maps agent keys, asset data, and deactivation from a gatekeeper document', async () => {
  const g = makeGatekeeper();
  g.agent(AGENT);
  g.asset(VRC_ID, { id: VRC_ID, kind: 'vrc' });
  const resolver = createArchonResolver(g.gk);

  const agent = await resolver.resolve(AGENT);
  assert.equal(agent?.kind, 'agent');
  assert.deepEqual(agent?.keys?.[vmOf(AGENT)], keypair(AGENT).publicJwk);

  const asset = await resolver.resolve(VRC_ID);
  assert.equal(asset?.kind, 'asset');
  assert.deepEqual(asset?.data, { id: VRC_ID, kind: 'vrc' });

  assert.equal((await resolver.resolve('did:cid:missing')), undefined); // unresolvable → fail-closed
  g.deactivate(AGENT);
  assert.equal((await resolver.resolve(AGENT))?.deactivated, true);
});

// @verifies R10, AC-7
// Regression: a live gatekeeper answers 200 (never a throw) with `didResolutionMetadata.error` for a DID it
// cannot resolve, and a `delete` yields an otherwise-empty doc with `deactivated: true`. Verified against a
// live node in scripts/e2e-archon-resolve.ts; pinned here as a unit test.
test('resolver adapter fails closed on an error / empty gatekeeper response', async () => {
  const from = (d: GatekeeperDidDocument): GatekeeperLike => ({ async resolveDID() { return d; } });

  // 200 + resolution error → unresolvable.
  assert.equal(await createArchonResolver(from({ didResolutionMetadata: { error: 'invalidDid' }, didDocument: {}, didDocumentMetadata: {} })).resolve('did:cid:x'), undefined);
  // No keys, no data, not deactivated → nothing to trust → unresolvable.
  assert.equal(await createArchonResolver(from({ didDocument: {}, didDocumentMetadata: {} })).resolve('did:cid:x'), undefined);
  // A `delete` IS a real resolution the caller must see and deny — not undefined.
  assert.equal((await createArchonResolver(from({ didDocument: {}, didDocumentMetadata: { deactivated: true } })).resolve('did:cid:x'))?.deactivated, true);
});

// @verifies R2, AC-3
test('anchor: a valid presentation verifies end-to-end over real Archon crypto', async () => {
  const { pres, req, deps } = world();
  assert.deepEqual(await verifyPresentation(pres, req, deps), { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies AC-3
test('anchor over real crypto: a forged AAC signature is denied', async () => {
  const { g, aac, pres, req, deps } = world();
  // Re-sign the AAC with a stranger's key but keep it claiming the controller as issuer.
  const stranger = 'did:cid:stranger';
  g.agent(stranger);
  const forged: AAC = { ...aac, proof: realSign({ ...aac, proof: undefined }, stranger) };
  // strip the injected `proof: undefined` so the signed body matches what the verifier canonicalizes
  const { proof: _p, ...forgedBody } = forged;
  const forgedAac: AAC = { ...(forgedBody as Omit<AAC, 'proof'>), proof: realSign(forgedBody, stranger) };
  const p2: Presentation = { ...pres, credentials: [forgedAac], proof: realSign({ holder: pres.holder, challenge: pres.challenge, audience: pres.audience }, pres.holder) };
  assert.equal((await verifyPresentation(p2, req, deps)).reason, 'issuer-signature');
});

// @verifies R10, AC-7
test('anchor over real crypto: a deactivated AAC is denied fail-closed', async () => {
  const { g, pres, req, deps } = world();
  g.deactivate(AAC_ID);
  assert.equal((await verifyPresentation(pres, req, deps)).reason, 'revoked');
});
