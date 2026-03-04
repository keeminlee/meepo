type SessionCategory = "official-canon" | "lab-canon" | "non-canon";

type SessionRow = {
  session_id: string;
  guild_id: string;
  kind: string;
  mode_at_start: string;
  label: string | null;
  started_at_ms: number;
  channel_id?: string | null;
};

type AnchorRow = {
  id: string;
  content: string;
};

export type CommandChoice = {
  name: string;
  value: string;
};

export type ResolveSessionSelectionResult = {
  sessionId: string;
  usedDefault: boolean;
  displayName: string;
};

function requireDb(args: { guildId: string; guildName?: string | null; db?: any }): any {
  if (args.db) return args.db;
  throw new Error("sessionResolve requires args.db");
}

function hasSessionChannelColumn(db: any): boolean {
  try {
    const cols = db.pragma("table_info(sessions)") as Array<{ name: string }>;
    return cols.some((col) => col.name === "channel_id");
  } catch {
    return false;
  }
}

function classifySession(row: SessionRow): SessionCategory {
  if (row.kind === "canon" && row.mode_at_start !== "lab") return "official-canon";
  if (row.kind === "canon" && row.mode_at_start === "lab") return "lab-canon";
  return "non-canon";
}

function formatDateTime(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatSessionDisplayName(row: SessionRow): string {
  const category = classifySession(row);
  const prefix = category === "lab-canon"
    ? "(dev) "
    : category === "non-canon"
      ? "(noncanon) "
      : "";
  const datePart = formatDateTime(row.started_at_ms);
  const channelPart = row.channel_id ? `#${row.channel_id}` : "#—";
  const labelPart = (row.label ?? "").trim() || "(unlabeled)";
  return `${prefix}${datePart} • ${channelPart} • ${labelPart}`.slice(0, 100);
}

function fetchSessionRows(db: any, guildId: string, limit = 50): SessionRow[] {
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const withChannel = hasSessionChannelColumn(db);
  if (withChannel) {
    return db.prepare(
      `SELECT session_id, guild_id, kind, mode_at_start, label, started_at_ms, channel_id
       FROM sessions
       WHERE guild_id = ?
       ORDER BY started_at_ms DESC
       LIMIT ?`
    ).all(guildId, bounded) as SessionRow[];
  }

  return db.prepare(
    `SELECT session_id, guild_id, kind, mode_at_start, label, started_at_ms
     FROM sessions
     WHERE guild_id = ?
     ORDER BY started_at_ms DESC
     LIMIT ?`
  ).all(guildId, bounded) as SessionRow[];
}

function findSessionById(rows: SessionRow[], sessionId: string): SessionRow | null {
  const normalized = sessionId.trim();
  if (!normalized) return null;
  return rows.find((row) => row.session_id === normalized) ?? null;
}

function findDefaultOfficialSession(args: { rows: SessionRow[]; channelId?: string | null; hasChannelColumn: boolean }): SessionRow | null {
  const official = args.rows.filter((row) => classifySession(row) === "official-canon");
  if (official.length === 0) return null;

  if (args.hasChannelColumn && args.channelId) {
    const inChannel = official.find((row) => row.channel_id === args.channelId);
    if (inChannel) return inChannel;
  }

  return official[0] ?? null;
}

export function resolveSessionSelection(args: {
  guildId: string;
  guildName?: string | null;
  channelId?: string | null;
  sessionOpt?: string | null;
  db?: any;
}): ResolveSessionSelectionResult | null {
  const db = requireDb(args);
  const rows = fetchSessionRows(db, args.guildId, 100);
  const hasChannelColumn = hasSessionChannelColumn(db);

  const provided = (args.sessionOpt ?? "").trim();
  if (provided) {
    const row = findSessionById(rows, provided);
    if (!row) return null;
    return {
      sessionId: row.session_id,
      usedDefault: false,
      displayName: formatSessionDisplayName(row),
    };
  }

  const fallback = findDefaultOfficialSession({
    rows,
    channelId: args.channelId,
    hasChannelColumn,
  });
  if (!fallback) return null;
  return {
    sessionId: fallback.session_id,
    usedDefault: true,
    displayName: formatSessionDisplayName(fallback),
  };
}

export function resolveSessionId(args: {
  guildId: string;
  guildName?: string | null;
  channelId?: string | null;
  sessionOpt?: string | null;
  db?: any;
}): string | null {
  return resolveSessionSelection(args)?.sessionId ?? null;
}

export function listSessionsForAutocomplete(args: {
  guildId: string;
  guildName?: string | null;
  channelId?: string | null;
  query?: string;
  db?: any;
}): CommandChoice[] {
  const db = requireDb(args);
  const rows = fetchSessionRows(db, args.guildId, 60);
  const query = (args.query ?? "").trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (!query) return true;
    const category = classifySession(row);
    const tag = category === "lab-canon" ? "dev" : category === "non-canon" ? "noncanon" : "canon";
    const label = (row.label ?? "").toLowerCase();
    return row.session_id.toLowerCase().includes(query)
      || label.includes(query)
      || tag.includes(query)
      || formatDateTime(row.started_at_ms).toLowerCase().includes(query);
  });

  return filtered
    .slice(0, 25)
    .map((row) => ({
      name: formatSessionDisplayName(row),
      value: row.session_id,
    }));
}

function fetchUserAnchorRows(db: any, guildId: string, sessionId: string, limit = 80): AnchorRow[] {
  const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
  return db.prepare(
    `SELECT id, content
     FROM ledger_entries
     WHERE guild_id = ?
       AND session_id = ?
       AND source <> 'system'
       AND TRIM(content) <> ''
       AND LOWER(COALESCE(author_id, '')) NOT LIKE 'meepo%'
       AND LOWER(COALESCE(author_name, '')) NOT LIKE 'meepo%'
     ORDER BY timestamp_ms DESC, id DESC
     LIMIT ?`
  ).all(guildId, sessionId, bounded) as AnchorRow[];
}

export function resolveLatestUserAnchorLedgerId(args: {
  guildId: string;
  guildName?: string | null;
  sessionId: string;
  db?: any;
}): string | null {
  const db = requireDb(args);
  const row = fetchUserAnchorRows(db, args.guildId, args.sessionId, 1)[0];
  return row?.id ?? null;
}

export function listAnchorsForAutocomplete(args: {
  guildId: string;
  guildName?: string | null;
  sessionId: string;
  query?: string;
  db?: any;
}): CommandChoice[] {
  const db = requireDb(args);
  const query = (args.query ?? "").trim().toLowerCase();
  const rows = fetchUserAnchorRows(db, args.guildId, args.sessionId, 80);

  const filtered = rows.filter((row) => {
    if (!query) return true;
    return row.id.toLowerCase().includes(query) || row.content.toLowerCase().includes(query);
  });

  return filtered
    .slice(0, 25)
    .map((row) => {
      const collapsed = row.content.replace(/\s+/g, " ").trim();
      const snippet = collapsed.length > 48 ? `${collapsed.slice(0, 48)}…` : collapsed;
      return {
        name: `${row.id} — "${snippet}"`.slice(0, 100),
        value: row.id,
      };
    });
}
