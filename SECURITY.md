# Security Policy

Sigil concerns verifiable agent identity and authority — the correctness of these mechanisms is the whole point of
the project. We take security seriously and welcome responsible disclosure.

## Reporting a vulnerability

- **Do not open a public issue for a security vulnerability.**
- Report privately via GitHub's [**private vulnerability reporting**](https://github.com/archetech/sigil/security/advisories/new)
  (the repository's **Security → Report a vulnerability**).
- Please include: a description, the affected component and version/commit, reproduction steps, and the impact.

## What to expect

- An acknowledgement of your report, an assessment, and **coordinated disclosure** once a fix or mitigation is
  available.
- Credit for the reporter, if desired.

## Scope

- **In scope:** the Sigil specification and reference implementation in this repository.
- **Out of scope here:** the underlying [Archon](https://github.com/archetech/archon) infrastructure — report
  those to the Archon project.

## A note on what "security" means here

Because Sigil is an identity/authority layer, the security-sensitive properties are not only memory-safety bugs
but **the invariants themselves**: holder binding (a credential is never bearer), monotonic attenuation
(delegation only narrows), fail-closed revocation, verify-before-interact, and "a published value carries no
capability." A break in one of these is a security issue even if no code crashes. Report those too.
