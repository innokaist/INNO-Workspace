CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_updated_at ON tasks(updated_at DESC);

CREATE TABLE IF NOT EXISTS usage (
  provider TEXT PRIMARY KEY,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO metadata (key, value) VALUES ('revision', 0);
