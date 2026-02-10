import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

let dbSingleton: Database.Database | null = null;

function ensureDirFor(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getDb(): Database.Database {
  if (dbSingleton) return dbSingleton;

  const dbPath = process.env.DB_PATH || "./data/bot.sqlite";
  ensureDirFor(dbPath);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // apply schema
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);

  dbSingleton = db;
  return dbSingleton;
}
