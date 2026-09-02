/**
 * Issuer ↔ verifier round-trip, offline. A fake gatekeeper records create/update/delete operations and answers
 * resolutions from them; real `@didcid/cipher` does the signing. So the issuer mints exactly what the verifier
 * consumes, and revocation (a `delete`) flows through — all without a live node. The live equivalent runs in
 * scripts/e2e-archon-prove.ts.
 *
 * @verifies R1, R3, AC-3, AC-7, AC-13
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();

const AUTH = { actions: ['invoke:catalog.search'], resources: ['res:catalog'], constraints: { audience: ['did:web:vendor.example'] } };

async function mintWorld() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };

  const controller = await issuer.mintAgent();
  const agent = await issuer.mintAgent();
  const rel = await issuer.mintRelationship(controller, agent.did);
  const auth = await issuer.mintAuthorization(controller, agent.did, rel.did, AUTH, { assuranceLevel: 'controller-vouched' });
  const pres = issuer.present(agent, { challenge: 'n1', audience: 'did:web:vendor.example', credentials: [auth.credential] });
  const req = { nonce: 'n1', audience: 'did:web:vendor.example', action: 'invoke:catalog.search', resource: 'res:catalog' };
  return { gk, issuer, deps, controller, agent, rel, auth, pres, req };
}

// @verifies R1, R3, AC-3
test('issuer→verifier: minted VRC + AAC verify through the resolver/signature adapters', async () => {
  const { deps, pres, req } = await mintWorld();
  assert.deepEqual(await verifyPresentation(pres, req, deps), { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies AC-3
test('issuer→verifier: an out-of-scope action against a minted AAC is denied', async () => {
  const { deps, pres, req } = await mintWorld();
  assert.equal((await verifyPresentation(pres, { ...req, action: 'invoke:catalog.delete' }, deps)).reason, 'authorization');
});

// @verifies AC-7
test('issuer→verifier: revoking (deleting) the AAC denies it, fail-closed', async () => {
  const { issuer, deps, pres, req, controller, auth } = await mintWorld();
  assert.equal(await issuer.revoke(auth.did, controller), true);
  assert.equal((await verifyPresentation(pres, req, deps)).reason, 'revoked');
});

// @verifies AC-13
test('issuer→verifier: revoking the VRC denies the AAC that references it', async () => {
  const { issuer, deps, pres, req, controller, rel } = await mintWorld();
  assert.equal(await issuer.revoke(rel.did, controller), true);
  assert.equal((await verifyPresentation(pres, req, deps)).reason, 'relationship-revoked');
});
