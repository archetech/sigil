# Requirements — Trust Registry

Formal requirements realized by [`docs/trust-registry.md`](../docs/trust-registry.md). Prefix **`TR`**. Format and
traceability: see [`README.md`](README.md). RFC 2119 keywords are normative. These govern how a verifier establishes
*which roots to trust* and *derives* an assurance level — the root-of-trust layer beneath the assurance taxonomy
(`R16`) and the "proved not asserted" mandate (`AC-10`).

**TR-1** — A verifier MUST **derive** a presentation's assurance level from what it can independently verify, and
MUST NOT accept the level asserted in a credential as authoritative. A verified controller relationship (VRC)
yields at most `controller-vouched`; higher levels require additional proved evidence.
· Actor: Verifier · Traces: R16, AC-10 · docs §2, §3
· **Verify:** an AAC asserting `witnessed` with no supporting evidence verifies at `controller-vouched`, not
`witnessed`.

**TR-2** — A verifier MUST be able to pin a set of **trusted issuers** (controller DIDs) it trusts a priori; a
presentation whose root issuer is pinned MUST derive at least `issuer-pinned`.
· Actor: Verifier · Traces: R16 · docs §3
· **Verify:** with the root's controller in the verifier's pinned set, the presentation derives `issuer-pinned`;
without it, `controller-vouched`.

**TR-3** — A verifier MUST be able to raise assurance from **trust-graph credentials** (DTG endorsement `VEC`,
witness `VWC`, or membership `VMC`) presented alongside the chain, PROVIDED each such credential is (a) about the
root issuer, (b) signed by an **anchor the verifier trusts**, (c) signature-verified against the anchor's key state
at signing time, and (d) not revoked. `VEC` → `endorsed`; `VWC` → `witnessed`; `VMC` from a trusted registry →
`issuer-pinned`. The effective level is the highest so derived (plus `human-co-signed` on a valid co-sign).
· Actor: Verifier, Endorser · Traces: R16, AC-10 · docs §3 · [`aac-dtg-reconciliation.md`](../docs/aac-dtg-reconciliation.md)
· **Verify:** a `VWC` about the root issuer, signed by a verifier-trusted anchor and unrevoked, derives `witnessed`.

**TR-4** — Trust evidence MUST **fail safe to lower assurance**: a trust credential from a non-anchor, revoked,
expired, about a different subject, or with an invalid signature MUST be ignored (never raise the level, never
deny). Absence of trust evidence simply yields the base derived level.
· Actor: Verifier · Traces: R16, P4 · docs §3
· **Verify:** a `VEC` signed by an unknown (non-anchor) issuer, or a revoked one, does not raise assurance; the
presentation still verifies at its base level.

**TR-5** — The trust layer MUST be an **input to the assurance level only**. It MUST NOT gate chain validity (a
chain that fails signature/attenuation/revocation is denied regardless of trust evidence), MUST NOT gate delegation
(cf. `DC-4` — blocking delegation is an anti-pattern), and MUST NOT replace signature verification with a registry
lookup. A central registry, if used, is modeled as a single trusted anchor issuing membership — not a separate
mechanism.
· Actor: Verifier · Traces: R16, R10, DC-4 · docs §1, §4
· **Verify:** trust evidence for a root whose chain fails verification does not make the presentation succeed; a
trusted registry never permits an otherwise-invalid or over-scoped presentation.

---

*Open: resolved (vs. presented) trust evidence — a verifier pulling endorsements from a registry DID it resolves,
rather than relying on the presenter to include them; transitive endorsement depth; and per-anchor level policy
(which anchors may confer which levels) are not yet firm requirements.*
