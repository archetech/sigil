# Sigil

**Verifiable AI agent identity on [Archon](https://github.com/archetech/archon).**

Sigil is the agent-identity layer on top of Archon's decentralized identity, credential, and collaboration
primitives. It lets two AI agents from two organizations establish grounded, scoped, revocable trust — verifying,
*before an interaction begins*, **who an agent is, what entity controls it, and what it is authorized to do** —
with a signature, not a pre-existing bilateral agreement.

The work is aligned to the W3C [Agent Identity Community Group](https://www.w3.org/community/agent-identity/) and
to the growing demand for verifiable agent-to-agent (A2A) exchange.

## Status

**v0 — the anchor use-case is implemented and verified end-to-end against a live Archon node.**

The anchor is **present-and-verify**: an agent, with no prior relationship to the verifier, proves its identity,
the entity that controls it, and that a **specific** action is in scope — and the verifier accepts or denies from
signatures and DID resolution alone. It is a single vertical slice (single-hop, no delegation chain yet), traced
Requirement → Design → Code → Test in [`TRACEABILITY.md`](TRACEABILITY.md). Delegation chains (multi-hop, attenuated
capabilities) and human step-up are the next slices.

New here? Read [`Requirements/sigil-v0-requirements.md`](Requirements/sigil-v0-requirements.md) for the thesis,
scope, actor model, and design principles; then [`docs/`](docs) for the design.

## What it does

Authority is a **signed, scoped, revocable capability object**, verified at the point of use — never a role or a
standing permission. Three layers:

- **Presentation** — a holder-bound presentation proving control of the agent DID against a fresh challenge (not
  bearer). See [`docs/presentation-model.md`](docs/presentation-model.md).
- **Control** — the agent↔controller binding is a referenced ToIP **DTG** Verifiable Relationship Credential (VRC),
  not the verifier's word. See [`docs/aac-dtg-reconciliation.md`](docs/aac-dtg-reconciliation.md).
- **Authorization** — a Sigil **Agent Authorization Credential (AAC)**: a capability credential referencing that
  VRC, carrying the scoped, attenuable, revocable authority. See [`docs/agent-credential.md`](docs/agent-credential.md).

Everything rests on the Archon substrate — resolution is operation-log **replay**, revocation is a `delete`, and
each signature is verified point-in-time against the signer's key state when it signed. See
[`docs/archon-substrate.md`](docs/archon-substrate.md).

## How it's built

Two seams, injected, so the logic is testable without a live node and the trust surface is minimal:

- **The verifier is keyless.** `verifyPresentation` ([`src/verify.ts`](src/verify.ts)) crosses a deny-by-default
  ladder using only two public dependencies — DID resolution and signature checking:
  - `createArchonResolver` ([`src/archon/resolver.ts`](src/archon/resolver.ts)) — wraps an Archon **gatekeeper**
    (`@didcid/clients`); resolution is operation-log replay, point-in-time via `versionTime`.
  - `createArchonSignatureVerifier` ([`src/archon/signatures.ts`](src/archon/signatures.ts)) — wraps
    **`@didcid/cipher`** (JCS canonicalization + ECDSA secp256k1); it verifies exactly what Archon signs.

  It never uses a keymaster/wallet — a verifier needs no secret, which is also what lets it run offline against
  cached resolutions.

- **The issuer self-custodies.** Minting needs signing, so `createArchonIssuer`
  ([`src/archon/issuer.ts`](src/archon/issuer.ts)) holds its **own** keys and submits `create`/`update`/`delete`
  operations straight to the gatekeeper — mint an agent, a VRC, an AAC; present; revoke. Also no keymaster/wallet.

## Build & test

Requires **Node ≥ 22.18** (ESM, strict TypeScript, `.ts` imports run via `node --experimental-strip-types`).

```bash
npm install
npm run typecheck        # tsc, including tests
npm test                 # unit tests — offline, hermetic (the CI gate)
```

Two **opt-in** live suites run the adapters against a real Archon node. Configure entirely by environment — no
hostname or secret is committed (see [`.env.example`](.env.example)); `SIGIL_GATEKEEPER_URL` defaults to a public
node.

```bash
# resolve real DIDs through a live gatekeeper (operation-log replay)
SIGIL_GATEKEEPER_URL=<url> npm run e2e:archon -- did:cid:...

# the whole anchor, live: mint → present → verify → out-of-scope deny → revoke → teardown
SIGIL_GATEKEEPER_URL=<url> npm run e2e:prove
```

## Repository layout

```
src/
  index.ts            public surface
  types.ts            AAC / VRC / Presentation / the Resolver + SignatureVerifier seams
  verify.ts           verifyPresentation — the anchor logic (keyless)
  archon/
    resolver.ts       createArchonResolver        — gatekeeper resolution (replay, point-in-time)
    signatures.ts     createArchonSignatureVerifier — @didcid/cipher (JCS + ECDSA secp256k1)
    issuer.ts         createArchonIssuer          — self-custodied mint / present / revoke
test/                 node:test — verify (fakes), archon (real crypto), issuer (round-trip)
scripts/              e2e-archon-resolve.ts · e2e-archon-prove.ts (opt-in, live node)
docs/                 substrate, presentation, agent-credential, DTG reconciliation, delegation, vocabulary, …
Requirements/         actor-first requirements (start with sigil-v0-requirements.md)
tools/trace/          the traceability-matrix generator
TRACEABILITY.md       generated Requirement → Design → Code → Test matrix
```

## Contributing

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the issue → PR → merge flow (issues cite requirement IDs; acceptance
  criteria are the `Verify:` lines; PRs keep the trace in sync).
- [`AGENTS.md`](AGENTS.md) — working rules for coding agents and the running lessons-learned log.
- [`docs/traceability.md`](docs/traceability.md) — the four-layer Requirement → Design → Code → Test trace and its
  generated [`TRACEABILITY.md`](TRACEABILITY.md) matrix.
- [`docs/ci-and-testing.md`](docs/ci-and-testing.md) — the staged CI gate and the unit-vs-live-node split.
- [`SECURITY.md`](SECURITY.md) — responsible disclosure.

## Governance & license

Sigil is a project under the [Archonomicon](https://github.com/archetech/archonomicon), the Archetech Nomicon —
its decisions are made and recorded through that process, alongside Archon. Changes to project *rules* go through a
Nomicon proposal; code and design changes follow [`CONTRIBUTING.md`](CONTRIBUTING.md).

Licensed under the [MIT License](LICENSE).
