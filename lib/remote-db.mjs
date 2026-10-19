import {createClient} from '@libsql/client';
import {readdir,readFile} from 'node:fs/promises';

export function adaptClient(client) {
 return {
  prepare(sql) {
   const execute=(args)=>client.execute({sql,args:args.map(v=>Buffer.isBuffer(v)?new Uint8Array(v):v)});
   return {
    async get(...args){return (await execute(args)).rows[0];},
    async all(...args){return (await execute(args)).rows;},
    async run(...args){const r=await execute(args);return {lastInsertRowid:r.lastInsertRowid,changes:r.rowsAffected};}
   };
  },
  close(){client.close();},
  async batch(statements){return (await client.batch(statements,'write')).map(r=>({changes:r.rowsAffected,lastInsertRowid:r.lastInsertRowid}));},
  client
 };
}

export async function migrateRemote(client) {
 await client.execute('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
 const dir=new URL('../migrations/',import.meta.url);
 for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) {
  const tx=await client.transaction('write');
  try {
   if(!(await tx.execute({sql:'SELECT name FROM migrations WHERE name=?',args:[name]})).rows.length){
    await tx.executeMultiple(await readFile(new URL(name,dir),'utf8'));
    await tx.execute({sql:'INSERT INTO migrations VALUES (?)',args:[name]});
   }
   await tx.commit();
  } catch(error){await tx.rollback();throw error;} finally{tx.close();}
 }
}

export async function openRemoteDatabase({url=process.env.TURSO_DATABASE_URL,authToken=process.env.TURSO_AUTH_TOKEN,migrate=false}={}) {
 if(!url)throw Error('Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
 const client=createClient({url,authToken,intMode:'number'});
 if(migrate)await migrateRemote(client);
 return adaptClient(client);
}
