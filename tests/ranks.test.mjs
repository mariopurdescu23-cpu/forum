import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {openDatabase} from '../lib/db.mjs';
import {createApp} from '../lib/app.mjs';
import {hashPassword} from '../lib/security.mjs';

test('Co-Owner and Super Admin have separate ranks and cannot grant or modify higher ranks',async()=>{
 const db=openDatabase(':memory:'),pass='Staff-test-password-123!',hash=await hashPassword(pass),origin='http://localhost:3000';
 for(const [name,role,staffRank,superAdmin] of [['Owner','OWNER','',0],['CoOwner','ADMIN','CO_OWNER',0],['SuperAdmin','ADMIN','',1],['Admin','ADMIN','',0],['Player','PLAYER','',0]])db.prepare('INSERT INTO users(username,email,password_hash,role,staff_rank,super_admin) VALUES (?,?,?,?,?,?)').run(name,name+'@example.test',hash,role,staffRank,superAdmin);
 const server=createServer(createApp(db,{origin}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 async function client(name){
  const login=await fetch(base+'/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:name,password:pass})});
  assert.equal(login.status,200);const data=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
  return {role:data.user.role,request:async(path,method='GET',body)=>fetch(base+path,{method,headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':data.csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})};
 }
 try{
  const co=await client('CoOwner'),superAdmin=await client('SuperAdmin'),owner=await client('Owner');
  assert.equal(co.role,'CO_OWNER');assert.equal(superAdmin.role,'SUPER_ADMIN');
  for(const c of [co,superAdmin])assert.equal((await c.request('/staff')).status,200);
  assert.equal((await co.request('/admin/users/1/role','PATCH',{role:'PLAYER'})).status,403);
  assert.equal((await co.request('/admin/users/5/role','PATCH',{role:'OWNER'})).status,403);
  assert.equal((await superAdmin.request('/admin/users/2/role','PATCH',{role:'PLAYER'})).status,403);
  assert.equal((await superAdmin.request('/admin/users/5/role','PATCH',{role:'CO_OWNER'})).status,403);
  assert.equal((await co.request('/admin/users/4/role','PATCH',{role:'SUPER_ADMIN'})).status,200);
  assert.equal((await superAdmin.request('/admin/users/5/role','PATCH',{role:'ADMIN'})).status,200);
  assert.equal((await owner.request('/admin/users/5/role','PATCH',{role:'CO_OWNER'})).status,200);
  assert.equal((await (await owner.request('/users/5')).json()).user.role,'CO_OWNER');
 }finally{await new Promise(r=>server.close(r));db.close();}
});
