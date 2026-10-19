CREATE TABLE users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'PLAYER' CHECK(role IN ('PLAYER','HELPER','MODERATOR','ADMIN','OWNER')),
 minecraft TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE resets (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE categories (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL, restricted INTEGER NOT NULL DEFAULT 0);
INSERT INTO categories (slug,name,description,restricted) VALUES
 ('announcements','Anunțuri','Noutăți, mentenanță și evenimente oficiale.',1),
 ('general','Discuții generale','Locul în care comunitatea se întâlnește.',0),
 ('suggestions','Sugestii','Idei pentru următorul capitol RETRO.',0),
 ('bugs','Probleme tehnice','Buguri și mecanici care au nevoie de atenție.',0),
 ('gameplay','PvP și gameplay','Strategii, ferme și aventuri împreună.',0),
 ('builds','Construcții și creații','Arată-ne ce ai construit.',0),
 ('guides','Ghiduri și tutoriale','Experiență împărtășită cu alți jucători.',0),
 ('rules','Regulamentul serverului','Regulile publicate de echipa RETRO.',1);
CREATE TABLE threads (
 id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id), author_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'submitted', views INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE replies (id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES threads(id), author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE votes (thread_id INTEGER NOT NULL REFERENCES threads(id), user_id INTEGER NOT NULL REFERENCES users(id), value INTEGER NOT NULL CHECK(value IN (-1,1)), PRIMARY KEY(thread_id,user_id));
CREATE TABLE cases (
 id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('ticket','report','appeal')), author_id INTEGER NOT NULL REFERENCES users(id),
 subject TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL, player TEXT NOT NULL DEFAULT '', incident_date TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal', assigned_id INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE case_messages (id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id), author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, href TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE audit (id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES ('discord_url',''),('rules',''),('privacy',''),('terms','');
CREATE TABLE limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX threads_category ON threads(category_id,deleted,pinned,updated_at);
CREATE INDEX replies_thread ON replies(thread_id,deleted);
CREATE INDEX cases_author ON cases(author_id,kind);
CREATE INDEX notifications_user ON notifications(user_id,is_read);
CREATE INDEX case_messages_case ON case_messages(case_id,internal);
