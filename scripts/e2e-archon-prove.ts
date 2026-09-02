/**
 * Live e2e: the WHOLE anchor against a real Archon node. It self-custodies keys (`@didcid/cipher`), mints a
 * controller + agent + VRC + AAC straight onto the gatekeeper (no keymaster/wallet), presents, and runs the real
 * `verifyPresentation` over the live resolver + signature adapters — then a negative (out-of-scope) and a
 * revocation (`delete`) check — and finally tears every DID down.
 *
 * Configured entirely by environment, so no hostname or secret is committed:
 *
 *   SIGIL_GATEKEEPER_URL       gatekeeper / drawbridge base URL   (default: https://archon.technology)
 *   SIGIL_GATEKEEPER_API_KEY   optional admin key
 *   SIGIL_E2E_REGISTRY         registry to anchor the ephemeral DIDs on   (default: hyperswarm)
 *
 * Run:  SIGIL_GATEKEEPER_URL=<url> node --experimental-strip-types scripts/e2e-archon-prove.ts
 */
import { GatekeeperClient } from '@didcid/clients';
import Cipher from '@didcid/cipher';
import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Signer } from '../src/index.ts';

const GATEKEEPER_URL = process.env.SIGIL_GATEKEEPER_URL ?? 'https://archon.technology';
const REGISTRY = process.env.SIGIL_E2E_REGISTRY ?? 'hyperswarm';
const AUDIENCE = 'did:web:vendor.example';

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

async function main(): Promise<void> {
  console.log(`\nSigil live prove e2e`);
  console.log(`  gatekeeper: ${GATEKEEPER_URL}`);
  console.log(`  registry  : ${REGISTRY}\n`);

  const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL, apiKey: process.env.SIGIL_GATEKEEPER_API_KEY });
  const cipher = new Cipher();
  const issuer = createArchonIssuer(gatekeeper, cipher, { registry: REGISTRY });
  const deps = { resolver: createArchonResolver(gatekeeper), signatures: createArchonSignatureVerifier(cipher) };

  const minted: Array<{ did: string; by: Signer }> = [];
  let controller: Signer | undefined, agent: Signer | undefined;
  try {
    console.log('mint (self-custodied, straight to the gatekeeper):');
    controller = await issuer.mintAgent();
    agent = await issuer.mintAgent();
    ok('minted controller + agent DIDs', controller.did.startsWith('did:') && agent.did.startsWith('did:'), `${controller.did.slice(0, 22)}… / ${agent.did.slice(0, 22)}…`);

    const rel = await issuer.mintRelationship(controller, agent.did);
    minted.push({ did: rel.did, by: controller });
    ok('minted VRC (control edge)', rel.did.startsWith('did:'), rel.did.slice(0, 22) + '…');

    const auth = await issuer.mintAuthorization(controller, agent.did, rel.did,
      { actions: ['invoke:catalog.search'], resources: ['res:catalog'], constraints: { audience: [AUDIENCE] } },
      { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', assuranceLevel: 'controller-vouched' });
    minted.push({ did: auth.did, by: controller });
    ok('minted AAC (scoped authorization)', auth.did.startsWith('did:'), auth.did.slice(0, 22) + '…');

    const pres = issuer.present(agent, { challenge: 'nonce-live', audience: AUDIENCE, credentials: [auth.credential] });
    const req = { nonce: 'nonce-live', audience: AUDIENCE, action: 'invoke:catalog.search', resource: 'res:catalog' };

    console.log('\nverify (the whole anchor, live):');
    const result = await verifyPresentation(pres, req, deps);
    ok('valid presentation verifies', result.ok === true, JSON.stringify(result));
    ok('assurance level is controller-vouched', result.assuranceLevel === 'controller-vouched');

    const denied = await verifyPresentation(pres, { ...req, action: 'invoke:catalog.delete' }, deps);
    ok('out-of-scope action is denied', denied.reason === 'authorization', denied.reason);

    console.log('\nrevoke (a `delete`, fail-closed):');
    ok('revoked the AAC', await issuer.revoke(auth.did, controller) === true);
    minted.pop(); // AAC revoked; don't re-delete in cleanup
    const afterRevoke = await verifyPresentation(pres, req, deps);
    ok('the revoked AAC is now denied', afterRevoke.reason === 'revoked', afterRevoke.reason);
  } finally {
    console.log('\ncleanup:');
    for (const m of minted.reverse()) ok(`revoked ${m.did.slice(0, 22)}…`, await issuer.revoke(m.did, m.by).catch(() => false) === true);
    if (agent) ok('revoked agent DID', await issuer.revoke(agent.did, agent).catch(() => false) === true);
    if (controller) ok('revoked controller DID', await issuer.revoke(controller.did, controller).catch(() => false) === true);
  }

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\ne2e error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
