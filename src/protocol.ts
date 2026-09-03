/**
 * The Sigil A2A exchange, as a small transport-agnostic protocol. It profiles present-and-verify onto a
 * request/response message flow that rides any `Transport` (DIDComm in production; in-memory in tests):
 *
 *   agent → verifier :  request       { action, resource }
 *   verifier → agent :  challenge     { nonce, audience, action, resource, requireHumanCoSign }
 *   agent → verifier :  presentation | invocation   ← built for the fresh challenge
 *   verifier → agent :  result | receipt            ← authorization decision, or an acknowledged act
 *
 * A **presentation** asks "may I?" (authorization query); an **invocation** is the committed act "I hereby do A on
 * R", which — when the verifier is a resource server with a key — comes back as a signed **receipt** (the second
 * half of an attributable record). The verifier owns the nonce (freshness) and correlates a response to the
 * challenge it issued that counterparty. Verification is the same `verifyPresentation` / `verifyInvocation`.
 *
 * @implements R14, INV-2
 */
import type { Presentation, Invocation, Receipt, VerifyDeps, VerifyResult } from './types.ts';
import type { Transport, TransportMessage } from './transport.ts';
import { verifyPresentation, verifyInvocation } from './verify.ts';

const PROTO = 'https://sigil.archetech.com/1.0';
export const MSG = {
  request: `${PROTO}/request`,
  challenge: `${PROTO}/challenge`,
  presentation: `${PROTO}/presentation`,
  invocation: `${PROTO}/invocation`,
  result: `${PROTO}/result`,
  receipt: `${PROTO}/receipt`,
} as const;

export interface RequestBody { readonly action: string; readonly resource: string; }
export interface ChallengeBody { readonly nonce: string; readonly audience: string; readonly action: string; readonly resource: string; readonly requireHumanCoSign: boolean; }
export interface PresentationBody { readonly presentation: Presentation; }
export interface InvocationBody { readonly invocation: Invocation; }
export type ResultBody = VerifyResult;
export interface ReceiptBody { readonly result: VerifyResult; readonly receipt?: Receipt; }

type Reply = { type: string; body: unknown };

export interface VerifierPolicy {
  /** The verifier's own DID — the audience a presentation must bind to. */
  readonly audience: string;
  /** Which actions demand a proof-of-human co-sign (AC-11). */
  readonly highConsequence?: (action: string) => boolean;
  readonly requiredAssurance?: string;
  /** If set, the verifier is a resource server: on an accepted invocation it signs a receipt (INV-4). */
  readonly issueReceipt?: (invocation: Invocation, result: VerifyResult) => Receipt;
}

/** A verifier's side of the exchange. Stateful: it remembers the challenge it issued to each counterparty. */
export function createVerifier(deps: VerifyDeps, policy: VerifierPolicy, nonce: () => string) {
  const pending = new Map<string, { action: string; resource: string; nonce: string; requireHumanCoSign: boolean }>();
  const request = (from: string, action: string, resource: string): Reply => {
    const requireHumanCoSign = policy.highConsequence?.(action) ?? false;
    const n = nonce();
    pending.set(from, { action, resource, nonce: n, requireHumanCoSign });
    return { type: MSG.challenge, body: { nonce: n, audience: policy.audience, action, resource, requireHumanCoSign } satisfies ChallengeBody };
  };
  return {
    async handle(from: string | undefined, msg: TransportMessage): Promise<Reply | null> {
      if (!from) return null;
      if (msg.type === MSG.request) {
        const { action, resource } = msg.body as RequestBody;
        return request(from, action, resource);
      }
      if (msg.type === MSG.presentation || msg.type === MSG.invocation) {
        const ch = pending.get(from);
        if (!ch) return { type: MSG.result, body: { ok: false, reason: 'no-challenge' } satisfies ResultBody };
        pending.delete(from);
        const req = { nonce: ch.nonce, audience: policy.audience, action: ch.action, resource: ch.resource, requireHumanCoSign: ch.requireHumanCoSign, requiredAssurance: policy.requiredAssurance };
        if (msg.type === MSG.presentation) {
          const result = await verifyPresentation((msg.body as PresentationBody).presentation, req, deps);
          return { type: MSG.result, body: result satisfies ResultBody };
        }
        const inv = (msg.body as InvocationBody).invocation;
        const result = await verifyInvocation(inv, req, deps);
        const receipt = result.ok && policy.issueReceipt ? policy.issueReceipt(inv, result) : undefined;
        return { type: MSG.receipt, body: { result, ...(receipt ? { receipt } : {}) } satisfies ReceiptBody };
      }
      return null;
    },
  };
}

/** A presenter's side: answer a challenge with a presentation built for its exact nonce/audience. */
export function createPresenter(build: (challenge: ChallengeBody) => Promise<Presentation>) {
  return {
    async handle(_from: string | undefined, msg: TransportMessage): Promise<Reply | null> {
      if (msg.type === MSG.challenge) {
        const presentation = await build(msg.body as ChallengeBody);
        return { type: MSG.presentation, body: { presentation } satisfies PresentationBody };
      }
      return null; // a result is terminal — the caller reads it
    },
  };
}

/** An invoker's side: answer a challenge with an **invocation** — the committed act — built for its exact nonce.
 *  The verifier replies with a receipt (a `result` + optional signed acknowledgment). @implements INV-1 */
export function createInvoker(build: (challenge: ChallengeBody) => Promise<Invocation>) {
  return {
    async handle(_from: string | undefined, msg: TransportMessage): Promise<Reply | null> {
      if (msg.type === MSG.challenge) {
        const invocation = await build(msg.body as ChallengeBody);
        return { type: MSG.invocation, body: { invocation } satisfies InvocationBody };
      }
      return null; // a receipt is terminal — the caller reads it
    },
  };
}

/** Presenter kick-off: ask a verifier to authorize an action. */
export async function requestAccess(transport: Transport, verifier: string, req: RequestBody): Promise<void> {
  await transport.send(verifier, { type: MSG.request, body: req });
}

/**
 * Drain an inbox once, dispatch each message through `handle`, and send any reply back to its sender. Returns the
 * drained messages (so a caller can watch for a `result`). A real driver calls this in a receive loop.
 */
export async function pump(transport: Transport, handle: (from: string | undefined, msg: TransportMessage) => Promise<Reply | null>): Promise<TransportMessage[]> {
  const msgs = await transport.receive();
  for (const m of msgs) {
    const reply = await handle(m.from, m);
    if (reply && m.from) await transport.send(m.from, reply);
  }
  return msgs;
}
