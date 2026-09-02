/**
 * Live e2e: a real multi-hop delegation chain against an Archon node. Self-custodied keys mint a controller and
 * three agents, a VRC, a root AAC, and two attenuating delegations straight onto the gatekeeper; the leaf agent
 * presents the whole chain and the real `verifyPresentation` walks it — plus negatives (narrowed-away scope, a
 * missing hop) and a mid-chain revocation — then every DID is torn down.
 *
 * Configured entirely by environment (no hostname or secret committed):
 *   SIGIL_GATEKEEPER_URL / SIGIL_GATEKEEPER_API_KEY / SIGIL_E2E_REGISTRY  (defaults: public node · hyperswarm)
 *
 * Run:  SIGIL_GATEKEEPER_URL=<url> node --experimental-strip-types scripts/e2e-archon-delegate.ts
 */
import { GatekeeperClient } from '@didcid/clients';
import Cipher from '@didcid/cipher';
import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Signer, Capability } from '../src/index.ts';

const GATEKEEPER_URL = process.env.SIGIL_GATEKEEPER_URL ?? 'https://archon.technology';
const REGISTRY = process.env.SIGIL_E2E_REGISTRY ?? 'hyperswarm';
const V = 'did:web:vendor.example';

const ROOT: Capability = { actions: ['read', 'write'], resources: ['res:a', 'res:b'], constraints: { audience: [V] }, delegable: true };
const MID: Capability = { actions: ['read'], resources: ['res:a', 'res:b'], constraints: { audience: [V] }, delegable: true };
const LEAF: Capability = { actions: ['read'], resources: ['res:a'], constraints: { audience: [V] } };

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

async function main(): Promise<void> {
  console.log(`\nSigil live delegation e2e`);
  console.log(`  gatekeeper: ${GATEKEEPER_URL}`);
  console.log(`  registry  : ${REGISTRY}\n`);

  const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL, apiKey: process.env.SIGIL_GATEKEEPER_API_KEY });
  const cipher = new Cipher();
  const issuer = createArchonIssuer(gatekeeper, cipher, { registry: REGISTRY });
  const deps = { resolver: createArchonResolver(gatekeeper), signatures: createArchonSignatureVerifier(cipher) };

  const teardown: Array<{ did: string; by: Signer }> = [];
  const agents: Signer[] = [];
  try {
    console.log('mint the chain (controller → a0 → a1 → a2, each self-custodied):');
    const controller = await issuer.mintAgent();
    const a0 = await issuer.mintAgent();
    const a1 = await issuer.mintAgent();
    const a2 = await issuer.mintAgent();
    agents.push(controller, a0, a1, a2);
    ok('minted controller + 3 agents', [controller, a0, a1, a2].every((s) => s.did.startsWith('did:')));

    const vrc = await issuer.mintRelationship(controller, a0.did);
    teardown.push({ did: vrc.did, by: controller });
    const root = await issuer.mintAuthorization(controller, a0.did, vrc.did, ROOT, { assuranceLevel: 'controller-vouched' });
    teardown.push({ did: root.did, by: controller });
    const d1 = await issuer.mintDelegation(a0, root.credential, a1.did, MID);
    teardown.push({ did: d1.did, by: a0 });
    const d2 = await issuer.mintDelegation(a1, d1.credential, a2.did, LEAF);
    teardown.push({ did: d2.did, by: a1 });
    ok('minted VRC + root AAC + 2 attenuating delegations', [vrc, root, d1, d2].every((x) => x.did.startsWith('did:')));

    const chain = [root.credential, d1.credential, d2.credential];
    const pres = issuer.present(a2, { challenge: 'nonce-live', audience: V, credentials: chain });
    const req = { nonce: 'nonce-live', audience: V, action: 'read', resource: 'res:a' };

    console.log('\nverify the chain (live, root → leaf):');
    const result = await verifyPresentation(pres, req, deps);
    ok('the 3-hop chain verifies', result.ok === true, JSON.stringify(result));

    const narrowed = await verifyPresentation(pres, { ...req, action: 'write' }, deps);
    ok('authority narrowed away up-chain is denied at the leaf', narrowed.reason === 'authorization', narrowed.reason);

    const gap = issuer.present(a2, { challenge: 'nonce-live', audience: V, credentials: [root.credential, d2.credential] });
    ok('a missing hop is denied', (await verifyPresentation(gap, req, deps)).reason === 'chain-linkage');

    console.log('\nrevoke a mid-chain hop (fail-closed):');
    ok('revoked the middle delegation', await issuer.revoke(d1.did, a0) === true);
    teardown.splice(teardown.findIndex((t) => t.did === d1.did), 1); // already revoked
    ok('the whole chain is now denied', (await verifyPresentation(pres, req, deps)).reason === 'revoked');
  } finally {
    console.log('\ncleanup:');
    for (const t of teardown.reverse()) ok(`revoked ${t.did.slice(0, 22)}…`, await issuer.revoke(t.did, t.by).catch(() => false) === true);
    for (const a of agents.reverse()) ok(`revoked agent ${a.did.slice(0, 22)}…`, await issuer.revoke(a.did, a).catch(() => false) === true);
  }

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\ne2e error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
