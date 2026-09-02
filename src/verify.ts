/**
 * The Sigil anchor use-case: an agent proves identity, control, and scope to a verifier before it acts, with no
 * prior relationship. Single-hop (no delegation chain — that is a later slice).
 *
 * The Archon substrate (resolution = operation-log replay; revocation = a `delete`) is behind the `Resolver`
 * seam; the signature primitive is behind `SignatureVerifier`. The logic here is what Sigil owns; the crypto and
 * the substrate are injected.
 */
import type { AAC, VRC, Presentation, VerifyRequest, VerifyDeps, VerifyResult } from './types.ts';

const deny = (reason: string): VerifyResult => ({ ok: false, reason });

/** Assurance ladder, low → high (docs/agent-credential.md §5). */
const LADDER = ['identity', 'controller-vouched', 'issuer-pinned', 'endorsed', 'witnessed', 'human-co-signed'];
function meetsAssurance(actual: string, required: string): boolean {
  const a = LADDER.indexOf(actual);
  const r = LADDER.indexOf(required);
  return a >= 0 && r >= 0 && a >= r;
}

/** Bytes a holder signs to bind a presentation to the challenge + audience.
 *  NOTE: a production build MUST canonicalize (JCS) as the substrate does; JSON.stringify suffices for the seam. */
function holderSignedData(p: Presentation): string {
  return JSON.stringify({ holder: p.holder, challenge: p.challenge, audience: p.audience });
}
/** Bytes a credential's issuer signs — the credential without its proof. */
function credentialSignedData(c: AAC | VRC): string {
  const { proof: _proof, ...rest } = c;
  return JSON.stringify(rest);
}

/**
 * Establish control: verify the referenced DTG VRC and that the AAC issuer is a party to it.
 * @implements AC-3, AC-13
 */
async function verifyRelationship(aac: AAC, deps: VerifyDeps): Promise<VerifyResult> {
  const vrcRes = await deps.resolver.resolve(aac.credentialSubject.relationship);
  if (!vrcRes || vrcRes.kind !== 'asset' || !vrcRes.data) return deny('relationship-unresolvable'); // fail-closed
  if (vrcRes.deactivated) return deny('relationship-revoked'); // a `delete` on the VRC invalidates the AAC [AC-13]
  const vrc = vrcRes.data as VRC;

  if (vrc.credentialSubject.id !== aac.credentialSubject.id) return deny('relationship-agent-mismatch');
  // The AAC issuer must be a party to the relationship — at the anchor (root) it is the controller.
  if (aac.issuer !== vrc.issuer) return deny('issuer-not-party');

  const controller = await deps.resolver.resolve(vrc.issuer);
  if (!controller || controller.deactivated || !controller.keys) return deny('controller-unresolvable');
  const relKey = controller.keys[vrc.proof.verificationMethod];
  if (!relKey || !(await deps.signatures.verify(credentialSignedData(vrc), vrc.proof, relKey))) return deny('relationship-signature');
  // The capability grant itself is signed by the same controller.
  const grantKey = controller.keys[aac.proof.verificationMethod];
  if (!grantKey || !(await deps.signatures.verify(credentialSignedData(aac), aac.proof, grantKey))) return deny('issuer-signature');

  return { ok: true };
}

/**
 * Verify a single-hop present-and-verify. Returns `{ ok: true, assuranceLevel }` or a denial whose `reason` is a
 * check-class label only (never the subject or full scope) — minimal disclosure.
 *
 * @implements AC-1, AC-2, AC-5, AC-6, AC-7, AC-9, AC-12
 */
export async function verifyPresentation(p: Presentation, req: VerifyRequest, deps: VerifyDeps): Promise<VerifyResult> {
  const now = req.now ?? new Date().toISOString();

  // The anchor is single-hop: exactly one AAC.
  if (p.credentials.length !== 1) return deny('presentation-shape');
  const aac = p.credentials[0];
  if (!aac) return deny('presentation-shape');

  // Bind the presentation to THIS challenge + verifier.
  if (p.challenge !== req.nonce || p.audience !== req.audience) return deny('challenge-binding');

  // Holder binding — the presenter controls the agent DID's key, proven against the challenge. Not bearer.
  if (p.holder !== aac.credentialSubject.id) return deny('holder-mismatch');
  const agent = await deps.resolver.resolve(p.holder);
  if (!agent || agent.deactivated || !agent.keys) return deny('holder-unresolvable'); // fail-closed
  const holderKey = agent.keys[p.proof.verificationMethod];
  if (!holderKey || !(await deps.signatures.verify(holderSignedData(p), p.proof, holderKey))) return deny('holder-binding');

  // Control — established by the referenced DTG VRC.
  const rel = await verifyRelationship(aac, deps);
  if (!rel.ok) return rel;

  // Revocation — the AAC must not be deactivated (a `delete`), resolved by replay. Fail-closed.
  const aacRes = await deps.resolver.resolve(aac.id);
  if (!aacRes || aacRes.deactivated) return deny('revoked');

  // Validity window.
  if (now < aac.validFrom || now > aac.validUntil) return deny('validity');

  // Authorization — the SPECIFIC requested action/resource is in scope, and constraints hold, at the point of use.
  const cap = aac.credentialSubject.authorization;
  if (!cap.actions.includes(req.action) || !cap.resources.includes(req.resource)) return deny('authorization');
  const aud = cap.constraints?.audience;
  if (aud && !aud.includes(req.audience)) return deny('audience'); // prevents redirect to a non-audience verifier
  if (cap.constraints?.notAfter && now > cap.constraints.notAfter) return deny('constraint-expired');

  // Trust level — a verified VRC yields at least controller-vouched.
  const level = aac.credentialSubject.assuranceLevel ?? 'controller-vouched';
  if (req.requiredAssurance && !meetsAssurance(level, req.requiredAssurance)) return deny('assurance');

  return { ok: true, assuranceLevel: level };
}
