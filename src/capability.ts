/**
 * The monotonic-attenuation rule (AC-8), defined once and used on both sides: the issuer refuses to mint a
 * widening delegation, and the verifier refuses to accept one. A delegated capability may only *narrow* its
 * parent — a broader action/resource set, or loosening a constraint the parent imposed, is a widening.
 *
 * @implements AC-8
 */
import type { Capability } from './types.ts';

const subset = (child: readonly string[], parent: readonly string[]): boolean => child.every((x) => parent.includes(x));

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
