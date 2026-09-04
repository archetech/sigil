# Sigil objects ↔ Archon primitives

**Status:** architecture reference · how Sigil's objects decompose into Archon primitives, and where we could lean
on Archon's tools more. Written for review with the Archon architect. Companion to
[`archon-substrate.md`](archon-substrate.md) (the primitives themselves).

## Thesis: Sigil adds no new substrate primitive

Everything Sigil produces is one of exactly three Archon things, moved over one Archon transport, revoked by one
Archon operation:

| Sigil needs | Archon primitive |
|---|---|
| an actor that signs | an **agent DID** (create op with `publicJwk`) |
| a durable signed object (a credential) | an **asset DID** (`didDocumentData` = the object, `controller` = issuer) |
| a transient signed act (a presentation, an invocation, a co-sign, a receipt) | a **signed message** — `EcdsaSecp256k1Signature2019` over the JCS hash, the *exact* proof `@didcid/cipher` makes |
| to move a message agent→agent | **DIDComm** (`sendDidComm` / `receiveDidComm`) |
| to revoke | a **`delete`** operation (`deactivated`, seen by replay) |
| to verify anything, at any point in time | **resolution = operation-log replay** (`versionTime` / `versionId`) |

Sigil introduces **no new cryptographic suite, no new storage, no new registry, no new transport.** The verifier is
keyless precisely because it only ever does two Archon reads — resolve a DID, check a signature — with Archon's own
cipher. The "complex objects" (a delegation chain, an invocation, an attributable record) are **compositions** of
these primitives plus **verification rules**. That is the whole of Sigil: a *semantic layer*, not a substrate.

## The object map

| Sigil object | Archon expression | Idiomatic? |
|---|---|---|
| `Signer` (agent identity) | agent DID; keys self-custodied via `@didcid/cipher` (Archon's cipher) | ✅ minted exactly as Archon mints an ID |
| **VRC** (relationship) | asset DID, `didDocumentData` = the signed VRC, `controller` = the controller | ◐ raw plaintext asset — see §"Credentials" |
| **AAC** (capability) | asset DID whose `id` == its own DID (content-addressed → create-then-update backfill) | ◐ raw plaintext asset — see §"Credentials" |
| **TrustCredential** (VEC/VWC/VMC) | asset DID, `didDocumentData` = the signed DTG credential, `controller` = the endorser | ◐ same as above |
| **Presentation** | a holder-signed message binding `{holder, challenge, audience}` + the chain | ◐ hand-rolled — Archon has native challenge/response, see §"Presentation" |
| **CoSign** (step-up) | a principal-signed message binding `{authorizer, challenge, audience, action, resource}` | ✅ a signed assertion, Archon proof suite |
| **Invocation** | a holder-signed message binding `{…, action, resource}` + chain references | ✅ composed; Archon has no ocap concept, see §"Invocation" |
| **Receipt** | a resource-server-signed message referencing the invocation | ✅ signed message |
| **InvocationRecord** | `{invocation, receipt}` — transient today | ◐ could be **anchored as an asset** for permanent audit, see §"Records" |
| **Revocation** | `keymaster.revoke` → gatekeeper `deleteDID` | ✅ the `delete` op directly |
| **Transport** | `createArchonTransport` → `sendDidComm` / `mediateDidComm` / `receiveDidComm` | ✅ DIDComm directly |
| **Assurance derivation / trust registry** | resolve trust-credential assets + verify anchor signatures | ✅ resolution + cipher only |

`✅` = uses the Archon primitive as-is. `◐` = works, but a cleaner or more native path exists — the open questions
below.

## Invocation, decomposed (the object of interest)

**Archon has no native invocation, capability, or ZCAP concept** — a grep of the keymaster/gatekeeper finds none.
So invocation is Sigil's contribution, and the clean story is *what it is built from*:

1. **A signed message.** An invocation is `{holder, challenge, audience, action, resource, credentials[], proof}`
   where `proof` is a standard `EcdsaSecp256k1Signature2019` over the JCS hash of the rest — the same proof Archon
   puts on every operation and credential. Nothing exotic: an Archon verifier could check this signature today.
2. **References, not copies.** `credentials[]` is the chain of AAC **asset DIDs**; the verifier resolves each by
   replay. The invocation carries authority *by reference* to anchored assets, so it stays small and the authority
   is independently revocable.
3. **The binding is the attribution.** Because the holder signs the specific `{action, resource}`, the message *is*
   a non-repudiable statement "this agent did this" — no registry, no central log. `verifyRecord` re-derives
   attribution (actor = leaf, principal = root controller) from signatures + resolution alone.
4. **It rides DIDComm.** In the A2A exchange the invocation is a DIDComm message; the receipt is the reply.

The one place Sigil could align *more* to a standard: Archon's proof purposes are `authentication` /
`assertionMethod`. An invocation is neither — ZCAP-LD names this `proofPurpose: "capabilityInvocation"`. Adopting
that purpose (instead of `authentication`) would make a Sigil invocation self-describing to any linked-data
verifier and slot cleanly beside Archon's existing purposes.

## Open questions — using Archon's tools more (for the architect)

These are the `◐` rows. Each is a real trade-off, not an oversight — worth deciding together.

**1. Credentials: native `issueCredential` vs. raw signed asset.**
Archon's native flow is `bindCredential` (to a **schema DID**) → `addProof` → **encrypt to the subject** → anchor as
an asset → pointer in the *subject's* **`manifest`** (with `reveal` disclosure control). Sigil instead writes a
*plaintext* VC into an issuer-controlled asset's `didDocumentData`, resolvable by anyone.
- *Why we diverge:* a capability is meant to be **presented and verified**, not held secret by the subject — an
  issuer-controlled, presentable asset is arguably the *right* shape for an AAC, where the native "encrypted
  attestation in the subject's manifest" model fits a private claim better.
- *But:* a plaintext public AAC exposes the controller↔agent edge to anyone who resolves it — a correlation concern
  (`R12`). Archon's `manifest` + `reveal: false` is the native tool for existence-only disclosure. **Question:** do
  we adopt the manifest/reveal model for correlation resistance, and — regardless — **register AAC / VRC / DTG /
  Invocation as Archon schema DIDs** for validation and legibility to Archon tooling (wallet UI, etc.)?

**2. Presentation: native `createChallenge` / `createResponse` / `verifyResponse`.**
Archon has a native VP triad; [`presentation-model.md`](presentation-model.md) even concludes "Archon's
challenge/response *is* a native VerifiablePresentation." Sigil hand-rolls the holder proof because it presents a
*chain* + trust credentials + co-sign, which the native response doesn't model. **Question:** should the
holder-binding sub-part reuse `createChallenge`/`createResponse` (with the chain as an extension), so Sigil's
presentation is a strict *superset* of the native VP rather than a parallel one?

**3. Records: anchor them as assets.**
Invocation and receipt are transient messages today. Anchoring an `InvocationRecord` as an **asset DID** would make
it a permanent, content-addressed, point-in-time-resolvable audit record — maximally Archon-idiomatic, and exactly
the durable-attribution artifact `R11` wants. **Question:** do we offer record-anchoring as an option (the acting
agent or the resource server anchors the record), keeping the transient path for the hot loop?

**4. `capabilityInvocation` proof purpose.** Adopt it (above), or keep `authentication`?

**5. Key custody: HD-seed recovery (done), and a Keymaster-backed signer (blocked upstream).**
The issuer now supports **HD-seed key derivation** (`createArchonIssuer(gk, cipher, { mnemonic })`): every identity
— agents *and* personas — derives from one BIP-39 seed at an incrementing path (`m/44'/0'/${index}'/0/0`), exactly
as the Keymaster derives its wallet IDs, so keys are **recoverable** (`recover(index, did)`). This closes the
recoverability gap for the many-identity persona case using the same `@didcid/cipher` HD primitives — no Keymaster
required. Random keys remain the default for tests/portability.

A **fully Keymaster-backed signer** (keys never leave the wallet) is the production ideal, and it is **reachable
today** — it is a design-alignment decision, not an upstream blocker. One HD wallet holds *many* identities (the
controller **and** its agents **and** every persona, all seed-recoverable), and **`setCurrentId` / `useId`** switches
which one acts, so the wallet can be every party in a Sigil flow. What it lacks is only a *raw* "sign this arbitrary
object" verb; its **specific** signing verbs, with `useId`, cover Sigil's operations **if they impose their shapes**:

| Sigil op | Keymaster verb (+ `useId`) | Note |
|---|---|---|
| mint agent / persona | `createId` | HD-derived, recoverable |
| present / invoke (holder proof) | `createResponse` | Archon's native VP envelope — align our chain to it (question 2) |
| AAC / VRC / persona-link | `issueCredential`, or `createAsset` | native VC (question 1), **or** the op-log route below |
| revoke | `revokeDID` / `removeId` | direct |

The clean route for credentials: our AAC carries a redundant inner `proof`; if instead the **asset's signed
create-operation** (by the controller) *is* the issuer's signature — authenticity from the controller-of-asset + the
signed operation log, not a second inner proof — then `useId(controller)` + `createAsset(aac)` mints a fully valid
AAC with **no inner-sign and no new verb**. That is strictly more Archon-idiomatic (the op log *is* the signature)
and is the cleanest path to Keymaster-native credentials. So the "peer that the Keymaster can grow to speak" is a
matter of adopting native envelopes (questions 1–2), not adding a primitive — a raw `sign(object, asDID,
proofPurpose)` verb would only be needed to keep Sigil's *current* custom shapes unchanged.

## What Sigil deliberately does not touch

Archon offers much more — **groups, polls, vaults, dmail, lightning, nostr, image/file assets**. Sigil uses none of
them. Per the project's focus mandate, Sigil is only the **identity + authority + trust layer for A2A
collaboration**; it reaches for an Archon primitive only when a capability the goal needs has no expression without
it. Everything above is agent DIDs, asset DIDs, signed messages, DIDComm, and `delete` — nothing more.
