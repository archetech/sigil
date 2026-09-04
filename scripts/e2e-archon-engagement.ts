/**
 * Live e2e modelling the "Morningstar" scenario: I (an agent of the principal) delegate a piece of work to
 * Morningstar (a counterparty agent that does not know Sigil's tools). Morningstar must validate the request came
 * from the principal, aided by a **relationship** the principal and Morningstar already have; the principal
 * **authorizes** the high-consequence step with a proof-of-human co-sign; and the completed work is anchored as a
 * **bi-directional commitment record** both sides — and any auditor — can verify offline.
 *
 * Everything anchors under identities self-custodied here (a real exchange would use Morningstar's own DID and
 * David's signing). Configured by environment; no hostname or secret committed.
 *
 * Run:  SIGIL_GATEKEEPER_URL=<url> node --experimental-strip-types scripts/e2e-archon-engagement.ts
 */
import { GatekeeperClient } from '@didcid/clients';
import Cipher from '@didcid/cipher';
import { createArchonIssuer, createArchonResolver, createArchonSignatureVerifier, verifyInvocation, verifyAnchoredRecord } from '../src/index.ts';
import type { Signer, TrustPolicy } from '../src/index.ts';

const GATEKEEPER_URL = process.env.SIGIL_GATEKEEPER_URL ?? 'https://archon.technology';
const REGISTRY = process.env.SIGIL_E2E_REGISTRY ?? 'hyperswarm';

let failures = 0;
const ok = (label: string, cond: boolean, detail = ''): void => { console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!cond) failures++; };

async function main(): Promise<void> {
  console.log(`\nSigil live engagement e2e (Morningstar scenario)\n  gatekeeper: ${GATEKEEPER_URL}\n  registry  : ${REGISTRY}\n`);
  const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL, apiKey: process.env.SIGIL_GATEKEEPER_API_KEY });
  const cipher = new Cipher();
  const issuer = createArchonIssuer(gatekeeper, cipher, { registry: REGISTRY });
  const deps = { resolver: createArchonResolver(gatekeeper), signatures: createArchonSignatureVerifier(cipher) };

  const teardown: Array<{ did: string; by: Signer }> = [];
  const agents: Signer[] = [];
  try {
    // The cast: the principal (flaxscrip), my agent, and Morningstar (the counterparty who does the work).
    const principal = await issuer.mintAgent();
    const me = await issuer.mintAgent();
    const morningstar = await issuer.mintAgent();
    agents.push(principal, me, morningstar);
    console.log('cast: principal, me (delegatee of principal), Morningstar (counterparty)');

    // Morningstar and the principal already have a relationship — Morningstar issued an endorsement about the
    // principal (its own trust anchor). This is how Morningstar will trust a request rooted in the principal.
    const rel = await issuer.mintEndorsement(morningstar, principal.did, 'endorsement'); teardown.push({ did: rel.did, by: morningstar });
    ok('Morningstar holds a relationship (endorsement) about the principal', rel.did.startsWith('did:'));

    // The principal grants ME a delegable capability; I delegate the work to Morningstar (audience = Morningstar).
    const V = morningstar.did;
    const vrc = await issuer.mintRelationship(principal, me.did); teardown.push({ did: vrc.did, by: principal });
    const root = await issuer.mintAuthorization(principal, me.did, vrc.did, { actions: ['deploy'], resources: ['svc:api'], constraints: { audience: [V] }, delegable: true }, { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', assuranceLevel: 'controller-vouched' }); teardown.push({ did: root.did, by: principal });
    const d1 = await issuer.mintDelegation(me, root.credential, morningstar.did, { actions: ['deploy'], resources: ['svc:api'], constraints: { audience: [V] } }); teardown.push({ did: d1.did, by: me });
    const chain = [root.credential, d1.credential];
    ok('principal → me → Morningstar delegation chain minted', chain.length === 2);

    // Morningstar invokes the work. It validates trust from the request alone: the chain roots in the principal,
    // and Morningstar TRUSTS the principal because of its own relationship endorsement → assurance rises.
    const trust: TrustPolicy = { anchors: [morningstar.did] }; // Morningstar trusts its own endorsements
    const nonce = crypto.randomUUID();
    // The principal AUTHORIZES the act with a proof-of-human co-sign (the "authorize a proof" step).
    const coSign = issuer.coSign(principal, { challenge: nonce, audience: V, action: 'deploy', resource: 'svc:api' });
    const inv = issuer.invoke(morningstar, { challenge: nonce, audience: V, action: 'deploy', resource: 'svc:api', credentials: chain, trust: [rel.credential], coSign });
    const result = await verifyInvocation(inv, { nonce, audience: V, action: 'deploy', resource: 'svc:api', requireHumanCoSign: true }, { ...deps, trust });
    ok('Morningstar accepts the invocation', result.ok === true, JSON.stringify(result));
    ok('the request is proven to come from the principal (relationship raises trust)', result.assuranceLevel === 'human-co-signed', result.assuranceLevel);

    // Morningstar receipts + anchors the completed work as a bi-directional commitment record.
    const receipt = issuer.mintReceipt(morningstar, inv, 'accepted', { assuranceLevel: result.assuranceLevel });
    const rec = await issuer.anchorRecord(morningstar, { invocation: inv, receipt }); teardown.push({ did: rec.did, by: morningstar });

    // Any auditor verifies the anchored record offline — both commitments + the attribution.
    const audit = await verifyAnchoredRecord(rec.did, deps);
    ok('an auditor verifies the anchored record', audit.ok === true, JSON.stringify(audit));
    ok('  attributes the act to Morningstar', audit.actor === morningstar.did);
    ok('  under the accountable principal', audit.accountablePrincipal === principal.did);
    ok('  durably committed by Morningstar', audit.anchoredBy === morningstar.did);
  } finally {
    console.log('\ncleanup:');
    for (const t of teardown.reverse()) ok(`revoked ${t.did.slice(0, 20)}…`, await issuer.revoke(t.did, t.by).catch(() => false) === true);
    for (const a of agents.reverse()) ok(`revoked ${a.did.slice(0, 20)}…`, await issuer.revoke(a.did, a).catch(() => false) === true);
  }
  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((err) => { console.error('\ne2e error:', err instanceof Error ? err.message : err); process.exit(1); });
