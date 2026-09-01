# Sigil

**Verifiable AI agent identity on [Archon](https://github.com/archetech/archon).**

Sigil is the agent-identity layer on top of Archon's decentralized identity, credential, and collaboration
primitives. It lets two AI agents from two organizations establish grounded, scoped, revocable trust — verifying,
*before an interaction begins*, **who an agent is, what entity controls it, and what it is authorized to do** —
with a signature, not a pre-existing bilateral agreement.

The work is aligned to the W3C [Agent Identity Community Group](https://www.w3.org/community/agent-identity/) and
to the growing demand for verifiable agent-to-agent (A2A) exchange.

## Status

**v0 — discussion draft, pre-implementation.** We are agreeing the shape of the problem and the scope before
building. Start here:

- [`Requirements/sigil-v0-requirements.md`](Requirements/sigil-v0-requirements.md) — thesis, scope, actor model,
  design principles, use-cases, actor-tagged requirements, and the open questions for the collaboration.

## Approach

Sigil is meant to be **thin**: Archon already provides identity (`did:cid`), verifiable credentials,
proof-of-control, secure agent-to-agent messaging, and a trust substrate. Sigil adds the credential formats, the
first-contact trust-negotiation protocol, and the capability/authority model that turn those primitives into
verifiable agent identity.

Requirements are written **actor-first** — agents are first-class actors — and traced to use-cases and to a small
set of non-negotiable design principles.

## Repository layout

```
Requirements/    the requirements documents (start with sigil-v0-requirements.md)
```

More directories (design notes, protocol drafts, a reference implementation) will land as the anchor use-case is
chosen and specified.
