/**
 * The live crypto behind the `SignatureVerifier` seam, using `@didcid/cipher` — the same primitive the
 * substrate uses, so Sigil verifies exactly what Archon signed (no re-implementation of the suite).
 *
 * Archon's `EcdsaSecp256k1Signature2019`: the canonical bytes are `hashJSON(obj)` = SHA-256 of the JCS
 * (RFC 8785) canonicalization of the object *without* its proof, and the signature is an ECDSA secp256k1
 * signature over that hash. `proof.proofValue` is the base64url of the compact-hex signature; the verifying
 * key is the signer's `publicKeyJwk` (secp256k1), which the caller resolved point-in-time at `proof.created`.
 *
 * `signed` here is already the proof-less object (the anchor passes `credentialBody` / `holderSignedData`),
 * so `hashJSON(signed)` matches what the signer hashed.
 *
 * @implements R2, AC-3
 */
import type { Jwk, Proof, SignatureVerifier } from '../types.ts';

/** The two cipher calls this adapter needs. A `@didcid/cipher` instance (`new CipherNode()`) satisfies it. */
export interface ArchonCipher {
  /** JCS-canonicalize `obj` and return its SHA-256 as hex. */
  hashJSON(obj: unknown): string;
  /** Verify a compact-hex ECDSA secp256k1 signature over `msgHash` (hex) against a secp256k1 public JWK. */
  verifySig(msgHash: string, sigHex: string, publicJwk: Jwk): boolean;
}

export function createArchonSignatureVerifier(cipher: ArchonCipher): SignatureVerifier {
  return {
    async verify(signed: unknown, proof: Proof, key: Jwk): Promise<boolean> {
      try {
        const msgHash = cipher.hashJSON(signed);
        const sigHex = Buffer.from(proof.proofValue, 'base64url').toString('hex');
        return cipher.verifySig(msgHash, sigHex, key);
      } catch {
        return false; // malformed proof / key → fail-closed
      }
    },
  };
}
