/**
 * The live transport: Sigil protocol messages over Archon **DIDComm**, using an agent's mailbox (its "inbox").
 * Agents address each other by `did:cid`; `send` packs + delivers to the recipient's mailbox, `receive` relays any
 * queued Forward envelopes for this agent and fetches the unpacked messages. Backed by a `@didcid/clients`
 * KeymasterClient (the wallet holds the agent's keys and speaks to the node's `/didcomm` mount).
 *
 * The wire identity here is the agent's wallet DID; the *authority* it presents (the AAC chain + holder proof)
 * is carried inside the message and verified independently. Live mailbox routing (mediator / service endpoint)
 * is validated by the DIDComm e2e.
 *
 * @implements R14
 */
import type { Transport, TransportMessage } from '../transport.ts';

/** The DIDComm calls this adapter needs. A `@didcid/clients` KeymasterClient satisfies it. */
export interface DidCommKeymaster {
  sendDidComm(message: Record<string, unknown>, to: string | string[], options?: { name?: string; sign?: boolean }): Promise<string[]>;
  receiveDidComm(options?: { name?: string }): Promise<unknown[]>;
  mediateDidComm?(options?: { name?: string }): Promise<{ relayed: number; skipped: number }>;
}

/** A transport for the wallet ID named `name` (defaults to the current ID). */
export function createArchonTransport(keymaster: DidCommKeymaster, options: { name?: string } = {}): Transport {
  const name = options.name;
  return {
    async send(to, message) {
      await keymaster.sendDidComm({ type: message.type, body: message.body }, to, { name });
    },
    async receive() {
      // Relay Forward envelopes queued at this ID's mailbox (mediator role), then fetch unpacked messages.
      await keymaster.mediateDidComm?.({ name }).catch(() => undefined);
      const received = await keymaster.receiveDidComm({ name });
      return received
        .map((r) => {
          const rec = r as { message?: Record<string, unknown>; from?: string; id?: string };
          const m = (rec.message ?? rec) as { type?: unknown; body?: unknown; from?: string; id?: string };
          return { type: m.type, body: m.body, from: m.from ?? rec.from, id: m.id ?? rec.id } as TransportMessage;
        })
        .filter((m): m is TransportMessage => typeof m.type === 'string');
    },
  };
}
