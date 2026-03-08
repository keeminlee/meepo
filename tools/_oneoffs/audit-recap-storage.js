const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const root = path.resolve(__dirname, "..", "..", "data", "campaigns");
const dirs = fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

for (const slug of dirs) {
  const files = ["db.sqlite", "campaign.sqlite", "bot.sqlite"];
  let dbPath = null;
  for (const f of files) {
    const p = path.join(root, slug, f);
    if (fs.existsSync(p)) {
      dbPath = p;
      break;
    }
  }
  if (!dbPath) continue;

  const db = new Database(dbPath, { readonly: true });
  const hasSessions = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()
  );
  const hasRecaps = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_recaps'").get()
  );

  let sessionCount = 0;
  let recapCount = 0;
  let overlap = 0;

  if (hasSessions) {
    sessionCount = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c || 0;
  }
  if (hasRecaps) {
    recapCount = db.prepare("SELECT COUNT(*) AS c FROM session_recaps").get().c || 0;
  }
  if (hasSessions && hasRecaps) {
    overlap = db
      .prepare("SELECT COUNT(*) AS c FROM session_recaps r JOIN sessions s ON s.session_id = r.session_id")
      .get().c || 0;
  }

  let recent = [];
  if (hasRecaps) {
    recent = db
      .prepare("SELECT session_id, updated_at_ms FROM session_recaps ORDER BY updated_at_ms DESC LIMIT 5")
      .all();
  }

  console.log(
    JSON.stringify({
      slug,
      dbPath,
      hasSessions,
      hasRecaps,
      sessionCount,
      recapCount,
      overlap,
      recent,
    })
  );

  db.close();
}
