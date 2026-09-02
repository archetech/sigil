/**
 * The transport seam: how two agents exchange Sigil protocol messages, addressing each other by DID. The
 * protocol (src/protocol.ts) is transport-agnostic; an Archon **DIDComm** adapter (src/archon/transport.ts) is
 * the real backing, and `inMemoryNetwork` here is an offline stand-in for tests and the demo.
 *
 * A `Transport` belongs to one agent (its own DID). `send` drops a message into a recipient DID's inbox; `receive`
 * drains this agent's inbox. Nothing here interprets messages — that is the protocol layer's job.
 *
 * @implements R14
 */
export interface TransportMessage {
  readonly type: string;
  readonly body: unknown;
  /** The sender's DID (set by the transport; authenticated by DIDComm authcrypt in the real adapter). */
  readonly from?: string;
  readonly id?: string;
}

export interface Transport {
  send(to: string, message: { type: string; body: unknown }): Promise<void>;
  /** Drain and return any messages waiting in this agent's inbox (empty if none). */
  receive(): Promise<TransportMessage[]>;
}

/** An in-process message bus: one shared set of inboxes keyed by DID. Offline, deterministic — for tests/demo. */
export function inMemoryNetwork() {
  const inboxes = new Map<string, TransportMessage[]>();
  const box = (did: string): TransportMessage[] => {
    let q = inboxes.get(did);
    if (!q) { q = []; inboxes.set(did, q); }
    return q;
  };
  let seq = 0;
  return {
    transport(did: string): Transport {
      box(did); // register
      return {
        async send(to, message) { box(to).push({ ...message, from: did, id: `m${++seq}` }); },
        async receive() { return box(did).splice(0); },
      };
    },
  };
}
