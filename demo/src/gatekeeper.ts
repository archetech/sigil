/**
 * The substrate the demo runs Sigil against. Two implementations of the same shape the library's seams need:
 *
 *  - `makeOfflineGatekeeper` — an in-memory, content-addressed gatekeeper (the same design the library's tests
 *    use). It replays nothing over a network: mint and verify happen entirely in the browser. Deterministic,
 *    no node, no CORS, no footprint.
 *  - `makeLiveGatekeeper` — a real `@didcid/clients` GatekeeperClient pointed at a running node (CORS permitting).
 *
 * Both satisfy the library's `IssuerGatekeeper` (create/update/delete/resolve) and `GatekeeperLike` (resolve).
 */
import { GatekeeperClient } from '@didcid/clients';

export interface HashJSON { hashJSON(obj: unknown): string; }

export function makeOfflineGatekeeper(cipher: HashJSON) {
  type Entry = { type: 'agent' | 'asset'; publicJwk?: unknown; data?: unknown; deactivated: boolean; versionId: string };
  const store = new Map<string, Entry>();
  let seq = 0;
  return {
    async getBlock() { return null; },
    async createDID(op: any): Promise<string> {
      const did = `did:cid:demo${cipher.hashJSON(op).slice(0, 40)}`;
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

export async function makeLiveGatekeeper(url: string, apiKey?: string) {
  return GatekeeperClient.create({ url, apiKey });
}
