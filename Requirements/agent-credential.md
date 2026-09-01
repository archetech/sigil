# Requirements — Agent Authorization Credential (AAC)

Formal requirements realized by [`docs/agent-credential.md`](../docs/agent-credential.md). Prefix **`AC`**. Format
and traceability: see [`README.md`](README.md). RFC 2119 keywords are normative.

## Identity

**AC-1** — The AAC MUST name the agent as `credentialSubject.id`, a DID of any method, and a verifier MUST require
a holder-binding proof of control of that DID — bound to the verifier's nonce and audience — before it treats the
agent as authenticated.
· Actor: Agent, Verifier · Traces: R1, R2 · docs §3.1, §6.1
· **Verify:** a presentation with no valid holder proof is denied; a replayed proof or one bound to a different
audience/nonce is denied.

**AC-2** — Possession of an AAC MUST NOT, by itself, authenticate or authorize the presenter; the credential is
not bearer.
· Actor: Verifier · Traces: R2 · docs §1
· **Verify:** presenting valid AAC bytes without proving control of `credentialSubject.id` is denied.

## Control binding

**AC-3** — The control binding (agent ↔ controller) MUST be established by a **referenced ToIP DTG VRC**, not by
the AAC issuer alone. The AAC MUST carry `credentialSubject.relationship` referencing that VRC; a verifier MUST
resolve and verify the VRC (signed, establishes controller↔agent, not revoked) and confirm the AAC `issuer` is a
party to it, before relying on the control claim.
· Actor: Principal, Verifier · Traces: R3, R4 · docs §3.2, §6.2 · [`aac-dtg-reconciliation.md`](../docs/aac-dtg-reconciliation.md)
· **Verify:** an AAC with no `relationship`, an unresolvable or revoked VRC, or an `issuer` not party to the VRC,
each produce a deny.

**AC-13** — A verifier MUST treat the AAC and its referenced VRC as a **fail-closed pair**: a revoked or
unresolvable VRC invalidates every AAC that references it, and the VRC's validity/status is checked alongside the
AAC's.
· Actor: Verifier · Traces: R9, R10 · docs §6 · [`aac-dtg-reconciliation.md`](../docs/aac-dtg-reconciliation.md)
· **Verify:** revoking the VRC denies a subsequently-presented AAC that references it, even if the AAC itself is
otherwise valid.

## Authorization / scope

**AC-4** — The AAC MUST express authorization as a structured object of `actions`, `resources`, and `constraints`;
free-text scope MUST NOT be used.
· Actor: Delegator · Traces: R5 · docs §2, §3.3
· **Verify:** an AAC lacking a structured `authorization` is rejected as invalid.

**AC-5** — A verifier MUST evaluate the *specific* requested action and resource against `authorization` at the
point of use and refuse anything outside it; authorization MUST NOT be inferred from the mere presence of a
credential.
· Actor: Verifier · Traces: R7 · docs §3.3, §6.4
· **Verify:** with one credential, an in-scope action is allowed and an out-of-scope action is denied.

**AC-6** — A verifier MUST enforce `authorization.constraints`, including `audience`; a verifier not named in the
audience MUST refuse.
· Actor: Verifier · Traces: R7, R15 · docs §2, §6.4
· **Verify:** presenting to a verifier outside `constraints.audience` is denied (no redirect).

## Lifecycle

**AC-7** — A verifier MUST enforce `validFrom`/`validUntil` and MUST resolve `credentialStatus`, denying on expiry,
on revocation, or on an unresolvable status (fail-closed).
· Actor: Verifier · Traces: R9, R10 · docs §2, §6.5, §6.6
· **Verify:** expired → deny; revoked → deny; status endpoint unreachable → deny.

**AC-8** — A delegated AAC's `authorization` MUST be a subset of its `parent`'s; widening MUST be refused at
issuance and MUST be unrepresentable in a verified chain. Verification MUST walk the `parent` chain to its root
and MUST fail closed on any broken or revoked hop.
· Actor: Delegator, Verifier · Traces: R6, R9 · docs §7, §6.7
· **Verify:** a child that widens scope is rejected at issuance; a forged widening is rejected at verification; a
revoked mid-chain hop denies the entire chain.

## Interoperability

**AC-9** — The agent, controller, and issuer DIDs MAY each be non-native (`did:web`, `did:key`, …); issuance,
delivery, holding, and presentation MUST function when the agent is non-native.
· Actor: Agent, Principal · Traces: R1, R3 · docs §2, §4 · presentation-model §5
· **Verify:** an AAC issued to a `did:web` agent over DIDComm is delivered, accepted, held, and later presented
and verified successfully.

## Assurance & oversight

**AC-10** — A verifier MUST be able to require a minimum `assuranceLevel` for an interaction, and the level MUST
reflect what was actually proved rather than only what the issuer asserts.
· Actor: Verifier · Traces: R16 · docs §5
· **Verify:** an interaction requiring `issuer-pinned` refuses a merely `controller-vouched` presentation.

**AC-11** — For an action designated high-consequence, a verifier MUST require a proof-of-human co-sign in addition
to the AAC.
· Actor: Human authorizer, Verifier · Traces: R13 · docs §5
· **Verify:** a high-consequence action presented without a valid co-sign is denied.

**AC-12** — A denial MUST give the requester an actionable reason while disclosing no more than necessary — no
subject linkage or full-scope disclosure.
· Actor: Verifier · Traces: R11, R12 · docs §6
· **Verify:** a denial names the failing check class but does not reveal the subject's other identifiers or the
full authorization contents.

---

*Open requirements (tracking design §8): a scope vocabulary (`AC-4` refinement), the revocation mechanism (`AC-7`),
and whether `assuranceLevel` is asserted or derived (`AC-10`) are not yet locked; they become firm requirements as
the design note's open questions are resolved.*
