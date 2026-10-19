CREATE TABLE attachments (
 id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
 thread_id INTEGER REFERENCES threads(id), case_id INTEGER REFERENCES cases(id),
 name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK ((thread_id IS NULL) != (case_id IS NULL))
);
CREATE INDEX attachments_thread ON attachments(thread_id);
CREATE INDEX attachments_case ON attachments(case_id);
CREATE TABLE case_events (
 id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), actor_id INTEGER NOT NULL REFERENCES users(id),
 message TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO settings VALUES ('ticket_categories',''),('report_categories','');
