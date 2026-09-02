/**
 * The live Archon substrate behind the `Resolver` seam: DID resolution by operation-log replay, via an
 * Archon gatekeeper. A `did:cid` has no stored document — the gatekeeper replays its create/update/delete
 * operations and returns the resulting state, optionally pinned to a point in time (`versionTime`/`versionId`).
 *
 * The mapping to `ResolvedDid`:
 *   - `deactivated`  ← a `delete` was replayed (`didDocumentMetadata.deactivated`). Revocation is this bit.
 *   - agent          ← the doc carries verification methods (keys that can sign); we index them by their id.
 *   - asset          ← no keys; the held data (e.g. a VRC / AAC credential) is `didDocumentData`.
 *
 * A `@didcid/clients` `GatekeeperClient` satisfies `GatekeeperLike` structurally, so this stays decoupled
 * from the client package's concrete types. A resolution that throws (network / not found) becomes
 * `undefined`, which every caller treats as fail-closed.
 *
 * @implements R2, R10, AC-7
 */
import type { Jwk, ResolvedDid, Resolver } from '../types.ts';

/** The one gatekeeper call this adapter needs. `GatekeeperClient.resolveDID` matches this shape. */
export interface GatekeeperLike {
  resolveDID(did: string, options?: { versionTime?: string; versionId?: string }): Promise<GatekeeperDidDocument>;
}

/** The slice of the gatekeeper's resolution result this adapter reads (a subset of `DidCidDocument`). */
export interface GatekeeperDidDocument {
  didDocument?: {
    verificationMethod?: Array<{ id?: string; publicKeyJwk?: unknown }>;
  };
  didDocumentMetadata?: { deactivated?: boolean };
  didDocumentData?: unknown;
}

export function createArchonResolver(gatekeeper: GatekeeperLike): Resolver {
  return {
    async resolve(did, opts) {
      let doc: GatekeeperDidDocument;
      try {
        const options: { versionTime?: string; versionId?: string } = {};
        if (opts?.versionTime) options.versionTime = opts.versionTime;
        if (opts?.versionId) options.versionId = opts.versionId;
        doc = await gatekeeper.resolveDID(did, Object.keys(options).length ? options : undefined);
      } catch {
        return undefined; // unresolvable → fail-closed at the caller
      }
      if (!doc || typeof doc !== 'object') return undefined;

      const deactivated = doc.didDocumentMetadata?.deactivated === true;
      const vms = doc.didDocument?.verificationMethod ?? [];

      if (vms.length > 0) {
        const keys: Record<string, Jwk> = {};
        for (const vm of vms) {
          if (typeof vm.id === 'string' && vm.publicKeyJwk && typeof vm.publicKeyJwk === 'object') {
            keys[vm.id] = vm.publicKeyJwk as Jwk;
          }
        }
        return { did, deactivated, kind: 'agent', keys } satisfies ResolvedDid;
      }
      return { did, deactivated, kind: 'asset', data: doc.didDocumentData } satisfies ResolvedDid;
    },
  };
}
