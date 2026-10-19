CREATE TABLE discord_queue (
 id INTEGER PRIMARY KEY,
 payload TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'pending',
 last_error TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX discord_queue_pending ON discord_queue(state,next_attempt);
