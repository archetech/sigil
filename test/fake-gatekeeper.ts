/**
 * A minimal in-memory gatekeeper for offline issuer↔verifier tests: it content-addresses DIDs (via the cipher's
 * hashJSON of the create op), applies updates, and marks deletes — enough for createArchonIssuer to mint and
 * createArchonResolver to resolve, with no live node. Not a test itself; imported by the *.test.ts files.
 */
import type { Jwk } from '../src/index.ts';

export interface HashJSON { hashJSON(obj: unknown): string; }

export function makeFakeGatekeeper(cipher: HashJSON) {
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
