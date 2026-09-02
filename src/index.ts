/** Sigil reference implementation — public surface. */
export { verifyPresentation } from './verify.ts';

// Live Archon adapters for the two seams (resolution + crypto). Inject these to run against a real node.
export { createArchonResolver } from './archon/resolver.ts';
export type { GatekeeperLike, GatekeeperDidDocument } from './archon/resolver.ts';
export { createArchonSignatureVerifier } from './archon/signatures.ts';
export type { ArchonCipher } from './archon/signatures.ts';

export type {
  Jwk,
  Proof,
  Capability,
  AAC,
  VRC,
  Presentation,
  VerifyRequest,
  VerifyResult,
  Resolver,
  ResolvedDid,
  SignatureVerifier,
  VerifyDeps,
} from './types.ts';
