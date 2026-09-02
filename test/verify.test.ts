/**
 * Anchor use-case tests (present → verify). In-memory fakes for the Archon substrate (resolver) and the crypto
 * (signature verifier), so the verification logic is exercised without a live node. The `@verifies` tags below
 * feed the traceability matrix (docs/traceability.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyPresentation } from '../src/verify.ts';
import type { AAC, VRC, Jwk, Proof, Presentation, Resolver, ResolvedDid, SignatureVerifier, VerifyRequest } from '../src/types.ts';

// ── fakes ────────────────────────────────────────────────────────────────
// These stand in for the live Archon adapters (createArchonResolver / createArchonSignatureVerifier). They
// model the same contract: the verifier canonicalizes the proof-less object; the resolver returns key state.
const keyOf = (did: string): Jwk => ({ kty: 'OKP', crv: 'Ed25519', x: `x-${did}` });
const vmOf = (did: string): string => `${did}#key-1`;
const CREATED = '2026-05-01T00:00:00Z';

/** A valid fake signature is `sig|<key.x>|<canonical(signed)>` — binding both the signing key and the bytes.
 *  (JSON.stringify stands in for JCS here; both the signer and this verifier use it, so they agree.) */
const signatures: SignatureVerifier = {
  async verify(signed, proof, key) {
    return typeof key.x === 'string' && proof.proofValue === `sig|${key.x}|${JSON.stringify(signed)}`;
  },
};
const sign = (signed: unknown, signerDid: string): Proof => ({
  type: 'EcdsaSecp256k1Signature2019',
  created: CREATED,
  verificationMethod: vmOf(signerDid),
  proofPurpose: 'assertionMethod',
  proofValue: `sig|${keyOf(signerDid).x}|${JSON.stringify(signed)}`,
});
const signCred = <T extends object>(body: T, signerDid: string): T & { proof: Proof } => ({
  ...body,
  proof: sign(body, signerDid),
});
/** A presentation's holder proof binds {holder, challenge, audience} (the credentials carry their own proofs). */
const signPres = (holder: string, challenge: string, audience: string, credentials: readonly AAC[]): Presentation => ({
  holder,
  challenge,
  audience,
  credentials,
  proof: sign({ holder, challenge, audience }, holder),
});

function makeResolver() {
  const m = new Map<string, ResolvedDid>();
  return {
    agent: (did: string): void => void m.set(did, { did, deactivated: false, kind: 'agent', keys: { [vmOf(did)]: keyOf(did) } }),
    asset: (did: string, data?: unknown): void => void m.set(did, { did, deactivated: false, kind: 'asset', data }),
    deactivate: (did: string): void => { const d = m.get(did); if (d) m.set(did, { ...d, deactivated: true }); },
    // opts (versionTime) is ignored: the fake has no history, so point-in-time == current here.
    resolver: { resolve: async (did: string): Promise<ResolvedDid | undefined> => m.get(did) } as Resolver,
  };
}

// ── a valid world ────────────────────────────────────────────────────────
const CONTROLLER = 'did:web:acme.example';
const AGENT = 'did:cid:agentA';
const VENDOR = 'did:web:vendor.example';
const VRC_ID = 'did:cid:vrc1';
const AAC_ID = 'did:cid:aac1';

function world(opts: { agent?: string; controller?: string } = {}) {
  const agent = opts.agent ?? AGENT;
  const controller = opts.controller ?? CONTROLLER;
  const r = makeResolver();
  r.agent(controller);
  r.agent(agent);

  const vrc: VRC = signCred(
    { id: VRC_ID, type: ['VerifiableCredential', 'VerifiableRelationshipCredential'], issuer: controller, credentialSubject: { id: agent } },
    controller,
  );
  r.asset(VRC_ID, vrc);

  const aac: AAC = signCred(
    {
      id: AAC_ID,
      type: ['VerifiableCredential', 'AgentAuthorizationCredential'],
      issuer: controller,
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2027-01-01T00:00:00Z',
      credentialSubject: {
        id: agent,
        relationship: VRC_ID,
        authorization: { actions: ['invoke:catalog.search'], resources: ['res:catalog'], constraints: { audience: [VENDOR] } },
        assuranceLevel: 'controller-vouched',
      },
    },
    controller,
  );
  r.asset(AAC_ID, aac); // for the revocation (deactivation) check

  const pres: Presentation = signPres(agent, 'nonce-123', VENDOR, [aac]);

  const req: VerifyRequest = { nonce: 'nonce-123', audience: VENDOR, action: 'invoke:catalog.search', resource: 'res:catalog', now: '2026-06-01T00:00:00Z' };
  return { r, aac, vrc, pres, req, deps: { resolver: r.resolver, signatures } };
}

// ── tests ────────────────────────────────────────────────────────────────

// @verifies AC-1, AC-3, AC-5
test('anchor: a valid present-and-verify succeeds', async () => {
  const { pres, req, deps } = world();
  const res = await verifyPresentation(pres, req, deps);
  assert.deepEqual(res, { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies AC-1, AC-2
test('not bearer: a tampered holder proof is denied', async () => {
  const { pres, req, deps } = world();
  const forged: Presentation = { ...pres, proof: { ...pres.proof, proofValue: 'sig|forged|x' } };
  assert.equal((await verifyPresentation(forged, req, deps)).reason, 'holder-binding');
});

// @verifies AC-2
test('not bearer: presenting the AAC under a different holder key is denied', async () => {
  const { pres, req, deps } = world();
  // an attacker holds the credential bytes but signs with their own (unrelated) key/DID
  const attacker: Presentation = { ...pres, proof: sign({ holder: pres.holder, challenge: pres.challenge, audience: pres.audience }, 'did:cid:mallory') };
  const res = await verifyPresentation(attacker, req, deps);
  assert.equal(res.ok, false); // the resolved holder key is the agent's, not mallory's → mismatch
});

// @verifies AC-5
test('out-of-scope action is denied', async () => {
  const { pres, req, deps } = world();
  assert.equal((await verifyPresentation(pres, { ...req, action: 'invoke:catalog.delete' }, deps)).reason, 'authorization');
});

// @verifies AC-6
test('presenting to a verifier outside constraints.audience is denied', async () => {
  const { pres, deps, req } = world();
  const other = 'did:web:evil.example';
  // rebuild the presentation bound to the other audience so challenge-binding passes and we reach the audience check
  const p2 = signPres(pres.holder, pres.challenge, other, pres.credentials);
  assert.equal((await verifyPresentation(p2, { ...req, audience: other }, deps)).reason, 'audience');
});

// @verifies AC-7
test('a revoked (deactivated) AAC is denied, fail-closed', async () => {
  const { pres, req, deps, r } = world();
  r.deactivate(AAC_ID);
  assert.equal((await verifyPresentation(pres, req, deps)).reason, 'revoked');
});

// @verifies AC-13
test('a revoked (deactivated) VRC denies the AAC that references it', async () => {
  const { pres, req, deps, r } = world();
  r.deactivate(VRC_ID);
  assert.equal((await verifyPresentation(pres, req, deps)).reason, 'relationship-revoked');
});

// @verifies AC-7
test('an expired AAC is denied', async () => {
  const { pres, req, deps } = world();
  assert.equal((await verifyPresentation(pres, { ...req, now: '2030-01-01T00:00:00Z' }, deps)).reason, 'validity');
});

// @verifies AC-7
test('an unresolvable credential denies fail-closed', async () => {
  const { pres, req, deps, r } = world();
  r.deactivate(VRC_ID); // simulate: use a resolver that drops it entirely
  const droppingDeps = { ...deps, resolver: { resolve: async (did: string) => (did === VRC_ID ? undefined : deps.resolver.resolve(did)) } };
  assert.equal((await verifyPresentation(pres, req, droppingDeps)).reason, 'relationship-unresolvable');
});

// @verifies AC-3
test('an AAC whose issuer is not a party to the VRC is denied', async () => {
  const { r, aac, pres, req } = world();
  // re-issue the AAC signed by a stranger (not the controller in the VRC)
  const stranger = 'did:web:stranger.example';
  r.agent(stranger);
  const rogueAac: AAC = signCred({ id: aac.id, type: aac.type, issuer: stranger, validFrom: aac.validFrom, validUntil: aac.validUntil, credentialSubject: aac.credentialSubject }, stranger);
  const p2 = signPres(pres.holder, pres.challenge, pres.audience, [rogueAac]);
  assert.equal((await verifyPresentation(p2, req, { resolver: r.resolver, signatures })).reason, 'issuer-not-party');
});

// @verifies AC-12
test('a denial reason is a check-class label, never the subject or scope', async () => {
  const { pres, req, deps } = world();
  const res = await verifyPresentation(pres, { ...req, action: 'invoke:catalog.delete' }, deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'authorization');
  assert.ok(!JSON.stringify(res).includes(AGENT)); // no subject DID leaked
  assert.ok(!JSON.stringify(res).includes('catalog.search')); // no scope contents leaked
});

// @verifies AC-9
test('a non-native did:web agent verifies (method-agnostic)', async () => {
  const webAgent = 'did:web:agent.partner.example';
  const { pres, req, deps } = world({ agent: webAgent });
  assert.equal((await verifyPresentation(pres, req, deps)).ok, true);
});
