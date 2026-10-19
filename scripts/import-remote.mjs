import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openRemoteDatabase} from '../lib/remote-db.mjs';

// Import schema and data together. Refuse any destination that already has tables.
export async function importDatabase(sourcePath,remote) {
 const source=new DatabaseSync(resolve(sourcePath),{readOnly:true});
 const tx=await remote.client.transaction('write');
 try {
  if((await tx.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.length)throw Error('Destination is not empty; import refused.');
  const schema=source.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,rowid").all();
  // Deferred foreign keys let self-references and dependent tables load in one transaction.
  await tx.execute('PRAGMA defer_foreign_keys=ON');
  for(const item of schema.filter(s=>s.type==='table'))await tx.execute(item.sql);
  for(const table of schema.filter(s=>s.type==='table')) {
   const name='"'+table.name.replaceAll('"','""')+'"';
   const rows=source.prepare(`SELECT * FROM ${name}`).all();
   for(const row of rows) {
    const columns=Object.keys(row).map(k=>'"'+k.replaceAll('"','""')+'"').join(',');
    await tx.execute({sql:`INSERT INTO ${name} (${columns}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`,args:Object.values(row).map(v=>Buffer.isBuffer(v)?new Uint8Array(v):v)});
   }
  }
  for(const item of schema.filter(s=>s.type!=='table'))await tx.execute(item.sql);
  if((await tx.execute('PRAGMA foreign_key_check')).rows.length)throw Error('Foreign key validation failed.');
  await tx.commit();
 } catch(error){await tx.rollback();throw error;}finally{tx.close();source.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const db=await openRemoteDatabase();
 try{await importDatabase(process.argv[2]||'./data/forum.sqlite',db);console.log('Existing database imported.');}finally{db.close();}
}
