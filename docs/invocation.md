# Sigil Invocation

**Status:** design note, v0 · the ocap verb that turns a *verified capability* into an *attributable act*.
Requirements in [`Requirements/invocation.md`](../Requirements/invocation.md). Completes the object-capability
lifecycle **mint → delegate → invoke → revoke**; builds on the chain in
[`delegation-chain.md`](delegation-chain.md) and the exchange in [`presentation-model.md`](presentation-model.md).

## 1. Present vs. invoke

Two different verbs, both legitimate:

- **Presentation** answers *"may this agent do A?"* — an authorization query. The holder proves key control over
  the challenge; the verifier picks the action to check.
- **Invocation** is *"this agent hereby does A on R"* — the agent's **committed act**. The holder signs the specific
  `{action, resource}`, so the act is **non-repudiably attributable** to it, not merely permitted.

The difference is one line of binding: a presentation's holder proof covers `{holder, challenge, audience}`; an
invocation's covers `{holder, challenge, audience, action, resource}`. That signature *is* the attribution.

## 2. Verifying an invocation

`verifyInvocation` is `verifyPresentation` plus two things (everything else — chain, holder binding, attenuation,
revocation, assurance derivation, optional co-sign — is identical):

1. the holder proof is bound over the specific `{action, resource}` (INV-1);
2. the committed act must equal the requested one (`invocation-binding`, INV-2).

**Replay is refused for free** (INV-3): an invocation is bound to the verifier's fresh challenge and audience, so
replay to another verifier (`challenge-binding` on audience) or against a new challenge (stale nonce) is denied — no
new server state. High-consequence invocations compose with the step-up (INV-5): a `delete` still needs the
principal's co-sign and lifts the act to `human-co-signed`.

## 3. The receipt and the record — two-way accountability

A completed invocation is an **attributable record** (INV-4):

```
  record = { invocation (agent-signed) , receipt? (resource-server-signed) }
```

- The **invocation** attributes the act to the acting agent. It stands alone — a verifier that is purely keyless
  can authorize it without signing anything.
- The **receipt** is the resource server's signed acknowledgment (`{server, invocation, action, resource, audience,
  decision, assuranceLevel, at}`, referencing the invocation by its holder `proofValue`). It gives the *agent* proof
  its act was accepted — the second half of two-way accountability. Issuing one needs a key, so it is the province
  of a *resource server* (a party with a DID), not the anonymous keyless verifier.

`verifyRecord` re-verifies the whole thing offline and returns the attribution — **who acted** (the leaf agent) and
**under whose authority** (the root controller) — from signatures + resolution alone, disclosing only what
attribution requires (R11). That auditable, non-repudiable record is the trust-building payoff of A2A collaboration.

## 4. Over the A2A transport

The [protocol](../src/protocol.ts) carries it end to end: `request → challenge → invocation → receipt`. A resource
server (`createVerifier` with an `issueReceipt` hook) verifies the act and signs a receipt; the agent
(`createInvoker`) answers the challenge with an invocation built for its exact nonce. Same DIDComm transport as the
rest of the exchange.

## 5. Open items

- **Multi-invocation sessions** — a capability exercised repeatedly under one grant (a session, not one act).
- **`maxInvocations` enforcement** — stateful spent-count tracking; deliberately kept out of the keyless verifier
  (the per-invocation freshness nonce is the primitive; spend-tracking is a separate, stateful layer).
- **Legible acts** — a controlled-natural-language rendering of an invocation for the co-sign/audit boundary (a
  Lexon-inspired legibility layer; render *from* the structured act, never parse prose *into* authority).

## Traceability

- `[D-INV-1 → INV-1, R7]` §1, §2 — the invocation binds the specific act; attributable to the leaf agent.
- `[D-INV-2 → INV-2]` §2 — accept only an in-scope act whose signed binding equals the request.
- `[D-INV-3 → INV-3]` §2 — non-replayable via the verifier's fresh challenge + audience (no new state).
- `[D-INV-4 → INV-4, R11]` §3 — invocation + receipt = an attributable record re-verifiable offline.
- `[D-INV-5 → INV-5, AC-11]` §2 — high-consequence invocations compose with the human co-sign.
