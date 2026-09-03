/**
 * Trust registry: the verifier DERIVES assurance from proved evidence (TR-1), not the issuer's asserted level.
 * A pinned issuer → issuer-pinned (TR-2); presented DTG trust credentials from a trusted anchor raise the level
 * (TR-3); anything from a non-anchor / revoked / wrong-subject is ignored, fail-safe to lower (TR-4); and trust
 * evidence never rescues an otherwise-invalid or over-scoped presentation (TR-5). Offline, real cipher.
 *
 * @verifies TR-1, TR-2, TR-3, TR-4, TR-5
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Capability, TrustPolicy } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:verifier.example';
const CAP: Capability = { actions: ['read'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true };

async function world() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const base = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const agent = await issuer.mintAgent();
  const registry = await issuer.mintAgent();   // a trusted anchor (endorser / registry)
  const stranger = await issuer.mintAgent();   // an untrusted issuer of endorsements
  const vrc = await issuer.mintRelationship(controller, agent.did);
  // Issuer ASSERTS 'witnessed' — the verifier must NOT honor it without evidence (TR-1).
  const root = await issuer.mintAuthorization(controller, agent.did, vrc.did, CAP, { assuranceLevel: 'witnessed' });
  return { gk, issuer, base, controller, agent, registry, stranger, root, chain: [root.credential] };
}

const req = (extra: Record<string, unknown> = {}) => ({ nonce: 'n', audience: V, action: 'read', resource: 'svc:api', ...extra });

// @verifies TR-1
test('the asserted assuranceLevel is ignored; the verifier derives controller-vouched', async () => {
  const w = await world();
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain });
  const res = await verifyPresentation(pres, req(), w.base); // no trust policy
  assert.deepEqual(res, { ok: true, assuranceLevel: 'controller-vouched' }); // NOT 'witnessed'
});

// @verifies TR-2
test('a pinned root issuer derives issuer-pinned', async () => {
  const w = await world();
  const trust: TrustPolicy = { anchors: [], pinnedIssuers: [w.controller.did] };
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain });
  const res = await verifyPresentation(pres, req(), { ...w.base, trust });
  assert.equal(res.assuranceLevel, 'issuer-pinned');
});

// @verifies TR-3
test('a witness credential from a trusted anchor derives witnessed', async () => {
  const w = await world();
  const vwc = await w.issuer.mintEndorsement(w.registry, w.controller.did, 'witness');
  const trust: TrustPolicy = { anchors: [w.registry.did] };
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain, trust: [vwc.credential] });
  const res = await verifyPresentation(pres, req(), { ...w.base, trust });
  assert.equal(res.assuranceLevel, 'witnessed');
});

// @verifies TR-3
test('the DTG type selects the rung: endorsement→endorsed, membership→issuer-pinned', async () => {
  const w = await world();
  const trust: TrustPolicy = { anchors: [w.registry.did] };
  const vec = await w.issuer.mintEndorsement(w.registry, w.controller.did, 'endorsement');
  const p1 = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain, trust: [vec.credential] });
  assert.equal((await verifyPresentation(p1, req(), { ...w.base, trust })).assuranceLevel, 'endorsed');
  const vmc = await w.issuer.mintEndorsement(w.registry, w.controller.did, 'membership');
  const p2 = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain, trust: [vmc.credential] });
  assert.equal((await verifyPresentation(p2, req(), { ...w.base, trust })).assuranceLevel, 'issuer-pinned');
});

// @verifies TR-4
test('trust evidence from a non-anchor, or revoked, or about a different subject is ignored (fail-safe)', async () => {
  const w = await world();
  const trust: TrustPolicy = { anchors: [w.registry.did] };

  // from a stranger (not an anchor) → ignored
  const fromStranger = await w.issuer.mintEndorsement(w.stranger, w.controller.did, 'witness');
  const p1 = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain, trust: [fromStranger.credential] });
  assert.equal((await verifyPresentation(p1, req(), { ...w.base, trust })).assuranceLevel, 'controller-vouched');

  // about a different subject (the agent, not the controller) → ignored
  const wrongSubject = await w.issuer.mintEndorsement(w.registry, w.agent.did, 'witness');
  const p2 = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain, trust: [wrongSubject.credential] });
  assert.equal((await verifyPresentation(p2, req(), { ...w.base, trust })).assuranceLevel, 'controller-vouched');

  // revoked → ignored, but the presentation still verifies at base
  const revoked = await w.issuer.mintEndorsement(w.registry, w.controller.did, 'witness');
  assert.equal(await w.issuer.revoke(revoked.did, w.registry), true);
  const p3 = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain, trust: [revoked.credential] });
  assert.deepEqual(await verifyPresentation(p3, req(), { ...w.base, trust }), { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies TR-5
test('trust evidence never rescues an out-of-scope request', async () => {
  const w = await world();
  const vmc = await w.issuer.mintEndorsement(w.registry, w.controller.did, 'membership');
  const trust: TrustPolicy = { anchors: [w.registry.did], pinnedIssuers: [w.controller.did] };
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain, trust: [vmc.credential] });
  // 'delete' is not in scope; being highly trusted does not grant it.
  assert.equal((await verifyPresentation(pres, req({ action: 'delete' }), { ...w.base, trust })).reason, 'authorization');
});

// @verifies TR-3, AC-10
test('requiredAssurance now passes only when the level is actually derived', async () => {
  const w = await world();
  const trust: TrustPolicy = { anchors: [w.registry.did] };
  const bare = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain });
  // requires witnessed but only controller-vouched is provable → deny (the asserted 'witnessed' does not count)
  assert.equal((await verifyPresentation(bare, req({ requiredAssurance: 'witnessed' }), { ...w.base, trust })).reason, 'assurance');
  // with a real VWC from the anchor → derives witnessed → passes
  const vwc = await w.issuer.mintEndorsement(w.registry, w.controller.did, 'witness');
  const withEvidence = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: w.chain, trust: [vwc.credential] });
  assert.equal((await verifyPresentation(withEvidence, req({ requiredAssurance: 'witnessed' }), { ...w.base, trust })).ok, true);
});
