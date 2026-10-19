import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.batch = statements => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const results=statements.map(({sql,args=[]})=>db.prepare(sql).run(...args));
      db.exec('COMMIT');return results;
    }catch(error){db.exec('ROLLBACK');throw error;}
  };
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT name FROM migrations WHERE name=?').get(name)) continue;
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(readFileSync(resolve(dir, name), 'utf8')); db.prepare('INSERT INTO migrations VALUES (?)').run(name); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return db;
}
