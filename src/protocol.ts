/**
 * The Sigil A2A exchange, as a small transport-agnostic protocol. It profiles present-and-verify onto a
 * request/response message flow that rides any `Transport` (DIDComm in production; in-memory in tests):
 *
 *   presenter → verifier :  request       { action, resource }
 *   verifier  → presenter:  challenge     { nonce, audience, action, resource, requireHumanCoSign }
 *   presenter → verifier :  presentation  { presentation }            ← built for the fresh challenge
 *   verifier  → presenter:  result        { ok, reason?, assuranceLevel? }
 *
 * The verifier owns the nonce (freshness) and correlates a presentation to the challenge it issued to that
 * counterparty. Verification itself is the same `verifyPresentation` — the protocol only moves the messages.
 *
 * @implements R14
 */
import type { Presentation, VerifyDeps, VerifyResult } from './types.ts';
import type { Transport, TransportMessage } from './transport.ts';
import { verifyPresentation } from './verify.ts';

const PROTO = 'https://sigil.archetech.com/1.0';
export const MSG = {
  request: `${PROTO}/request`,
  challenge: `${PROTO}/challenge`,
  presentation: `${PROTO}/presentation`,
  result: `${PROTO}/result`,
} as const;

export interface RequestBody { readonly action: string; readonly resource: string; }
export interface ChallengeBody { readonly nonce: string; readonly audience: string; readonly action: string; readonly resource: string; readonly requireHumanCoSign: boolean; }
export interface PresentationBody { readonly presentation: Presentation; }
export type ResultBody = VerifyResult;

type Reply = { type: string; body: unknown };

export interface VerifierPolicy {
  /** The verifier's own DID — the audience a presentation must bind to. */
  readonly audience: string;
  /** Which actions demand a proof-of-human co-sign (AC-11). */
  readonly highConsequence?: (action: string) => boolean;
  readonly requiredAssurance?: string;
}

/** A verifier's side of the exchange. Stateful: it remembers the challenge it issued to each counterparty. */
export function createVerifier(deps: VerifyDeps, policy: VerifierPolicy, nonce: () => string) {
  const pending = new Map<string, { action: string; resource: string; nonce: string; requireHumanCoSign: boolean }>();
  return {
    async handle(from: string | undefined, msg: TransportMessage): Promise<Reply | null> {
      if (!from) return null;
      if (msg.type === MSG.request) {
        const { action, resource } = msg.body as RequestBody;
        const requireHumanCoSign = policy.highConsequence?.(action) ?? false;
        const n = nonce();
        pending.set(from, { action, resource, nonce: n, requireHumanCoSign });
        return { type: MSG.challenge, body: { nonce: n, audience: policy.audience, action, resource, requireHumanCoSign } satisfies ChallengeBody };
      }
      if (msg.type === MSG.presentation) {
        const ch = pending.get(from);
        if (!ch) return { type: MSG.result, body: { ok: false, reason: 'no-challenge' } satisfies ResultBody };
        pending.delete(from);
        const result = await verifyPresentation((msg.body as PresentationBody).presentation, {
          nonce: ch.nonce, audience: policy.audience, action: ch.action, resource: ch.resource,
          requireHumanCoSign: ch.requireHumanCoSign, requiredAssurance: policy.requiredAssurance,
        }, deps);
        return { type: MSG.result, body: result satisfies ResultBody };
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
