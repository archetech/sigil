/**
 * Live e2e: human step-up (AC-11) against a real Archon node. Mints a controller + agent + VRC + AAC (whose scope
 * includes a high-consequence `delete`), then shows that a high-consequence action is denied without a co-sign and
 * accepted — at assurance `human-co-signed` — with a fresh proof-of-human co-sign by the accountable principal.
 * Every DID is torn down.
 *
 *   SIGIL_GATEKEEPER_URL / SIGIL_GATEKEEPER_API_KEY / SIGIL_E2E_REGISTRY  (defaults: public node · hyperswarm)
 * Run:  SIGIL_GATEKEEPER_URL=<url> node --experimental-strip-types scripts/e2e-archon-stepup.ts
 */
import { GatekeeperClient } from '@didcid/clients';
import Cipher from '@didcid/cipher';
import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '../src/index.ts';
import type { Signer } from '../src/index.ts';

const GATEKEEPER_URL = process.env.SIGIL_GATEKEEPER_URL ?? 'https://archon.technology';
const REGISTRY = process.env.SIGIL_E2E_REGISTRY ?? 'hyperswarm';
const V = 'did:web:vendor.example';

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

async function main(): Promise<void> {
  console.log(`\nSigil live step-up e2e\n  gatekeeper: ${GATEKEEPER_URL}\n  registry  : ${REGISTRY}\n`);
  const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL, apiKey: process.env.SIGIL_GATEKEEPER_API_KEY });
  const cipher = new Cipher();
  const issuer = createArchonIssuer(gatekeeper, cipher, { registry: REGISTRY });
  const deps = { resolver: createArchonResolver(gatekeeper), signatures: createArchonSignatureVerifier(cipher) };

  const teardown: Array<{ did: string; by: Signer }> = [];
  const agents: Signer[] = [];
  try {
    const controller = await issuer.mintAgent();
    const agent = await issuer.mintAgent();
    agents.push(controller, agent);
    const vrc = await issuer.mintRelationship(controller, agent.did);
    teardown.push({ did: vrc.did, by: controller });
    const root = await issuer.mintAuthorization(controller, agent.did, vrc.did,
      { actions: ['read', 'delete'], resources: ['res:vault'], constraints: { audience: [V] } },
      { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', assuranceLevel: 'controller-vouched' });
    teardown.push({ did: root.did, by: controller });
    ok('minted controller + agent + VRC + AAC (scope includes delete)', root.did.startsWith('did:'));

    const nonce = 'nonce-live';
    const present = () => issuer.present(agent, { challenge: nonce, audience: V, credentials: [root.credential] });
    const highReq = { nonce, audience: V, action: 'delete', resource: 'res:vault', requireHumanCoSign: true };

    console.log('\nhigh-consequence action (delete), live:');
    const noCoSign = await verifyPresentation(present(), highReq, deps);
    ok('denied without a co-sign', noCoSign.reason === 'co-sign-required', noCoSign.reason);

    const coSign = issuer.coSign(controller, { challenge: nonce, audience: V, action: 'delete', resource: 'res:vault' });
    const withCoSign = await verifyPresentation({ ...present(), coSign }, highReq, deps);
    ok('accepted with the principal co-sign', withCoSign.ok === true, JSON.stringify(withCoSign));
    ok('assurance is human-co-signed', withCoSign.assuranceLevel === 'human-co-signed');

    const wrongSigner = issuer.coSign(agent, { challenge: nonce, audience: V, action: 'delete', resource: 'res:vault' });
    const bySelf = await verifyPresentation({ ...present(), coSign: wrongSigner }, highReq, deps);
    ok('a co-sign by the agent itself is denied', bySelf.reason === 'co-sign-authorizer', bySelf.reason);
  } finally {
    console.log('\ncleanup:');
    for (const t of teardown.reverse()) ok(`revoked ${t.did.slice(0, 22)}…`, await issuer.revoke(t.did, t.by).catch(() => false) === true);
    for (const a of agents.reverse()) ok(`revoked agent ${a.did.slice(0, 22)}…`, await issuer.revoke(a.did, a).catch(() => false) === true);
  }

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((err) => { console.error('\ne2e error:', err instanceof Error ? err.message : err); process.exit(1); });
