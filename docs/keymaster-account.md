# Keymaster-backed accounts (op-log-as-proof)

**Status:** design note, v0 · how a Sigil identity can be a real Archon **Keymaster** wallet account — keys never
leaving the wallet — using only native verbs. Companion to [`archon-primitives.md`](archon-primitives.md).

## The idea

A Keymaster wallet holds HD-derived, recoverable identities and switches between them with `useId`
(`setCurrentId`). It can mint assets (`createAsset`), issue credentials, and revoke — but it exposes **no raw "sign
this object" verb**. So it cannot produce Sigil's *inner-signed* credentials directly. The way through is to stop
requiring an inner signature and let the **operation log be the proof**.

## Op-log-as-proof (R4)

A Sigil durable credential (VRC, AAC, DTG trust credential, persona-link) is anchored as an Archon **asset**. Its
create-operation is signed by the asset's **controller**; resolution (operation-log replay) yields the asset's
`controller` and its `didDocumentData`. So a credential is authentic to `issuer` if:

> **`resolve(cred.id).controller === cred.issuer`** — the issuer anchored it, proven by the signed op log —
> **and the presented body equals the authentic anchored data** (`didDocumentData`).

The equality check is what makes it sound: a presenter cannot mutate the credential it shows, because the anchored
data is exactly what the controller signed into the log. A tampered copy fails the equality and is denied.

The verifier accepts **either** authenticity path, per credential (`src/verify.ts` → `issuerAuthentic`):

1. **inner proof** — a signature over the body, verified point-in-time (self-custody agents; unchanged); or
2. **op-log-as-proof** — no proof; `controller === issuer` and `presented body === anchored data` (Keymaster).

Both coexist in one chain (an op-log root with inner-proof delegations, and vice-versa).

## Minting a credential with the wallet

```
keymaster.setCurrentId('controller')                 // useId — act as the controller
const did = await keymaster.createAsset(aacBody)      // signs the create-op with the wallet key; key never leaves
// (AAC only: update the asset to backfill `id === did`, as its DID is content-addressed)
```

The resulting AAC has **no inner proof** and is controlled by `controller` — the op-log-as-proof verifier accepts
it. **Verified live:** a real Keymaster-minted asset resolves through the library with `controller === issuer`, so
Sigil accepts it, with the key never leaving the wallet.

## What is wallet-backed, and what isn't

- **Issuer / controller side — wallet-backed.** The high-value root key (the accountable principal) lives in the
  Keymaster; it mints VRCs/AACs via `createAsset`. This is where custody matters most.
- **Presenter side — self-custody (for now).** A holder proof (present / invoke / co-sign) is an inner signature
  over a challenge, which the wallet has no verb to produce for Sigil's shape. Presenters remain self-custody
  identities (now HD-seed-recoverable, [`archon-primitives.md`](archon-primitives.md) §Open-questions-5). A wallet
  could present only if it adopts the native `createResponse` VP envelope, or gains a raw-sign verb.

## Public claims for unprivileged validation (direction)

`setProperty` publishes a **cleartext property** on a DID that resolves for anyone — a lightweight *unprivileged*
validation (resolve-and-read, no challenge). It suits low-stakes public markers where privacy is not required; it is
the opposite trade-off to a pairwise persona (public ⇒ correlatable), so it must not carry anything correlation- or
consent-sensitive. It is **not exposed on the `@didcid/clients` KeymasterClient** today (core/MCP only), so a
library integration awaits either that method or the gatekeeper `update` path used with a wallet signature — noted
for the collaboration.

## Traceability

- `[D-KM-1 → R4]` op-log-as-proof: a credential is authentic to its issuer if the issuer controls its asset (signed
  op log) and the presented body equals the anchored data — enabling Keymaster `createAsset` minting.
