# Requirements — Poly Integration Profile

Formal requirements realized by [`docs/poly-profile.md`](../docs/poly-profile.md). Prefix **`PP`**. Format and
traceability: see [`README.md`](README.md). RFC 2119 keywords are normative. These realize **`R14`** (a relying
party consumes Sigil through a host it already runs) and **`R16`** (a stated assurance level the host can require),
for the host runtime [Poly](https://cognitivefab.com/poly), whose identity proposals PD5 (verifier adapter, K11)
and PD6 (freshness, narrowing mandates) define the contract Sigil fills.

## The adapter

**PP-1** — Sigil MUST provide a Poly **verifier adapter**: a function from a presentation (or invocation) and the
verifier's request to a typed claims record `{ kind, attest, assurance, principal, delegate }`. On a verified
presentation `attest` is `Verified`, `principal` is the chain root's controller (the accountable principal) and
`delegate` is the holder-bound leaf agent. On a denial `attest` is `Failed`, the record carries the verifier's
check-class `reason` only, and MUST NOT carry a principal, delegate or scope (nothing was proven). The adapter
MUST perform all cryptography and resolution on Sigil's side; Poly receives data only (K11).
· Actor: Relying party (Poly host) · Traces: R14, R11, AC-12 · docs §2, §3
· **Verify:** a valid presentation yields `Verified` with `principal` = root issuer and `delegate` = holder; a
denied one yields `Failed` with the same `reason` the verifier gives and no `principal`.

## Assurance

**PP-2** — The record's `assurance` MUST be the **derived** level (TR-1) expressed as its rung index on Sigil's
ladder, with the level's name alongside; it MUST NOT reflect an issuer-asserted `assuranceLevel`. A minimum the
host requires is enforced through the request's `requiredAssurance`, so an under-assured presentation is `Failed`
rather than `Verified` at a low number.
· Actor: Relying party · Traces: R16, TR-1, AC-10 · docs §3
· **Verify:** a pinned root issuer raises the index; a valid human co-sign yields the top rung; an asserted level
above what is proved does not raise it; a presentation below `requiredAssurance` is `Failed` with reason
`assurance`.

## Freshness

**PP-3** — The record MUST carry `verifiedAt` (when the verification ran) and `statusAt` (the time of the
revocation status it used), as PD6 §1 requires. With the reference resolver, which resolves status fresh at every
verification (R9: staleness zero), `statusAt` equals `verifiedAt`. A deployment that injects a caching resolver
MUST supply its status time, so Poly's `statusAge` is honest; the adapter MUST NOT fabricate freshness.
· Actor: Relying party · Traces: R9, R10 · docs §4
· **Verify:** by default both fields are present and equal to the request clock; a supplied `statusAt` is
reported instead.

## Mandate

**PP-4** — The record MUST carry the verified chain as PD6's **`Mandate`**: one per hop, `{ delegator, delegate,
scope, expires, parent? }`, nested from the leaf (innermost) to the root, where `scope` is the finite part of the
hop's capability (`actions`, `resources`, `audience`, `maxInvocations`) and `expires` is the earlier of
`validUntil` and `constraints.notAfter`. Because the verifier has proven every hop narrows and links to its parent
(AC-8, DC-4), each mandate's scope MUST be a subset of its parent's and its delegator MUST equal its parent's
delegate — Poly's narrowing rule (K12) holds by construction.
· Actor: Relying party · Traces: R6, R8, R14 · docs §5
· **Verify:** a three-hop chain yields a mandate whose `parent.parent` is the root's; every scope is a subset of
its parent's; every delegator equals its parent's delegate; `expires` never exceeds the parent's.

## Revocation as a signal

**PP-5** — The adapter MUST be callable per proposed action with no session state, so that a revocation between
two actions is detected on the next call (PD6 §2 "every action, not the first"). A revoked hop MUST yield `Failed`
with reason `revoked`, which the host maps to Poly's `CredentialRevoked` signal on its `Trust` mode machine.
· Actor: Relying party, Principal · Traces: R9, R10, R7 · docs §6
· **Verify:** the same presentation verifies, the AAC is revoked, and the next call yields `Failed` /
`revoked`.

---

*Scope: this profile delivers the adapter and the data it emits. Poly's own checking of what a program does
with the claims, the `Trust` machine, and PD6's age policies are Poly's; the joint test in docs §7 exercises
both sides together.*
