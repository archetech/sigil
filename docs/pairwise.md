# Sigil Pairwise / Correlation Resistance

**Status:** design note, v0 · how an agent's interactions with different counterparties stay uncorrelatable
(closes the correlation-resistance half of `R12` / `UC-5`). Requirements in
[`Requirements/pairwise.md`](../Requirements/pairwise.md). Uses the DTG **VPC** (Verifiable Persona Credential)
adopted in [`aac-dtg-reconciliation.md`](aac-dtg-reconciliation.md).

## 1. The problem, and the tension

If an agent presents the same DID (and the same chain) to every verifier, two counterparties — or a passive
observer resolving public assets — can correlate its activity into a profile. But the act must still be
**attributable when there is cause** (`UC-5`). So the property is: *unlinkable across counterparties, attributable
with cause.* `R12` names the mechanism: **pairwise identifiers.**

## 2. Persona — a pairwise identity

An agent acts under a **persona**: a fresh, standalone `did:cid` used in place of its canonical identity in a given
relationship. The capability chain is issued **to the persona** (the persona *is* the agent-facing identity in that
chain), so:

- the verifier attributes the act to the **persona**, and the **canonical agent DID never appears** in the
  presentation, invocation, or record (PW-1);
- two personas of the same agent share **no identifier that reveals them as the same agent** — distinct persona
  DIDs, no common canonical DID — so a verifier (even two colluding ones) cannot correlate them *as the same agent*
  (PW-2).

`mintPersona(canonical)` returns a fresh persona `Signer` (usable anywhere the agent would be — a leaf subject, a
presenter, an invoker) plus the persona-link below. When the issuer is seeded (`{ mnemonic }`), a persona's key is
**HD-derived and recoverable** — the same seed backs every persona, so the many-identities-per-relationship pattern
does not become a key-custody sprawl (see [`archon-primitives.md`](archon-primitives.md) §Open-questions-5).

## 3. The persona-link (VPC) — with-cause attribution

A **persona-link** is a DTG VPC, **signed by the canonical agent**, binding `persona → canonical`. It is the
recovery path:

- it is **never part of a presentation** — it is disclosed existence-only / out-of-band, so it never lets a
  verifier correlate;
- an authorized holder (the principal, an auditor) calls `verifyPersonaLink(link)` to recover the canonical agent —
  **only** if the link is signed by that canonical agent, is about the persona, and is unrevoked (PW-3);
- it **fails closed**: a forged, wrong-signer, or revoked link does not unmask (PW-4). Because the link is signed by
  the canonical agent, the canonical **cannot repudiate** a persona it vouched for, and no third party can forge a
  link implicating an innocent agent.

So attribution is a *deliberate, evidenced* act (someone presents the VPC), not a property a verifier can extract —
which is exactly "no correlation **without cause**."

## 4. Scope — what this achieves, and what it doesn't

This is the pairwise-identifier **mechanism** `R12` asks for. It gives **per-relationship agent unlinkability** plus
the with-cause recovery path. Two honest boundaries:

- **The accountable principal (the chain's root controller) is still shared** across a principal's personas — that
  is what makes attribution possible at all. Two verifiers can still correlate on *the principal*, not the agent.
  **Full** unlinkability additionally requires a **per-audience chain** (a fresh controller-signed chain, or a
  pairwise *principal* identifier, per counterparty) — which the persona primitive enables but does not itself
  automate. A follow-up.
- **Passive observers** are defeated only if the credential assets are not publicly correlatable — Archon's native
  `manifest` + `reveal: false` (existence-only disclosure) is the tool; a chain delivered only over the encrypted
  DIDComm presentation is not observable at all.

## Traceability

- `[D-PW-1 → PW-1, R12]` §2 — act under a persona; the canonical agent never appears in a presentation.
- `[D-PW-2 → PW-2, R12]` §2 — two personas share no identifier that reveals the common agent.
- `[D-PW-3 → PW-3, R11]` §3 — the persona-link (VPC), signed by the canonical, is the with-cause recovery path.
- `[D-PW-4 → PW-4]` §3 — persona-link verification fails closed (forged / wrong-signer / revoked ⇒ no unmask).
