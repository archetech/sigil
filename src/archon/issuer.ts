/**
 * The issuer / holder seam: mint the credentials the verifier consumes, on a real Archon substrate. Unlike the
 * verifier (which is keyless), issuing requires signing — but Sigil's model is object-capability self-custody, so
 * this issuer holds its OWN keys (`@didcid/cipher`) and submits operations straight to the gatekeeper. It never
 * uses a keymaster/wallet: an agent, a controller, and each credential is a DID whose operations this process
 * builds and signs itself.
 *
 * It mints exactly what `verifyPresentation` verifies:
 *   - `mintAgent`         — a self-custodied agent DID (create operation, `publicJwk`, self-signed).
 *   - `mintRelationship`  — a DTG VRC as a controller-signed asset (the control edge).
 *   - `mintAuthorization` — an AAC as a controller-signed asset. Because a credential's DID content-addresses its
 *                           data, the AAC's own `id` can only equal its DID after creation, so it is created then
 *                           updated to backfill `id` — the one place a two-step is unavoidable.
 *   - `present`           — a holder-signed presentation binding {holder, challenge, audience}.
 *   - `revoke`            — a `delete` operation (irreversible), for teardown or real revocation.
 *
 * @implements R1, R3, AC-3
 */
import type { AAC, VRC, Capability, Presentation, Proof, Jwk } from '../types.ts';

/** A private JWK carries `d`; kept in-process, never disclosed. */
export type PrivateJwk = Jwk & { readonly d?: string };

/** A self-custodied identity: a DID and the keypair that controls it. */
export interface Signer {
  readonly did: string;
  readonly publicJwk: Jwk;
  readonly privateJwk: PrivateJwk;
}

/** The gatekeeper operations the issuer submits. A `@didcid/clients` `GatekeeperClient` satisfies this. */
export interface IssuerGatekeeper {
  getBlock(registry: string): Promise<{ hash?: string } | null>;
  createDID(operation: unknown): Promise<string>;
  updateDID(operation: unknown): Promise<boolean>;
  deleteDID(operation: unknown): Promise<boolean>;
  resolveDID(did: string, options?: unknown): Promise<{ didDocumentMetadata?: { versionId?: string } }>;
}

/** The cipher primitives the issuer signs with. A `@didcid/cipher` instance satisfies this. */
export interface IssuerCipher {
  generateRandomJwk(): { publicJwk: Jwk; privateJwk: PrivateJwk };
  hashJSON(obj: unknown): string;
  signHash(msgHash: string, privateJwk: PrivateJwk): string;
}

export interface IssuerOptions {
  /** The registry to anchor DIDs on (default `hyperswarm`). */
  readonly registry?: string;
  /** Injectable clock, for deterministic tests. */
  readonly now?: () => string;
}

export interface ArchonIssuer {
  mintAgent(): Promise<Signer>;
  mintRelationship(controller: Signer, subject: string): Promise<{ did: string; credential: VRC }>;
  mintAuthorization(
    controller: Signer,
    subject: string,
    relationshipDid: string,
    authorization: Capability,
    opts?: { validFrom?: string; validUntil?: string; assuranceLevel?: string },
  ): Promise<{ did: string; credential: AAC }>;
  present(holder: Signer, opts: { challenge: string; audience: string; credentials: readonly AAC[] }): Presentation;
  revoke(did: string, controller: Signer): Promise<boolean>;
}

export function createArchonIssuer(gatekeeper: IssuerGatekeeper, cipher: IssuerCipher, options: IssuerOptions = {}): ArchonIssuer {
  const registry = options.registry ?? 'hyperswarm';
  const now = options.now ?? (() => new Date().toISOString());
  const blockid = async (): Promise<string | undefined> => (await gatekeeper.getBlock(registry))?.hash;
  const toB64Url = (hex: string): string => Buffer.from(hex, 'hex').toString('base64url');

  /** Attach an `EcdsaSecp256k1Signature2019` proof over the JCS hash of `obj` (which must exclude any proof). */
  function signed<T extends object>(obj: T, privateJwk: PrivateJwk, verificationMethod: string): T & { proof: Proof } {
    const proofValue = toB64Url(cipher.signHash(cipher.hashJSON(obj), privateJwk));
    return { ...obj, proof: { type: 'EcdsaSecp256k1Signature2019', created: now(), verificationMethod, proofPurpose: 'authentication', proofValue } };
  }
  const vm = (did: string): string => `${did}#key-1`;

  async function createAsset(controller: Signer, data: unknown): Promise<string> {
    const op = { type: 'create', created: now(), blockid: await blockid(), registration: { version: 1, type: 'asset', registry }, controller: controller.did, data };
    return gatekeeper.createDID(signed(op, controller.privateJwk, vm(controller.did)));
  }

  return {
    async mintAgent() {
      const { publicJwk, privateJwk } = cipher.generateRandomJwk();
      const op = { type: 'create', created: now(), blockid: await blockid(), registration: { version: 1, type: 'agent', registry }, publicJwk };
      // A create operation is self-signed by the new key; its DID does not exist yet, so the vm is the bare fragment.
      const did = await gatekeeper.createDID(signed(op, privateJwk, '#key-1'));
      return { did, publicJwk, privateJwk };
    },

    async mintRelationship(controller, subject) {
      // `id` is not part of what a verifier checks for a VRC, so a single controller-signed asset suffices.
      const credential = signed(
        { id: '', type: ['VerifiableCredential', 'VerifiableRelationshipCredential'], issuer: controller.did, credentialSubject: { id: subject } },
        controller.privateJwk, vm(controller.did),
      ) as VRC;
      const did = await createAsset(controller, credential);
      return { did, credential };
    },

    async mintAuthorization(controller, subject, relationshipDid, authorization, opts = {}) {
      // The AAC's `id` must equal its own DID (a verifier resolves it for revocation), which is only known after
      // creation — so create with a placeholder, then update to store the signed AAC that names its own DID.
      const did = await createAsset(controller, { pending: true });
      const credential = signed(
        {
          id: did, type: ['VerifiableCredential', 'AgentAuthorizationCredential'], issuer: controller.did,
          validFrom: opts.validFrom ?? now(), validUntil: opts.validUntil ?? '2099-01-01T00:00:00Z',
          credentialSubject: { id: subject, relationship: relationshipDid, authorization, ...(opts.assuranceLevel ? { assuranceLevel: opts.assuranceLevel } : {}) },
        },
        controller.privateJwk, vm(controller.did),
      ) as AAC;

      const current = await gatekeeper.resolveDID(did);
      const doc: Record<string, unknown> = { ...current, didDocumentData: credential };
      delete doc.didDocumentMetadata;
      delete doc.didResolutionMetadata;
      const updateOp = { type: 'update', did, previd: current.didDocumentMetadata?.versionId, blockid: await blockid(), doc };
      await gatekeeper.updateDID(signed(updateOp, controller.privateJwk, vm(controller.did)));
      return { did, credential };
    },

    present(holder, { challenge, audience, credentials }) {
      const { proof } = signed({ holder: holder.did, challenge, audience }, holder.privateJwk, vm(holder.did));
      return { holder: holder.did, challenge, audience, credentials, proof };
    },

    async revoke(did, controller) {
      const current = await gatekeeper.resolveDID(did);
      const op = { type: 'delete', did, previd: current.didDocumentMetadata?.versionId, blockid: await blockid() };
      // An agent revokes itself (`did === controller.did`); an asset is revoked by its controller.
      return gatekeeper.deleteDID(signed(op, controller.privateJwk, vm(controller.did)));
    },
  };
}
