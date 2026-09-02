/** Sigil reference implementation — public surface. */
export { verifyPresentation } from './verify.ts';

// Live Archon adapters for the two seams (resolution + crypto). Inject these to run against a real node.
export { createArchonResolver } from './archon/resolver.ts';
export type { GatekeeperLike, GatekeeperDidDocument } from './archon/resolver.ts';
export { createArchonSignatureVerifier } from './archon/signatures.ts';
export type { ArchonCipher } from './archon/signatures.ts';

// Issuer / holder seam: self-custodied minting of the credentials the verifier consumes.
export { createArchonIssuer } from './archon/issuer.ts';
export type { ArchonIssuer, Signer, PrivateJwk, IssuerGatekeeper, IssuerCipher, IssuerOptions } from './archon/issuer.ts';

// The monotonic-attenuation rule (AC-8), shared by issuer and verifier.
export { attenuates } from './capability.ts';

// The A2A transport + protocol: present-and-verify as a message exchange over any transport (DIDComm in production).
export { inMemoryNetwork } from './transport.ts';
export type { Transport, TransportMessage } from './transport.ts';
export { MSG, createVerifier, createPresenter, requestAccess, pump } from './protocol.ts';
export type { VerifierPolicy, RequestBody, ChallengeBody, PresentationBody, ResultBody } from './protocol.ts';
export { createArchonTransport } from './archon/transport.ts';
export type { DidCommKeymaster } from './archon/transport.ts';

export type {
  Jwk,
  Proof,
  Capability,
  AAC,
  VRC,
  CoSign,
  Presentation,
  VerifyRequest,
  VerifyResult,
  Resolver,
  ResolvedDid,
  SignatureVerifier,
  VerifyDeps,
} from './types.ts';
