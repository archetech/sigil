# Sigil Requirements

Formal, traceable requirements for everything Sigil builds. **Every design note in [`docs/`](../docs/) has a
corresponding requirements document here** that captures its features and functions as formal requirements. This
gives us code-to-requirement traceability and a standing quality manual — the basis for reviews, acceptance, and
future audits.

## Structure

- [`sigil-v0-requirements.md`](sigil-v0-requirements.md) — **foundational** requirements (`R1`–`R16`): the actors,
  design principles, use-cases, and the top-level actor requirements. The *why*.
- **Per-feature documents** — one per design area, named to match its design note (e.g.
  [`agent-credential.md`](agent-credential.md) ↔ [`../docs/agent-credential.md`](../docs/agent-credential.md)).
  Each realizes the foundational requirements in a specific design, with prefixed IDs.

## Requirement format

Each requirement is a single normative statement plus its trace:

> **`<PREFIX>-<n>`** — a normative statement using RFC 2119 keywords (`MUST` / `SHOULD` / `MAY`), per the
> [Archonomicon](https://github.com/archetech/archonomicon) convention.
> · **Actor:** the party the requirement serves · **Traces:** the foundational requirement(s) `R*` it realizes +
> the design-note section(s) · **Verify:** the acceptance criterion — how we confirm it is met.

- IDs are **feature-prefixed** (e.g. `AC-*` for the Agent Credential); the foundational document uses `R*`.
- The **Verify** line is the anchor for tests and audits: a requirement is not "done" until something checks it.

## Traceability chain

```
foundational requirement (R*)  ←  feature requirement (XX-*)  ←  design note (docs/)  ←  implementation + tests
```

A change at any layer is traceable up (to the need it serves) and down (to what verifies it). **When a design
note is written or changed, its requirements document MUST be updated in the same change** so the two never drift.

## Index

| Requirements | Prefix | Design note | Covers |
|---|---|---|---|
| [`sigil-v0-requirements.md`](sigil-v0-requirements.md) | `R` | — | Actors, principles, use-cases, foundational requirements |
| [`agent-credential.md`](agent-credential.md) | `AC` | [`docs/agent-credential.md`](../docs/agent-credential.md) | The Agent Authorization Credential (agent ↔ controller ↔ scope) |
