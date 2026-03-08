import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import type { CommitSpec } from "../../scripts/awakening/_schema.js";
import type { CommitContext } from "./commitActionRegistry.js";
import { requireStringField } from "./commitUtils.js";
import { getRegistryDirForScope } from "../../registry/scaffold.js";
import { isAwakeningSetupWritable } from "../isSetupPhase.js";
import { buildPcRegistryEntry } from "../../registry/runtime/buildPcRegistryEntry.js";
import type { RawRegistryYaml, RawCharacter } from "../../registry/types.js";
import { writeFileAtomic } from "../../io/atomicWrite.js";

type PlayerInput = {
  discord_user_id: string;
  canonical_name: string;
};

function ensureArrayInput(value: unknown, key: string): PlayerInput[] {
  if (!Array.isArray(value)) {
    throw new Error(`append_registry_yaml expected array input at ${key}`);
  }

  return value.map((item, index) => {
    const row = item as Record<string, unknown>;
    const discordUserId =
      typeof row?.discord_user_id === "string" && row.discord_user_id.trim().length > 0
        ? row.discord_user_id.trim()
        : typeof row?.user_id === "string" && row.user_id.trim().length > 0
          ? row.user_id.trim()
          : "";
    const canonicalName =
      typeof row?.canonical_name === "string" && row.canonical_name.trim().length > 0
        ? row.canonical_name.trim()
        : typeof row?.character_name === "string" && row.character_name.trim().length > 0
          ? row.character_name.trim()
          : "";

    if (!discordUserId) {
      throw new Error(`append_registry_yaml.${key}[${index}].discord_user_id must be a non-empty string`);
    }
    if (!canonicalName) {
      throw new Error(`append_registry_yaml.${key}[${index}].canonical_name must be a non-empty string`);
    }
    return {
      discord_user_id: discordUserId,
      canonical_name: canonicalName,
    };
  });
}

export async function handleAppendRegistryYamlCommit(ctx: CommitContext, commit: CommitSpec): Promise<void> {
  // Setup-only append. Never modify/delete existing registry entries at runtime. Export/edit via tooling/webapp later.
  if (!isAwakeningSetupWritable({
    onboardingState: ctx.onboardingState,
    guildConfig: ctx.guildConfig,
  })) {
    throw new Error("registry writes are setup-only");
  }

  const target = requireStringField(commit, "target");
  if (target !== "pcs") {
    throw new Error("append_registry_yaml.target supports only pcs in Sprint 5");
  }

  const mode = (commit as Record<string, unknown>).mode;
  if (mode !== undefined && mode !== "append_only") {
    throw new Error("append_registry_yaml.mode must be append_only");
  }

  const entriesFromKey = requireStringField(commit, "entries_from");
  const players = ensureArrayInput(ctx.inputs[entriesFromKey], entriesFromKey);

  const registryDir = getRegistryDirForScope({
    guildId: ctx.guildId,
    campaignSlug: ctx.campaignSlug,
  });
  fs.mkdirSync(registryDir, { recursive: true });
  const pcsPath = path.join(registryDir, "pcs.yml");

  const existingDoc = fs.existsSync(pcsPath)
    ? (yaml.parse(fs.readFileSync(pcsPath, "utf8")) as RawRegistryYaml)
    : ({ version: 1, characters: [] } as RawRegistryYaml);

  if (typeof existingDoc.version !== "number") {
    existingDoc.version = 1;
  }
  if (!Array.isArray(existingDoc.characters)) {
    existingDoc.characters = [];
  }

  const characters = existingDoc.characters as RawCharacter[];
  const byDiscordUserId = new Set(
    characters
      .map((character) => character.discord_user_id)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );
  const existingIds = new Set(
    characters
      .map((character) => character.id)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );

  let appended = false;
  for (const player of players) {
    if (byDiscordUserId.has(player.discord_user_id)) {
      // Append-only policy: never mutate or rename existing entries for known discord_user_id.
      continue;
    }

    const entry = buildPcRegistryEntry({
      canonical_name: player.canonical_name,
      discord_user_id: player.discord_user_id,
      existingIds,
    });

    characters.push({
      id: entry.id,
      canonical_name: entry.canonical_name,
      discord_user_id: entry.discord_user_id,
      aliases: entry.aliases,
      notes: entry.notes,
    });

    existingIds.add(entry.id);
    byDiscordUserId.add(player.discord_user_id);
    appended = true;
  }

  if (!appended && fs.existsSync(pcsPath)) {
    return;
  }

  const nextYaml = yaml.stringify({
    version: existingDoc.version,
    characters,
  });

  writeFileAtomic(pcsPath, nextYaml);
}
