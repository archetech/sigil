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
import type { AAC, VRC, Jwk, Proof, CoSign, Presentation, VerifyRequest, VerifyDeps, VerifyResult } from './types.ts';
import { attenuates } from './capability.ts';

const deny = (reason: string): VerifyResult => ({ ok: false, reason });

/** Assurance ladder, low → high (docs/agent-credential.md §5). */
const LADDER = ['identity', 'controller-vouched', 'issuer-pinned', 'endorsed', 'witnessed', 'human-co-signed'];
function meetsAssurance(actual: string, required: string): boolean {
  const a = LADDER.indexOf(actual);
  const r = LADDER.indexOf(required);
  return a >= 0 && r >= 0 && a >= r;
}

/** The object a holder signs to bind a presentation to the challenge + audience. The `SignatureVerifier`
 *  canonicalizes it (JCS) as the substrate does — this returns the object, not pre-serialized bytes. */
function holderSignedData(p: Presentation): unknown {
  return { holder: p.holder, challenge: p.challenge, audience: p.audience };
}
/** The object a credential's issuer signs — the credential without its `proof`. */
function credentialBody(c: AAC | VRC): unknown {
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

/**
 * Verify a present-and-verify over a complete ordered delegation chain. Returns `{ ok: true, assuranceLevel }` or a
 * denial whose `reason` is a check-class label only (never the subject or full scope) — minimal disclosure.
 *
 * @implements AC-1, AC-2, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, DC-1, DC-2, DC-3, DC-4, DC-5
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

  // Root anchoring — parent must be null, and control established by the referenced DTG VRC.
  if ((root.credentialSubject.authorization.parent ?? null) !== null) return deny('root-anchoring');
  const anchored = await verifyRoot(root, deps);
  if (!anchored.ok) return anchored;

  // Walk the chain root → leaf. Every hop: status (current, fail-closed) + validity. Non-root hops additionally:
  // signature (at signing version), linkage to the parent, delegability of the parent, and monotonic attenuation.
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
      // Delegability — the parent permitted delegation. [DC-4]
      if (parent.credentialSubject.authorization.delegable !== true) return deny('not-delegable');
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

  // Trust level — a verified chain yields at least controller-vouched; the leaf carries the effective level.
  let level = leaf.credentialSubject.assuranceLevel ?? 'controller-vouched';

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
