"use client";

import { useMemo, useState } from "react";
import {
  applyCampaignRegistryPendingActionApi,
  createCampaignRegistryEntryApi,
  updateCampaignRegistryEntryApi,
} from "@/lib/api/registry";
import { WebApiError } from "@/lib/api/http";
import type {
  RegistryCategoryKey,
  RegistryEntityDto,
  RegistrySnapshotDto,
} from "@/lib/registry/types";

const TABS: Array<{ key: RegistryCategoryKey | "pending" | "ignore"; label: string }> = [
  { key: "pcs", label: "PCs" },
  { key: "npcs", label: "NPCs" },
  { key: "locations", label: "Locations" },
  { key: "factions", label: "Factions" },
  { key: "misc", label: "Misc" },
  { key: "pending", label: "Pending" },
  { key: "ignore", label: "Ignore" },
];

type CampaignRegistryManagerProps = {
  campaignSlug: string;
  initialRegistry: RegistrySnapshotDto;
  searchParams?: Record<string, string | string[] | undefined>;
  isEditable?: boolean;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof WebApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Compendium action failed.";
}

function normalizeCsvAliases(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function CampaignRegistryManager({
  campaignSlug,
  initialRegistry,
  searchParams,
  isEditable = true,
}: CampaignRegistryManagerProps) {
  const [registry, setRegistry] = useState(initialRegistry);
  const [activeTab, setActiveTab] = useState<RegistryCategoryKey | "pending" | "ignore">("pcs");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const [newCategory, setNewCategory] = useState<RegistryCategoryKey>("npcs");
  const [newCanonicalName, setNewCanonicalName] = useState("");
  const [newAliases, setNewAliases] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newDiscordUserId, setNewDiscordUserId] = useState("");
  const [pendingPromoteCategory, setPendingPromoteCategory] = useState<RegistryCategoryKey>("npcs");

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  const categoryCounts = useMemo(
    () => ({
      pcs: registry.categories.pcs.length,
      npcs: registry.categories.npcs.length,
      locations: registry.categories.locations.length,
      factions: registry.categories.factions.length,
      misc: registry.categories.misc.length,
      pending: registry.pending.items.length,
      ignore: registry.ignoreTokens.length,
    }),
    [registry]
  );

  const filteredEntities = useMemo(() => {
    if (!(activeTab in registry.categories)) {
      return [] as RegistryEntityDto[];
    }

    const entities = registry.categories[activeTab as RegistryCategoryKey];
    const q = query.trim().toLowerCase();
    if (!q) return entities;

    return entities.filter((entity) => {
      if (entity.canonicalName.toLowerCase().includes(q)) return true;
      if (entity.id.toLowerCase().includes(q)) return true;
      if (entity.aliases.some((alias) => alias.toLowerCase().includes(q))) return true;
      if (entity.notes.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [activeTab, query, registry]);

  const filteredPending = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return registry.pending.items;
    return registry.pending.items.filter((item) => {
      if (item.display.toLowerCase().includes(q)) return true;
      if (item.key.toLowerCase().includes(q)) return true;
      return item.examples.some((example) => example.toLowerCase().includes(q));
    });
  }, [query, registry.pending.items]);

  const filteredIgnore = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return registry.ignoreTokens;
    return registry.ignoreTokens.filter((token) => token.toLowerCase().includes(q));
  }, [query, registry.ignoreTokens]);

  async function withUpdate(action: () => Promise<RegistrySnapshotDto>, successMessage: string) {
    setIsPending(true);
    setError(null);
    setStatus(null);
    try {
      const next = await action();
      setRegistry(next);
      setStatus(successMessage);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    } finally {
      setIsPending(false);
    }
  }

  async function handleCreateEntry() {
    const canonicalName = newCanonicalName.trim();
    if (!canonicalName) {
      setError("Canonical name is required.");
      return;
    }

    await withUpdate(async () => {
      const response = await createCampaignRegistryEntryApi(
        campaignSlug,
        {
          category: newCategory,
          canonicalName,
          aliases: normalizeCsvAliases(newAliases),
          notes: newNotes.trim(),
          ...(newCategory === "pcs" && newDiscordUserId.trim()
            ? { discordUserId: newDiscordUserId.trim() }
            : {}),
        },
        searchParams
      );
      return response.registry;
    }, `Added ${canonicalName}.`);

    setNewCanonicalName("");
    setNewAliases("");
    setNewNotes("");
    setNewDiscordUserId("");
  }

  async function handleSaveEntry(entity: RegistryEntityDto) {
    const form = document.getElementById(`edit-form-${entity.id}`) as HTMLFormElement | null;
    if (!form) return;

    const formData = new FormData(form);
    const canonicalName = String(formData.get("canonicalName") ?? "").trim();
    const aliases = normalizeCsvAliases(String(formData.get("aliases") ?? ""));
    const notes = String(formData.get("notes") ?? "").trim();
    const discordUserId = String(formData.get("discordUserId") ?? "").trim();

    await withUpdate(async () => {
      const response = await updateCampaignRegistryEntryApi(
        campaignSlug,
        entity.id,
        {
          category: entity.category,
          canonicalName,
          aliases,
          notes,
          ...(entity.category === "pcs" ? { discordUserId: discordUserId || null } : {}),
        },
        searchParams
      );
      return response.registry;
    }, `Updated ${canonicalName || entity.canonicalName}.`);

    setEditingEntryId(null);
  }

  async function handlePendingAccept(key: string, category: RegistryCategoryKey) {
    await withUpdate(async () => {
      const response = await applyCampaignRegistryPendingActionApi(
        campaignSlug,
        {
          action: "accept",
          key,
          category,
        },
        searchParams
      );
      return response.registry;
    }, "Pending candidate promoted.");
  }

  async function handlePendingReject(key: string) {
    await withUpdate(async () => {
      const response = await applyCampaignRegistryPendingActionApi(
        campaignSlug,
        {
          action: "reject",
          key,
        },
        searchParams
      );
      return response.registry;
    }, "Pending candidate rejected and added to ignore.");
  }

  async function handlePendingDelete(key: string) {
    await withUpdate(async () => {
      const response = await applyCampaignRegistryPendingActionApi(
        campaignSlug,
        {
          action: "delete",
          key,
        },
        searchParams
      );
      return response.registry;
    }, "Pending candidate removed.");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl card-glass p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-serif">Campaign Compendium</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              YAML is the source of truth. This UI applies structured campaign-scoped mutations only.
            </p>
            {!isEditable ? (
              <p className="mt-2 text-xs uppercase tracking-wider text-amber-200/90">
                System demo mode: compendium is read-only.
              </p>
            ) : null}
          </div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Campaign: {registry.campaignSlug}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-7">
          {TABS.map((tab) => (
            <div key={tab.key} className="rounded-md border border-border/60 bg-background/35 px-2 py-1">
              <span className="font-semibold text-foreground">{tab.label}</span>: {categoryCounts[tab.key]}
            </div>
          ))}
        </div>
      </section>

      {isEditable ? (
      <section className="rounded-xl card-glass p-5">
        <h3 className="text-lg font-serif">Add Canonical Entry</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>Category</span>
            <select
              value={newCategory}
              onChange={(event) => setNewCategory(event.currentTarget.value as RegistryCategoryKey)}
              className="control-select w-full rounded-md px-3 py-2"
            >
              <option value="pcs">PCs</option>
              <option value="npcs">NPCs</option>
              <option value="locations">Locations</option>
              <option value="factions">Factions</option>
              <option value="misc">Misc</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Canonical Name</span>
            <input
              value={newCanonicalName}
              onChange={(event) => setNewCanonicalName(event.currentTarget.value)}
              className="control-input w-full rounded-md px-3 py-2"
              placeholder="e.g. Captain Rowan"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span>Aliases (comma-separated)</span>
            <input
              value={newAliases}
              onChange={(event) => setNewAliases(event.currentTarget.value)}
              className="control-input w-full rounded-md px-3 py-2"
              placeholder="Rowan, Captain"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span>Notes</span>
            <input
              value={newNotes}
              onChange={(event) => setNewNotes(event.currentTarget.value)}
              className="control-input w-full rounded-md px-3 py-2"
              placeholder="Optional"
            />
          </label>
          {newCategory === "pcs" ? (
            <label className="space-y-1 text-sm md:col-span-2">
              <span>Discord User ID (PC only)</span>
              <input
                value={newDiscordUserId}
                onChange={(event) => setNewDiscordUserId(event.currentTarget.value)}
                className="control-input w-full rounded-md px-3 py-2"
                placeholder="Optional"
              />
            </label>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleCreateEntry}
          disabled={isPending}
          className="mt-4 rounded-full button-primary px-4 py-2 text-xs font-bold uppercase tracking-wider"
        >
          Add Entry
        </button>
      </section>
      ) : null}

      <section className="rounded-xl card-glass p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                  activeTab === tab.key ? "bg-primary text-primary-foreground cursor-pointer" : "control-button-ghost"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="control-input w-full max-w-xs rounded-md px-3 py-2 text-sm"
            placeholder="Search"
          />
        </div>

        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        {status ? <p className="mt-4 text-sm text-emerald-300">{status}</p> : null}

        {activeTab === "pending" ? (
          <div className="mt-4 space-y-3">
            {filteredPending.length === 0 ? <p className="text-sm text-muted-foreground">No pending candidates.</p> : null}
            {filteredPending.map((item) => (
              <div key={item.key} className="rounded-lg border border-border/60 bg-background/35 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{item.display}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.count} total / {item.primaryCount} primary
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={isPending || !isEditable} onClick={() => handlePendingAccept(item.key, pendingPromoteCategory)} className="control-button-ghost rounded-full px-3 py-1 text-xs uppercase tracking-wider">Accept</button>
                    <button type="button" disabled={isPending || !isEditable} onClick={() => handlePendingReject(item.key)} className="control-button-ghost rounded-full px-3 py-1 text-xs uppercase tracking-wider">Reject</button>
                    <button type="button" disabled={isPending || !isEditable} onClick={() => handlePendingDelete(item.key)} className="control-button-danger rounded-full px-3 py-1 text-xs uppercase tracking-wider">Delete</button>
                  </div>
                </div>
                <label className="mt-2 block text-xs uppercase tracking-wider text-muted-foreground">
                  Promote Category
                  <select
                    value={pendingPromoteCategory}
                    onChange={(event) => setPendingPromoteCategory(event.currentTarget.value as RegistryCategoryKey)}
                    className="control-select mt-1 w-full max-w-xs rounded-md px-2 py-1 text-xs normal-case tracking-normal"
                  >
                    <option value="pcs">PC</option>
                    <option value="npcs">NPC</option>
                    <option value="locations">Location</option>
                    <option value="factions">Faction</option>
                    <option value="misc">Misc</option>
                  </select>
                </label>
                {item.examples.length > 0 ? (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {item.examples.slice(0, 2).map((example, index) => (
                      <p key={`${item.key}-${index}`}>• {example}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : activeTab === "ignore" ? (
          <div className="mt-4">
            {filteredIgnore.length === 0 ? <p className="text-sm text-muted-foreground">No ignored tokens.</p> : null}
            {filteredIgnore.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {filteredIgnore.map((token) => (
                  <span key={token} className="rounded-full border border-border/70 bg-background/40 px-3 py-1 text-xs">
                    {token}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {filteredEntities.length === 0 ? <p className="text-sm text-muted-foreground">No entries in this category.</p> : null}
            {filteredEntities.map((entity) => {
              const isEditing = editingEntryId === entity.id;
              return (
                <div key={entity.id} className="rounded-lg border border-border/60 bg-background/35 p-4">
                  {isEditing ? (
                    <form id={`edit-form-${entity.id}`} className="space-y-2">
                      <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                        Canonical Name
                        <input
                          name="canonicalName"
                          defaultValue={entity.canonicalName}
                          className="control-input mt-1 w-full rounded-md px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                        Aliases (comma-separated)
                        <input
                          name="aliases"
                          defaultValue={entity.aliases.join(", ")}
                          className="control-input mt-1 w-full rounded-md px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                        Notes
                        <input
                          name="notes"
                          defaultValue={entity.notes}
                          className="control-input mt-1 w-full rounded-md px-3 py-2 text-sm"
                        />
                      </label>
                      {entity.category === "pcs" ? (
                        <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                          Discord User ID
                          <input
                            name="discordUserId"
                            defaultValue={entity.discordUserId ?? ""}
                            className="control-input mt-1 w-full rounded-md px-3 py-2 text-sm"
                          />
                        </label>
                      ) : null}
                      <div className="flex gap-2 pt-1">
                        <button type="button" disabled={isPending || !isEditable} onClick={() => handleSaveEntry(entity)} className="rounded-full button-primary px-3 py-1 text-xs uppercase tracking-wider">Save</button>
                          <button type="button" disabled={isPending || !isEditable} onClick={() => setEditingEntryId(null)} className="control-button-ghost rounded-full px-3 py-1 text-xs uppercase tracking-wider">Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{entity.canonicalName}</p>
                        <p className="text-xs text-muted-foreground">{entity.id}</p>
                        {entity.aliases.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">Aliases: {entity.aliases.join(", ")}</p> : null}
                        {entity.notes ? <p className="mt-1 text-xs text-muted-foreground">Notes: {entity.notes}</p> : null}
                        {entity.category === "pcs" && entity.discordUserId ? <p className="mt-1 text-xs text-muted-foreground">Discord: {entity.discordUserId}</p> : null}
                      </div>
                      <button type="button" disabled={isPending || !isEditable} onClick={() => setEditingEntryId(entity.id)} className="control-button-ghost rounded-full px-3 py-1 text-xs uppercase tracking-wider">Edit</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
