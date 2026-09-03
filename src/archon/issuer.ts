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
 * @implements R1, R3, R6, AC-3, AC-11, TR-3, INV-1, INV-4
 */
import type { AAC, VRC, Capability, CoSign, TrustCredential, Presentation, Invocation, Receipt, Proof, Jwk } from '../types.ts';
import { attenuates, isStructuredCapability } from '../capability.ts';
import { hexToBase64url } from '../base64url.ts';

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
  /** Mint a delegated AAC: issued by `delegator` (which must be `parent`'s subject), narrowing `parent`. Widening
   *  or a non-delegable parent is refused here, at issuance (AC-8) — as well as at verification. */
  mintDelegation(
    delegator: Signer,
    parent: AAC,
    subject: string,
    authorization: Capability,
    opts?: { validFrom?: string; validUntil?: string; assuranceLevel?: string },
  ): Promise<{ did: string; credential: AAC }>;
  present(holder: Signer, opts: { challenge: string; audience: string; credentials: readonly AAC[]; trust?: readonly TrustCredential[] }): Presentation;
  /** The leaf agent invokes a capability — a committed, attributable act binding the specific action/resource. */
  invoke(holder: Signer, opts: { challenge: string; audience: string; action: string; resource: string; credentials: readonly AAC[]; trust?: readonly TrustCredential[]; coSign?: CoSign }): Invocation;
  /** A resource server signs a receipt acknowledging an invocation — the second half of an attributable record. */
  mintReceipt(server: Signer, invocation: Invocation, decision: 'accepted' | 'denied', opts?: { assuranceLevel?: string; at?: string }): Receipt;
  /** The accountable principal freshly co-signs a specific high-consequence request — a proof-of-human step-up. */
  coSign(authorizer: Signer, req: { challenge: string; audience: string; action: string; resource: string }): CoSign;
  /** An anchor (endorser / witness / registry) vouches for a controller — a DTG trust-graph credential (TR-3).
   *  `kind`: 'endorsement' (VEC) / 'witness' (VWC) / 'membership' (VMC). Minted as the endorser's asset. */
  mintEndorsement(endorser: Signer, controllerDid: string, kind: 'endorsement' | 'witness' | 'membership'): Promise<{ did: string; credential: TrustCredential }>;
  revoke(did: string, controller: Signer): Promise<boolean>;
}

export function createArchonIssuer(gatekeeper: IssuerGatekeeper, cipher: IssuerCipher, options: IssuerOptions = {}): ArchonIssuer {
  const registry = options.registry ?? 'hyperswarm';
  const now = options.now ?? (() => new Date().toISOString());
  const blockid = async (): Promise<string | undefined> => (await gatekeeper.getBlock(registry))?.hash;
  const toB64Url = hexToBase64url;

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

  /** Mint an AAC asset whose own `id` names its DID: create with a placeholder, then update to store the signed
   *  credential (a verifier resolves the AAC's DID for revocation, so `id` must equal it — known only after create). */
  async function mintAacAsset(signer: Signer, buildBody: (did: string) => object): Promise<{ did: string; credential: AAC }> {
    const did = await createAsset(signer, { pending: true });
    const credential = signed(buildBody(did), signer.privateJwk, vm(signer.did)) as AAC;
    const current = await gatekeeper.resolveDID(did);
    const doc: Record<string, unknown> = { ...current, didDocumentData: credential };
    delete doc.didDocumentMetadata;
    delete doc.didResolutionMetadata;
    const updateOp = { type: 'update', did, previd: current.didDocumentMetadata?.versionId, blockid: await blockid(), doc };
    await gatekeeper.updateDID(signed(updateOp, signer.privateJwk, vm(signer.did)));
    return { did, credential };
  }
  const aacBase = (did: string, issuer: string, opts: { validFrom?: string; validUntil?: string }) => ({
    id: did, type: ['VerifiableCredential', 'AgentAuthorizationCredential'], issuer,
    validFrom: opts.validFrom ?? now(), validUntil: opts.validUntil ?? '2099-01-01T00:00:00Z',
  });
  const withAssurance = (level?: string) => (level ? { assuranceLevel: level } : {});

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
      if (!isStructuredCapability(authorization)) throw new Error('mintAuthorization: authorization must be structured (R5/AC-4)');
      // A root AAC: it references the establishing VRC and carries no `parent`.
      return mintAacAsset(controller, (did) => ({
        ...aacBase(did, controller.did, opts),
        credentialSubject: { id: subject, relationship: relationshipDid, authorization, ...withAssurance(opts.assuranceLevel) },
      }));
    },

    async mintDelegation(delegator, parent, subject, authorization, opts = {}) {
      const parentCap = parent.credentialSubject.authorization;
      if (!isStructuredCapability(authorization)) throw new Error('mintDelegation: authorization must be structured (R5/AC-4)');
      // The one hard invariant is monotonic attenuation — a delegation can only narrow. Delegation itself is never
      // blocked: `parent.delegable === false` is advisory policy ("please don't"), honored by convention and left
      // in the chain for audit, but it does not prevent minting (blocking delegation is an anti-pattern — it forces
      // the unaccountable proxy path instead of an accountable, attenuated grant).
      if (!attenuates(authorization, parentCap)) throw new Error('mintDelegation: authorization widens its parent');
      // A delegated AAC: issued by the delegator (the parent's subject), pinned to the parent, no VRC of its own.
      return mintAacAsset(delegator, (did) => ({
        ...aacBase(did, delegator.did, opts),
        credentialSubject: { id: subject, authorization: { ...authorization, parent: parent.id }, ...withAssurance(opts.assuranceLevel) },
      }));
    },

    present(holder, { challenge, audience, credentials, trust }) {
      const { proof } = signed({ holder: holder.did, challenge, audience }, holder.privateJwk, vm(holder.did));
      return { holder: holder.did, challenge, audience, credentials, proof, ...(trust ? { trust } : {}) };
    },

    invoke(holder, { challenge, audience, action, resource, credentials, trust, coSign }) {
      // The holder signs the specific act — {holder, challenge, audience, action, resource} — so the invocation is
      // non-repudiably attributable to the leaf agent, not a permission query.
      const { proof } = signed({ holder: holder.did, challenge, audience, action, resource }, holder.privateJwk, vm(holder.did));
      return { holder: holder.did, challenge, audience, action, resource, credentials, proof, ...(trust ? { trust } : {}), ...(coSign ? { coSign } : {}) };
    },

    mintReceipt(server, invocation, decision, opts = {}) {
      const body = {
        server: server.did, invocation: invocation.proof.proofValue,
        action: invocation.action, resource: invocation.resource, audience: invocation.audience,
        decision, ...(opts.assuranceLevel ? { assuranceLevel: opts.assuranceLevel } : {}), at: opts.at ?? now(),
      };
      const { proof } = signed(body, server.privateJwk, vm(server.did));
      return { ...body, proof };
    },

    coSign(authorizer, { challenge, audience, action, resource }) {
      const body = { authorizer: authorizer.did, challenge, audience, action, resource };
      const { proof } = signed(body, authorizer.privateJwk, vm(authorizer.did));
      return { ...body, proof };
    },

    async mintEndorsement(endorser, controllerDid, kind) {
      const dtgType = kind === 'witness' ? 'VerifiableWitnessCredential' : kind === 'membership' ? 'DTGMembershipCredential' : 'VerifiableEndorsementCredential';
      const build = (did: string) => ({ id: did, type: ['VerifiableCredential', dtgType], issuer: endorser.did, credentialSubject: { id: controllerDid } });
      const did = await createAsset(endorser, { pending: true });
      const credential = signed(build(did), endorser.privateJwk, vm(endorser.did)) as TrustCredential;
      const current = await gatekeeper.resolveDID(did);
      const doc: Record<string, unknown> = { ...current, didDocumentData: credential };
      delete doc.didDocumentMetadata;
      delete doc.didResolutionMetadata;
      const updateOp = { type: 'update', did, previd: current.didDocumentMetadata?.versionId, blockid: await blockid(), doc };
      await gatekeeper.updateDID(signed(updateOp, endorser.privateJwk, vm(endorser.did)));
      return { did, credential };
    },

    async revoke(did, controller) {
      const current = await gatekeeper.resolveDID(did);
      const op = { type: 'delete', did, previd: current.didDocumentMetadata?.versionId, blockid: await blockid() };
      // An agent revokes itself (`did === controller.did`); an asset is revoked by its controller.
      return gatekeeper.deleteDID(signed(op, controller.privateJwk, vm(controller.did)));
    },
  };
}
