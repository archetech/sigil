# AAC ↔ DTG Reconciliation

**Status:** design note, v0 · settles how the Agent Authorization Credential relates to the ToIP
[Decentralized Trust Graph](https://trustoverip.github.io/dtgwg-cred-spec/). Updates
[`agent-credential.md`](agent-credential.md) and its requirements.

## Decision

**The AAC is a thin Sigil *capability* credential that *references* a DTG VRC.** The durable controller↔agent
relationship lives in a DTG **Verifiable Relationship Credential (VRC)**; the AAC carries only the ephemeral
**Capability** and points at the VRC that establishes control.

The AAC deliberately **references** the relationship rather than **embedding** it. The relationship and the
capability have **different lifecycles** — the controller↔agent edge is stable and long-lived; a capability is
short, scoped, attenuable, often per-task. Embedding the relationship in the capability credential would force
re-issuing the whole relationship every time authority changes, and would duplicate what DTG already standardizes.

## The layered model

| Layer | Owner | Carries |
|---|---|---|
| **Presentation** | Archon VP / OID4VP (DCQL) | how a credential is requested and shown (holder-bound) |
| **Trust graph** | **ToIP DTG** (adopted) | relationships, personas, vouching, witnessing |
| **Capability** | **Sigil** (the AAC) | scoped, attenuable, revocable authority — *what an agent may do* |

DTG defines the *graph* — who is related to, vouched by, and accountable for whom. It does **not** define a scoped
object-capability (DTG's VIC confers coarse *membership* authorization only). That authority layer is Sigil's
contribution, riding on a DTG edge.

## What Sigil adopts from DTG

| Sigil concern | DTG credential | Role in Sigil |
|---|---|---|
| Controller ↔ Agent binding | **VRC** (Verifiable Relationship Credential) | the control edge the AAC references |
| Pairwise / correlation control | **VPC** (Verifiable Persona Credential) | unlinkable persona DID per counterparty |
| Third-party attestation (issuer ≠ controller; runtime/SPIFFE grounding) | **VWC** (Verifiable Witness Credential) | witnessed edge formation |
| Vouching / reputation → trust level | **VEC** (Verifiable Endorsement Credential) | grounds the assurance ladder |
| Org membership / onboarding (if modelled) | **VMC / VIC** | optional |

These trust-graph credentials reference **DTG's** schemas. The **AAC** — the capability layer DTG does not model —
has **Sigil's own** schema. See [`schemas.md`](schemas.md).

## The re-specified AAC

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://sigil.archetech.org/ns/agent/v1"],
  "type": ["VerifiableCredential", "AgentAuthorizationCredential"],
  "issuer": "did:web:acme.example",            // a party to the referenced relationship (the controller or a delegator)
  "validFrom": "…", "validUntil": "…",         // short-lived
  "credentialStatus": { "type": "SigilRevocation2026", "id": "did:cid:…status" },
  "credentialSubject": {
    "id": "did:cid:…agentA",                   // the agent (holder proves control of this key at presentation)
    "relationship": "did:cid:…vrc",            // REFERENCE to the DTG VRC establishing controller ↔ agent
    "authorization": {                         // the Capability — Sigil's layer
      "actions": ["invoke:catalog.search"],
      "resources": ["did:web:vendor.example/catalog"],
      "constraints": { "audience": ["did:web:vendor.example"], "maxInvocations": 100, "notAfter": "…" },
      "delegable": true,
      "parent": null
    },
    "assuranceLevel": "controller-vouched"     // derived, grounded in the graph (VRC/VEC/VWC)
  },
  "proof": { "…": "issuer signature" }
}
```

Changes from the standalone AAC:

- **`credentialSubject.relationship`** — a reference to the DTG **VRC** that establishes the controller↔agent
  relationship. The controller is **read from the VRC**, not re-asserted in the AAC.
- **`issuer`** — MUST be a party to that VRC (the controller, or a delegator whose authority chains to it). The
  issuer signature no longer *is* the control binding by itself; it is the capability grant, made valid by the
  referenced relationship.
- **`authorization`** — unchanged in shape; still carries the Capability.

## Composed verification

For a requested action `A` on resource `R`, audience `V`, nonce `N`, the verifier MUST confirm **all** of:

1. **Holder binding** — the presenter controls `credentialSubject.id`, bound to `N` and `V`.
2. **Relationship** — resolve and verify the referenced **VRC**: it is signed, establishes controller↔agent, and
   is not revoked; the AAC's `issuer` is a party to it (the controller, or a delegator in the chain).
3. **Capability** — `A ∈ authorization.actions` ∧ `R ∈ authorization.resources` ∧ all `constraints` hold
   (incl. `V ∈ audience`).
4. **Validity + status** — `now ∈ [validFrom, validUntil]`; `credentialStatus` **and** the VRC status resolve and
   are not revoked. *Unresolvable ⇒ deny.*
5. **Trust level** — the issuer/relationship satisfies the interaction's required assurance (grounded in VRC, and
   in VEC/VWC where higher assurance is demanded).
6. **(If delegated)** — walk `authorization.parent` to the root; each hop `⊆` its parent; no hop revoked.

Any failure is a **deny**, fail-closed, with minimal disclosure.

## Trust ladder, grounded in the graph

`identity` (holder proof only) → `controller-vouched` (VRC verified) → `issuer-pinned` (controller ∈ verifier's
trusted set) → `endorsed` / `witnessed` (VEC / VWC on the graph) → `human-co-signed`.

## Open items

- **VRC exact fields** — track the DTG Working Draft; pin the reference shape (by credential DID vs. embedded).
- **Capability inline vs. linked object-capability** — the `authorization` is inline today; a linked ZCAP-LD may
  serve delegation better (unchanged from `agent-credential.md` §8).
- **Revocation coordination** — revoking the VRC edge vs. the AAC capability are distinct actions; a revoked VRC
  MUST invalidate every AAC referencing it (fail-closed).
- **Register both the AAC and the VRC reference** as Archon schemas so a challenge can require them.

## Traceability

- `[D-AAC-11 → AC-3, AC-13]` — control binding via a referenced DTG VRC; the AAC is a capability credential on the
  trust graph.
