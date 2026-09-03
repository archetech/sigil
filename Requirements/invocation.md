# Requirements — Invocation

Formal requirements realized by [`docs/invocation.md`](../docs/invocation.md). Prefix **`INV`**. Format and
traceability: see [`README.md`](README.md). RFC 2119 keywords are normative. Invocation is the ocap verb that turns
a *verified capability* into an *attributable act* — the point-of-use exercise (`R7`) plus the completed-action
attribution (`R11`) the A2A collaboration story needs.

**INV-1** — An agent invokes a capability by producing an **invocation**: a statement it signs binding the specific
`action` and `resource` (and any target/params) to the capability chain, a fresh challenge, and the audience. The
invocation MUST be **non-repudiably attributable to the acting agent** (the chain's holder-bound leaf) — an
invocation is the agent's committed *act*, not the verifier's query about what is permitted.
· Actor: Agent · Traces: R7, R11 · docs §2
· **Verify:** an invocation verifies as signed by the leaf agent over exactly its `{action, resource, challenge,
audience}`; altering the action after signing invalidates it.

**INV-2** — A verifier (resource server) MUST accept an invocation only if **all** of: the capability chain
verifies (holder binding, control via VRC, attenuation, validity, revocation — as `verifyPresentation`); the
invocation proof binds to the **requested** `action`/`resource`; and the action/resource are in the leaf's scope.
Anything else MUST be denied.
· Actor: Verifier · Traces: R7 · docs §2, §3
· **Verify:** an invocation of an out-of-scope action is denied `authorization`; an invocation whose signed action
differs from the requested one is denied.

**INV-3** — An invocation MUST NOT be **replayable**: it is bound to the verifier's fresh challenge and to the
audience, so replay to a different verifier, or reuse of a stale/foreign challenge, MUST be denied. (Freshness
comes from the verifier-issued nonce — no new server state is required.)
· Actor: Verifier · Traces: R7, P10 · docs §2
· **Verify:** an invocation bound to verifier A's challenge is denied when presented to verifier B (audience
mismatch), and when re-sent against a new challenge (challenge mismatch).

**INV-4** — A completed invocation MUST yield an **attributable record**: the invocation (agent-signed) plus an
optional **receipt** (resource-server-signed acknowledgment referencing the invocation). Any third party MUST be
able, from signatures + DID/status resolution alone, to attribute the action to the acting agent and — via the
chain — to the accountable principal, disclosing only what attribution requires.
· Actor: Verifier / Auditor · Traces: R11, P2 · docs §4
· **Verify:** a record re-verifies offline: the invocation's chain + action-binding check out, and the receipt (if
present) is a valid signature by the named resource server over the invocation id and decision.

**INV-5** — A **high-consequence** invocation MUST compose with the human step-up (`AC-11`): invoking a
high-consequence action requires the principal's proof-of-human co-sign, exactly as for a presentation, and lifts
the record to `human-co-signed`.
· Actor: Human authorizer, Verifier · Traces: R13, AC-11 · docs §3
· **Verify:** a high-consequence invocation without a co-sign is denied `co-sign-required`; with a valid principal
co-sign it succeeds at `human-co-signed`.

---

*Open: multi-invocation sessions (a capability exercised repeatedly under one grant) and `maxInvocations`
enforcement (stateful spent-count tracking) are deferred — the per-invocation freshness nonce is the primitive; a
spend-tracking layer is a later slice, kept out of the keyless verifier.*
