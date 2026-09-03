/**
 * Structured authorization (R5/AC-4): authority is a structured `{actions, resources, constraints}` object, never
 * free-text. The verifier independently rejects any hop whose authorization is not structured — so a buggy or
 * malicious issuer can't smuggle free-text scope past the checks — and the issuer refuses to mint one. Offline.
 *
 * @verifies R5, AC-4
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier, isStructuredCapability } from '../src/index.ts';
import type { AAC, Signer } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:verifier.example';

/** Store a raw AAC asset signed by `issuer`, bypassing the issuer's structural guard (to test the verifier). */
async function forgeAac(gk: any, signer: Signer, buildBody: (did: string) => object): Promise<AAC> {
  const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64url');
  const did = await gk.createDID({ registration: { type: 'asset' }, controller: signer.did, data: { pending: true } });
  const body = buildBody(did);
  const proofValue = b64(cipher.signHash(cipher.hashJSON(body), signer.privateJwk as any));
  const cred = { ...body, proof: { type: 'EcdsaSecp256k1Signature2019', created: new Date().toISOString(), verificationMethod: `${signer.did}#key-1`, proofPurpose: 'authentication', proofValue } } as AAC;
  await gk.updateDID({ did, doc: { didDocumentData: cred } });
  return cred;
}

async function world() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const agent = await issuer.mintAgent();
  const vrc = await issuer.mintRelationship(controller, agent.did);
  return { gk, issuer, deps, controller, agent, vrc };
}

// @verifies R5, AC-4
test('the verifier rejects a validly-signed AAC whose authorization is free-text', async () => {
  const w = await world();
  const bad = await forgeAac(w.gk, w.controller, (did) => ({
    id: did, type: ['VerifiableCredential', 'AgentAuthorizationCredential'], issuer: w.controller.did,
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2099-01-01T00:00:00Z',
    credentialSubject: { id: w.agent.did, relationship: w.vrc.did, authorization: 'may deploy anything' }, // free-text!
  }));
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: [bad] });
  const res = await verifyPresentation(pres, { nonce: 'n', audience: V, action: 'deploy', resource: 'svc:api' }, w.deps);
  assert.equal(res.reason, 'authorization-shape');
});

// @verifies AC-4
test('the verifier rejects an AAC whose authorization is missing the required arrays', async () => {
  const w = await world();
  const bad = await forgeAac(w.gk, w.controller, (did) => ({
    id: did, type: ['VerifiableCredential', 'AgentAuthorizationCredential'], issuer: w.controller.did,
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2099-01-01T00:00:00Z',
    credentialSubject: { id: w.agent.did, relationship: w.vrc.did, authorization: { actions: ['deploy'] } }, // no resources[]
  }));
  const pres = w.issuer.present(w.agent, { challenge: 'n', audience: V, credentials: [bad] });
  assert.equal((await verifyPresentation(pres, { nonce: 'n', audience: V, action: 'deploy', resource: 'svc:api' }, w.deps)).reason, 'authorization-shape');
});

// @verifies R5, AC-4
test('the issuer refuses to mint a free-text authorization', async () => {
  const w = await world();
  await assert.rejects(() => w.issuer.mintAuthorization(w.controller, w.agent.did, w.vrc.did, 'may deploy anything' as any), /structured/);
});

// @verifies AC-4
test('isStructuredCapability accepts structured, rejects free-text / malformed', () => {
  assert.equal(isStructuredCapability({ actions: ['read'], resources: ['r'] }), true);
  assert.equal(isStructuredCapability({ actions: ['read'], resources: ['r'], constraints: { audience: ['v'] }, delegable: true }), true);
  assert.equal(isStructuredCapability('free text'), false);
  assert.equal(isStructuredCapability(null), false);
  assert.equal(isStructuredCapability({ actions: ['read'] }), false);           // missing resources
  assert.equal(isStructuredCapability({ actions: 'read', resources: ['r'] }), false); // actions not an array
  assert.equal(isStructuredCapability({ actions: [1], resources: ['r'] }), false);    // non-string members
  assert.equal(isStructuredCapability({ actions: ['read'], resources: ['r'], delegable: 'yes' }), false); // bad delegable
});