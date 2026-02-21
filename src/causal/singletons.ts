import type { CausalLink } from "./types.js";
import type { SingletonNode } from "./cycleTypes.js";
import type { KernelEffect } from "./extractCausalLinksKernel.js";

export function extractSingletonsFromKernelOutput(params: {
  sessionId: string;
  links: CausalLink[];
  unclaimedEffects?: KernelEffect[];
  keepUnclaimedLinks?: boolean;
}): {
  links: CausalLink[];
  singletonCauses: SingletonNode[];
  singletonEffects: SingletonNode[];
} {
  const singletonCauses: SingletonNode[] = [];
  const retainedLinks: CausalLink[] = [];

  for (const link of params.links) {
    if (!link.claimed) {
      const anchor = link.cause_anchor_index ?? link.intent_anchor_index;
      singletonCauses.push({
        id: `S:cause:${link.session_id}:${anchor}`,
        kind: "cause",
        anchor_index: anchor,
        text: link.cause_text ?? link.intent_text,
        mass: link.mass ?? link.link_mass ?? link.cause_mass ?? 0,
        type: link.cause_type ?? link.intent_type,
      });
      if (params.keepUnclaimedLinks) retainedLinks.push(link);
    } else {
      retainedLinks.push(link);
    }
  }

  const singletonEffects: SingletonNode[] = (params.unclaimedEffects ?? []).map((effect) => ({
    id: `S:effect:${params.sessionId}:${effect.anchor_index}`,
    kind: "effect",
    anchor_index: effect.anchor_index,
    text: effect.text,
    mass: effect.mass,
    type: effect.effect_type,
  }));

  return {
    links: retainedLinks,
    singletonCauses,
    singletonEffects,
  };
}
