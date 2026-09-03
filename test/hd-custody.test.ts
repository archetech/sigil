/**
 * HD-seed custody + recovery. In seed mode the issuer derives every identity's key from one BIP-39 mnemonic (the
 * same mechanism the Keymaster uses) so keys are recoverable: same seed + index ⇒ same key. A recovered signer
 * regains the ability to sign for its already-anchored DID. Random mode (no mnemonic) is unchanged. Offline.
 *
 * @verifies R1
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Capability } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const MNEMONIC = cipher.generateMnemonic();
const V = 'did:web:verifier.example';
const CAP: Capability = { actions: ['read'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true };

// @verifies R1
test('seed mode derives recoverable keys; random mode does not', async () => {
  const gk = makeFakeGatekeeper(cipher);
  const hd = createArchonIssuer(gk, cipher, { registry: 'test', mnemonic: MNEMONIC });
  const rand = createArchonIssuer(gk, cipher, { registry: 'test' });

  assert.equal(hd.mnemonic, MNEMONIC);
  assert.equal(rand.mnemonic, undefined);

  const a = await hd.mintAgent();
  const b = await hd.mintAgent();
  assert.equal(a.index, 0);
  assert.equal(b.index, 1);              // incrementing HD index
  assert.notEqual(a.privateJwk.d, b.privateJwk.d); // distinct keys per identity

  const r = await rand.mintAgent();
  assert.equal(r.index, undefined);       // random mode carries no index
});

// @verifies R1
test('the same seed + index reproduces the same key across issuer instances (recovery)', async () => {
  const gk = makeFakeGatekeeper(cipher);
  const issuerA = createArchonIssuer(gk, cipher, { registry: 'test', mnemonic: MNEMONIC });
  const agent = await issuerA.mintAgent(); // index 0, did D

  // A fresh issuer with only the SAME mnemonic recovers the identical signing key for the recorded (index, did).
  const issuerB = createArchonIssuer(gk, cipher, { registry: 'test', mnemonic: MNEMONIC });
  const recovered = issuerB.recover(agent.index!, agent.did);
  assert.equal(recovered.did, agent.did);
  assert.deepEqual(recovered.privateJwk, agent.privateJwk); // same key from same seed + index
});

// @verifies R1
test('a recovered signer can sign a valid presentation for its DID', async () => {
  const gk = makeFakeGatekeeper(cipher);
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test', mnemonic: MNEMONIC });
  const controller = await issuer.mintAgent();
  const agent = await issuer.mintAgent();
  const vrc = await issuer.mintRelationship(controller, agent.did);
  const root = await issuer.mintAuthorization(controller, agent.did, vrc.did, CAP, { assuranceLevel: 'controller-vouched' });

  // Recover the agent (as if from cold storage) and present with the recovered signer.
  const recoveredAgent = issuer.recover(agent.index!, agent.did);
  const pres = issuer.present(recoveredAgent, { challenge: 'n', audience: V, credentials: [root.credential] });
  const res = await verifyPresentation(pres, { nonce: 'n', audience: V, action: 'read', resource: 'svc:api' }, deps);
  assert.deepEqual(res, { ok: true, assuranceLevel: 'controller-vouched' });
});

// @verifies R1
test('recover() in random mode throws (no seed)', () => {
  const gk = makeFakeGatekeeper(cipher);
  const rand = createArchonIssuer(gk, cipher, { registry: 'test' });
  assert.throws(() => rand.recover(0, 'did:cid:x'), /mnemonic/);
});
