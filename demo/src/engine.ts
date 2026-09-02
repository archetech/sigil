/**
 * The demo's brain: it drives the REAL Sigil library — `createArchonIssuer`, `verifyPresentation`,
 * `createArchonResolver`/`createArchonSignatureVerifier` — over whichever gatekeeper the mode selects. Nothing
 * here re-implements Sigil; the UI just orchestrates the same calls the tests and live e2e scripts make.
 */
import { verifyPresentation, createArchonIssuer, createArchonResolver, createArchonSignatureVerifier } from '@sigil';
import type { AAC, Capability, Signer, VerifyResult, VerifyRequest, ArchonIssuer, Resolver, SignatureVerifier } from '@sigil';
import Cipher from '@didcid/cipher';
import { makeOfflineGatekeeper, makeLiveGatekeeper } from './gatekeeper.ts';

export type Mode = 'offline' | 'live';
export const AUDIENCE = 'did:web:acme-vendor.example';
export const ACTIONS = ['read', 'write', 'delete', 'admin'] as const;
export const RESOURCES = ['res:catalog', 'res:orders', 'res:billing'] as const;

export interface Actor { id: string; name: string; role: 'controller' | 'agent'; did: string; signer: Signer; }
export interface Hop { did: string; credential: AAC; issuerId: string; subjectId: string; cap: Capability; revoked: boolean; }

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
  private agentCount = 0;

  constructor() { this.wire(makeOfflineGatekeeper(this.cipher)); }

  private wire(gk: any): void {
    const registry = this.mode === 'offline' ? 'demo' : 'hyperswarm';
    this.issuer = createArchonIssuer(gk, this.cipher, { registry });
    this.deps = { resolver: createArchonResolver(gk), signatures: createArchonSignatureVerifier(this.cipher) };
  }

  reset(): void { this.actors = []; this.controllerId = ''; this.chain = []; this.agentCount = 0; }

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

  async verify(action: string, resource: string, audience: string): Promise<VerifyResult> {
    const presenter = this.leafSubject(); if (!presenter) throw new Error('nothing to present');
    const nonce = crypto.randomUUID();
    const pres = this.issuer.present(presenter.signer, { challenge: nonce, audience, credentials: this.chain.map((h) => h.credential) });
    const req: VerifyRequest = { nonce, audience, action, resource };
    return verifyPresentation(pres, req, this.deps);
  }
}
