import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../lib/db.mjs';
import {openRemoteDatabase} from '../lib/remote-db.mjs';
import {importDatabase} from '../scripts/import-remote.mjs';

test('existing SQLite data, schema and blobs import without overwriting a destination',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forum-import-'));
 const path=join(dir,'source.sqlite'),source=openDatabase(path);
 const remote=await openRemoteDatabase({url:'file::memory:'});
 try {
  source.prepare("INSERT INTO users(username,email,password_hash,role) VALUES ('Owner','owner@example.test','existing-hash','OWNER')").run();
  source.prepare("INSERT INTO cases(kind,author_id,subject,category,body,status) VALUES ('ticket',1,'Existing ticket','Ajutor general','Existing body','open')").run();
  source.prepare("INSERT INTO attachments(owner_id,case_id,name,mime,data) VALUES (1,1,'image.png','image/png',?)").run(Buffer.from([1,2,3,4]));
  await importDatabase(path,remote);
  assert.equal((await remote.prepare('SELECT password_hash FROM users WHERE id=1').get()).password_hash,'existing-hash');
  assert.equal((await remote.prepare('SELECT subject FROM cases WHERE id=1').get()).subject,'Existing ticket');
  assert.deepEqual(Buffer.from((await remote.prepare('SELECT data FROM attachments WHERE id=1').get()).data),Buffer.from([1,2,3,4]));
  await assert.rejects(importDatabase(path,remote),/not empty/);
  assert.equal((await remote.prepare('SELECT COUNT(*) n FROM cases').get()).n,1);
 }finally{remote.close();source.close();rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
