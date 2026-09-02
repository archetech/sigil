# CI & Testing (staged)

The intended continuous-integration gate for Sigil — staged now, to drop in with the first code. It mirrors the
order Archon uses, so a change that passes locally passes in CI.

## The gate (every PR)

1. **`npm ci`** — clean install from the committed lockfile.
2. **Build / compile** — the build (`tsc` / `tsc --build`) must succeed.
3. **Lint** — `eslint .`.
4. **Typecheck** — `tsc --noEmit`, **including tests** (per-file transpilers skip cross-file checks, so a broken
   test type slips through the build without this).
5. **Test + coverage** — run unit tests with **coverage collected on every run**. Curate `collectCoverageFrom` for
   accuracy over a vanity percentage. Segment suites (unit / e2e) as they grow.
6. **Supply chain** — dependency review on PRs + Dependabot; a lockfile-consistency check.

## Testing conventions

- Each test carries a **`@verifies <requirement-id>`** tag, so [`../TRACEABILITY.md`](../TRACEABILITY.md) shows
  which requirements are checked. A requirement is **done** when its `Verify:` criterion is covered by a tagged
  test.
- **Keep side effects behind an entrypoint** so modules import cleanly and dependencies can be faked (see
  [`../AGENTS.md`](../AGENTS.md)); this is what makes unit tests possible without standing up real services.
- **Strict TypeScript**; `typecheck` and `lint` are gates, not suggestions.

## Unit vs. live-node tests

Two tiers, kept separate so CI stays hermetic:

- **Unit (`npm test`)** — offline, no network. `test/verify.test.ts` exercises the anchor logic against fakes;
  `test/archon.test.ts` exercises the live adapters against real `@didcid/cipher` crypto and stubbed gatekeeper
  documents (including the fail-closed cases a real node returns). This is the CI gate.
- **Live (`npm run e2e:archon` / `e2e:prove` / `e2e:delegate` / `e2e:stepup`)** — opt-in, hits a running Archon
  node. `e2e:archon` validates `createArchonResolver` against real operation-log replay. `e2e:prove` runs the
  **whole anchor** (mint a controller + agent + VRC + AAC, present, verify, revoke). `e2e:delegate` runs a
  **multi-hop chain** (controller → a0 → a1 → a2, walked root→leaf with every delegator offline). `e2e:stepup` runs
  **human step-up** (a high-consequence action denied without a co-sign, accepted at `human-co-signed` with the
  principal's co-sign). All are configured entirely by environment (see
  [`../.env.example`](../.env.example)) — no hostname or secret is committed; `SIGIL_GATEKEEPER_URL` defaults to a
  public node.

Running the live e2e is how we found that a gatekeeper answers `200` with `didResolutionMetadata.error` (never a
throw) for a DID it cannot resolve — the resolver now fails closed on it, pinned by a unit regression test.

## Toolchain

Pinned via [`../.nvmrc`](../.nvmrc) (and `engines` once `package.json` exists). Pin npm to match, so lockfiles
stay CI-compatible.

## Traceability from the tests

The code/test columns of the matrix populate automatically as `@implements` / `@verifies` tags land — so coverage
and requirement traceability reinforce each other: a requirement with a green test column *and* line coverage is
genuinely done, and the gap report shows the rest.
