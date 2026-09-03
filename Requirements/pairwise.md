# Requirements — Pairwise / Correlation Resistance

Formal requirements realized by [`docs/pairwise.md`](../docs/pairwise.md). Prefix **`PW`**. Format and traceability:
see [`README.md`](README.md). RFC 2119 keywords are normative. These realize the foundational **`R12`** (an agent's
interactions with different counterparties cannot be correlated without cause, via pairwise identifiers) and its
with-cause attribution tie to `R11`/`UC-5`.

**PW-1** — An agent MUST be able to act under a **persona** — a fresh, standalone `did:cid` used in place of its
canonical identity in a given relationship — such that the persona is usable anywhere the canonical agent would be
(a chain's leaf subject, a presenter, an invoker). A presentation or invocation made under a persona MUST NOT carry
the canonical agent's DID.
· Actor: Agent, Principal · Traces: R12, P8 · docs §2
· **Verify:** an agent presents under a persona; the verifier attributes the act to the persona and the canonical
DID appears nowhere in the presentation or the record.

**PW-2** — Personas of the same agent MUST be **unlinkable** to a verifier: two presentations made under two
personas MUST share no identifier that reveals them as the same agent (distinct persona DIDs; no common canonical
DID disclosed).
· Actor: Verifier (adversary) · Traces: R12, P8 · docs §2
· **Verify:** two records for two personas of one agent share no DID that ties them to a common canonical agent.

**PW-3** — A **persona-link** (a DTG **VPC**, signed by the canonical agent, binding `persona → canonical`) MUST
let an authorized holder recover the canonical agent from a persona — the **with-cause** attribution path. It MUST
NOT be part of the presentation (it is disclosed existence-only / out-of-band), so it never enables correlation by
a verifier, only accountability by a party that holds it.
· Actor: Auditor / Principal · Traces: R12, R11 · docs §3
· **Verify:** given a persona-link, `verifyPersonaLink` returns the canonical agent iff the link is signed by that
canonical agent, is about the persona, and is unrevoked.

**PW-4** — Persona-link verification MUST **fail closed**: a link with an invalid signature, about a different
subject, or revoked MUST NOT unmask (no canonical returned). Because the link is signed by the canonical agent, the
canonical cannot repudiate a persona it vouched for, and no third party can forge a link implicating an agent.
· Actor: Auditor · Traces: R12, P4 · docs §3
· **Verify:** a forged link, or one whose signer is not the claimed canonical, does not unmask; a revoked link does
not unmask.

---

*Scope: this delivers the pairwise-identifier **mechanism** (R12 as written). It gives per-relationship agent
unlinkability + a with-cause recovery path; **full** unlinkability against colluding verifiers additionally requires
a per-audience chain (a fresh controller-signed chain per counterparty), which the persona primitive enables but
does not itself automate — a documented follow-up.*
