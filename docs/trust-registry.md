# Sigil Trust Registry

**Status:** design note, v0 · the root-of-trust layer beneath the assurance taxonomy. Requirements in
[`Requirements/trust-registry.md`](../Requirements/trust-registry.md). Builds on the DTG adoption in
[`aac-dtg-reconciliation.md`](aac-dtg-reconciliation.md) and the assurance ladder in
[`agent-credential.md`](agent-credential.md) §5.

## 1. The gap it fills

The delegation chain proves **derivation**: "this agent's authority descends from controller X, attenuated and
holder-bound." It does not answer **"should the verifier trust X at all?"** — the chain is self-verifying, the
*root* is not. Concretely, this showed up as a hole in our own assurance ladder:

```
identity → controller-vouched → issuer-pinned → endorsed → witnessed → human-co-signed
```

Only `controller-vouched` (from a verified VRC) and `human-co-signed` (from a fresh co-sign) were ever *proved*.
`issuer-pinned` / `endorsed` / `witnessed` were **asserted by the issuer** — which violates `AC-10` ("the level
MUST reflect what was actually proved"). The trust registry is the machinery that lets a verifier **derive** those
middle rungs from evidence it independently trusts.

## 2. Derive, don't trust the claim (TR-1)

The verifier ignores a credential's asserted `assuranceLevel` and **derives** the effective level:

- base `controller-vouched` — the root's VRC verified during the chain walk;
- raised by the trust policy (below);
- `human-co-signed` on a valid proof-of-human co-sign (`AC-11`).

The result is the **highest** rung the verifier can actually prove.

## 3. A registry expressed as a graph, not a central list

Rather than one authoritative list, trust is a graph of **DTG credentials** the verifier evaluates from **its own
anchors** — `createArchonResolver`/`createArchonSignatureVerifier` do the crypto, `deriveAssurance` the policy:

- **Pinned issuers (TR-2)** — the verifier's `TrustPolicy.pinnedIssuers`: controllers it trusts a priori → at least
  `issuer-pinned`. This is out-of-band pinning made explicit.
- **Trust-graph credentials (TR-3)** — presented alongside the chain, about the root controller:
  - `VerifiableEndorsementCredential` (VEC) → `endorsed`
  - `VerifiableWitnessCredential` (VWC) → `witnessed`
  - `DTGMembershipCredential` (VMC), from a trusted registry → `issuer-pinned`

  A credential counts **only if** it is about the root issuer, signed by an **anchor in `TrustPolicy.anchors`**,
  signature-verified against the anchor's key state at signing time (point-in-time), and not revoked.
- **Fail safe to lower (TR-4)** — any credential from a non-anchor, revoked, expired, wrong-subject, or with a bad
  signature is **ignored**, never a denial. Absence of evidence just yields the base level. (Safe because trust
  evidence can only *raise* assurance; a malicious presenter omitting or forging it can't help itself.)

A **central registry is a degenerate case**, not a separate mechanism: the verifier pins the registry DID as an
anchor, and the registry issues `VMC` membership credentials. Same code path serves both a formal governance
authority and peer-to-peer vouching.

## 4. Guardrails (TR-5)

- **Input to the level only.** A chain that fails signature / attenuation / revocation is denied regardless of how
  trusted its root is; trust evidence never rescues an invalid or over-scoped presentation.
- **Never a delegation gate.** Accreditation raises assurance; it does not gate the right to attenuate
  (cf. `DC-4` — blocking delegation is an anti-pattern).
- **Never a substitute for signature verification.** The registry answers "is this issuer accredited," not "is this
  presentation valid" — the latter is always the chain's own signatures.
- **The verifier still chooses its anchors out-of-band.** Trust is not turtles-all-the-way-down; the graph
  terminates at roots the verifier decides to trust. The registry is where that decision is *expressed and shared*,
  not where it is eliminated.

## 5. Open items

- **Resolved (vs. presented) evidence** — a verifier pulling endorsements from a registry DID it resolves, instead
  of relying on the presenter to include them (useful when the presenter has no incentive to raise its own level).
- **Transitive endorsement** — anchor A vouches for endorser B who endorses controller X; bounded-depth traversal.
- **Per-anchor level policy** — which anchors may confer which rungs (not every anchor should be able to grant
  `issuer-pinned`).
- **Human-legible framework text** — a controlled-natural-language rendering of the governance framework and of a
  capability's attenuation, for the co-sign/audit boundary (a Lexon-inspired legibility layer; render *from* the
  structured credential, never parse requester prose *into* authority).

## Traceability

- `[D-TR-1 → TR-1, AC-10]` §2 — assurance is derived from proved evidence, not the asserted level.
- `[D-TR-2 → TR-2]` §3 — a priori pinned issuers → `issuer-pinned`.
- `[D-TR-3 → TR-3, R16]` §3 — DTG VEC/VWC/VMC from a trusted anchor raise the rung (about the root, signed by an
  anchor, point-in-time verified, unrevoked).
- `[D-TR-4 → TR-4]` §3 — fail safe to lower: bad/untrusted/revoked evidence is ignored, never a denial.
- `[D-TR-5 → TR-5, R10]` §4 — trust is an input to the level only; not a chain gate, not a delegation gate, not a
  replacement for signature verification.
