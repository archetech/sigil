/**
 * Sigil reference types for the anchor use-case (present → verify).
 *
 * These follow the design notes: an Agent Authorization Credential (AAC) is a capability credential that
 * references a DTG VRC (the control edge); presentation is holder-bound; the Archon substrate (resolution =
 * operation-log replay, revocation = a `delete`) sits behind the `Resolver` seam so the verification logic is
 * testable without a live node.
 */

/** A public JSON Web Key. Archon agent keys are secp256k1 (`kty: 'EC', crv: 'secp256k1', x, y`); the
 *  optional fields keep this compatible with both EC and OKP keys and with `@didcid/cipher`'s JWK types. */
export type Jwk = { readonly kty: string; readonly crv?: string; readonly x?: string; readonly y?: string };

/**
 * A Linked-Data proof over a credential or presentation, shaped as Archon emits it
 * (`EcdsaSecp256k1Signature2019`): the signer canonicalizes the object *without* its `proof` (JCS),
 * hashes it, and signs. `proofValue` is the base64url of the compact-hex signature; the signer's key
 * is resolved point-in-time at `created`.
 */
export interface Proof {
  readonly type: string;
  /** ISO 8601 — also the `versionTime` the signer's key is resolved at (point-in-time verification). */
  readonly created: string;
  /** The verification-method id (`<did>#<fragment>`) the signature is made with. */
  readonly verificationMethod: string;
  readonly proofPurpose?: string;
  /** base64url(compact-hex ECDSA signature). */
  readonly proofValue: string;
  readonly [k: string]: unknown;
}

/** The unit of authority the AAC carries. */
export interface Capability {
  readonly actions: readonly string[];
  readonly resources: readonly string[];
  readonly constraints?: {
    /** Which verifier(s) may accept this — binds the presentation target (prevents redirect). */
    readonly audience?: readonly string[];
    readonly notAfter?: string;
    readonly maxInvocations?: number;
  };
  readonly delegable?: boolean;
  /** For delegation chains: the parent capability this one narrows. `null` at the root. */
  readonly parent?: string | null;
}

/** Agent Authorization Credential — Sigil's capability credential. A root AAC references a DTG VRC for control;
 *  a delegated AAC narrows its parent (`authorization.parent`) and is issued by the parent's subject. */
export interface AAC {
  /** The credential's own DID (the VC-DID / asset). */
  readonly id: string;
  readonly type: readonly string[];
  /** A party to the referenced relationship (canonically the controller). */
  readonly issuer: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly credentialSubject: {
    /** The agent DID (the holder proves control of this key). */
    readonly id: string;
    /** The DID of the DTG VRC establishing controller ↔ agent. Present on the **root** of a chain (which anchors
     *  to the controller); a delegated hop has none — it is pinned to its parent by signature + `authorization.parent`. */
    readonly relationship?: string;
    readonly authorization: Capability;
    readonly assuranceLevel?: string;
  };
  readonly proof: Proof;
}

/** A DTG Verifiable Relationship Credential — the control edge (minimal shape for the anchor). */
export interface VRC {
  readonly id: string;
  readonly type: readonly string[];
  /** The controller. */
  readonly issuer: string;
  /** The agent. */
  readonly credentialSubject: { readonly id: string };
  readonly proof: Proof;
}

/** A holder-bound presentation: the credential(s) + a proof of key control against the challenge. */
export interface Presentation {
  /** The presenting agent DID. */
  readonly holder: string;
  /** The echoed challenge nonce. */
  readonly challenge: string;
  /** The verifier this presentation is bound to. */
  readonly audience: string;
  /** The complete ordered delegation chain, root → leaf. A single-hop anchor is a chain of length 1 (root = leaf);
   *  the presenting agent is the leaf's subject. */
  readonly credentials: readonly AAC[];
  /** Holder proof binding (holder, challenge, audience). */
  readonly proof: Proof;
}

/** What the verifier asks, plus the specific action being authorized. */
export interface VerifyRequest {
  readonly nonce: string;
  /** The verifier's own identity (the audience the presentation must bind to). */
  readonly audience: string;
  readonly action: string;
  readonly resource: string;
  /** Injectable clock (ISO 8601); defaults to now. */
  readonly now?: string;
  readonly requiredAssurance?: string;
}

/** A resolved DID — the result of replaying its operation log (the Archon substrate model). */
export interface ResolvedDid {
  readonly did: string;
  /** A `delete` operation was seen in the log. */
  readonly deactivated: boolean;
  readonly kind: 'agent' | 'asset';
  /** Verification keys, keyed by verification-method id (agents). */
  readonly keys?: Readonly<Record<string, Jwk>>;
  /** The asset's document data — e.g. a VRC (assets). */
  readonly data?: unknown;
}

/** Resolve a DID by replaying its operations, optionally pinned to a point in time. */
export interface Resolver {
  resolve(did: string, opts?: { readonly versionTime?: string; readonly versionId?: string }): Promise<ResolvedDid | undefined>;
}

/**
 * Verify `proof` over the canonical form of `signed` (the object *without* its proof) using `key`.
 * The verifier owns canonicalization (JCS) + hashing + the signature check, so the anchor logic stays
 * crypto-agnostic. `createArchonSignatureVerifier` (src/archon/signatures.ts) is the live implementation.
 */
export interface SignatureVerifier {
  verify(signed: unknown, proof: Proof, key: Jwk): Promise<boolean>;
}

export interface VerifyDeps {
  readonly resolver: Resolver;
  readonly signatures: SignatureVerifier;
}

/** The verifier's decision. Denials carry a check-class label only — minimal disclosure. */
export interface VerifyResult {
  readonly ok: boolean;
  /** On denial: the failing check class (never the subject or full scope). */
  readonly reason?: string;
  /** On success: the assurance level established. */
  readonly assuranceLevel?: string;
}
