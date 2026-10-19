# Governance

Sigil is a project under the jurisdiction of the [Archonomicon](https://github.com/archetech/archonomicon), the Archetech Nomicon ([rule 21](https://github.com/archetech/archonomicon#jurisdiction)). The rules of the game are the text of the Archonomicon's default branch (rule 9). This file only points to them. Where it seems to differ from them, the rules prevail (rule 24). Rules are cited by their permanent numbers (rule 26).

## What it means for this repository

**Ordinary changes.** Requirements, design, code, tests and documentation change through this repository's own process, described in [CONTRIBUTING.md](CONTRIBUTING.md). Those changes are not rule changes, but they must comply with the rules (rule 23). The project's own guidelines, including the requirements practice and the instructions for coding agents, must not conflict with the rules (rule 24).

**Rule changes.** Changes to the rules or process are proposals to the Archonomicon, as described under *Who decides* below.

**The `did:cid` protocol.** Sigil resolves DIDs through an Archon Gatekeeper rather than implementing resolution itself. The protocol rules (rules 42 to 49) bind the implementations that accept operations or resolve DIDs. Where Sigil depends on how a DID resolves, the [did:cid Method Specification](https://archetech.com/didcid-specs/) is the authority (rule 42).

**Security.** Report vulnerabilities in Sigil as [SECURITY.md](SECURITY.md) describes. Report vulnerabilities in the `did:cid` protocol or in an implementation of it through Archon's [private vulnerability reporting](https://github.com/archetech/archon/security/advisories/new) (rule 52).

## Who decides

Anyone may submit a proposal: a pull request to the [Archonomicon repository](https://github.com/archetech/archonomicon) that adds, amends or repeals rules (rules 10 and 11). The players and the Operator are listed in [players.md](https://github.com/archetech/archonomicon/blob/master/players.md), and the rules say how proposals are agreed, objected to and adopted (rules 12 to 16, 37 and 38).
