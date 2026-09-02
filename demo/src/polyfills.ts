/**
 * Browser polyfills for the Node globals `@didcid/cipher` (and transitively bip39/hdkey/multiformats) reach for.
 * Sigil's own library needs none of this — it is browser-portable — but the injected cipher does. This module has
 * side effects only and MUST be imported before anything that pulls in the cipher (see app.ts).
 */
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: unknown; global?: unknown };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
