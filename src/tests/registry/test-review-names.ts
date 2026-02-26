import { expect, test } from "vitest";
import {
  addAliasIfMissing,
  addIgnoreToken,
  createRegistryEntry,
  generateUniqueId,
  removePendingAtIndex,
} from "../../registry/reviewNamesCore.js";

test("generateUniqueId appends suffix when base id exists", () => {
  const existing = new Set(["npc_bob", "npc_bob_2"]);
  const id = generateUniqueId("npc", "Bob", existing);
  expect(id).toBe("npc_bob_3");
});

test("addIgnoreToken is normalized and idempotent", () => {
  const first = addIgnoreToken(["hello"], "  THANKS  ");
  expect(first.changed).toBe(true);
  expect(first.tokens).toEqual(["hello", "thanks"]);

  const second = addIgnoreToken(first.tokens, "thanks");
  expect(second.changed).toBe(false);
  expect(second.tokens).toEqual(["hello", "thanks"]);
});

test("addAliasIfMissing avoids canonical/duplicate aliases", () => {
  const base = {
    id: "npc_kara",
    canonical_name: "Kara Vale",
    aliases: ["KV"],
    notes: "",
  };

  const unchangedCanonical = addAliasIfMissing(base, "Kara Vale");
  expect(unchangedCanonical.changed).toBe(false);

  const added = addAliasIfMissing(base, "Kara");
  expect(added.changed).toBe(true);
  expect(added.entry.aliases).toEqual(["KV", "Kara"]);

  const unchangedDuplicate = addAliasIfMissing(added.entry, "Kara");
  expect(unchangedDuplicate.changed).toBe(false);
  expect(unchangedDuplicate.entry.aliases).toEqual(["KV", "Kara"]);
});

test("createRegistryEntry sets alias when display differs from canonical", () => {
  const entry = createRegistryEntry({
    prefix: "npc",
    canonicalName: "The Watcher",
    candidateDisplay: "Watcher",
    existingIds: new Set<string>(),
  });

  expect(entry.id).toBe("npc_the_watcher");
  expect(entry.aliases).toEqual(["Watcher"]);
  expect(entry.notes).toBe("");
});

test("removePendingAtIndex is stable and idempotent for invalid index", () => {
  const pending = ["a", "b", "c"];
  expect(removePendingAtIndex(pending, 1)).toEqual(["a", "c"]);
  expect(removePendingAtIndex(pending, -1)).toEqual(["a", "b", "c"]);
  expect(removePendingAtIndex(pending, 999)).toEqual(["a", "b", "c"]);
});
