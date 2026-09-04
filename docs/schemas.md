# Sigil schemas

**Status:** design note, v0 · which credentials use Sigil's own schema and which reference DTG's. Companion to
[`aac-dtg-reconciliation.md`](aac-dtg-reconciliation.md).

## The division

Archon supports **any** JSON Schema for its VCs — a schema is a JSON Schema anchored as a **schema DID**
(`createSchema` → `createAsset({ schema })`), and a credential references it via
`credentialSchema: { id: <schemaDID>, type: "JsonSchema" }`. So Sigil registers only what is genuinely its own and
reuses the rest:

| Credential | Layer | Schema |
|---|---|---|
| **AAC** (Agent Authorization Credential) | capability | **Sigil's own** — [`schemas/aac.schema.json`](../schemas/aac.schema.json) |
| **VRC** (relationship) | trust graph | **DTG** (ToIP `VerifiableRelationshipCredential`) |
| **VPC** (persona) | trust graph | **DTG** (`VerifiablePersonaCredential`) |
| **VEC / VWC / VMC** (endorsement / witness / membership) | trust graph | **DTG** |

The AAC is the object-capability credential DTG does not model — the "capability layer on the DTG trust graph." It
is the one thing that needs a Sigil schema; everything else references DTG's registered schemas. We do not reinvent
DTG.

## The AAC schema

[`schemas/aac.schema.json`](../schemas/aac.schema.json) is the canonical source: a draft-07 JSON Schema with
Archon's `$credentialContext` / `$credentialType` extensions, describing the AAC — including the structured
`capability` (`actions` / `resources` / `constraints`; no free-text, R5/AC-4), the advisory `delegable` (not a gate,
per Karp), and the optional `proof` (omitted for op-log-as-proof credentials).

**Registering it** (a deliberate, governance-owned step): `createSchema(<aac.schema.json>)` → an Archon schema DID.
Then configure the issuer with it:

```
createArchonIssuer(gk, cipher, { aacSchemaDid })   // minted AACs carry credentialSchema → self-describing
```

A schema DID depends on its controller + create-op (not purely content-addressed), so the *production* schema DID
should be registered under a Sigil governance identity, not ad-hoc. `schemas/aac.schema.json` stays the source of
record regardless.

**Verified live:** the AAC schema registers as a real schema DID; an AAC minted with `createAsset` (op-log-as-proof)
carries `credentialSchema` pointing at it, and that schema DID resolves back to the AAC schema — so a Sigil AAC is
self-describing and validatable by any Archon tool. (Probe artifacts were revoked.)

## Validation

A `credentialSchema` reference makes an AAC self-describing and lets a verifier (or Archon tooling) validate it
against the schema. Sigil's verifier already enforces the load-bearing structural invariant at the point of use
(`isStructuredCapability`, R5/AC-4); full JSON-Schema validation against the referenced schema is an optional
additional check a relying party MAY perform. The verifier does not require `credentialSchema` — it is metadata,
carried in the credential body (so it is covered by both the inner-proof and op-log-as-proof authenticity paths).

## Traceability

- `[D-SCH-1 → R14]` a Sigil AAC schema (Archon schema DID) makes the capability credential self-describing +
  validatable; trust-graph credentials reference DTG schemas — the capability layer on the DTG trust graph.
