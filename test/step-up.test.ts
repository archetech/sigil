/**
 * Human step-up (AC-11): for an action the verifier designates high-consequence, a fresh proof-of-human co-sign
 * by the accountable principal (the root's controller) is required — bound to the exact request, non-replayable,
 * and yielding assurance `human-co-signed`. Offline, over the fake gatekeeper + real cipher.
 *
 * @verifies AC-11
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Capability, Presentation } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:vendor.example';
const NONCE = 'n-step-up';
const CAP: Capability = { actions: ['read', 'delete'], resources: ['res:vault'], constraints: { audience: [V] }, delegable: true };

async function world() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const A = await issuer.mintAgent();
  const vrc = await issuer.mintRelationship(controller, A.did);
  const root = await issuer.mintAuthorization(controller, A.did, vrc.did, CAP, { assuranceLevel: 'controller-vouched' });
  return { gk, issuer, deps, controller, A, root, chain: [root.credential] };
}

const present = (w: Awaited<ReturnType<typeof world>>): Presentation =>
  w.issuer.present(w.A, { challenge: NONCE, audience: V, credentials: w.chain });
const req = (action: string, extra: Record<string, unknown> = {}) =>
  ({ nonce: NONCE, audience: V, action, resource: 'res:vault', ...extra });

// @verifies AC-11
test('a high-consequence action without a co-sign is denied', async () => {
  const w = await world();
  assert.equal((await verifyPresentation(present(w), req('delete', { requireHumanCoSign: true }), w.deps)).reason, 'co-sign-required');
});

// @verifies AC-11
test('a valid principal co-sign lifts a high-consequence action to human-co-signed', async () => {
  const w = await world();
  const p: Presentation = { ...present(w), coSign: w.issuer.coSign(w.controller, { challenge: NONCE, audience: V, action: 'delete', resource: 'res:vault' }) };
  assert.deepEqual(await verifyPresentation(p, req('delete', { requireHumanCoSign: true }), w.deps), { ok: true, assuranceLevel: 'human-co-signed' });
});

// @verifies AC-11
test('a co-sign by anyone but the accountable principal is denied', async () => {
  const w = await world();
  const p: Presentation = { ...present(w), coSign: w.issuer.coSign(w.A, { challenge: NONCE, audience: V, action: 'delete', resource: 'res:vault' }) }; // the agent, not the controller
  assert.equal((await verifyPresentation(p, req('delete', { requireHumanCoSign: true }), w.deps)).reason, 'co-sign-authorizer');
});

// @verifies AC-11
test('a co-sign bound to a different action or a tampered proof is denied', async () => {
  const w = await world();
  const wrongAction: Presentation = { ...present(w), coSign: w.issuer.coSign(w.controller, { challenge: NONCE, audience: V, action: 'read', resource: 'res:vault' }) };
  assert.equal((await verifyPresentation(wrongAction, req('delete', { requireHumanCoSign: true }), w.deps)).reason, 'co-sign-binding');

  const good = w.issuer.coSign(w.controller, { challenge: NONCE, audience: V, action: 'delete', resource: 'res:vault' });
  const tampered: Presentation = { ...present(w), coSign: { ...good, proof: { ...good.proof, proofValue: 'AAAA' } } };
  assert.equal((await verifyPresentation(tampered, req('delete', { requireHumanCoSign: true }), w.deps)).reason, 'co-sign-invalid');
});

// @verifies AC-11, AC-10
test('a non-high-consequence action is unaffected by the co-sign path', async () => {
  const w = await world();
  assert.deepEqual(await verifyPresentation(present(w), req('read'), w.deps), { ok: true, assuranceLevel: 'controller-vouched' });
  // AC-10: requiring a higher assurance level than was proved is denied on assurance.
  assert.equal((await verifyPresentation(present(w), req('read', { requiredAssurance: 'human-co-signed' }), w.deps)).reason, 'assurance');
});

// @verifies AC-11
test('the co-signer must be the ROOT principal even for a delegated leaf', async () => {
  const w = await world();
  const B = await w.issuer.mintAgent();
  const d1 = await w.issuer.mintDelegation(w.A, w.root.credential, B.did, { actions: ['delete'], resources: ['res:vault'], constraints: { audience: [V] } });
  const chain = [w.root.credential, d1.credential];
  const base = w.issuer.present(B, { challenge: NONCE, audience: V, credentials: chain });

  const byController: Presentation = { ...base, coSign: w.issuer.coSign(w.controller, { challenge: NONCE, audience: V, action: 'delete', resource: 'res:vault' }) };
  assert.deepEqual(await verifyPresentation(byController, req('delete', { requireHumanCoSign: true }), w.deps), { ok: true, assuranceLevel: 'human-co-signed' });

  const byDelegator: Presentation = { ...base, coSign: w.issuer.coSign(w.A, { challenge: NONCE, audience: V, action: 'delete', resource: 'res:vault' }) };
  assert.equal((await verifyPresentation(byDelegator, req('delete', { requireHumanCoSign: true }), w.deps)).reason, 'co-sign-authorizer');
});
