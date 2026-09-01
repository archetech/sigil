# Sigil Vocabulary (the grammar)

**Status:** foundational reference. The canonical lexicon Sigil's requirements, design notes, code, and tests all
draw from — one term per concept, one concept per term. Grammar is the first building block: the requirements are
*written in* this vocabulary, so it sits upstream of them.

Settled conventions:
1. **`Capability`** is the noun for authority (scoped, attenuable, revocable). `authorization` is only the AAC
   *field* that carries it. "Scope" is not used as a primary term (OAuth-loaded; connotes coarse static strings).
2. **Principal / Controller / Issuer** are distinct *roles*, usually played by one entity.
3. **`Verifier`** is canonical; *relying party* is the accepted synonym.
4. The credential is the **Agent Authorization Credential (`AAC`)**.
5. **Defer to W3C VC/DID and ToIP terms wherever they exist; coin new terms only where the standards are silent.**

## Nouns — entities (roles; often one entity plays several)

| Term | Meaning | Standards anchor |
|---|---|---|
| **Principal** | the human/org that is the ultimate source of authority and accountability | — |
| **Controller** | the entity accountable for *a specific* agent; who it is bound to | W3C DID `controller`; ToIP DTG relationship party |
| **Issuer** | the signer of a credential; canonically = the Controller | W3C VC `issuer` |
| **Agent** | autonomous software with its own DID, acting for a principal; may be a principal to sub-agents | W3C VC subject/holder; ToIP DTG node ("AI bot") |
| **Verifier** | the counterparty that checks a presentation before interacting (syn. *relying party*) | W3C VC `verifier` |
| **Delegator** | a principal or agent that grants a *narrowed* capability to another agent | — |
| **Authorizer** | a human who supplies a proof-of-human step-up for high-consequence actions | — |

## Nouns — artifacts

| Term | Meaning | Schema anchor |
|---|---|---|
| **DID** | decentralized identifier; every actor has one, method-agnostic | W3C DID Core |
| **Agent Authorization Credential (AAC)** | the credential binding *Agent ↔ Controller ↔ Capability* | Sigil (rides on a DTG relationship edge — see §Schema) |
| **Capability** | the unit of authority: a *scoped, attenuable, revocable* grant of what an agent may do | **Sigil** (the layer DTG does not define) |
| **Constraint / caveat** | a limit on a capability (audience, count, time, context) | Sigil |
| **Presentation (VP)** | what an agent shows a verifier: the credential(s) + a holder proof, bound to a challenge | W3C VP; OID4VP; Archon VP |
| **Challenge** | the verifier's request: nonce + audience + credential requirements | Archon challenge; OID4VP request |
| **Proof** | a signature — the issuer's (on a credential) or the holder's (on a presentation) | W3C VC proof |
| **Trust level** | the strength of what a presentation proves (identity → controller-vouched → issuer-pinned → human-co-signed) | Sigil (grounded in DTG endorsement/witness) |
| **Delegation chain** | the ordered capabilities root→leaf; monotonically narrowing | Sigil |
| **Revocation status** | a resolvable, fail-closed validity indicator | W3C VC status |

## Verbs — the distinctions *are* the grammar

- **resolve** (DID → document) · **issue** (sign a credential) · **deliver / accept / hold** (move a credential to
  the agent) · **revoke** (invalidate, fail-closed) · **attest** (a third party asserts a fact it did not perform).
- **delegate** (hand authority down) ≠ **attenuate / narrow** (the *only* permitted change on delegation — monotonic).
- **authenticate** (establish *who*) ≠ **authorize** (establish *what may be done*) ≠ **verify** (the verifier's
  *whole* check: authenticate + resolve controller + authorize + validity + status).
- **present** (show a credential) ≠ **invoke** (use a capability to act).
- **prove** (holder binding) = demonstrate live key control against the nonce.

## Properties & relations

- **Properties:** scoped · attenuable · revocable · holder-bound · method-agnostic · pairwise · monotonic
  (attenuation) · fail-closed · deny-by-default.
- **Relations:** an entity *controls* an agent · an issuer *issues to* a subject · a capability *narrows* its
  parent · a presentation *binds to* a nonce + audience · a verifier *trusts* an issuer.

## The rules — well-formed sentences

1. A **Controller** *issues* an **AAC** *to* an **Agent**, *binding* it to a **Capability**.
2. An **Agent** *presents* an **AAC** *to* a **Verifier**, which *verifies* — *authenticate*, resolve the
   **Controller**, *authorize* the action against the **Capability** — *before* interacting; else *deny*,
   *fail-closed*.
3. A **Delegator** *delegates* an *attenuated* **Capability** to a sub-agent; the **Delegation Chain** is *monotonic*.
4. A high-consequence action requires an **Authorizer**'s proof-of-human *co-sign*.

## Schema alignment

Sigil is layered, and each layer adopts a standard rather than reinventing one:

- **Presentation layer → Archon VP / OID4VP (DCQL).** How a credential is requested and shown (see
  [`presentation-model.md`](presentation-model.md)).
- **Trust-graph layer → ToIP [DTG Core Credentials](https://trustoverip.github.io/dtgwg-cred-spec/)** (Decentralized
  Trust Graph, Working Draft v1.0, 2026-08) — a graph of trust relationships between people, orgs, and AI agents,
  as six W3C VC types. Sigil adopts these for the relationship / trust / privacy / vouching edges:

  | Sigil concept | DTG credential |
  |---|---|
  | Controller ↔ Agent binding | **VRC** — Verifiable Relationship Credential (a trust edge between two entities) |
  | Pairwise / correlation control (unlinkability) | **VPC** — Verifiable Persona Credential (persona DID per relationship) |
  | Third-party attestation (issuer ≠ controller; runtime/SPIFFE grounding) | **VWC** — Verifiable Witness Credential |
  | Vouching / reputation feeding a trust level | **VEC** — Verifiable Endorsement Credential |
  | Org membership / agent onboarding (if modelled) | **VMC / VIC** — Membership / Invitation Credentials |

- **Capability layer → Sigil.** DTG defines the trust *graph* (who is related to / vouched by / accountable for
  whom) but **not** a scoped, attenuable, revocable grant of *what an agent may do*. That authority layer — the
  **Capability** and the AAC's `authorization` — is Sigil's distinct contribution, riding on the DTG relationship
  edge. (DTG's VIC confers *membership* authorization, not an object-capability.)

**Consequence for the AAC:** the *control binding* is a DTG relationship edge (a VRC); the *capability* is Sigil's
addition on top. Whether the AAC **is** a VRC extended with a capability claim, or a Sigil capability credential
that **references** a VRC, is the next design decision — tracked against [`agent-credential.md`](agent-credential.md).

DTG is a ToIP Working-Group draft (heading to an approved deliverable); Sigil should **track and align to it, and
contribute** where the agent/capability case exposes gaps — the same posture we take toward the W3C Agent Identity
CG.
