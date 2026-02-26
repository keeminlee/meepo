import Database from "better-sqlite3";
import { expect, test } from "vitest";

test("buildTranscript bronze view returns contiguous line_index and provenance", async () => {
  process.env.DISCORD_TOKEN = "test-token";
  process.env.OPENAI_API_KEY = "test-openai-key";

  const { buildTranscript } = await import("../ledger/transcripts.js");

  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE bronze_transcript (
      session_id TEXT NOT NULL,
      line_index INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_ids TEXT NOT NULL,
      compiled_at_ms INTEGER NOT NULL,
      PRIMARY KEY (session_id, line_index)
    );
  `);

  const sessionId = "session-bronze-contract";

  const insert = db.prepare(`
    INSERT INTO bronze_transcript (
      session_id, line_index, author_name, content, timestamp_ms, source_type, source_ids, compiled_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(sessionId, 2, "DM", "Opening scene", 1000, "voice_fused", JSON.stringify(["a1", "a2"]), 2000);
  insert.run(sessionId, 5, "Panda", "Player action", 1001, "voice", JSON.stringify(["a3"]), 2000);

  const transcript = buildTranscript(sessionId, { view: "bronze", primaryOnly: true }, db);

  expect(transcript).toHaveLength(2);
  expect(transcript.map((line) => line.line_index)).toEqual([0, 1]);
  expect(transcript[0]?.source_type).toBe("voice_fused");
  expect(transcript[0]?.source_ids).toEqual(["a1", "a2"]);
  expect(transcript[1]?.source_ids).toEqual(["a3"]);

  db.close();
});
