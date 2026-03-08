const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const repoRoot = path.resolve(__dirname, "..", "..");
const root = path.resolve(repoRoot, "data", "campaigns");
const dirs = fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

const dbTargets = [];

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
  dbTargets.push({ kind: "campaign", slug, dbPath });
}

for (const rel of ["data/bot.sqlite", "data/control/control.sqlite"]) {
  const dbPath = path.resolve(repoRoot, rel);
  if (fs.existsSync(dbPath)) {
    dbTargets.push({ kind: "global", slug: rel, dbPath });
  }
}

for (const target of dbTargets) {
  const { dbPath } = target;

  const db = new Database(dbPath, { readonly: true });
  const hasSessions = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()
  );
  const hasRecaps = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_recaps'").get()
  );
  const hasMeecaps = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meecaps'").get()
  );
  const hasSessionArtifacts = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_artifacts'").get()
  );

  let sessionCount = 0;
  let recapCount = 0;
  let overlap = 0;
  let meecapCount = 0;
  let recapArtifactCount = 0;

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
  if (hasMeecaps) {
    meecapCount = db.prepare("SELECT COUNT(*) AS c FROM meecaps").get().c || 0;
  }
  if (hasSessionArtifacts) {
    recapArtifactCount =
      db
        .prepare("SELECT COUNT(*) AS c FROM session_artifacts WHERE artifact_type = 'recap_final'")
        .get().c || 0;
  }

  let recent = [];
  let recentArtifacts = [];
  let recentMeecaps = [];
  if (hasRecaps) {
    recent = db
      .prepare("SELECT session_id, updated_at_ms FROM session_recaps ORDER BY updated_at_ms DESC LIMIT 5")
      .all();
  }
  if (hasSessionArtifacts) {
    recentArtifacts = db
      .prepare(
        "SELECT session_id, strategy, created_at_ms FROM session_artifacts WHERE artifact_type = 'recap_final' ORDER BY created_at_ms DESC LIMIT 5"
      )
      .all();
  }
  if (hasMeecaps) {
    recentMeecaps = db
      .prepare("SELECT session_id, updated_at_ms FROM meecaps ORDER BY updated_at_ms DESC LIMIT 5")
      .all();
  }

  console.log(
    JSON.stringify({
      kind: target.kind,
      slug: target.slug,
      dbPath,
      hasSessions,
      hasRecaps,
      hasMeecaps,
      hasSessionArtifacts,
      sessionCount,
      recapCount,
      overlap,
      meecapCount,
      recapArtifactCount,
      recent,
      recentArtifacts,
      recentMeecaps,
    })
  );

  db.close();
}
