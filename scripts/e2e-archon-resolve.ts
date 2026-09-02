/**
 * Live e2e: exercise `createArchonResolver` against a real Archon node — the one seam that genuinely needs
 * a live gatekeeper (resolution = operation-log replay). It validates, against a running node, the substrate
 * behaviour the unit tests assert with fakes: an agent DID maps to its keys, a `versionTime` resolves
 * point-in-time, a non-existent DID fails closed. Signature verification is proven against real crypto in
 * `test/archon.test.ts`; a full present-and-verify round-trip additionally needs the mint (issuer) seam.
 *
 * Everything is configured by environment so no hostname or secret is baked into the repo:
 *
 *   SIGIL_GATEKEEPER_URL       gatekeeper / drawbridge base URL   (default: https://archon.technology)
 *   SIGIL_GATEKEEPER_API_KEY   optional admin key for the above
 *   SIGIL_KEYMASTER_URL        optional — if set, provision an ephemeral agent DID to resolve, then remove it
 *   SIGIL_KEYMASTER_API_KEY    optional admin key for the keymaster
 *   SIGIL_E2E_REGISTRY         optional registry for the ephemeral DID (a local node's "local" resolves fastest)
 *   argv / SIGIL_E2E_DIDS      optional extra DIDs (comma-separated) to resolve and map
 *
 * Run:  SIGIL_GATEKEEPER_URL=<url> [SIGIL_KEYMASTER_URL=<url>] node --experimental-strip-types scripts/e2e-archon-resolve.ts
 */
import { GatekeeperClient, KeymasterClient } from '@didcid/clients';
import { createArchonResolver } from '../src/index.ts';

const GATEKEEPER_URL = process.env.SIGIL_GATEKEEPER_URL ?? 'https://archon.technology';
const KEYMASTER_URL = process.env.SIGIL_KEYMASTER_URL;
const REGISTRY = process.env.SIGIL_E2E_REGISTRY;
const EXTRA_DIDS = [
  ...process.argv.slice(2),
  ...(process.env.SIGIL_E2E_DIDS?.split(',') ?? []),
].map((s) => s.trim()).filter(Boolean);

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A syntactically valid did:cid that (almost certainly) does not exist — for the fail-closed check. */
const NONEXISTENT_DID = 'did:cid:z3v8Aexamplenonexistentsigile2eplaceholderdidvalue00';

async function main(): Promise<void> {
  console.log(`\nSigil live resolver e2e`);
  console.log(`  gatekeeper: ${GATEKEEPER_URL}`);
  console.log(`  keymaster : ${KEYMASTER_URL ?? '(none — provisioning step skipped)'}\n`);

  const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL, apiKey: process.env.SIGIL_GATEKEEPER_API_KEY });
  const resolver = createArchonResolver(gatekeeper);

  // 1 — fail-closed: a non-existent DID must resolve to undefined (the verifier reads this as deny).
  console.log('fail-closed:');
  const missing = await resolver.resolve(NONEXISTENT_DID);
  ok('a non-existent DID resolves to undefined', missing === undefined);

  // 2 — provision → resolve → point-in-time → cleanup (only if a keymaster is configured).
  if (KEYMASTER_URL) {
    console.log('\nephemeral agent DID (provision → resolve via gatekeeper → cleanup):');
    const keymaster = await KeymasterClient.create({ url: KEYMASTER_URL, apiKey: process.env.SIGIL_KEYMASTER_API_KEY });
    const name = `sigil-e2e-${Date.now()}`;
    let did: string | undefined;
    try {
      did = await keymaster.createId(name, REGISTRY ? { registry: REGISTRY } : undefined);
      ok('created ephemeral agent DID', typeof did === 'string' && did.startsWith('did:'), did);

      // The gatekeeper may take a moment to see a freshly created op — retry a few times.
      let resolved = await resolver.resolve(did);
      for (let i = 0; i < 10 && !resolved; i++) { await sleep(1000); resolved = await resolver.resolve(did); }

      ok('resolves through the gatekeeper (operation-log replay)', resolved !== undefined);
      ok('maps to kind = agent', resolved?.kind === 'agent', resolved?.kind);
      ok('carries at least one verification key', (resolved?.keys && Object.keys(resolved.keys).length > 0) === true,
        resolved?.keys ? `${Object.keys(resolved.keys).length} key(s)` : 'none');
      ok('is not deactivated', resolved?.deactivated === false);

      // Point-in-time: resolving "as of now" still returns the agent.
      const pinned = await resolver.resolve(did, { versionTime: new Date().toISOString() });
      ok('point-in-time resolution (versionTime) returns the agent', pinned?.kind === 'agent');
    } finally {
      if (did) {
        const removed = await keymaster.removeId(name).catch(() => false);
        ok('cleaned up ephemeral DID', removed === true);
      }
    }
  }

  // 3 — resolve any caller-supplied DIDs and print how each maps.
  if (EXTRA_DIDS.length) {
    console.log('\nsupplied DIDs:');
    for (const d of EXTRA_DIDS) {
      const r = await resolver.resolve(d);
      const shape = r ? `${r.kind}${r.deactivated ? ' (deactivated)' : ''}${r.keys ? `, ${Object.keys(r.keys).length} key(s)` : ''}${r.data ? ', has data' : ''}` : 'unresolvable';
      ok(`resolved ${d}`, r !== undefined, shape);
    }
  }

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\ne2e error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
