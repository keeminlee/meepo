import { normalizeName } from "./textFeatures.js";

export type ActorLike = {
  id: string;
  canonical_name: string;
  aliases?: string[];
};

export function buildActorNameSet(actor: ActorLike): string[] {
  const names = [actor.canonical_name, ...(actor.aliases ?? [])];
  return names.map((name) => normalizeName(name)).filter(Boolean);
}

export function mentionsActor(text: string, actor: ActorLike): boolean {
  const normText = normalizeName(text);
  if (!normText) return false;

  for (const name of buildActorNameSet(actor)) {
    if (name && normText.includes(name)) {
      return true;
    }
  }

  return false;
}

export function getMentionedActors<T extends ActorLike>(text: string, actors: T[]): T[] {
  const mentioned: T[] = [];
  for (const actor of actors) {
    if (mentionsActor(text, actor)) {
      mentioned.push(actor);
    }
  }
  return mentioned;
}
