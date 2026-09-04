/**
 * Pairwise / correlation resistance (R12, PW-1..4). An agent acts under a **persona** — a fresh DID delegated to
 * per relationship — so the verifier never sees the canonical agent and can't correlate two personas of the same
 * agent. A persona-link (DTG VPC), signed by the canonical agent and kept out-of-band, is the with-cause recovery
 * path: `verifyPersonaLink` unmasks persona → canonical only with a valid, unrevoked link. Offline, real cipher.
 *
 * @verifies PW-1, PW-2, PW-3, PW-4
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyInvocation, verifyRecord, verifyPersonaLink, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Capability } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const CAP: Capability = { actions: ['deploy'], resources: ['svc:api'], delegable: true };

async function world() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const agent = await issuer.mintAgent(); // the canonical acting agent
  return { gk, issuer, deps, controller, agent };
}

/** An audience-bound chain issued to the PERSONA directly — the persona stands in for the canonical agent, so the
 *  canonical DID never appears in the chain. (The controller is the accountable root and is legitimately present.) */
async function chainToPersona(w: Awaited<ReturnType<typeof world>>, persona: string, audience: string) {
  const cap = { ...CAP, constraints: { audience: [audience] } };
  const vrc = await w.issuer.mintRelationship(w.controller, persona);
  const root = await w.issuer.mintAuthorization(w.controller, persona, vrc.did, cap, { assuranceLevel: 'controller-vouched' });
  return [root.credential];
}

// @verifies PW-1
test('an agent acts under a persona; the verifier attributes to the persona, not the canonical agent', async () => {
  const w = await world();
  const V = 'did:web:v1.example';
  const { persona } = await w.issuer.mintPersona(w.agent);
  const chain = await chainToPersona(w, persona.did, V);
  const inv = w.issuer.invoke(persona, { challenge: 'n', audience: V, action: 'deploy', resource: 'svc:api', credentials: chain });
  const res = await verifyInvocation(inv, { nonce: 'n', audience: V, action: 'deploy', resource: 'svc:api' }, w.deps);
  assert.equal(res.ok, true);
  // The canonical agent DID appears NOWHERE in the presentation.
  assert.ok(!JSON.stringify(inv).includes(w.agent.did), 'canonical agent DID is not in the presentation');
});

// @verifies PW-2
test('two personas of the same agent are unlinkable — no shared DID reveals the common agent', async () => {
  const w = await world();
  const p1 = (await w.issuer.mintPersona(w.agent)).persona;
  const p2 = (await w.issuer.mintPersona(w.agent)).persona;
  const inv1 = w.issuer.invoke(p1, { challenge: 'a', audience: 'did:web:v1.example', action: 'deploy', resource: 'svc:api', credentials: await chainToPersona(w, p1.did, 'did:web:v1.example') });
  const inv2 = w.issuer.invoke(p2, { challenge: 'b', audience: 'did:web:v2.example', action: 'deploy', resource: 'svc:api', credentials: await chainToPersona(w, p2.did, 'did:web:v2.example') });
  assert.notEqual(p1.did, p2.did);
  const s1 = JSON.stringify(inv1), s2 = JSON.stringify(inv2);
  assert.ok(!s1.includes(w.agent.did) && !s2.includes(w.agent.did), 'neither presentation carries the canonical agent');
  assert.ok(!s1.includes(p2.did) && !s2.includes(p1.did), 'the personas do not cross-reference');
});

// @verifies PW-3
test('a persona-link unmasks persona → canonical for an authorized holder', async () => {
  const w = await world();
  const { persona, link } = await w.issuer.mintPersona(w.agent);
  const res = await verifyPersonaLink(link, w.deps);
  assert.deepEqual(res, { ok: true, persona: persona.did, canonical: w.agent.did });
});

// @verifies PW-4
test('persona-link verification fails closed: forged, wrong-signer, or revoked does not unmask', async () => {
  const w = await world();
  const { link } = await w.issuer.mintPersona(w.agent);

  // forged signature
  const forged = { ...link, proof: { ...link.proof!, proofValue: 'AAAA' } };
  assert.equal((await verifyPersonaLink(forged, w.deps)).reason, 'signature');

  // a link claiming a different canonical (issuer) than the one who actually signed → signature check fails
  const impersonating = { ...link, issuer: w.controller.did };
  assert.equal((await verifyPersonaLink(impersonating, w.deps)).ok, false);

  // revoked link → no unmasking
  const { link: link2 } = await w.issuer.mintPersona(w.agent);
  await w.issuer.revoke(link2.id, w.agent);
  assert.equal((await verifyPersonaLink(link2, w.deps)).reason, 'revoked');
});

// @verifies PW-1, PW-3
test('the record attributes to the persona; the canonical is recovered only via the link', async () => {
  const w = await world();
  const V = 'did:web:v1.example';
  const { persona, link } = await w.issuer.mintPersona(w.agent);
  const chain = await chainToPersona(w, persona.did, V);
  const inv = w.issuer.invoke(persona, { challenge: 'n', audience: V, action: 'deploy', resource: 'svc:api', credentials: chain });
  const rec = await verifyRecord({ invocation: inv }, w.deps);
  assert.equal(rec.actor, persona.did);            // the record attributes to the persona, not the canonical agent
  assert.notEqual(rec.actor, w.agent.did);
  // with cause (holding the link) the auditor recovers the canonical:
  assert.equal((await verifyPersonaLink(link, w.deps)).canonical, w.agent.did);
});
