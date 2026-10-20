# Sigil — Verifiable AI Agent Identity on Archon

**v0.1 · foundational requirements · revised 2026-10-20**
Audience: the Sigil collaboration.
Purpose: the thesis, scope, actors, principles, and foundational requirements (`R1`–`R16`) that every feature
requirement realizes. v0 was a discussion draft; v0.1 incorporates the review in
[issue #1](https://github.com/archetech/sigil/issues/1) — the R8/R10 and R11/R12 tensions, the revocation window,
the threat model (§4a), and the post-quantum framing — now that the first vertical slices have forced the decisions.

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

## 4a. Threat model (v0)

The adversary cases the principles exist to defeat, each mapped to the requirements that mitigate it and to what
remains. Threat IDs (`T1`…) are **not** requirements and do not enter the traceability matrix; the mitigations
cited are the traced requirements. The adversary is assumed to control the network and any relay or gateway, to
hold any public artifact, and to be able to obtain credential bytes — but not the holder's signing key unless the
case says so.

| ID | Threat | Mitigated by | Residual / out of scope |
|---|---|---|---|
| T1 | A relay, gateway, or transport **lies about availability** — drops, delays, or reorders messages. | P5: a dropped message confers nothing; deny-by-default (P9) means absence is never authority. | Availability itself is out of scope — Sigil does not defend against denial of service. |
| T2 | A relay or transport **tampers with content** or substitutes a credential. | P5, P6: every authority object is signed and verified point-in-time (`AC-1`, `DC-1`); the transport carries no trust (`R14`). | — |
| T3 | **Replay** of a presentation or invocation — to the same verifier later, or to a different verifier. | Holder proof bound to the verifier's fresh nonce and audience (`AC-1`, `AC-6`, `INV-3`); stale or foreign challenge → deny. | A verifier that reissues a nonce defeats itself; nonce uniqueness is the verifier's duty. |
| T4 | **Credential theft** — the bytes of an AAC are copied and presented by someone else. | Not bearer (`AC-2`): without proof of control of `credentialSubject.id`, the bytes are inert. | — |
| T5 | **Compromised agent key.** | Per-hop, fail-closed revocation (`R9`, `R10`, `AC-7`): the principal `delete`s the agent or its grant; point-in-time signature checks keep earlier valid acts attributable (`R11`) rather than retroactively voided. Human step-up (`R13`, `AC-11`) bounds high-consequence use. | Acts between compromise and revocation are valid-looking — the window of `R9` is this exposure. Key custody is the wallet's (Archon Keymaster), not Sigil's. |
| T6 | **Compromised delegator key** mid-chain. | As T5, plus: revoking that hop kills everything downstream (`AC-8`, `DC-4`), and monotonic attenuation (P3) bounds the blast radius — a compromised delegator can only mint within the scope it already held. | — |
| T7 | **Confused deputy** at the MCP / A2A boundary — an agent is induced to spend its authority on an adversary's request. | Widening is unrepresentable (P3, `AC-8`); scope and audience are checked for the *specific* action at the point of use (`R7`, `AC-5`, `AC-6`); an invocation commits to one action, resource, and audience (`INV-1`, `INV-3`). | Whether the agent *should* make a request that is in scope is the agent's own policy — out of scope (§2). |
| T8 | **Forged controller binding** — an agent claims a principal it does not have. | The binding is a VRC signed by the controller, and the AAC issuer must be a party to it (`AC-3`); the AAC and VRC are a fail-closed pair (`AC-13`). | — |
| T9 | **Correlation** by a verifier, or by colluding verifiers, across an agent's relationships. | Personas (`PW-1`, `PW-2`); the persona-link is never presented in-band (`PW-3`). | Full unlinkability against colluding verifiers who also share timing and content side-channels is not claimed. |
| T10 | **Stale or rolled-back resolution** — the verifier is served old registry state, so a revoked credential looks live. | Status is resolved current at each verification and an unresolvable DID denies (`AC-7`); any caching is bounded by the stated window (`R9`). | Registry consensus and propagation are the Archon substrate's concern; Sigil inherits its guarantees. |
| T11 | **Malicious or careless trust anchor** asserts an assurance it did not earn. | Assurance is *derived* from what the verifier can prove, not asserted (`TR-1`); evidence from a non-anchor or revoked source fails safe to *lower* assurance (`TR-4`); trust never gates chain validity (`TR-5`). | Which anchors a verifier pins is the verifier's policy. |
| T12 | **Forged persona-link** implicating an agent in a persona it never used. | Only a link signed by the canonical agent unmasks; forged, mis-subject, or revoked links do not (`PW-4`). | — |
| T13 | **A principal's own agent exceeds the principal's intent** while staying inside its granted scope. | Human step-up for high-consequence actions (`R13`); least-authority grants (`R5`, `R6`). | Policy authorship — what to grant — is out of scope (§2). |

Explicitly out of scope: denial of service and availability; compromise of the verifier's own host; wallet key
custody and the registry's consensus (both Archon's); and the agent's own decision policy.

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
| Keymaster wallet / signing | **Revocation & lifecycle** semantics (per-hop, fail-closed) and **signature-suite agility** (forward-compatibility, including post-quantum) |

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
- **R8 · Agent** — to prove a multi-hop delegation chain to a verifier without any delegator or intermediate
  issuer being contacted. "Offline" means *delegator-offline*: the verifier decides from the presented credentials
  plus exactly two delegator-independent lookups against the public registry — **DID resolution** (keys, resolved
  point-in-time at each signature) and **status resolution** (revocation, resolved current). Those lookups are the
  freshness oracle `R10` needs; the carve-out is what reconciles the two. A verifier MAY serve them from cached
  resolutions only within its stated window (`R9`). *(UC-2; P5)* — realized by `DC-1`.

**Revocation & lifecycle**
- **R9 · Principal / Delegator** — to revoke an agent or a single delegation hop and have every downstream
  authority fail closed within a bounded, stated window. **The window is defined** as the registry's propagation
  latency for the `delete` operation plus the verifier's resolution staleness. The reference verifier resolves
  **fresh at every verification** (staleness zero), so its window is the substrate's propagation latency alone; a
  verifier that caches resolutions MUST bound the cache age and MUST state that bound as its window. There is no
  status list, short-lived-token, or CRLite-style artifact: revocation is the `delete` operation, seen by replay.
  *(UC-4; P4)* — realized by `AC-7`, `AC-13`, `DC-4`.
- **R10 · Verifier** — to detect a revoked identity or capability and refuse it, defaulting to *deny* on any
  ambiguity or unavailability. *(UC-4; P4)*

**Accountability & privacy**
- **R11 · Verifier / Auditor** — to attribute a completed action to the acting agent and its controlling entity
  for liability, disclosing only what the attribution requires. Attribution is **auditor-mediated, with cause**:
  by default an act is attributed to the *persona* that performed it (`R12`); the canonical agent and its principal
  are recovered only by an authorized holder of the signed **persona-link** (a DTG VPC, kept out-of-band), which
  the canonical agent cannot repudiate and no third party can forge. Selective disclosure is not used for this.
  *(UC-5; P2)* — realized by `INV-1`, `INV-4`, `PW-3`, `PW-4`.
- **R12 · Principal** — that my agent's independent interactions with different counterparties cannot be
  correlated into a profile without cause, via pairwise identifiers (a fresh **persona** DID per relationship). This
  is what `R11` trades against, and the persona-link is the agreed resolution: unlinkable to counterparties,
  linkable to an authorized auditor. Full unlinkability against *colluding* verifiers is a stated residual (§4a).
  *(UC-5; P8)* — realized by `PW-1`–`PW-4`.

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

These are genuinely open — the point of a v0 is to surface them for discussion, not pre-answer them.

1. **Credential format** — how much of the agent credential aligns to the CG's emerging VC profile vs. an
   Archon-native shape? Where should Sigil *propose* to the CG rather than follow?
2. **Trust-level taxonomy** — what are the levels, and what verification does each demand? (self-asserted →
   org-vouched → human-co-signed → …?)
   *Status: settled for v0 — levels are **derived** from what the verifier proves, raised by a decentralized trust
   graph (`TR-1`–`TR-5`, `AC-10`; [`trust-registry.md`](trust-registry.md)).*
3. **The controller binding** — is "controlling entity" always a principal DID, or can it be an org credential, a
   role, a legal identifier? How is accountability expressed for a chain of orgs?
4. **First-contact protocol** — synchronous negotiation vs. presentation-of-credentials-then-verify; how much
   round-trip is acceptable before an interaction?
   *Status: settled for v0 — one round trip: request → challenge → presentation (or invocation) → result (or
   receipt), transport-agnostic (`R14`; [`../docs/presentation-model.md`](../docs/presentation-model.md)).*
5. **Integration priority** — which profile is first (A2A? MCP?), driven by observed market demand?
   *Status: the review recommended MCP first. v0 shipped the transport-agnostic exchange over Archon DIDComm
   (`R14`) because that is where the live counterparty agents were; the **MCP profile is the next integration**,
   now also motivated by gateway environments that speak only MCP and A2A. Still open: the exact shape of that
   profile.*
6. **Human-in-the-loop boundary** — what makes an action "high-consequence," and is that Sigil's call, the
   principal's policy, or the verifier's requirement?
   *Status: settled for v0 — the **verifier designates** high-consequence actions and requires the co-sign
   (`AC-11`, `INV-5`); Sigil supplies the mechanism, not the policy.*
7. **Vocabulary alignment** — do we adopt the CG's terms as they solidify, or seed ours (the actor model above)
   into the CG?
8. **Post-quantum** — a requirement now, or a stated forward-compatibility constraint?
   *Status: resolved — a **forward-compatibility constraint**, not a mandate. The proof names its signature suite
   (`proof.type`), and verification sits behind a suite-agnostic `SignatureVerifier` seam, so a post-quantum suite
   is an added verifier, not a redesign. Today's only suite is Archon's `EcdsaSecp256k1Signature2019`. §6 is
   worded to match.*

---

## 9. Next steps

The v0 steps are done: the collaboration reviewed the draft (issue #1, folded into v0.1); the anchor use-case
(present-and-verify, UC-1/UC-3) was designed and implemented against live Archon as the first vertical slice; the
agent-credential profile exists ([`agent-credential.md`](agent-credential.md), `schemas/aac.schema.json`); the
reference implementation is in this repository. What remains open at the foundational level:

1. Take the agent-credential profile toward the W3C Agent Identity CG (§8 Q1, Q7).
2. Define the **MCP integration profile** (§8 Q5).
3. Decide how "controlling entity" generalizes beyond a principal DID (§8 Q3).

*Sigil — a verifiable mark an agent presents to prove who it is, who stands behind it, and what it may do.*
