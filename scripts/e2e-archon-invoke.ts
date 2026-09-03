/**
 * Live e2e: the invocation verb against a real Archon node. Self-custodied keys mint a controller → α → β chain
 * (audience-bound to a resource server) and a resource server; β **invokes** the capability, the server verifies
 * the committed act and signs a **receipt**, and the resulting **record** is re-verified offline to attribute the
 * action to β and the accountable principal. Also shows an out-of-scope invoke denied and a high-consequence invoke
 * needing a co-sign. Every DID is torn down.
 *
 *   SIGIL_GATEKEEPER_URL / SIGIL_GATEKEEPER_API_KEY / SIGIL_E2E_REGISTRY  (defaults: public node · hyperswarm)
 * Run:  SIGIL_GATEKEEPER_URL=<url> node --experimental-strip-types scripts/e2e-archon-invoke.ts
 */
import { GatekeeperClient } from '@didcid/clients';
import Cipher from '@didcid/cipher';
import { createArchonIssuer, createArchonResolver, createArchonSignatureVerifier, verifyInvocation, verifyRecord } from '../src/index.ts';
import type { Signer } from '../src/index.ts';

const GATEKEEPER_URL = process.env.SIGIL_GATEKEEPER_URL ?? 'https://archon.technology';
const REGISTRY = process.env.SIGIL_E2E_REGISTRY ?? 'hyperswarm';

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => { console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!cond) failures++; };

async function main(): Promise<void> {
  console.log(`\nSigil live invocation e2e\n  gatekeeper: ${GATEKEEPER_URL}\n  registry  : ${REGISTRY}\n`);
  const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL, apiKey: process.env.SIGIL_GATEKEEPER_API_KEY });
  const cipher = new Cipher();
  const issuer = createArchonIssuer(gatekeeper, cipher, { registry: REGISTRY });
  const deps = { resolver: createArchonResolver(gatekeeper), signatures: createArchonSignatureVerifier(cipher) };
  const nonce = () => crypto.randomUUID();

  const authority: Array<{ did: string; by: Signer }> = [];
  const agents: Signer[] = [];
  try {
    const controller = await issuer.mintAgent();
    const alpha = await issuer.mintAgent();
    const beta = await issuer.mintAgent();
    const server = await issuer.mintAgent(); // the resource server (audience + receipt signer)
    agents.push(controller, alpha, beta, server);
    const V = server.did;
    const vrc = await issuer.mintRelationship(controller, alpha.did); authority.push({ did: vrc.did, by: controller });
    const cap = { actions: ['read', 'deploy', 'delete'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true };
    const root = await issuer.mintAuthorization(controller, alpha.did, vrc.did, cap, { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', assuranceLevel: 'controller-vouched' }); authority.push({ did: root.did, by: controller });
    const d1 = await issuer.mintDelegation(alpha, root.credential, beta.did, { actions: ['read', 'deploy', 'delete'], resources: ['svc:api'], constraints: { audience: [V] } }); authority.push({ did: d1.did, by: alpha });
    const chain = [root.credential, d1.credential];
    ok('minted chain (controller → α → β) + resource server', chain.length === 2);

    const highConsequence = (a: string) => a === 'delete';
    async function invokeFlow(action: string, coSign: boolean) {
      const n = nonce();
      const cs = highConsequence(action) && coSign ? issuer.coSign(controller, { challenge: n, audience: V, action, resource: 'svc:api' }) : undefined;
      const inv = issuer.invoke(beta, { challenge: n, audience: V, action, resource: 'svc:api', credentials: chain, ...(cs ? { coSign: cs } : {}) });
      const result = await verifyInvocation(inv, { nonce: n, audience: V, action, resource: 'svc:api', requireHumanCoSign: highConsequence(action) }, deps);
      return { inv, result, n };
    }

    console.log('\ninvoke over live resolution:');
    const deploy = await invokeFlow('deploy', false);
    ok('β invokes deploy → accepted', deploy.result.ok === true, JSON.stringify(deploy.result));

    // server signs a receipt; the record re-verifies and attributes the act.
    const receipt = issuer.mintReceipt(server, deploy.inv, 'accepted', { assuranceLevel: deploy.result.assuranceLevel });
    const rec = await verifyRecord({ invocation: deploy.inv, receipt }, deps);
    ok('the record re-verifies and attributes the act', rec.ok === true && rec.actor === beta.did && rec.accountablePrincipal === controller.did, `${rec.actor?.slice(0, 18)}… under ${rec.accountablePrincipal?.slice(0, 18)}…`);

    const admin = await invokeFlow('admin', false);
    ok('β invokes admin → denied (out of scope)', admin.result.reason === 'authorization', admin.result.reason);

    const delNo = await invokeFlow('delete', false);
    ok('β invokes delete (high-consequence) → denied without co-sign', delNo.result.reason === 'co-sign-required', delNo.result.reason);
    const delYes = await invokeFlow('delete', true);
    ok('β invokes delete with principal co-sign → human-co-signed', delYes.result.ok === true && delYes.result.assuranceLevel === 'human-co-signed', JSON.stringify(delYes.result));
  } finally {
    console.log('\ncleanup:');
    for (const t of authority.reverse()) ok(`revoked ${t.did.slice(0, 20)}…`, await issuer.revoke(t.did, t.by).catch(() => false) === true);
    for (const a of agents.reverse()) ok(`revoked agent ${a.did.slice(0, 20)}…`, await issuer.revoke(a.did, a).catch(() => false) === true);
  }
  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((err) => { console.error('\ne2e error:', err instanceof Error ? err.message : err); process.exit(1); });
