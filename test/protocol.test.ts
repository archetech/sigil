/**
 * The A2A exchange, offline: a verifier and a presenter run request → challenge → presentation → result over an
 * in-memory transport, driving the same `verifyPresentation`. Proves the protocol carries accept, out-of-scope
 * deny, and human step-up — no live node. The DIDComm equivalent is scripts/e2e-archon-didcomm.ts.
 *
 * @verifies R14
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { createArchonIssuer, createArchonResolver, createArchonSignatureVerifier, inMemoryNetwork, createVerifier, createPresenter, requestAccess, pump, MSG } from '../src/index.ts';
import type { ChallengeBody, ResultBody } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:verifier.example';
let n = 0;
const nonce = () => `nonce-${++n}`;

async function setup() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const alpha = await issuer.mintAgent();
  const beta = await issuer.mintAgent();
  const vrc = await issuer.mintRelationship(controller, alpha.did);
  const root = await issuer.mintAuthorization(controller, alpha.did, vrc.did, { actions: ['read', 'deploy', 'delete'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true }, { assuranceLevel: 'controller-vouched' });
  const d1 = await issuer.mintDelegation(alpha, root.credential, beta.did, { actions: ['read', 'deploy', 'delete'], resources: ['svc:api'], constraints: { audience: [V] } });
  return { issuer, deps, controller, beta, chain: [root.credential, d1.credential] };
}

/** Drive a full request → challenge → presentation → result exchange and return the verifier's result. */
async function exchange(s: Awaited<ReturnType<typeof setup>>, action: string, resource: string, opts: { highConsequence?: (a: string) => boolean; coSign?: boolean } = {}): Promise<ResultBody> {
  const net = inMemoryNetwork();
  const vt = net.transport(V);
  const pt = net.transport(s.beta.did);
  const verifier = createVerifier(s.deps, { audience: V, highConsequence: opts.highConsequence }, nonce);
  const presenter = createPresenter(async (ch: ChallengeBody) => {
    let p = s.issuer.present(s.beta, { challenge: ch.nonce, audience: ch.audience, credentials: s.chain });
    if (ch.requireHumanCoSign && opts.coSign) p = { ...p, coSign: s.issuer.coSign(s.controller, { challenge: ch.nonce, audience: ch.audience, action: ch.action, resource: ch.resource }) };
    return p;
  });

  await requestAccess(pt, V, { action, resource });
  await pump(vt, (f, m) => verifier.handle(f, m)); // request → challenge
  await pump(pt, (f, m) => presenter.handle(f, m)); // challenge → presentation
  await pump(vt, (f, m) => verifier.handle(f, m)); // presentation → result
  const drained = await pt.receive();
  return (drained.find((m) => m.type === MSG.result)?.body ?? { ok: false, reason: 'no-result' }) as ResultBody;
}

// @verifies R14
test('remote exchange: an in-scope action is accepted over the transport', async () => {
  const s = await setup();
  assert.deepEqual(await exchange(s, 'deploy', 'svc:api'), { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies R14
test('remote exchange: an out-of-scope action is denied', async () => {
  const s = await setup();
  assert.equal((await exchange(s, 'admin', 'svc:api')).reason, 'authorization');
});

// @verifies R14
test('remote exchange: a high-consequence action needs a co-sign', async () => {
  const s = await setup();
  const high = (a: string) => a === 'delete';
  assert.equal((await exchange(s, 'delete', 'svc:api', { highConsequence: high })).reason, 'co-sign-required');
  assert.deepEqual(await exchange(s, 'delete', 'svc:api', { highConsequence: high, coSign: true }), { ok: true, assuranceLevel: 'human-co-signed' });
});

// @verifies R14
test('remote exchange: a presentation with no prior challenge is refused', async () => {
  const s = await setup();
  const net = inMemoryNetwork();
  const vt = net.transport(V);
  const pt = net.transport(s.beta.did);
  const verifier = createVerifier(s.deps, { audience: V }, nonce);
  const p = s.issuer.present(s.beta, { challenge: 'x', audience: V, credentials: s.chain });
  await pt.send(V, { type: MSG.presentation, body: { presentation: p } });
  await pump(vt, (f, m) => verifier.handle(f, m));
  const drained = await pt.receive();
  assert.equal((drained.find((m) => m.type === MSG.result)?.body as ResultBody).reason, 'no-challenge');
});
