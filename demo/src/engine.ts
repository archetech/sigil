/**
 * The demo's brain: it drives the REAL Sigil library — `createArchonIssuer`, `verifyPresentation`,
 * `createArchonResolver`/`createArchonSignatureVerifier` — over whichever gatekeeper the mode selects. Nothing
 * here re-implements Sigil; the UI just orchestrates the same calls the tests and live e2e scripts make.
 */
import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '@sigil';
import type { AAC, Capability, Signer, VerifyResult, VerifyRequest, ArchonIssuer, Resolver, SignatureVerifier, Presentation } from '@sigil';
import Cipher from '@didcid/cipher';
import { makeOfflineGatekeeper, makeLiveGatekeeper } from './gatekeeper.ts';

export type Mode = 'offline' | 'live';
export const AUDIENCE = 'did:web:acme-vendor.example';
export const ACTIONS = ['read', 'write', 'delete', 'admin'] as const;
export const RESOURCES = ['res:catalog', 'res:orders', 'res:billing'] as const;
/** Actions the verifier treats as high-consequence — they require a human co-sign (AC-11). */
export const HIGH_CONSEQUENCE = new Set(['delete', 'admin']);
export const isHighConsequence = (action: string): boolean => HIGH_CONSEQUENCE.has(action);

export interface Actor { id: string; name: string; role: 'controller' | 'agent'; did: string; signer: Signer; }
export interface Hop { did: string; credential: AAC; issuerId: string; subjectId: string; cap: Capability; revoked: boolean; }

/** One resolution the verifier performed — captured to show that verification is read-only DID/status resolution. */
export interface TraceEntry { did: string; label: string; purpose: 'key' | 'liveness' | 'status'; }
export interface VerifyOutcome { result: VerifyResult; trace: TraceEntry[]; presentation: Presentation; }

export class DemoEngine {
  mode: Mode = 'offline';
  nodeUrl = 'http://localhost:4222';
  liveError: string | null = null;

  private cipher = new Cipher() as any;
  private issuer!: ArchonIssuer;
  private deps!: { resolver: Resolver; signatures: SignatureVerifier };

  actors: Actor[] = [];
  controllerId = '';
  chain: Hop[] = [];
  rootVrcDid = '';
  private agentCount = 0;

  constructor() { this.wire(makeOfflineGatekeeper(this.cipher)); }

  private wire(gk: any): void {
    const registry = this.mode === 'offline' ? 'demo' : 'hyperswarm';
    this.issuer = createArchonIssuer(gk, this.cipher, { registry });
    this.deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(this.cipher) };
  }

  reset(): void { this.actors = []; this.controllerId = ''; this.chain = []; this.rootVrcDid = ''; this.agentCount = 0; }

  /** A friendly name for a DID seen in a verification trace. */
  private didLabel(did: string): string {
    const a = this.actors.find((x) => x.did === did);
    if (a) return a.name;
    const idx = this.chain.findIndex((h) => h.did === did);
    if (idx >= 0) return idx === 0 ? 'root grant (AAC)' : `delegation ${idx} (AAC)`;
    if (did === this.rootVrcDid) return 'relationship (VRC)';
    return did.length > 22 ? `${did.slice(0, 15)}…` : did;
  }

  async setOffline(): Promise<void> {
    this.mode = 'offline'; this.liveError = null; this.reset(); this.wire(makeOfflineGatekeeper(this.cipher));
  }
  async setLive(url: string): Promise<void> {
    this.mode = 'live'; this.nodeUrl = url; this.liveError = null; this.reset();
    try { this.wire(await makeLiveGatekeeper(url)); }
    catch (e) { this.liveError = e instanceof Error ? e.message : String(e); this.mode = 'offline'; this.wire(makeOfflineGatekeeper(this.cipher)); }
  }

  actor(id: string): Actor { const a = this.actors.find((x) => x.id === id); if (!a) throw new Error(`unknown actor ${id}`); return a; }
  leaf(): Hop | undefined { return this.chain[this.chain.length - 1]; }
  leafSubject(): Actor | undefined { const l = this.leaf(); return l ? this.actor(l.subjectId) : undefined; }
  /** Agents that can currently delegate: the leaf's subject, if its capability is delegable and not revoked. */
  canDelegateFrom(): Actor | undefined {
    const l = this.leaf();
    if (!l || l.revoked || l.cap.delegable !== true) return undefined;
    return this.actor(l.subjectId);
  }

  async ensureController(): Promise<Actor> {
    if (this.controllerId) return this.actor(this.controllerId);
    const signer = await this.issuer.mintAgent();
    const a: Actor = { id: 'controller', name: 'Acme Corp', role: 'controller', did: signer.did, signer };
    this.actors.push(a); this.controllerId = a.id; return a;
  }
  async addAgent(): Promise<Actor> {
    const signer = await this.issuer.mintAgent();
    const letter = String.fromCharCode(65 + this.agentCount++); // A, B, C, …
    const a: Actor = { id: `agent-${letter}`, name: `Agent ${letter}`, role: 'agent', did: signer.did, signer };
    this.actors.push(a); return a;
  }

  async issueRoot(subjectId: string, cap: Capability): Promise<void> {
    const controller = await this.ensureController();
    const subject = this.actor(subjectId);
    const vrc = await this.issuer.mintRelationship(controller.signer, subject.did);
    this.rootVrcDid = vrc.did;
    const root = await this.issuer.mintAuthorization(controller.signer, subject.did, vrc.did, cap, { assuranceLevel: 'controller-vouched' });
    this.chain = [{ did: root.did, credential: root.credential, issuerId: controller.id, subjectId, cap, revoked: false }];
  }

  async delegate(subjectId: string, cap: Capability): Promise<void> {
    const l = this.leaf(); if (!l) throw new Error('no chain to delegate from');
    const delegator = this.actor(l.subjectId);
    const subject = this.actor(subjectId);
    const del = await this.issuer.mintDelegation(delegator.signer, l.credential, subject.did, cap);
    this.chain.push({ did: del.did, credential: del.credential, issuerId: delegator.id, subjectId, cap, revoked: false });
  }

  async revokeHop(index: number): Promise<void> {
    const hop = this.chain[index]; if (!hop) return;
    await this.issuer.revoke(hop.did, this.actor(hop.issuerId).signer);
    hop.revoked = true;
  }

  async verify(action: string, resource: string, audience: string, opts: { coSign?: boolean } = {}): Promise<VerifyOutcome> {
    const presenter = this.leafSubject(); if (!presenter) throw new Error('nothing to present');
    const high = isHighConsequence(action);
    const nonce = crypto.randomUUID();
    let presentation = this.issuer.present(presenter.signer, { challenge: nonce, audience, credentials: this.chain.map((h) => h.credential) });
    // High-consequence + the human approves → the accountable principal (root controller) freshly co-signs.
    if (high && opts.coSign) {
      const principal = this.actor(this.controllerId);
      presentation = { ...presentation, coSign: this.issuer.coSign(principal.signer, { challenge: nonce, audience, action, resource }) };
    }
    const req: VerifyRequest = { nonce, audience, action, resource, requireHumanCoSign: high };

    // Wrap the resolver to capture every lookup the verifier makes — proving verification is read-only DID/status
    // resolution, and no delegator is contacted for approval (R8).
    const trace: TraceEntry[] = [];
    const tracing: Resolver = {
      resolve: async (did, opts) => {
        const isAgent = this.actors.some((a) => a.did === did);
        trace.push({ did, label: this.didLabel(did), purpose: opts?.versionTime ? 'key' : isAgent ? 'liveness' : 'status' });
        return this.deps.resolver.resolve(did, opts);
      },
    };
    const result = await verifyPresentation(presentation, req, { resolver: tracing, signatures: this.deps.signatures });
    return { result, trace, presentation };
  }
}
