import { openDatabase } from '../lib/db.mjs';
const db = openDatabase(process.env.DATABASE_PATH || './data/forum.sqlite');
console.log('Migrările sunt aplicate.'); db.close();
