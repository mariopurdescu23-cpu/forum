import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp} from '../lib/app.mjs';
import {openDatabase} from '../lib/db.mjs';
import {forumActivity} from '../lib/activity.mjs';

test('successful actions notify Discord once; failed requests and reads do not',async()=>{
 const db=openDatabase(':memory:'),events=[];
 const origin='http://localhost:3000';
 const server=createServer(createApp(db,{origin,discord:{enqueueActivity:async e=>events.push(e)}}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  let r=await fetch(base+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'TestUser',email:'private@example.test',password:'private-password-123!',confirm:'private-password-123!'})});
  const cookie=r.headers.get('set-cookie').split(';')[0],data=await r.json();
  assert.equal(r.status,201);assert.equal(events.length,1);
  const headers={Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':data.csrf};
  r=await fetch(base+'/api/threads',{method:'POST',headers,body:JSON.stringify({category_id:2,title:'A safe test title',body:'Private body should never be sent to Discord.'})});
  const thread=await r.json();assert.equal(r.status,201);
  assert.equal(events.at(-1).href,`/thread/${thread.id}`);
  r=await fetch(base+'/api/threads',{method:'POST',headers,body:JSON.stringify({category_id:1,title:'Forbidden announcement',body:'Player cannot publish an announcement.'})});
  assert.equal(r.status,403);assert.equal(events.length,2);
  await fetch(base+'/api/bootstrap',{headers});assert.equal(events.length,2);
  assert.ok(!JSON.stringify(events).includes('private'));
  r=await fetch(base+'/api/cases',{method:'POST',headers,body:JSON.stringify({kind:'ticket',category:'Ajutor general',subject:'A test ticket',body:'This is the body of a support ticket.'})});
  assert.equal(r.status,201);assert.equal(events.length,3);
  assert.equal(events.at(-1).label,'Cerere noua');
 }finally{await new Promise(r=>server.close(r));db.close();}
});

test('activity covers content, account and moderation operations',()=>{
 for(const [method,path] of [['POST','/api/login'],['POST','/api/logout'],['POST','/api/reset'],['PATCH','/api/profile'],['POST','/api/threads/1/replies'],['POST','/api/threads/1/vote'],['DELETE','/api/threads/1'],['PATCH','/api/replies/1'],['DELETE','/api/replies/1'],['PATCH','/api/cases/1'],['POST','/api/cases/1/messages'],['POST','/api/attachments'],['DELETE','/api/attachments/1'],['PATCH','/api/admin/users/1/role'],['POST','/api/admin/categories'],['PATCH','/api/admin/categories/1'],['PATCH','/api/admin/settings']]) {
  assert.ok(forumActivity(method,path,{id:1},{id:2}),`${method} ${path}`);
 }
 assert.equal(forumActivity('GET','/api/threads',{},null),null);
 assert.equal(forumActivity('POST','/api/forgot',{},null),null);
});
