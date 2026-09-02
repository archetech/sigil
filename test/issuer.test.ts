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
import type { Jwk } from '../src/index.ts';

const cipher = new Cipher();

/** A minimal in-memory gatekeeper: content-addresses DIDs (hashJSON), applies updates, marks deletes. */
function fakeGatekeeper() {
  type Entry = { type: 'agent' | 'asset'; publicJwk?: Jwk; data?: unknown; deactivated: boolean; versionId: string };
  const store = new Map<string, Entry>();
  let seq = 0;
  return {
    async getBlock() { return null; },
    async createDID(op: any): Promise<string> {
      const did = `did:cid:test${cipher.hashJSON(op).slice(0, 44)}`;
      store.set(did, { type: op.registration.type, publicJwk: op.publicJwk, data: op.data, deactivated: false, versionId: `v${++seq}` });
      return did;
    },
    async updateDID(op: any): Promise<boolean> {
      const e = store.get(op.did); if (!e) return false;
      e.data = op.doc?.didDocumentData; e.versionId = `v${++seq}`; return true;
    },
    async deleteDID(op: any): Promise<boolean> {
      const e = store.get(op.did); if (!e) return false;
      e.deactivated = true; e.versionId = `v${++seq}`; return true;
    },
    async resolveDID(did: string): Promise<any> {
      const e = store.get(did);
      if (!e) return { didResolutionMetadata: { error: 'invalidDid' }, didDocument: {}, didDocumentMetadata: {} };
      const didDocumentMetadata = { deactivated: e.deactivated, versionId: e.versionId };
      if (e.type === 'agent') return { didDocument: { verificationMethod: [{ id: '#key-1', publicKeyJwk: e.publicJwk }] }, didDocumentMetadata };
      return { didDocumentData: e.deactivated ? undefined : e.data, didDocumentMetadata };
    },
  };
}

const AUTH = { actions: ['invoke:catalog.search'], resources: ['res:catalog'], constraints: { audience: ['did:web:vendor.example'] } };

async function mintWorld() {
  const gk = fakeGatekeeper();
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
