# Agent Workflow

Rules for coding agents — and contributors — working in this repository. **Save lessons learned here; do not
rely on session memory for process corrections.** (Contributors should also read [`CONTRIBUTING.md`](CONTRIBUTING.md).)

## Governance

- Sigil is a project under the [Archonomicon](https://github.com/archetech/archonomicon). Changes to project
  *rules* or process go through a **Nomicon proposal** (a PR to the archonomicon), agreed by the players — not the
  code workflow below.
- Code and design changes follow the issue → PR → merge flow.

## Branching & git hygiene

- Treat each task/PR as a **new branch from `main`** unless told to continue on the current branch.
- **Never commit directly to `main`.** Never mix unrelated changes on one branch.
- Check the current branch before committing if scope has changed; rebuild a stale branch from `origin/main`
  rather than patching around contamination.
- **Never run mutating git operations in parallel** — serialize `git add` / `commit` / `push`, branch moves, and
  anything that writes to `.git`.
- Use **`gh`** for GitHub operations (issues, PRs) by default.
- Do **not** amend published commits or force-push unless explicitly requested; add follow-ups as normal commits.
- After a PR merges: switch to `main`, fast-forward from `origin/main`, delete the merged branch. Prefer a clean
  branch cut over stash-juggling.

## Issue → PR → merge

- **Open an issue first.** State the requirement(s) it addresses by **ID** (`R*` foundational / `AC-*` feature),
  and the acceptance criteria — which mirror the requirement's `Verify:` line. If no requirement covers the work,
  **add the requirement first** (a change to `Requirements/`).
- Branch from the issue; **every PR links to its issue.**
- **Squash-merge** with a [**conventional commit**](https://www.conventionalcommits.org/) prefix, scoped to the
  feature (e.g. `feat(agent-credential): …`).

## Requirements, design & traceability

- Every design note in [`docs/`](docs/) has a **paired requirements doc** in [`Requirements/`](Requirements/);
  change **both in the same commit**.
- Tag the trace as you work (see [`docs/traceability.md`](docs/traceability.md)):
  design points in docs `[D-AAC-3 → AC-3]` · code `@implements AC-3` · tests `@verifies AC-3`.
- **Regenerate the matrix** whenever any layer changes, and commit it:
  `node tools/trace/build-traceability.mjs`.
- The requirement **ID is the join key** across the issue, the PR, the design point, the code, and the test — so
  GitHub's history view and the in-repo audit view are one graph.

## Code hygiene

- **Keep side effects behind an entrypoint** (e.g. `main()`) so modules import cleanly for tests; **inject fake
  dependencies** in tests rather than starting real services.
- Strict TypeScript; lint and typecheck must pass (see [`docs/ci-and-testing.md`](docs/ci-and-testing.md)).
- Use the repo-pinned toolchain (`.nvmrc`); pin npm to match so lockfiles stay CI-compatible.

## Lessons learned

Record process corrections and non-obvious gotchas here — dated — so they survive across sessions and
contributors.

- _(none yet — add as we learn.)_
