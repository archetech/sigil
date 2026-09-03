/**
 * The Sigil verifier: an agent proves identity, control, and scope to a verifier before it acts, with no prior
 * relationship. It verifies a **complete ordered delegation chain** `[root … leaf]` from the presented credentials
 * alone — plus DID resolution (keys) and status resolution (revocation) — never contacting a delegator (R8). A
 * single-hop anchor is just a chain of length 1 (root = leaf).
 *
 * The Archon substrate (resolution = operation-log replay; revocation = a `delete`) is behind the `Resolver` seam;
 * the signature primitive is behind `SignatureVerifier`. The logic here is what Sigil owns; the crypto and the
 * substrate are injected.
 */
import type { AAC, VRC, Jwk, Proof, CoSign, TrustCredential, Presentation, Invocation, Receipt, InvocationRecord, VerifyRequest, VerifyDeps, VerifyResult, RecordResult } from './types.ts';
import { attenuates } from './capability.ts';

const deny = (reason: string): VerifyResult => ({ ok: false, reason });

/** Assurance ladder, low → high (docs/agent-credential.md §5). */
const LADDER = ['identity', 'controller-vouched', 'issuer-pinned', 'endorsed', 'witnessed', 'human-co-signed'];
function meetsAssurance(actual: string, required: string): boolean {
  const a = LADDER.indexOf(actual);
  const r = LADDER.indexOf(required);
  return a >= 0 && r >= 0 && a >= r;
}

/** The object a holder signs. A presentation binds {holder, challenge, audience}; an **invocation** additionally
 *  binds the specific {action, resource} it exercises, making it the agent's committed, attributable act (INV-1).
 *  The `SignatureVerifier` canonicalizes it (JCS) as the substrate does — this returns the object, not bytes. */
function holderSignedData(p: Presentation): unknown {
  const base = { holder: p.holder, challenge: p.challenge, audience: p.audience };
  const inv = p as Partial<Invocation>;
  return inv.action !== undefined && inv.resource !== undefined ? { ...base, action: inv.action, resource: inv.resource } : base;
}
/** The object a credential's issuer signs — the credential without its `proof`. */
function credentialBody(c: AAC | VRC | TrustCredential): unknown {
  const { proof: _proof, ...rest } = c;
  return rest;
}
/** The object a co-signer signs — the request binding, without the proof. */
function coSignBody(c: CoSign): unknown {
  const { proof: _proof, ...rest } = c;
  return rest;
}

/**
 * Resolve the key a proof was made with, at the signer's key-state *when the proof was created*
 * (`versionTime: proof.created`) — Archon verifies each signature point-in-time, so a later key rotation or a
 * `delete` does not retroactively invalidate a proof that was valid when signed. The signer DID is derived from
 * `verificationMethod` and MUST equal the principal we expect to have signed (`expectedSigner`), closing the
 * "sign with my own key while claiming to be the issuer" substitution.
 * @implements DC-5
 */
async function signerKeyAt(deps: VerifyDeps, proof: Proof, expectedSigner: string): Promise<Jwk | undefined> {
  const [signerDid] = proof.verificationMethod.split('#');
  if (signerDid !== expectedSigner) return undefined;
  const resolved = await deps.resolver.resolve(signerDid, { versionTime: proof.created });
  if (!resolved || resolved.kind !== 'agent' || !resolved.keys) return undefined;
  return resolved.keys[proof.verificationMethod];
}

/**
 * Establish control at the root: verify the referenced DTG VRC and that the root AAC's issuer is a party to it.
 * @implements AC-3, AC-13, DC-3
 */
async function verifyRoot(root: AAC, deps: VerifyDeps): Promise<VerifyResult> {
  const relDid = root.credentialSubject.relationship;
  if (!relDid) return deny('root-anchoring'); // the root must anchor to a controller VRC
  const vrcRes = await deps.resolver.resolve(relDid);
  if (!vrcRes) return deny('relationship-unresolvable'); // fail-closed
  if (vrcRes.deactivated) return deny('relationship-revoked'); // a `delete` on the VRC invalidates the chain [AC-13]
  if (vrcRes.kind !== 'asset' || !vrcRes.data) return deny('relationship-unresolvable');
  const vrc = vrcRes.data as VRC;

  if (vrc.credentialSubject.id !== root.credentialSubject.id) return deny('relationship-agent-mismatch');
  // The root's issuer must be a party to the relationship — the controller.
  if (root.issuer !== vrc.issuer) return deny('issuer-not-party');

  // The relationship edge is signed by the controller, verified at its own signing time.
  const relKey = await signerKeyAt(deps, vrc.proof, vrc.issuer);
  if (!relKey || !(await deps.signatures.verify(credentialBody(vrc), vrc.proof, relKey))) return deny('relationship-signature');
  // The root grant itself is signed by the same controller.
  const grantKey = await signerKeyAt(deps, root.proof, root.issuer);
  if (!grantKey || !(await deps.signatures.verify(credentialBody(root), root.proof, grantKey))) return deny('issuer-signature');

  return { ok: true };
}

/** The DTG rung a trust credential's `type` can confer. */
function trustRung(tc: TrustCredential): string | undefined {
  const t = tc.type;
  if (t.includes('VerifiableWitnessCredential')) return 'witnessed';
  if (t.includes('VerifiableEndorsementCredential')) return 'endorsed';
  if (t.includes('DTGMembershipCredential')) return 'issuer-pinned';
  return undefined;
}

/**
 * Derive the assurance level from what the verifier can independently prove — never from the issuer's asserted
 * `assuranceLevel` (TR-1). Base is `controller-vouched` (the root's VRC verified during the chain walk). The trust
 * policy raises it: a pinned root issuer → `issuer-pinned` (TR-2); each presented trust credential that is about the
 * root issuer, signed by a **trusted anchor**, verifies point-in-time, and is not revoked → its rung (TR-3). Any
 * credential that fails those tests is ignored — fail safe to lower, never deny (TR-4). Returns the highest rung.
 * @implements TR-1, TR-2, TR-3, TR-4, AC-10
 */
async function deriveAssurance(rootIssuer: string, p: Presentation, deps: VerifyDeps, now: string): Promise<string> {
  let best = LADDER.indexOf('controller-vouched');
  const raise = (rung: string): void => { const i = LADDER.indexOf(rung); if (i > best) best = i; };
  const policy = deps.trust;
  if (!policy) return LADDER[best]!;

  if (policy.pinnedIssuers?.includes(rootIssuer)) raise('issuer-pinned');

  for (const tc of p.trust ?? []) {
    const rung = trustRung(tc);
    if (!rung) continue;
    if (tc.credentialSubject.id !== rootIssuer) continue;      // must be about the root controller
    if (!policy.anchors.includes(tc.issuer)) continue;          // signed by an anchor the verifier trusts
    const status = await deps.resolver.resolve(tc.id);          // not revoked (fail safe: unresolvable ⇒ skip)
    if (!status || status.deactivated) continue;
    const key = await signerKeyAt(deps, tc.proof, tc.issuer);   // anchor's key state at signing time
    if (!key || !(await deps.signatures.verify(credentialBody(tc), tc.proof, key))) continue;
    raise(rung);
  }
  return LADDER[best]!;
}

/**
 * Verify a present-and-verify over a complete ordered delegation chain. Returns `{ ok: true, assuranceLevel }` or a
 * denial whose `reason` is a check-class label only (never the subject or full scope) — minimal disclosure.
 *
 * @implements AC-1, AC-2, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, DC-1, DC-2, DC-3, DC-4, DC-5, TR-1, TR-5
 */
export async function verifyPresentation(p: Presentation, req: VerifyRequest, deps: VerifyDeps): Promise<VerifyResult> {
  const now = req.now ?? new Date().toISOString();

  const chain = p.credentials;
  if (chain.length < 1) return deny('presentation-shape');
  const root = chain[0];
  const leaf = chain[chain.length - 1];
  if (!root || !leaf) return deny('presentation-shape');

  // Bind the presentation to THIS challenge + verifier.
  if (p.challenge !== req.nonce || p.audience !== req.audience) return deny('challenge-binding');

  // Leaf holder binding — the presenter controls the LEAF agent DID's key, proven against the challenge. Not bearer.
  if (p.holder !== leaf.credentialSubject.id) return deny('holder-mismatch');
  const agent = await deps.resolver.resolve(p.holder); // liveness at *now* (revocation is current)
  if (!agent || agent.deactivated || agent.kind !== 'agent') return deny('holder-unresolvable'); // fail-closed
  const holderKey = await signerKeyAt(deps, p.proof, p.holder); // key state at signing time
  if (!holderKey || !(await deps.signatures.verify(holderSignedData(p), p.proof, holderKey))) return deny('holder-binding');

  // Invocation binding — if this is an invocation, the act it COMMITTED to (signed) must be the one requested. The
  // holder signature above already covered the action/resource; this ensures the committed act == the request. [INV-2]
  const inv = p as Partial<Invocation>;
  if (inv.action !== undefined && (inv.action !== req.action || inv.resource !== req.resource)) return deny('invocation-binding');

  // Root anchoring — parent must be null, and control established by the referenced DTG VRC.
  if ((root.credentialSubject.authorization.parent ?? null) !== null) return deny('root-anchoring');
  const anchored = await verifyRoot(root, deps);
  if (!anchored.ok) return anchored;

  // Walk the chain root → leaf. Every hop: status (current, fail-closed) + validity. Non-root hops additionally:
  // signature (at signing version), linkage to the parent, and monotonic attenuation.
  //
  // Note: there is NO hard "delegability" gate. Blocking delegation is an anti-pattern (Karp, "Blocking Delegation
  // is an Anti-pattern") — it doesn't stop authority flowing onward, it only forces the *unaccountable* path
  // (credential-sharing / proxying) instead of an accountable, attenuated grant. Authority is bounded by monotonic
  // attenuation (a hop can never exceed its parent), the capability's constraints, and per-hop revocation; a
  // parent's `authorization.delegable` is advisory policy surfaced for audit, never a verification gate. [DC-4]
  for (let i = 0; i < chain.length; i++) {
    const hop = chain[i];
    if (!hop) return deny('presentation-shape');

    // Revocation — resolve the hop by DID; a `delete` (deactivated) or an unresolvable hop denies. [DC-5 current]
    const status = await deps.resolver.resolve(hop.id);
    if (!status || status.deactivated) return deny('revoked');
    // Validity window.
    if (now < hop.validFrom || now > hop.validUntil) return deny('validity');

    if (i > 0) {
      const parent = chain[i - 1];
      if (!parent) return deny('presentation-shape');
      // Signature — the delegator (this hop's issuer) signed it, verified at its signing version. [DC-5]
      const key = await signerKeyAt(deps, hop.proof, hop.issuer);
      if (!key || !(await deps.signatures.verify(credentialBody(hop), hop.proof, key))) return deny('hop-signature');
      // Linkage — the delegator IS the parent's subject, and the hop references the parent. [DC-4, DC-2]
      if (hop.issuer !== parent.credentialSubject.id) return deny('chain-linkage');
      if ((hop.credentialSubject.authorization.parent ?? null) !== parent.id) return deny('chain-linkage');
      // Attenuation — this hop only narrows its parent. [AC-8]
      if (!attenuates(hop.credentialSubject.authorization, parent.credentialSubject.authorization)) return deny('attenuation');
    }
  }

  // Authorization at the LEAF — the SPECIFIC requested action/resource is in scope, and constraints hold.
  const cap = leaf.credentialSubject.authorization;
  if (!cap.actions.includes(req.action) || !cap.resources.includes(req.resource)) return deny('authorization');
  const aud = cap.constraints?.audience;
  if (aud && !aud.includes(req.audience)) return deny('audience'); // prevents redirect to a non-audience verifier
  if (cap.constraints?.notAfter && now > cap.constraints.notAfter) return deny('constraint-expired');

  // Trust level — DERIVED from what the verifier can prove, never taken from the issuer's asserted `assuranceLevel`
  // (TR-1). A verified chain (root anchored to a VRC) yields at least controller-vouched; the trust-registry layer
  // raises it from evidence the verifier trusts.
  let level = await deriveAssurance(root.issuer, p, deps, now);

  // Human step-up — for an action the verifier designates high-consequence, require a fresh proof-of-human co-sign
  // by the accountable principal (the root's controller), bound to THIS exact request. [AC-11]
  if (req.requireHumanCoSign) {
    const cs = p.coSign;
    if (!cs) return deny('co-sign-required');
    if (cs.challenge !== req.nonce || cs.audience !== req.audience || cs.action !== req.action || cs.resource !== req.resource) return deny('co-sign-binding');
    if (cs.authorizer !== root.issuer) return deny('co-sign-authorizer'); // only the accountable principal may co-sign
    const key = await signerKeyAt(deps, cs.proof, cs.authorizer);
    if (!key || !(await deps.signatures.verify(coSignBody(cs), cs.proof, key))) return deny('co-sign-invalid');
    level = 'human-co-signed';
  }

  if (req.requiredAssurance && !meetsAssurance(level, req.requiredAssurance)) return deny('assurance');

  return { ok: true, assuranceLevel: level };
}

/**
 * Verify an **invocation** — the agent's committed act of exercising a capability. Identical to
 * `verifyPresentation` (chain, holder binding, attenuation, revocation, assurance, optional co-sign) plus: the
 * holder proof is bound over the specific `{action, resource}`, and that committed act must equal the request. A
 * replay is refused by the same challenge/audience binding (no new server state — INV-3).
 *
 * @implements INV-1, INV-2, INV-3, INV-5
 */
export async function verifyInvocation(inv: Invocation, req: VerifyRequest, deps: VerifyDeps): Promise<VerifyResult> {
  return verifyPresentation(inv, req, deps);
}

/**
 * Verify an **invocation record** offline and return the attribution it establishes — the acting agent (leaf) and
 * the accountable principal (root controller), from signatures + resolution alone (INV-4, R11). The reconstructed
 * request comes from the invocation itself; a carried co-sign is checked. If a receipt is present, it must reference
 * this exact invocation, agree on the act, and carry a valid signature by the named resource server.
 *
 * @implements INV-4
 */
export async function verifyRecord(record: InvocationRecord, deps: VerifyDeps): Promise<RecordResult> {
  const inv = record.invocation;
  const req: VerifyRequest = {
    nonce: inv.challenge, audience: inv.audience, action: inv.action, resource: inv.resource,
    requireHumanCoSign: inv.coSign !== undefined,
  };
  const res = await verifyInvocation(inv, req, deps);
  if (!res.ok) return { ok: false, reason: res.reason };

  const actor = inv.holder;
  const accountablePrincipal = inv.credentials[0]?.issuer;

  const r = record.receipt;
  if (r) {
    if (r.invocation !== inv.proof.proofValue) return { ok: false, reason: 'receipt-mismatch' };
    if (r.action !== inv.action || r.resource !== inv.resource || r.audience !== inv.audience) return { ok: false, reason: 'receipt-mismatch' };
    const key = await signerKeyAt(deps, r.proof, r.server);
    if (!key || !(await deps.signatures.verify(receiptBody(r), r.proof, key))) return { ok: false, reason: 'receipt-signature' };
  }
  return { ok: true, assuranceLevel: res.assuranceLevel, actor, accountablePrincipal };
}

/** The object a resource server signs for a receipt — the receipt without its proof. */
function receiptBody(r: Receipt): unknown {
  const { proof: _proof, ...rest } = r;
  return rest;
}
