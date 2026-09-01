# Sigil — Verifiable AI Agent Identity on Archon

**v0 · discussion draft · not a specification**
Audience: the Sigil collaboration.
Purpose: agree the *shape* of the problem and the scope before building — a shared starting point, meant to be marked up.

---

## 0. One-paragraph thesis

Autonomous AI agents increasingly act across organizational boundaries — negotiating, transacting, and deciding
on behalf of people and organizations — but there is no agreed way to verify, *before an interaction begins*,
**who an agent is, what entity controls it, and what it is authorized to do.** Archon already provides the hard
part: decentralized identity (`did:cid`), verifiable credentials, challenge/response proof, secure agent-to-agent
messaging, and a delegation/trust substrate. **Sigil is the agent-identity layer on top of Archon** — the
credential formats, the first-contact trust-negotiation protocol, and the authority model that let two agents from
two organizations establish grounded, scoped, revocable trust with no prior bilateral agreement.

This maps directly onto the W3C Agent Identity Community Group's problem statement and its named deliverables, and
onto the growing market demand for verifiable agent-to-agent (A2A) exchange.

---

## 1. The problem (grounded in the W3C CG)

The CG frames the gap precisely: *"there is no agreed upon mechanism for verifying an agent's identity, its
controlling entity, or its authorization scope before interaction begins,"* which creates *"accountability,
security, and liability challenges."*

Three questions must be answerable by a counterparty **at first contact, cryptographically, without a pre-existing
relationship:**

1. **Identity** — is this agent who it claims to be? (a resolvable, controllable identifier)
2. **Control** — what entity stands behind it and is accountable for it? (a verifiable binding to a principal)
3. **Authorization** — what, specifically, is it allowed to do here, right now? (a scoped, revocable capability)

Sigil exists to make all three answerable with a signature, not a bilateral integration.

---

## 2. Scope

**In scope (v0):**
- Agent **identity**: an agent as a first-class, resolvable, controllable DID.
- Agent **credentials**: a verifiable format binding *agent ↔ controlling entity ↔ authorization scope*.
- **Trust negotiation** at first contact across organizational boundaries.
- **Scoped delegation** (principal → agent → sub-agent), verifiable end-to-end.
- **Capability invocation** to a relying service (the A2A/MCP call), verified at the point of use.
- **Revocation and lifecycle** — per-hop, fail-closed.
- **Accountability / attribution** for liability, without over-disclosure.
- **Integration profiles** with complementary protocols (A2A, MCP, OAuth/OIDC, SPIFFE).

**Deliberately out of scope (v0):**
- Personal, lifelong **private-data custody** and evidence-of-private-history disclosure — a distinct problem with
  a distinct audience, addressed by a separate effort. Sigil is about *agents proving authority to counterparties*,
  not *a person's data vault*.
- Being a general-purpose PKI, a payments rail, or an agent runtime/framework. Sigil rides on Archon and interops
  with agent frameworks; it does not replace them.
- Governance of *what agents should be allowed to do* (policy authorship) beyond the mechanisms to express, prove,
  attenuate, and revoke authority.

---

## 3. Actors

Agents are first-class here — the CG names the roles informally but does not yet formalize a vocabulary; this is
one place Sigil can lead. An **agent can also be a principal to its own sub-agents**, so the model is recursive.

| Actor | Role |
|---|---|
| **Principal** | The human or organization on whose behalf an agent acts; the ultimate source of authority and the party accountable for it. |
| **Agent** | Autonomous software with its own DID. Presents credentials binding it to its principal and its authorization scope. May delegate to sub-agents. |
| **Issuer / Authority custodian** | Mints an agent's identity and its scoped authority; enforces narrowing at issuance. May be the principal, or a service acting for it. |
| **Verifier / Relying party** | The cross-organization counterparty. Verifies identity + controlling entity + scope *before* interacting. Trusts the issuer's signature, never an intermediary's word. |
| **Delegator** | A principal or agent that hands an *attenuated* slice of its authority to another agent. |
| **Human-in-the-loop authorizer** | The principal (or a designate) who supplies a proof-of-human step-up for high-consequence actions. |

---

## 4. Design principles (non-negotiable properties)

These are carried forward as *properties the design must guarantee*, not features — validated the hard way in
prior work and stated here on their own merit:

- **P1 — Authority is an object, not a role.** The right to act is a *signed, scoped, revocable capability
  verified at the point of use* — never a standing permission or a role lookup.
- **P2 — Separate the holder of authority from the actor that wields it**, so that no single component both defines
  and exercises a power.
- **P3 — Attenuation is monotonic.** A delegated capability can only *narrow*. Widening is refused at issuance and
  is unrepresentable in a verified chain — there is no confused deputy.
- **P4 — Revocation is per-hop and fail-closed.** Revoking any link invalidates everything downstream; ambiguity
  resolves to *deny*.
- **P5 — Trust rests on the issuer's signature**, not on the word of any relay, gateway, or transport. A relay may
  lie about availability but never about content.
- **P6 — Identity is proven by a signature, not by a network property.** Never authenticate an agent by its
  origin, address, or transport metadata; those are circumstantial. The key is the identity.
- **P7 — A published value must carry no capability.** Anything that must be public by construction (a resolvable
  document, a callback, a challenge) must not itself confer authority; the secret that authorizes must live
  outside the public artifact.
- **P8 — Unlinkable by default where it matters.** Use a fresh, pairwise identifier per counterparty so that
  independent interactions can't be correlated into a profile without cause.
- **P9 — Deny-by-default, with human step-up for high-consequence actions.** Every authority decision crosses a
  single gate; sensitive actions escalate to a proof-of-human co-sign.
- **P10 — Verify before interacting.** Identity, controller, and scope are checked at *first contact*, ahead of
  any consequential exchange — the CG's core requirement.

---

## 5. Use-cases

Each maps to a CG deliverable and to an existing Archon primitive, and names the property it must guarantee.

**UC-1 · First-contact trust negotiation.** Agent A (org X) meets Agent B (org Y), no prior agreement. Each
resolves the other's identity, verifies the controlling entity, and confirms authorization scope before any
consequential exchange. *Guarantees: P10, P5. CG: trust-negotiation protocol, trust levels.*

**UC-2 · Scoped delegation to a sub-agent.** A principal grants an agent authority; the agent delegates a narrowed
slice to a task-specific sub-agent; the sub-agent proves the full chain to a verifier. *Guarantees: P1, P3. CG:
credential format + delegation.*

**UC-3 · Capability invocation at a service.** An agent presents a scoped capability to invoke a specific action
at a relying party (an A2A or MCP call), verified at the moment of use. *Guarantees: P1, P10. CG: integration
profiles.*

**UC-4 · Revocation propagation.** A principal revokes an agent, or a delegator revokes one hop; relying parties
reject every subsequent presentation, fail-closed, within a bounded window. *Guarantees: P4. CG: revocation &
lifecycle.*

**UC-5 · Accountability / attribution.** After an agent acts, the relying party (or an auditor) can attribute the
action to the agent and its controlling entity for liability — with only the disclosure the attribution requires.
*Guarantees: P2, P8. CG: the accountability motivation.*

**UC-6 · Human step-up.** A high-consequence agent action requires the principal's proof-of-human co-sign before
the relying party will accept it. *Guarantees: P9.*

---

## 6. What Archon already provides · what Sigil builds

| Archon provides (the substrate) | Sigil builds (the agent-identity layer) |
|---|---|
| `did:cid` identity + resolution | An **agent-credential profile** (W3C VC) binding *agent ↔ controlling entity ↔ scope* |
| Verifiable Credentials (Herald) | A **first-contact trust-negotiation protocol** (resolve → verify controller → confirm scope) |
| Challenge/response proof-of-control | **Trust-level definitions** and the verification requirements per level |
| Secure agent-to-agent messaging (DIDComm) | **Integration profiles**: A2A, MCP, OAuth/OIDC, SPIFFE |
| Groups / trust registry | A **capability model**: mint → delegate-with-narrowing → invoke → revoke, as verifiable chains |
| Keymaster wallet / signing | **Revocation & lifecycle** semantics (per-hop, fail-closed) and **post-quantum** requirements |

The point of the split: Sigil should be *thin* — most of the identity and messaging weight is already Archon's.
Sigil is the credential shapes, the negotiation protocol, and the authority semantics that turn those primitives
into verifiable agent identity.

---

## 7. Requirements (v0 — actor-tagged, proposed)

Framed as *actor requirements*: **as an ‹actor›, I need ‹capability› so that ‹property›.** Each is traceable to a
use-case and a principle. This is a first set to react to, not a settled list.

**Identity**
- **R1 · Agent** — a resolvable, controllable DID of my own, distinct from my principal's, so that I can be
  identified and held accountable as a distinct entity. *(UC-1; P6)*
- **R2 · Verifier** — to resolve an agent's identity and cryptographically confirm it controls its DID before I
  interact, with no pre-existing relationship. *(UC-1; P5, P10)*

**Control binding**
- **R3 · Principal** — to issue a verifiable credential binding a specific agent to me as its controlling entity,
  so a counterparty knows who stands behind it. *(UC-1; P2)*
- **R4 · Verifier** — to verify the *controlling entity* behind an agent, and the chain from the agent to that
  entity, from signatures alone. *(UC-1; P5)*

**Authorization & delegation**
- **R5 · Delegator** — to grant an agent a *scoped* capability that names exactly what it may do, and nothing
  more. *(UC-2, UC-3; P1)*
- **R6 · Delegator** — to delegate a *narrowed* slice of my own authority to a sub-agent such that widening is
  impossible to express or forge. *(UC-2; P3)*
- **R7 · Verifier** — to confirm an agent's authorization scope *for this specific action* at the point of use,
  and refuse anything outside it. *(UC-3; P1, P10)*
- **R8 · Agent** — to prove a multi-hop delegation chain to a verifier without any hop needing to contact any
  other party live. *(UC-2; P5)*

**Revocation & lifecycle**
- **R9 · Principal / Delegator** — to revoke an agent or a single delegation hop and have every downstream
  authority fail closed within a bounded, stated window. *(UC-4; P4)*
- **R10 · Verifier** — to detect a revoked identity or capability and refuse it, defaulting to *deny* on any
  ambiguity or unavailability. *(UC-4; P4)*

**Accountability & privacy**
- **R11 · Verifier / Auditor** — to attribute a completed action to the acting agent and its controlling entity
  for liability, disclosing only what the attribution requires. *(UC-5; P2)*
- **R12 · Principal** — that my agent's independent interactions with different counterparties cannot be
  correlated into a profile without cause, via pairwise identifiers. *(UC-5; P8)*

**Human oversight**
- **R13 · Human authorizer** — that high-consequence actions cannot complete without my proof-of-human co-sign,
  enforced structurally rather than by convention. *(UC-6; P9)*

**Integration & assurance (cross-cutting)**
- **R14 · Relying party** — to consume Sigil identity/authority through the protocol I already speak (A2A, MCP,
  OIDC, SPIFFE) via a documented profile, without adopting a new transport. *(UC-3)*
- **R15 · All** — that no published artifact (document, callback, challenge) ever carries the secret that
  authorizes; authority lives outside anything that must be public. *(P7)*
- **R16 · All** — a stated **trust-level** taxonomy so a verifier can require the assurance a given interaction
  warrants (e.g. self-asserted vs. organization-vouched vs. human-co-signed). *(UC-1; CG: trust levels)*

---

## 8. Open questions for the collaboration

These are genuinely open — the point of a v0 is to surface them for macterra, not pre-answer them.

1. **Credential format** — how much of the agent credential aligns to the CG's emerging VC profile vs. an
   Archon-native shape? Where should Sigil *propose* to the CG rather than follow?
2. **Trust-level taxonomy** — what are the levels, and what verification does each demand? (self-asserted →
   org-vouched → human-co-signed → …?)
3. **The controller binding** — is "controlling entity" always a principal DID, or can it be an org credential, a
   role, a legal identifier? How is accountability expressed for a chain of orgs?
4. **First-contact protocol** — synchronous negotiation vs. presentation-of-credentials-then-verify; how much
   round-trip is acceptable before an interaction?
5. **Integration priority** — which profile is first (A2A? MCP?), driven by the market demand you're seeing?
6. **Human-in-the-loop boundary** — what makes an action "high-consequence," and is that Sigil's call, the
   principal's policy, or the verifier's requirement?
7. **Vocabulary alignment** — do we adopt the CG's terms as they solidify, or seed ours (the actor model above)
   into the CG?
8. **Post-quantum** — a requirement now, or a stated forward-compatibility constraint?

---

## 9. Proposed next steps

1. macterra + flaxscrip react to this v0 — cut, add, re-scope; especially §2 (scope), §5 (use-cases), §8.
2. Lock the **anchor use-case** (likely UC-1 or the priority A2A exchange) and design it end-to-end against Archon
   primitives as the first vertical slice.
3. From the anchor slice, derive the **agent-credential profile** (R3/R4/R5) as the first concrete artifact to
   take toward the CG.
4. Stand up the Sigil repo and a minimal reference implementation of the anchor use-case.

*Sigil — a verifiable mark an agent presents to prove who it is, who stands behind it, and what it may do.*
