import { openDatabase } from '../lib/db.mjs';
const username = process.argv[2];
if (!username) { console.error('Utilizare: npm run owner -- nume-utilizator (cont înregistrat anterior)'); process.exit(1); }
const db = openDatabase(process.env.DATABASE_PATH || './data/forum.sqlite');
const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
if (!user) { console.error('Contul nu există. Înregistrează-l mai întâi în forum.'); db.close(); process.exit(1); }
db.exec('BEGIN IMMEDIATE');
try {
 if (db.prepare("SELECT id FROM users WHERE role='OWNER'").get()) throw new Error('Există deja un OWNER. Folosește panoul de administrare.');
 db.prepare("UPDATE users SET role='OWNER' WHERE id=?").run(user.id);
 db.prepare('INSERT INTO audit(actor_id,action,target) VALUES (?,?,?)').run(user.id,'bootstrap_owner',String(user.id));
 db.exec('COMMIT'); console.log('Primul OWNER a fost atribuit contului indicat.');
} catch(e) { db.exec('ROLLBACK'); console.error(e.message); process.exitCode=1; }
db.close();
