/**
 * Op-log-as-proof credential authenticity (R4). A credential minted with `createAsset` (as a Keymaster does) carries
 * NO inner proof — its authenticity is that its asset is controlled by the issuer (proven by the signed operation
 * log). The verifier accepts it iff the asset's controller equals the issuer AND the presented body equals the
 * authentic anchored data (so a tampered presented copy is rejected). Keys never leave the wallet. Offline.
 *
 * @verifies R4
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { AAC, VRC } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:verifier.example';

/** Mint a credential the op-log way: an asset controlled by `controllerDid`, holding the credential body — NO inner
 *  proof. (This is exactly what `keymaster.createAsset(data, { controller })` produces — the key stays in the wallet.) */
async function mintOpLog<T>(gk: any, controllerDid: string, buildBody: (did: string) => T): Promise<T> {
  const did = await gk.createDID({ registration: { type: 'asset' }, controller: controllerDid, data: { pending: true } });
  const body = buildBody(did);
  await gk.updateDID({ did, doc: { didDocumentData: body } });
  return body;
}

async function world() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' }); // self-custody, for the agent + presenting
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent(); // stands in for a Keymaster-held controller identity
  const agent = await issuer.mintAgent();       // ephemeral presenter, self-custody

  // The controller mints an op-log VRC + root AAC (no inner proofs) — as a Keymaster would, via createAsset.
  const CAP = { actions: ['deploy'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true };
  const vrc = await mintOpLog<VRC>(gk, controller.did, (did) => ({
    id: did, type: ['VerifiableCredential', 'VerifiableRelationshipCredential'], issuer: controller.did, credentialSubject: { id: agent.did },
  }));
  const aac = await mintOpLog<AAC>(gk, controller.did, (did) => ({
    id: did, type: ['VerifiableCredential', 'AgentAuthorizationCredential'], issuer: controller.did,
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z',
    credentialSubject: { id: agent.did, relationship: vrc.id, authorization: CAP, assuranceLevel: 'controller-vouched' },
  }));
  return { gk, issuer, deps, controller, agent, vrc, aac };
}

const req = (extra: Record<string, unknown> = {}) => ({ nonce: 'n', audience: V, action: 'deploy', resource: 'svc:api', ...extra });

// @verifies R4
test('a Keymaster-style op-log credential (no inner proof) verifies', async () => {
  const w = await world();
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: [w.aac] });
  assert.deepEqual(await verifyPresentation(pres, req(), w.deps), { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies R4
test('a tampered presented op-log credential (body ≠ anchored data) is denied', async () => {
  const w = await world();
  // widen the authorization on the PRESENTED copy; the anchored asset is unchanged → mismatch → deny.
  const tampered: AAC = { ...w.aac, credentialSubject: { ...w.aac.credentialSubject, authorization: { ...w.aac.credentialSubject.authorization, actions: ['deploy', 'delete'] } } };
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: [tampered] });
  assert.equal((await verifyPresentation(pres, req(), w.deps)).reason, 'issuer-signature');
});

// @verifies R4
test('an op-log credential whose asset controller ≠ issuer is denied', async () => {
  const w = await world();
  const stranger = await w.issuer.mintAgent();
  // asset controlled by `stranger`, but the AAC claims issuer = controller → controller mismatch.
  const rogue = await mintOpLog<AAC>(w.gk, stranger.did, (did) => ({
    id: did, type: ['VerifiableCredential', 'AgentAuthorizationCredential'], issuer: w.controller.did,
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z',
    credentialSubject: { id: w.agent.did, relationship: w.vrc.id, authorization: { actions: ['deploy'], resources: ['svc:api'], constraints: { audience: [V] } } },
  }));
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: [rogue] });
  assert.equal((await verifyPresentation(pres, req(), w.deps)).reason, 'issuer-signature');
});

// @verifies R4
test('op-log and inner-proof credentials interoperate in one chain', async () => {
  const w = await world();
  // Delegate (self-custody, INNER proof) from the op-log-rooted agent to a sub-agent.
  const sub = await w.issuer.mintAgent();
  const d1 = await w.issuer.mintDelegation(w.agent, w.aac, sub.did, { actions: ['deploy'], resources: ['svc:api'], constraints: { audience: [V] } });
  const pres = w.issuer.present(sub, { challenge: 'n', audience: V, credentials: [w.aac, d1.credential] });
  assert.equal((await verifyPresentation(pres, req(), w.deps)).ok, true); // op-log root + inner-proof hop both verify
});
