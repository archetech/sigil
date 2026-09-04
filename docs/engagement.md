# Sigil engagement records (bi-directional commitment)

**Status:** design note, v0 · anchoring a completed invocation as a durable, bilateral, third-party-auditable
commitment. First slice of the bi-directional commitment mechanism. Builds on invocation records
([`invocation.md`](invocation.md)) and op-log-as-proof ([`keymaster-account.md`](keymaster-account.md)).

## The idea

An invocation record `{invocation, receipt}` is already a **bilateral pair**: the invocation is the *agent's*
signed commitment ("I did this"), the receipt the *counterparty's* ("I accepted it"). We built it as a transient
message (`verifyRecord`). Anchoring it makes it **durable and resolvable** — a non-repudiable record either side,
or any auditor, can verify long after the exchange.

## Anchor to a party-controlled asset — not the AAC

The record is anchored as an **asset controlled by the party that performed / receipted the work** (op-log-as-proof
— the asset's controller *is* the signature). Crucially it is **not** written onto the AAC:

- the AAC is controlled by the *grantor*, so writing to it would pull the grantor back online for every use —
  destroying the object-capability property (Karp's "the delegator speaks once"; our R8). Anchoring under the
  *performing* party keeps the grantor out of the loop.
- both commitments stay intact: the invocation and receipt carry their own signatures inside the record;
- it verifies **keyless / offline** — `verifyAnchoredRecord(did)` resolves the record and checks both signatures +
  the chain, contacting no one.

`issuer.anchorRecord(anchor, record)` anchors it; `verifyAnchoredRecord(did, deps)` returns the attribution
(`actor`, `accountablePrincipal`) plus `anchoredBy` (the durable committer). A record carrying a receipt must be
anchored by that receipt's server (`anchor-mismatch` otherwise), binding "who committed" to "who acted". The anchor
can **revoke** its own record to retract the commitment (fail-closed on replay).

## Worked scenario — a delegation to a counterparty that doesn't know our tools

*I (an agent of the principal) delegate work to Morningstar, a counterparty that does not run Sigil.* Verified live
(`npm run e2e:engagement`):

1. **Relationship** — Morningstar holds an endorsement about the principal (its own trust anchor). This is how it
   trusts a request *rooted in the principal* — the trust-registry mechanism ([`trust-registry.md`](trust-registry.md)).
2. **Delegation** — principal → me → Morningstar; the chain roots in the accountable principal.
3. **Authorization** — the principal co-signs the act (proof-of-human step-up, [`agent-credential.md`](agent-credential.md)
   §5) → the request lifts to `human-co-signed`. This is "I authorize a proof."
4. **Validation without our tools** — Morningstar validates from **resolution + signatures alone** (op-log-as-proof
   + the relationship); it needs no Sigil-specific tooling to establish that the request came from the principal.
5. **Commitment** — Morningstar receipts and **anchors** the completed record. Any auditor verifies it offline:
   the act attributes to Morningstar, under the accountable principal, durably committed by Morningstar.

The *deploy-delegation* shape — principal → aegis (all deploy) → archon-ops (production deploy) — is the same
multi-hop chain ([`delegation-chain.md`](delegation-chain.md)); an engagement record can be anchored at each
consequential deploy.

## Open items (later slices)

- **Accrual / spend ledger** — successive invocations appended as *updates* to one engagement asset give a signed
  history, and `maxInvocations` "for free" (resolve and count). Deferred; the single-record anchor is this slice.
- **Privacy** — a public record is correlatable (opposite of a pairwise persona, R12), so anchoring is **opt-in**
  and correlation-sensitive engagements anchor under a persona.
- **Cost** — one anchor per act is a network write; anchor consequential acts, not a hot loop.

## Traceability

- `[D-ENG-1 → INV-4, R11]` anchor `{invocation, receipt}` as an op-log-as-proof asset controlled by the performing
  party (never the AAC — R8 preserved); `verifyAnchoredRecord` verifies both commitments + attribution offline.
