/**
 * Portable base64url ⇄ hex, with no Node `Buffer` — `btoa`/`atob` + `Uint8Array` are native in Node ≥ 16 and in
 * browsers alike, so the keyless verifier (and the issuer) run unchanged in either. Archon's `proofValue` is the
 * base64url of a compact-hex signature.
 */
function bytesToBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function hexToBase64url(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytesToBase64url(bytes);
}

export function base64urlToHex(b64: string): string {
  let hex = '';
  for (const b of base64urlToBytes(b64)) hex += b.toString(16).padStart(2, '0');
  return hex;
}
