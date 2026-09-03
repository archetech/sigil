/**
 * The monotonic-attenuation rule (AC-8), defined once and used on both sides: the issuer refuses to mint a
 * widening delegation, and the verifier refuses to accept one. A delegated capability may only *narrow* its
 * parent — a broader action/resource set, or loosening a constraint the parent imposed, is a widening.
 *
 * @implements AC-8
 */
import type { Capability } from './types.ts';

const subset = (child: readonly string[], parent: readonly string[]): boolean => child.every((x) => parent.includes(x));

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/**
 * A capability MUST be a **structured** object — `actions` and `resources` as string arrays, optional structured
 * `constraints`, optional boolean `delegable`/`parent` — never free-text scope (R5/AC-4). The verifier rejects any
 * hop whose authorization is not structured, so free-text or malformed authority is unrepresentable in a verified
 * chain and can't be smuggled past scope checks.
 *
 * @implements R5, AC-4
 */
export function isStructuredCapability(x: unknown): x is Capability {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Record<string, unknown>;
  if (!isStringArray(c.actions) || !isStringArray(c.resources)) return false;
  if (c.constraints !== undefined && (typeof c.constraints !== 'object' || c.constraints === null)) return false;
  if (c.delegable !== undefined && typeof c.delegable !== 'boolean') return false;
  if (c.parent !== undefined && c.parent !== null && typeof c.parent !== 'string') return false;
  return true;
}

export function attenuates(child: Capability, parent: Capability): boolean {
  if (!subset(child.actions, parent.actions)) return false;
  if (!subset(child.resources, parent.resources)) return false;
  const pc = parent.constraints, cc = child.constraints;
  // If the parent bounds a dimension, the child must bound it no more loosely.
  if (pc?.audience && (!cc?.audience || !subset(cc.audience, pc.audience))) return false;
  if (pc?.notAfter && (!cc?.notAfter || cc.notAfter > pc.notAfter)) return false;
  if (pc?.maxInvocations !== undefined && (cc?.maxInvocations === undefined || cc.maxInvocations > pc.maxInvocations)) return false;
  return true;
}
