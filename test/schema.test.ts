/**
 * Sigil AAC schema reference. When the issuer is configured with the Sigil AAC schema DID, minted AACs carry a
 * `credentialSchema` reference (self-describing) — and it is covered by the credential's authenticity (inner proof
 * or op-log-as-proof), so tampering it is rejected while a faithful presentation still verifies. Offline.
 *
 * @verifies R14
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { AAC, Capability } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:verifier.example';
const SCHEMA = 'did:cid:test-sigil-aac-schema';
const CAP: Capability = { actions: ['deploy'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true };

async function world() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test', aacSchemaDid: SCHEMA });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const agent = await issuer.mintAgent();
  const vrc = await issuer.mintRelationship(controller, agent.did);
  const root = await issuer.mintAuthorization(controller, agent.did, vrc.did, CAP, { assuranceLevel: 'controller-vouched' });
  return { issuer, deps, agent, root };
}
const req = () => ({ nonce: 'n', audience: V, action: 'deploy', resource: 'svc:api' });

// @verifies R14
test('a configured issuer stamps credentialSchema, and the AAC verifies', async () => {
  const w = await world();
  assert.deepEqual(w.root.credential.credentialSchema, { id: SCHEMA, type: 'JsonSchema' });
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: [w.root.credential] });
  assert.equal((await verifyPresentation(pres, req(), w.deps)).ok, true);
});

// @verifies R14
test('tampering credentialSchema on the presented AAC is rejected (covered by the proof)', async () => {
  const w = await world();
  const tampered: AAC = { ...w.root.credential, credentialSchema: { id: 'did:cid:evil-schema', type: 'JsonSchema' } };
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: [tampered] });
  assert.equal((await verifyPresentation(pres, req(), w.deps)).reason, 'issuer-signature');
});
