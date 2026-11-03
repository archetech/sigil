/**
 * Poly integration profile — the host **verifier adapter** that Poly's identity proposal expects (PD5 §1.4),
 * backed by Sigil's keyless verifier.
 *
 * Poly (cognitivefab.com/poly) checks a program exhaustively before it runs and gates every effect, but does no
 * identity: a host-supplied adapter turns credentials into a *typed claims record*, and Poly trusts that record
 * under its assumption K11 while checking everything the program does with it. This module is that adapter for
 * Sigil presentations. It returns plain data — no Poly dependency, no cryptography on Poly's side — shaped to
 * PD5's `{ kind, attest, assurance, principal }` and PD6's freshness (`verifiedAt`, `statusAt`) and narrowing
 * `Mandate` additions. See `docs/poly-profile.md`.
 *
 * @implements PP-1, PP-2, PP-3, PP-4, PP-5, R14, R16
 */
import type { AAC, Presentation, Invocation, VerifyRequest, VerifyDeps } from '../types.ts';
import { verifyPresentation, ASSURANCE_LADDER } from '../verify.ts';

/** A mandate's scope: the finite, subset-comparable part of a Sigil capability (PD6 §2 "scope is finite"). */
export interface PolyScope {
  readonly actions: readonly string[];
  readonly resources: readonly string[];
  readonly audience?: readonly string[];
  readonly maxInvocations?: number;
}

/** PD6's `Mandate` — one verified hop of the chain. `parent` nests outward toward the root, so the innermost
 *  mandate (the leaf) is the one Poly's gate checks each proposal against. */
export interface PolyMandate {
  /** The hop's issuer: the principal (root) or the delegating agent. */
  readonly delegator: string;
  /** The hop's subject: the agent granted this scope. */
  readonly delegate: string;
  readonly scope: PolyScope;
  /** ISO 8601 — the earlier of the hop's `validUntil` and its `constraints.notAfter`. */
  readonly expires: string;
  readonly parent?: PolyMandate;
}

/** A verified presentation as Poly claims. */
export interface PolyVerifiedClaims {
  readonly kind: 'Agent';
  readonly attest: 'Verified';
  /** The derived assurance as a rung index on Sigil's ladder (0 = identity … 5 = human-co-signed). */
  readonly assurance: number;
  /** The same rung by name, for policies that prefer the label. */
  readonly assuranceLevel: string;
  /** The accountable principal — the chain root's controller (the party authority descends from). */
  readonly principal: string;
  /** The acting agent — the holder-bound leaf. Never equal to `principal`'s role: the agent acts *for* it. */
  readonly delegate: string;
  /** When this verification ran (PD6 §1). */
  readonly verifiedAt: string;
  /** The time of the revocation status the verification used (PD6 §1). */
  readonly statusAt: string;
  readonly mandate: PolyMandate;
}

/** A denied presentation as Poly claims: `attest: Failed`, with the check-class reason only (AC-12) — no
 *  principal, delegate or scope is disclosed, because none was proven. */
export interface PolyRefusal {
  readonly kind: 'Agent';
  readonly attest: 'Failed';
  readonly assurance: 0;
  readonly reason: string;
  readonly verifiedAt: string;
}

export type PolyClaims = PolyVerifiedClaims | PolyRefusal;

export interface PolyVerifierOptions {
  /** Injectable clock (ISO 8601); used when the request carries no `now`. */
  readonly now?: () => string;
  /** The time of the status information the injected resolver served. The reference resolver resolves fresh at
   *  every verification, so the default is `verifiedAt` (R9: staleness zero). A deployment that injects a
   *  *caching* resolver MUST supply its cache time here, so Poly's `statusAge` is honest. */
  readonly statusAt?: (verifiedAt: string) => string;
}

/** The adapter: a function from a Sigil presentation (or invocation) and the verifier's request to Poly claims. */
export type PolyVerifier = (p: Presentation | Invocation, req: VerifyRequest) => Promise<PolyClaims>;

/** The rung index of an assurance level on Sigil's ladder; unknown levels map to 0. */
export function assuranceIndex(level: string | undefined): number {
  const i = level === undefined ? -1 : ASSURANCE_LADDER.indexOf(level);
  return i < 0 ? 0 : i;
}

const minTime = (a: string, b: string | undefined): string => (b !== undefined && b < a ? b : a);

/** One hop as a mandate. */
function mandateOfHop(hop: AAC): Omit<PolyMandate, 'parent'> {
  const cap = hop.credentialSubject.authorization;
  const scope: PolyScope = {
    actions: cap.actions,
    resources: cap.resources,
    ...(cap.constraints?.audience ? { audience: cap.constraints.audience } : {}),
    ...(cap.constraints?.maxInvocations !== undefined ? { maxInvocations: cap.constraints.maxInvocations } : {}),
  };
  return { delegator: hop.issuer, delegate: hop.credentialSubject.id, scope, expires: minTime(hop.validUntil, cap.constraints?.notAfter) };
}

/**
 * The verified chain `[root … leaf]` as nested mandates, innermost = leaf. Because the verifier has already
 * proven every hop narrows its parent (AC-8) and is linked to it (DC-4), each mandate's scope is a subset of its
 * parent's and its delegator is its parent's delegate — Poly's narrowing rule K12 holds by construction.
 */
export function mandateOf(chain: readonly AAC[]): PolyMandate {
  let m: PolyMandate | undefined;
  for (const hop of chain) m = { ...mandateOfHop(hop), ...(m ? { parent: m } : {}) };
  if (!m) throw new Error('mandateOf: empty chain');
  return m;
}

/**
 * Build the Poly verifier adapter over Sigil's verifier. The adapter is pure per call and MUST be invoked for
 * every proposed action (PD6 §2 "every action, not the first"): a revocation between two calls surfaces as
 * `attest: Failed, reason: 'revoked'` on the next one, which the host maps to Poly's `CredentialRevoked` signal.
 */
export function createPolyVerifier(deps: VerifyDeps, opts: PolyVerifierOptions = {}): PolyVerifier {
  return async (p, req) => {
    const verifiedAt = req.now ?? opts.now?.() ?? new Date().toISOString();
    const res = await verifyPresentation(p, { ...req, now: verifiedAt }, deps);
    if (!res.ok) return { kind: 'Agent', attest: 'Failed', assurance: 0, reason: res.reason ?? 'denied', verifiedAt };
    const root = p.credentials[0]!; // verifyPresentation denies an empty chain before we get here
    return {
      kind: 'Agent',
      attest: 'Verified',
      assurance: assuranceIndex(res.assuranceLevel),
      assuranceLevel: res.assuranceLevel ?? ASSURANCE_LADDER[0]!,
      principal: root.issuer,
      delegate: p.holder,
      verifiedAt,
      statusAt: opts.statusAt ? opts.statusAt(verifiedAt) : verifiedAt,
      mandate: mandateOf(p.credentials),
    };
  };
}
