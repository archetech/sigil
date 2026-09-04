/**
 * Anchored engagement records — the bi-directional commitment mechanism. A completed invocation + receipt (the
 * agent's and the counterparty's signed commitments) is anchored as an op-log-as-proof asset controlled by the
 * performing party. A third party resolves it and verifies both commitments offline — without the AAC being
 * touched, so the grantor stays out of the loop. Offline, real cipher.
 *
 * @verifies INV-4
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyAnchoredRecord, verifyInvocation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Capability } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:verifier.example';
const CAP: Capability = { actions: ['deploy'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true };

async function engagement() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const agent = await issuer.mintAgent();
  const server = await issuer.mintAgent(); // the counterparty / resource server (audience + receipt signer + anchor)
  const vrc = await issuer.mintRelationship(controller, agent.did);
  const root = await issuer.mintAuthorization(controller, agent.did, vrc.did, { ...CAP, constraints: { audience: [server.did] } }, { assuranceLevel: 'controller-vouched' });

  // The agent invokes; the server receipts; the server anchors the completed record.
  const inv = issuer.invoke(agent, { challenge: 'n', audience: server.did, action: 'deploy', resource: 'svc:api', credentials: [root.credential] });
  const result = await verifyInvocation(inv, { nonce: 'n', audience: server.did, action: 'deploy', resource: 'svc:api' }, deps);
  const receipt = issuer.mintReceipt(server, inv, 'accepted', { assuranceLevel: result.assuranceLevel });
  const { did } = await issuer.anchorRecord(server, { invocation: inv, receipt });
  return { gk, issuer, deps, controller, agent, server, inv, receipt, recordDid: did };
}

// @verifies INV-4
test('a third party verifies an anchored record and reads both commitments + attribution', async () => {
  const e = await engagement();
  const res = await verifyAnchoredRecord(e.recordDid, e.deps);
  assert.equal(res.ok, true);
  assert.equal(res.actor, e.agent.did);                 // the agent's committed act
  assert.equal(res.accountablePrincipal, e.controller.did); // under the accountable principal
  assert.equal(res.anchoredBy, e.server.did);           // durably committed by the counterparty
});

// @verifies INV-4
test('a record anchored by someone other than the receipt server is denied', async () => {
  const e = await engagement();
  const impostor = await e.issuer.mintAgent();
  const { did } = await e.issuer.anchorRecord(impostor, { invocation: e.inv, receipt: e.receipt }); // impostor anchors the server's receipt
  assert.equal((await verifyAnchoredRecord(did, e.deps)).reason, 'anchor-mismatch');
});

// @verifies INV-4
test('an anchored record with a tampered invocation is denied', async () => {
  const e = await engagement();
  // tamper the invocation's action inside a re-anchored record
  const badInv = { ...e.inv, action: 'delete' };
  const { did } = await e.issuer.anchorRecord(e.server, { invocation: badInv as typeof e.inv, receipt: e.receipt });
  assert.equal((await verifyAnchoredRecord(did, e.deps)).ok, false); // the tampered invocation fails holder binding
});

// @verifies INV-4
test('a revoked anchored record no longer verifies (fail-closed)', async () => {
  const e = await engagement();
  await e.issuer.revoke(e.recordDid, e.server); // the anchor can retract its commitment
  assert.equal((await verifyAnchoredRecord(e.recordDid, e.deps)).reason, 'record-unresolvable');
});
