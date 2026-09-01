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

## Toolchain

Pinned via [`../.nvmrc`](../.nvmrc) (and `engines` once `package.json` exists). Pin npm to match, so lockfiles
stay CI-compatible.

## Traceability from the tests

The code/test columns of the matrix populate automatically as `@implements` / `@verifies` tags land — so coverage
and requirement traceability reinforce each other: a requirement with a green test column *and* line coverage is
genuinely done, and the gap report shows the rest.
