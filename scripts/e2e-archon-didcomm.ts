/**
 * Live e2e: the whole present-and-verify exchange over real Archon **DIDComm** mailboxes. Two wire identities
 * (keymaster IDs with published DIDComm mailboxes) run request → challenge → presentation → result over the node's
 * inbox; the self-custodied authority chain (controller → α → β) rides inside the messages as payload and is
 * verified independently against the gatekeeper. Shows accept, a high-consequence deny, and a co-signed accept —
 * then tears everything down.
 *
 *   SIGIL_GATEKEEPER_URL   gatekeeper (mint + resolve)        default: https://archon.technology
 *   SIGIL_KEYMASTER_URL    keymaster (the DIDComm wallet)     REQUIRED — DIDComm needs a wallet
 *   SIGIL_KEYMASTER_API_KEY / SIGIL_GATEKEEPER_API_KEY / SIGIL_E2E_REGISTRY   optional (registry default hyperswarm)
 *
 * Run:  SIGIL_GATEKEEPER_URL=<gk> SIGIL_KEYMASTER_URL=<km> node --experimental-strip-types scripts/e2e-archon-didcomm.ts
 */
import { GatekeeperClient, KeymasterClient } from '@didcid/clients';
import Cipher from '@didcid/cipher';
import { createArchonIssuer, createArchonResolver, createArchonSignatureVerifier, createArchonTransport, createVerifier, createPresenter, requestAccess, pump, MSG } from '../src/index.ts';
import type { Signer, ChallengeBody, ResultBody } from '../src/index.ts';

const GATEKEEPER_URL = process.env.SIGIL_GATEKEEPER_URL ?? 'https://archon.technology';
const KEYMASTER_URL = process.env.SIGIL_KEYMASTER_URL;
const REGISTRY = process.env.SIGIL_E2E_REGISTRY ?? 'hyperswarm';

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => { console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!cond) failures++; };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`\nSigil live DIDComm e2e\n  gatekeeper: ${GATEKEEPER_URL}\n  keymaster : ${KEYMASTER_URL ?? '(none)'}\n`);
  if (!KEYMASTER_URL) { console.error('SIGIL_KEYMASTER_URL is required (DIDComm needs a wallet).'); process.exit(2); }

  const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL, apiKey: process.env.SIGIL_GATEKEEPER_API_KEY });
  const keymaster = await KeymasterClient.create({ url: KEYMASTER_URL, apiKey: process.env.SIGIL_KEYMASTER_API_KEY });
  const cipher = new Cipher();
  const issuer = createArchonIssuer(gatekeeper, cipher, { registry: REGISTRY });
  const deps = { resolver: createArchonResolver(gatekeeper), signatures: createArchonSignatureVerifier(cipher) };

  const stamp = Date.now();
  const vName = `sigil-e2e-verifier-${stamp}`, pName = `sigil-e2e-presenter-${stamp}`;
  const wireIds: string[] = [];
  const authority: Array<{ did: string; by: Signer }> = [];
  const agents: Signer[] = [];
  try {
    // Wire identities with published DIDComm mailboxes.
    const verifierDid = await keymaster.createId(vName, { registry: REGISTRY }); wireIds.push(vName);
    const presenterDid = await keymaster.createId(pName, { registry: REGISTRY }); wireIds.push(pName);
    await keymaster.publishDidComm(undefined, vName);
    await keymaster.publishDidComm(undefined, pName);
    ok('created + published two DIDComm wire identities', verifierDid.startsWith('did:') && presenterDid.startsWith('did:'));

    // Self-custodied authority chain, bound to the verifier's DID as audience.
    const controller = await issuer.mintAgent();
    const alpha = await issuer.mintAgent();
    const beta = await issuer.mintAgent();
    agents.push(controller, alpha, beta);
    const vrc = await issuer.mintRelationship(controller, alpha.did); authority.push({ did: vrc.did, by: controller });
    const cap = { actions: ['read', 'deploy', 'delete'], resources: ['svc:api'], constraints: { audience: [verifierDid] }, delegable: true };
    const root = await issuer.mintAuthorization(controller, alpha.did, vrc.did, cap, { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', assuranceLevel: 'controller-vouched' }); authority.push({ did: root.did, by: controller });
    const d1 = await issuer.mintDelegation(alpha, root.credential, beta.did, { actions: ['read', 'deploy', 'delete'], resources: ['svc:api'], constraints: { audience: [verifierDid] } }); authority.push({ did: d1.did, by: alpha });
    const chain = [root.credential, d1.credential];
    ok('minted authority chain (controller → α → β), audience-bound to the verifier', chain.length === 2);

    const vt = createArchonTransport(keymaster, { name: vName });
    const pt = createArchonTransport(keymaster, { name: pName });
    const highConsequence = (a: string) => a === 'delete' || a === 'admin';

    async function run(action: string, resource: string, coSign: boolean): Promise<ResultBody> {
      const verifier = createVerifier(deps, { audience: verifierDid, highConsequence }, () => crypto.randomUUID());
      const presenter = createPresenter(async (ch: ChallengeBody) => {
        let p = issuer.present(beta, { challenge: ch.nonce, audience: ch.audience, credentials: chain });
        if (ch.requireHumanCoSign && coSign) p = { ...p, coSign: issuer.coSign(controller, { challenge: ch.nonce, audience: ch.audience, action: ch.action, resource: ch.resource }) };
        return p;
      });
      await requestAccess(pt, verifierDid, { action, resource });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await pump(vt, (f, m) => verifier.handle(f, m));
        const got = await pump(pt, (f, m) => presenter.handle(f, m));
        const r = got.find((m) => m.type === MSG.result);
        if (r) return r.body as ResultBody;
        await sleep(1200);
      }
      return { ok: false, reason: 'timeout' };
    }

    console.log('\nexchange over DIDComm (request → challenge → presentation → result):');
    const deploy = await run('deploy', 'svc:api', false);
    ok('deploy svc:api → accepted', deploy.ok === true, JSON.stringify(deploy));
    const delNo = await run('delete', 'svc:api', false);
    ok('delete svc:api (high-consequence) → denied without co-sign', delNo.reason === 'co-sign-required', delNo.reason);
    const delYes = await run('delete', 'svc:api', true);
    ok('delete svc:api with principal co-sign → human-co-signed', delYes.ok === true && delYes.assuranceLevel === 'human-co-signed', JSON.stringify(delYes));
  } finally {
    console.log('\ncleanup:');
    for (const a of authority.reverse()) ok(`revoked ${a.did.slice(0, 20)}…`, await issuer.revoke(a.did, a.by).catch(() => false) === true);
    for (const a of agents.reverse()) ok(`revoked agent ${a.did.slice(0, 20)}…`, await issuer.revoke(a.did, a).catch(() => false) === true);
    for (const name of wireIds.reverse()) ok(`removed wire id ${name}`, await keymaster.removeId(name).catch(() => false) === true);
  }

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((err) => { console.error('\ne2e error:', err instanceof Error ? err.message : err); process.exit(1); });
