/**
 * Poly integration profile — the verifier adapter Poly's PD5/PD6 expect, over Sigil's verifier. The issuer mints a
 * real chain onto a fake op-recording gatekeeper (real @didcid/cipher crypto); the adapter is exercised per call, as
 * Poly's gate would. No Poly dependency: the claims record is plain data checked here against PD5/PD6's shape.
 *
 * @verifies PP-1, PP-2, PP-3, PP-4, PP-5
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Cipher from '@didcid/cipher';

import { createPolyVerifier, mandateOf, assuranceIndex, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier, ASSURANCE_LADDER } from '../src/index.ts';
import type { Capability, PolyMandate, PolyVerifiedClaims, VerifyRequest } from '../src/index.ts';
import { makeFakeGatekeeper } from './fake-gatekeeper.ts';

const cipher = new Cipher();
const V = 'did:web:vendor.example';
const NOW = '2026-11-03T12:00:00Z';

const ROOT: Capability = { actions: ['read', 'write'], resources: ['res:a', 'res:b'], constraints: { audience: [V], maxInvocations: 10 }, delegable: true };
const MID: Capability = { actions: ['read'], resources: ['res:a', 'res:b'], constraints: { audience: [V], maxInvocations: 5 }, delegable: true };
const LEAF: Capability = { actions: ['read'], resources: ['res:a'], constraints: { audience: [V], maxInvocations: 1, notAfter: '2026-12-01T00:00:00Z' } };

async function world() {
  const gk = makeFakeGatekeeper(cipher);
  const issuer = createArchonIssuer(gk, cipher, { registry: 'test' });
  const deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(cipher) };
  const controller = await issuer.mintAgent();
  const a0 = await issuer.mintAgent();
  const a1 = await issuer.mintAgent();
  const a2 = await issuer.mintAgent();
  const vrc = await issuer.mintRelationship(controller, a0.did);
  const root = await issuer.mintAuthorization(controller, a0.did, vrc.did, ROOT, { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z', assuranceLevel: 'witnessed' }); // asserted high — must be ignored
  const d1 = await issuer.mintDelegation(a0, root.credential, a1.did, MID, { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z' });
  const d2 = await issuer.mintDelegation(a1, d1.credential, a2.did, LEAF, { validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-01-01T00:00:00Z' });
  const chain = [root.credential, d1.credential, d2.credential];
  const pres = issuer.present(a2, { challenge: 'n', audience: V, credentials: chain });
  const req: VerifyRequest = { nonce: 'n', audience: V, action: 'read', resource: 'res:a', now: NOW };
  return { gk, issuer, deps, controller, a0, a1, a2, vrc, root, d1, d2, chain, pres, req };
}

const subset = (c: readonly string[], p: readonly string[]) => c.every((x) => p.includes(x));

// @verifies PP-1
test('a verified presentation becomes Verified claims: principal = root controller, delegate = leaf holder', async () => {
  const w = await world();
  const claims = await createPolyVerifier(w.deps)(w.pres, w.req);
  assert.equal(claims.attest, 'Verified');
  const c = claims as PolyVerifiedClaims;
  assert.equal(c.kind, 'Agent');
  assert.equal(c.principal, w.controller.did);
  assert.equal(c.delegate, w.a2.did);
  assert.notEqual(c.principal, c.delegate);
});

// @verifies PP-1
test('a denial becomes Failed with the check-class reason only — no principal, delegate or scope', async () => {
  const w = await world();
  const claims = await createPolyVerifier(w.deps)(w.pres, { ...w.req, action: 'write' }); // narrowed away at the mid hop
  assert.deepEqual(claims, { kind: 'Agent', attest: 'Failed', assurance: 0, reason: 'authorization', verifiedAt: NOW });
  assert.equal('principal' in claims, false);
  assert.equal('mandate' in claims, false);
});

// @verifies PP-2
test('assurance is the derived rung index, never the asserted level; a pinned issuer and a co-sign raise it', async () => {
  const w = await world();
  const base = await createPolyVerifier(w.deps)(w.pres, w.req) as PolyVerifiedClaims;
  assert.equal(base.assuranceLevel, 'controller-vouched'); // the root ASSERTED 'witnessed'; derived is what counts
  assert.equal(base.assurance, ASSURANCE_LADDER.indexOf('controller-vouched'));
  assert.equal(base.assurance, 1);

  const pinned = await createPolyVerifier({ ...w.deps, trust: { anchors: [], pinnedIssuers: [w.controller.did] } })(w.pres, w.req) as PolyVerifiedClaims;
  assert.equal(pinned.assurance, 2);
  assert.equal(pinned.assuranceLevel, 'issuer-pinned');

  const coSigned = { ...w.pres, coSign: w.issuer.coSign(w.controller, { challenge: 'n', audience: V, action: 'read', resource: 'res:a' }) };
  const human = await createPolyVerifier(w.deps)(coSigned, { ...w.req, requireHumanCoSign: true }) as PolyVerifiedClaims;
  assert.equal(human.assurance, 5);
  assert.equal(human.assuranceLevel, 'human-co-signed');
  assert.equal(assuranceIndex(undefined), 0);
  assert.equal(assuranceIndex('not-a-level'), 0);
});

// @verifies PP-2
test('a presentation below the required assurance is Failed, not Verified at a low number', async () => {
  const w = await world();
  const claims = await createPolyVerifier(w.deps)(w.pres, { ...w.req, requiredAssurance: 'issuer-pinned' });
  assert.equal(claims.attest, 'Failed');
  assert.equal((claims as { reason: string }).reason, 'assurance');
});

// @verifies PP-3
test('freshness: verifiedAt and statusAt are the request clock by default; a caching deployment states its own', async () => {
  const w = await world();
  const fresh = await createPolyVerifier(w.deps)(w.pres, w.req) as PolyVerifiedClaims;
  assert.equal(fresh.verifiedAt, NOW);
  assert.equal(fresh.statusAt, NOW);

  const cached = await createPolyVerifier(w.deps, { statusAt: () => '2026-11-03T11:50:00Z' })(w.pres, w.req) as PolyVerifiedClaims;
  assert.equal(cached.verifiedAt, NOW);
  assert.equal(cached.statusAt, '2026-11-03T11:50:00Z');

  const { now: _n, ...noClock } = w.req;
  const clocked = await createPolyVerifier(w.deps, { now: () => NOW })(w.pres, noClock) as PolyVerifiedClaims;
  assert.equal(clocked.verifiedAt, NOW);
});

// @verifies PP-4
test('mandate: the verified chain nests leaf → root, each scope within its parent, each delegator its parent\'s delegate', async () => {
  const w = await world();
  const { mandate } = await createPolyVerifier(w.deps)(w.pres, w.req) as PolyVerifiedClaims;

  // innermost = leaf (a1 → a2), parent = mid (a0 → a1), parent.parent = root (controller → a0)
  assert.equal(mandate.delegator, w.a1.did);
  assert.equal(mandate.delegate, w.a2.did);
  assert.equal(mandate.parent?.delegator, w.a0.did);
  assert.equal(mandate.parent?.delegate, w.a1.did);
  assert.equal(mandate.parent?.parent?.delegator, w.controller.did);
  assert.equal(mandate.parent?.parent?.delegate, w.a0.did);
  assert.equal(mandate.parent?.parent?.parent, undefined);

  // scope is the finite part of the capability
  assert.deepEqual(mandate.scope, { actions: ['read'], resources: ['res:a'], audience: [V], maxInvocations: 1 });
  assert.deepEqual(mandate.parent?.parent?.scope, { actions: ['read', 'write'], resources: ['res:a', 'res:b'], audience: [V], maxInvocations: 10 });

  // K12 by construction: every hop ⊆ parent, delegator chains, expiry never later than the parent's
  for (let m: PolyMandate | undefined = mandate; m?.parent; m = m.parent) {
    assert.ok(subset(m.scope.actions, m.parent.scope.actions));
    assert.ok(subset(m.scope.resources, m.parent.scope.resources));
    assert.ok(subset(m.scope.audience ?? [], m.parent.scope.audience ?? []));
    assert.ok((m.scope.maxInvocations ?? Infinity) <= (m.parent.scope.maxInvocations ?? Infinity));
    assert.ok(m.expires <= m.parent.expires);
    assert.equal(m.delegator, m.parent.delegate);
  }
  // expires folds validUntil and notAfter: the leaf's notAfter is earlier than its validUntil
  assert.equal(mandate.expires, '2026-12-01T00:00:00Z');
  assert.equal(mandate.parent?.expires, '2027-01-01T00:00:00Z');

  assert.deepEqual(mandateOf(w.chain), mandate);
  assert.throws(() => mandateOf([]), /empty chain/);
});

// @verifies PP-5
test('revocation as a signal: the same presentation verifies, the AAC is revoked, the next call is Failed / revoked', async () => {
  const w = await world();
  const verify = createPolyVerifier(w.deps);
  assert.equal((await verify(w.pres, w.req)).attest, 'Verified');
  assert.equal(await w.issuer.revoke(w.d1.did, w.a0), true); // the delegator revokes the mid hop
  const after = await verify(w.pres, w.req);
  assert.equal(after.attest, 'Failed');
  assert.equal((after as { reason: string }).reason, 'revoked');
  assert.equal((await verify(w.pres, w.req)).attest, 'Failed'); // and stays failed — no session state to fall back on
});
