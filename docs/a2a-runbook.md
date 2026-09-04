# Live A2A runbook — two wallet-backed agents

**Status:** operational runbook · how to run a real Sigil A2A exchange between two agents that each hold their own
`did:cid` wallet, keys never leaving the wallet. Verified end-to-end, live, between two public hyperswarm agents.

This is the procedure behind the "delegate a piece of work to a counterparty" scenario ([`engagement.md`](engagement.md)):
a **grantor** (its own wallet) delegates a scoped capability to a **counterparty** (its own wallet, which may not run
Sigil), the counterparty validates it from resolution + signatures alone, does the work, and the completed act is a
durable, bilateral, third-party-auditable record.

## What each side does with only wallet verbs

Everything below is a Keymaster verb (CLI `npx @didcid/keymaster <verb>`, or the MCP `archon_*` tools). No key is
ever exported.

| Step | Actor | Verb | Sigil meaning |
|---|---|---|---|
| 1. Create the counterparty | counterparty | `create-id` + `publish-didcomm` | a hyperswarm agent DID with a mailbox |
| 2. Relationship (optional) | grantor | `create-asset-json` | a VRC the counterparty can resolve to trust the grantor |
| 3. Mint the grant | grantor | `create-asset-json` (VRC), then `create-asset-json` + `update-asset-json` (AAC, backfill `id`) | **op-log-as-proof** VRC + AAC — controller = grantor, no inner proof ([`keymaster-account.md`](keymaster-account.md)) |
| 4. Send the grant | grantor | `send-didcomm` → counterparty | the AAC + a fresh challenge over DIDComm |
| 5. Receive + validate | counterparty | `receive-didcomm`; resolve + verify | authentic *without Sigil tooling* — `controller === issuer` from the signed op log |
| 6. Invoke | counterparty | `sign-file` over `{holder, challenge, audience, action, resource}` | the committed act — `sign-file` = `addProof` = Sigil's exact `EcdsaSecp256k1Signature2019` proof |
| 7. Verify | grantor / resource server | `verifyInvocation` (library) | the chain + the counterparty's holder proof |
| 8. Receipt | grantor | `sign-file` over the receipt body | the grantor's signed acknowledgment |
| 9. Anchor | grantor / performer | `create-asset-json` `{invocation, receipt}` | the durable **bilateral commitment** ([`engagement.md`](engagement.md)) |
| 10. Audit | anyone | `verifyAnchoredRecord` (library) | actor, accountable principal, committer — from resolution alone |

The library (`verifyInvocation` / `verifyAnchoredRecord`) does the Sigil verification; the wallet does the signing.
A wallet-driven library signer shells to the CLI / MCP for `sign-file` (the `@didcid/clients` REST client omits it).

## Notes from the live run

- **The return leg does not need DIDComm.** The forward grant (grantor → counterparty) goes over DIDComm; the
  *return* is the **anchored record** the counterparty (or grantor) writes and anyone **resolves** — no reply
  message required. This is more robust than a round-trip and matches the object-capability shape.
- **A freshly-published mailbox receives immediately.** A long-established DID whose mailbox predates the current
  mediator setup may lag on receive; publish/refresh its DIDComm mailbox before relying on it as a *receiver*.
- **The counterparty needs no Sigil tooling to validate** — op-log-as-proof means `controller === issuer` is read
  from standard DID resolution + signature checking. This is what lets a stranger's agent trust a Sigil grant.

## Config

The keymaster reads `ARCHON_PASSPHRASE` + `ARCHON_GATEKEEPER_URL` from the wallet directory's `.env` (via dotenv).
**dotenv does not override an already-set variable** — unset any inherited global copies first
(`env -u ARCHON_PASSPHRASE -u ARCHON_GATEKEEPER_URL npx @didcid/keymaster …`), or the wallet-local `.env` is ignored
and you get "Incorrect passphrase".
