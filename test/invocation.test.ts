/**
 * Invocation: the agent's committed, attributable act of exercising a capability (INV-1..5). An invocation binds
 * the specific {action, resource}; the verifier accepts only an in-scope, correctly-bound act; it can't be replayed
 * to another verifier or challenge; a completed invocation + receipt is an auditable record a third party can
 * attribute to the acting agent and the accountable principal. Offline, real cipher.
 *
 * @verifies INV-1, INV-2, INV-3, INV-4, INV-5
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyInvocation, verifyRecord, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Capability, Invocation } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:verifier.example';
const CAP: Capability = { actions: ['read', 'deploy', 'delete'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true };

async function world() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const alpha = await issuer.mintAgent();
  const beta = await issuer.mintAgent();
  const server = await issuer.mintAgent(); // the resource server (issues receipts)
  const vrc = await issuer.mintRelationship(controller, alpha.did);
  const root = await issuer.mintAuthorization(controller, alpha.did, vrc.did, CAP, { assuranceLevel: 'controller-vouched' });
  const d1 = await issuer.mintDelegation(alpha, root.credential, beta.did, { actions: ['read', 'deploy', 'delete'], resources: ['svc:api'], constraints: { audience: [V] } });
  return { issuer, deps, controller, beta, server, chain: [root.credential, d1.credential] };
}

const req = (extra: Record<string, unknown> = {}) => ({ nonce: 'n', audience: V, action: 'deploy', resource: 'svc:api', ...extra });
const invoke = (w: Awaited<ReturnType<typeof world>>, action = 'deploy', challenge = 'n', audience = V): Invocation =>
  w.issuer.invoke(w.beta, { challenge, audience, action, resource: 'svc:api', credentials: w.chain });

// @verifies INV-1, INV-2
test('an in-scope invocation is accepted and attributable to the acting agent', async () => {
  const w = await world();
  assert.deepEqual(await verifyInvocation(invoke(w), req(), w.deps), { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies INV-2
test('an out-of-scope invocation is denied', async () => {
  const w = await world();
  assert.equal((await verifyInvocation(invoke(w, 'admin'), req({ action: 'admin' }), w.deps)).reason, 'authorization');
});

// @verifies INV-1, INV-2
test('an invocation whose signed act differs from the requested one is denied', async () => {
  const w = await world();
  const inv = invoke(w, 'deploy');
  // request a different action than the holder signed → the committed act ≠ the request
  assert.equal((await verifyInvocation(inv, req({ action: 'delete' }), w.deps)).reason, 'invocation-binding');
});

// @verifies INV-1
test('tampering the action after signing invalidates the invocation', async () => {
  const w = await world();
  const inv = invoke(w, 'deploy');
  const tampered: Invocation = { ...inv, action: 'delete' };
  assert.equal((await verifyInvocation(tampered, req({ action: 'delete' }), w.deps)).reason, 'holder-binding');
});

// @verifies INV-3
test('an invocation cannot be replayed to a different verifier or challenge', async () => {
  const w = await world();
  const inv = invoke(w, 'deploy', 'n', V);
  assert.equal((await verifyInvocation(inv, req({ audience: 'did:web:other.example' }), w.deps)).reason, 'challenge-binding'); // different verifier
  assert.equal((await verifyInvocation(inv, req({ nonce: 'n2' }), w.deps)).reason, 'challenge-binding'); // stale/foreign challenge
});

// @verifies INV-5
test('a high-consequence invocation composes with the human co-sign', async () => {
  const w = await world();
  const bare = invoke(w, 'delete');
  assert.equal((await verifyInvocation(bare, req({ action: 'delete', requireHumanCoSign: true }), w.deps)).reason, 'co-sign-required');
  const cs = w.issuer.coSign(w.controller, { challenge: 'n', audience: V, action: 'delete', resource: 'svc:api' });
  const signed = w.issuer.invoke(w.beta, { challenge: 'n', audience: V, action: 'delete', resource: 'svc:api', credentials: w.chain, coSign: cs });
  assert.deepEqual(await verifyInvocation(signed, req({ action: 'delete', requireHumanCoSign: true }), w.deps), { ok: true, assuranceLevel: 'human-co-signed' });
});

// @verifies INV-4
test('a completed record (invocation + receipt) re-verifies and attributes the action', async () => {
  const w = await world();
  const inv = invoke(w, 'deploy');
  const receipt = w.issuer.mintReceipt(w.server, inv, 'accepted', { assuranceLevel: 'controller-vouched' });
  const res = await verifyRecord({ invocation: inv, receipt }, w.deps);
  assert.equal(res.ok, true);
  assert.equal(res.actor, w.beta.did);                 // the acting agent (leaf)
  assert.equal(res.accountablePrincipal, w.controller.did); // the accountable principal (root controller)
  assert.equal(res.assuranceLevel, 'controller-vouched');
});

// @verifies INV-4
test('a record with a receipt for the wrong invocation, or a forged receipt, is rejected', async () => {
  const w = await world();
  const inv = invoke(w, 'deploy');
  const other = invoke(w, 'read'); // a different invocation
  const wrongReceipt = w.issuer.mintReceipt(w.server, other, 'accepted');
  assert.equal((await verifyRecord({ invocation: inv, receipt: wrongReceipt }, w.deps)).reason, 'receipt-mismatch');

  const good = w.issuer.mintReceipt(w.server, inv, 'accepted');
  const forged = { ...good, proof: { ...good.proof, proofValue: 'AAAA' } };
  assert.equal((await verifyRecord({ invocation: inv, receipt: forged }, w.deps)).reason, 'receipt-signature');
});

// @verifies INV-4
test('a record whose invocation is invalid (e.g. revoked leaf) is rejected before attribution', async () => {
  const w = await world();
  const inv = invoke(w, 'deploy');
  await w.issuer.revoke(w.chain[1]!.id, w.controller); // deactivate the leaf delegation → the chain no longer verifies
  const res = await verifyRecord({ invocation: inv }, w.deps);
  assert.equal(res.ok, false);
  assert.equal(res.actor, undefined); // no attribution from an invalid record
});
