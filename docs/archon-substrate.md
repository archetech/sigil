# Archon Substrate

**Status:** foundational reference · the Archon identity model Sigil builds on. Sigil's credentials, relationships,
and revocation are all expressed in these primitives; the design notes assume this model. Source: the
[did:cid specification](https://archetech.com/didcid-specs).

## Operations — the whole grammar of change

Every DID is an **ordered log of signed operations**, each operation content-addressed by a CID and linked to the
prior one by `previd`. There are exactly three:

| Operation | Fields | Meaning |
|---|---|---|
| **`create`** | `registration.{version,type,registry}` (`type` = `agent`\|`asset`), `publicJwk` (agents) or `controller`+`data` (assets), `created`, `proof` | Anchors a new DID. Its CID **is** the DID identifier. |
| **`update`** | `did`, `doc`, `previd`, `proof` | Evolves the document; signed by the controller. |
| **`delete`** | `did`, `previd`, `proof` | Deactivates the DID (`didDocumentMetadata.deactivated = true`). **Irreversible** — no recovery op exists. |

The DID identifier is `did:cid:<cid>`, where `<cid>` is the **CIDv1-base32 of the JCS-canonicalized create seed** —
so the identifier is a content hash of its own genesis (the anchor).

## Objects — agents sign, assets hold

- **Agent** — has `verificationMethod` (keys), `authentication`, `assertionMethod`. Agents *sign* operations and
  credentials.
- **Asset** — has a `controller` (an agent DID) and `didDocumentData`; **no keys**. Assets *hold data* and are
  governed by their controlling agent.

**A credential is an asset.** It is *held* by being listed in the holder **agent's** `didDocumentData.manifest`:
each entry keys the credential's DID to a **disclosure mode** — `reveal: true` (the full credential is published)
or `reveal: false` (existence only). Credentials are added by ordinary `update` ops on the holder's DID. The
keymaster verbs (`issueCredential` / `bindCredential` / `acceptCredential`) are the API over these operations:
*issue* ≈ `create` the credential asset (issuer-signed); *accept/hold* ≈ `update` the holder's manifest.

A Sigil/Archon VC therefore involves **four DIDs**: the credential's own **VC-DID** (the asset), its **issuer**
DID, the **recipient** DID (`credentialSubject.id`, the agent), and the **schema** DID (the credential `type`).

## Resolution — replay, not fetch

There is **no stored "resolved document."** A resolver reconstructs a DID document by **replaying its operations in
order at resolution time**, validating each `proof`. This has two consequences Sigil relies on:

- **Offline + delegator-independent.** Operations are content-addressed and published to the registry, so any
  party can fetch the CIDs and replay locally — no live contact with the DID's controller. This is the substrate
  that makes the offline delegation-chain proof ([`delegation-chain.md`](delegation-chain.md)) native, not bolted-on.
- **Point-in-time resolution is formal.** A resolution may be pinned with `versionTime` (ISO 8601 — "at or before"),
  `versionSequence` (1-indexed op number), or `versionId` (a specific op CID). This is what lets a verifier check a
  delegation against the signer's key state *as of when it signed*, so key rotation never invalidates a valid past
  delegation.

## Revocation — the `delete` operation, irreversible

**Revocation is a `delete` operation** on the credential's (or relationship's) DID. Replay then yields a minimal
document with `deactivated: true`; a verifier resolving it MUST **fail closed** (deny). It is **irreversible** —
once `delete` is confirmed on the registry there is no controller left to sign a recovery. Consequences for Sigil:

- **Temporary suspension MUST use short validity + re-issue**, never `delete`.
- **Disclosure is a separate, reversible lever:** a holder setting `reveal: false` in its manifest un-publishes a
  credential (existence-only) without revoking it — correlation/disclosure control, not revocation.

## How Sigil maps onto it

Every Sigil credential — the **AAC**, and the DTG **VRC / VPC / VWC / VEC** — is an Archon **asset DID** with a
`create → update → delete` lifecycle: resolvable at any point in time by replay, revoked (irreversibly) by
`delete`, and disclosed under the holder's manifest control. Nothing in Sigil's model requires a primitive Archon
does not already provide.

## Traceability

- `[D-AS-1 → AC-7]` — revocation is the `delete` operation (deactivated, irreversible, seen by replay, fail-closed);
  no separate status list.
- `[D-AS-2 → DC-5, R8]` — versioned resolution (`versionTime`/`versionId`) enables per-hop key-state verification.
- `[D-AS-3 → R8]` — content-addressed operation-log replay is the offline, delegator-independent substrate.
