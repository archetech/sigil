# Requirements — Delegation Chain

Formal requirements realized by [`docs/delegation-chain.md`](../docs/delegation-chain.md). Prefix **`DC`**. Format
and traceability: see [`README.md`](README.md). RFC 2119 keywords are normative. Monotonic attenuation itself is
`AC-8` (agent-credential); these requirements govern the *chain proof*.

**DC-1** — A verifier MUST be able to verify a complete multi-hop delegation chain from the **presented
credentials** alone, plus standard DID resolution (keys) and status resolution (revocation), and MUST NOT contact
any delegator or intermediate issuer for approval. A delegator's signature on its delegation is sufficient; it
need not be online at verification time.
· Actor: Agent, Verifier · Traces: R8, P5 · docs §2, §4
· **Verify:** a chain verifies end-to-end with every delegator offline; a network trace of verification shows DID
and status lookups only — no call to any delegator.

**DC-2** — The presenting agent MUST present the **complete ordered chain** from the root (controller-anchored) to
the leaf (itself); a missing or out-of-order hop MUST produce a deny.
· Actor: Agent, Verifier · Traces: R8 · docs §2
· **Verify:** omitting an intermediate credential, or presenting hops out of order, is denied.

**DC-3** — The verifier MUST confirm the chain is **anchored**: the root has `parent == null` and references a
verified controller VRC, and the **leaf's subject is the presenting, holder-bound agent**. A chain not rooted in
the controller, or whose leaf is not the presenter, MUST be denied.
· Actor: Verifier · Traces: R3, AC-3 · docs §3
· **Verify:** a chain whose root is not controller/VRC-anchored, or whose leaf subject ≠ the holder-bound
presenter, is denied.

**DC-4** — For each hop the verifier MUST confirm **linkage and delegability**: the hop's `issuer` equals its
parent's subject, it references the parent capability, and the parent's `authorization.delegable` is true. A hop
issued by a party other than the parent's subject, or delegated from a non-delegable parent, MUST be denied.
· Actor: Verifier · Traces: R6, AC-8 · docs §2
· **Verify:** a hop whose issuer is not the parent's subject is denied; delegating from a capability with
`delegable: false` is denied.

**DC-5** — For each hop the verifier MUST verify the issuer's signature against the issuer's key state **as of when
the hop was signed** (resolving the delegator DID at the hop's signing version — `versionTime` / `versionId`), so
a later key rotation does not invalidate a validly-signed past delegation. Revocation, by contrast, MUST be checked
at the **current** version (a `delete` seen by replay ⇒ deny).
· Actor: Verifier · Traces: R8, P5 · docs §2 · [`archon-substrate.md`](../docs/archon-substrate.md)
· **Verify:** a delegation signed before its delegator rotated keys still verifies; a `delete` on that delegator's
credential denies the chain currently.

---

*Open (design §5): chain-length bounds, cross-method signature interop along a chain, the ordered-chain
presentation encoding, and revocation cost for long chains are not yet firm requirements.*
