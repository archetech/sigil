# Contributing to Sigil

Sigil is developed in the open as a project under the [Archonomicon](https://github.com/archetech/archonomicon).
This is the day-to-day contribution flow. Coding agents should also read [`AGENTS.md`](AGENTS.md); the traceability
conventions are in [`docs/traceability.md`](docs/traceability.md) and the requirements practice in
[`Requirements/README.md`](Requirements/README.md).

The two traceability views are **complementary and share one join key — the requirement ID**: GitHub issues/PRs
carry the *decision history*, and the in-repo requirements + `TRACEABILITY.md` carry the *audited current state*.

## 1. Start with an issue

- Open a GitHub issue **before** writing code.
- Name the **requirement(s)** it addresses by ID (`R*` foundational / `AC-*` feature — see
  [`Requirements/`](Requirements/)), and state the **acceptance criteria**, which are the `Verify:` lines of those
  requirements.
- If no requirement covers the work, **add or amend the requirement first** (a change to `Requirements/`), so
  every change traces to a stated need.
- Design discussion belongs in the issue and/or the relevant [`docs/`](docs/) design note.

## 2. Branch & build

- Create a branch from `main`, named starting with the issue number.
- Use the pinned toolchain (`.nvmrc`).

## 3. Keep the trace in sync — in the same PR

A PR that changes design or code MUST:

- update the **paired requirements** doc if the design changed (`docs/x.md` ↔ `Requirements/x.md`);
- carry **traceability tags** — `[D-… → …]` design points, `@implements` on code, `@verifies` on tests;
- **regenerate** [`TRACEABILITY.md`](TRACEABILITY.md): `node tools/trace/build-traceability.mjs`.

## 4. Verify (once there is code)

- Build, lint, typecheck, and test-with-coverage must pass — see [`docs/ci-and-testing.md`](docs/ci-and-testing.md).
- A requirement is **done** when its `Verify:` criterion is checked by a `@verifies`-tagged test.

## 5. Open the PR

- **Link the PR to its issue.**
- Merge by **squash**, with a [**conventional-commit**](https://www.conventionalcommits.org/) message scoped to
  the feature.

## Governance vs. contribution

This flow is for **code and design**. Changes to project *rules* or process go through a **Nomicon proposal** (a
PR to the [Archonomicon](https://github.com/archetech/archonomicon)), unanimously agreed by the players.

Security issues follow [`SECURITY.md`](SECURITY.md) — never a public issue.
