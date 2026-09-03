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
  /** Advisory delegation policy, NOT a hard gate. `false` = "please don't delegate onward"; it is honored by
   *  convention and left in the chain for audit, but it never blocks a (still-attenuating) delegation or its
   *  verification — blocking delegation is an anti-pattern (it forces the unaccountable proxy path). Authority is
   *  bounded by monotonic attenuation, `constraints`, and per-hop revocation, not by refusing to delegate. */
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

/**
 * A DTG trust-graph credential *about a controller* — the decentralized form of a "trust registry" entry. An
 * endorser/witness/registry (`issuer`) attests to the controller (`credentialSubject.id`). The `type` array's DTG
 * member selects the rung it can confer: `VerifiableEndorsementCredential` (VEC) → `endorsed`,
 * `VerifiableWitnessCredential` (VWC) → `witnessed`, `DTGMembershipCredential` (VMC) → `issuer-pinned`. It raises
 * assurance only when the verifier trusts `issuer` as an anchor and it verifies + is unrevoked (see TrustPolicy).
 */
export interface TrustCredential {
  readonly id: string;
  readonly type: readonly string[];
  /** The endorser / witness / registry. */
  readonly issuer: string;
  /** The controller being vouched for. */
  readonly credentialSubject: { readonly id: string };
  readonly proof: Proof;
}

/**
 * A **persona-link** — a DTG **VPC** (Verifiable Persona Credential). Signed by the *canonical* agent, it binds a
 * throwaway **persona** DID to that canonical identity. It is the **with-cause** recovery path for correlation
 * resistance (R12): it is NOT carried in a presentation (disclosed existence-only / out-of-band), so it never lets
 * a verifier correlate — only a party that holds it can unmask `persona → canonical` for accountability.
 */
export interface PersonaLink {
  readonly id: string;
  readonly type: readonly string[];
  /** The canonical agent — the persona's real controller, and the signer. */
  readonly issuer: string;
  /** The persona DID. */
  readonly credentialSubject: { readonly id: string };
  readonly proof: Proof;
}

/** The result of unmasking a persona-link: the persona and (with a valid link) the canonical agent behind it. */
export interface PersonaResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly persona?: string;
  readonly canonical?: string;
}

/** A verifier's root-of-trust policy: the anchors whose trust credentials it honors, and issuers it pins a priori. */
export interface TrustPolicy {
  /** DIDs the verifier trusts as endorsers / witnesses / registries — the anchors trust evidence must be signed by. */
  readonly anchors: readonly string[];
  /** Controller DIDs the verifier trusts a priori → at least `issuer-pinned`. */
  readonly pinnedIssuers?: readonly string[];
}

/**
 * A proof-of-human step-up: the accountable principal (the root's controller) *freshly* co-signs a specific
 * request — bound to the challenge, audience, action, and resource, so a standing capability alone is not enough
 * and the co-sign cannot be replayed onto a different action. The "human" property is key custody (the authorizer
 * key is held by a human 2nd factor); the verifier requires a fresh signature by the accountable principal.
 */
export interface CoSign {
  /** The co-signing DID — canonically the root's controller (the principal). */
  readonly authorizer: string;
  readonly challenge: string;
  readonly audience: string;
  readonly action: string;
  readonly resource: string;
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
  /** Present for a high-consequence action: the principal's proof-of-human co-sign (AC-11). */
  readonly coSign?: CoSign;
  /** Optional DTG trust-graph credentials about the root controller, to raise assurance (TR-3). Their absence only
   *  lowers the derived level; they can never make an invalid chain valid. */
  readonly trust?: readonly TrustCredential[];
}

/**
 * An **invocation**: the agent's committed *act* of exercising a capability, not merely a query about what is
 * permitted. It is a presentation whose holder proof additionally binds the specific `action` and `resource`, so
 * the act is non-repudiably attributable to the leaf agent (INV-1). Verified by `verifyInvocation`.
 */
export interface Invocation extends Presentation {
  readonly action: string;
  readonly resource: string;
}

/**
 * A **receipt**: a resource server's signed acknowledgment of an invocation — the second half of an attributable
 * record (INV-4). It references the invocation by its holder proof value and records the decision, so a third party
 * can attribute the completed action to both the acting agent and (via the chain) the accountable principal.
 */
export interface Receipt {
  /** The resource server DID that issued (and signed) this receipt. */
  readonly server: string;
  /** The invocation's holder `proof.proofValue` — a unique, verifiable reference to the exact invocation. */
  readonly invocation: string;
  readonly action: string;
  readonly resource: string;
  readonly audience: string;
  readonly decision: 'accepted' | 'denied';
  readonly assuranceLevel?: string;
  /** ISO 8601 time the server acknowledged the invocation. */
  readonly at: string;
  readonly proof: Proof;
}

/** A completed invocation as an auditable artifact: the agent-signed act plus the optional server-signed receipt. */
export interface InvocationRecord {
  readonly invocation: Invocation;
  readonly receipt?: Receipt;
}

/** The verifier's decision on an invocation record — the attribution it establishes (minimal disclosure, R11). */
export interface RecordResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly assuranceLevel?: string;
  /** The acting agent (the chain's holder-bound leaf). */
  readonly actor?: string;
  /** The accountable principal the authority descends from (the chain root's controller). */
  readonly accountablePrincipal?: string;
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
  /** The verifier designates this action high-consequence: a valid proof-of-human co-sign is then required (AC-11). */
  readonly requireHumanCoSign?: boolean;
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
  /** The verifier's root-of-trust policy (TR-2, TR-3). Absent → assurance derives from the VRC + co-sign only. */
  readonly trust?: TrustPolicy;
}

/** The verifier's decision. Denials carry a check-class label only — minimal disclosure. */
export interface VerifyResult {
  readonly ok: boolean;
  /** On denial: the failing check class (never the subject or full scope). */
  readonly reason?: string;
  /** On success: the assurance level established. */
  readonly assuranceLevel?: string;
}
