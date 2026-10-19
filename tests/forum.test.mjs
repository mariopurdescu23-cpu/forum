import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../lib/db.mjs';
import { createApp } from '../lib/app.mjs';
import { hashPassword } from '../lib/security.mjs';

test('RETRO: authenticated workflows, privacy, moderation and persistence',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'retro-forum-test-')),path=join(dir,'test.sqlite');let db=openDatabase(path);let server;const emails=[];
 try{
  server=createServer(createApp(db,{origin:'http://localhost:3000',sendReset:async(email,link)=>emails.push({email,link})}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  class Client{
   cookie='';csrf='';
   async request(path,method='GET',body,headers={}){const r=await fetch(base+'/api'+path,{method,headers:{Origin:'http://localhost:3000',...(this.cookie?{Cookie:this.cookie}:{}),...(this.csrf?{'X-CSRF-Token':this.csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});const cookie=r.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];const data=r.headers.get('content-type')?.includes('application/json')?await r.json():await r.arrayBuffer();if(data.csrf)this.csrf=data.csrf;return {status:r.status,data,headers:r.headers};}
   async login(name){const r=await this.request('/login','POST',{login:name,password:'Strong-password-123!'});assert.equal(r.status,200);return r;}
  }
  const alice=new Client(),bob=new Client(),owner=new Client(),mod=new Client(),helper=new Client(),admin=new Client(),guest=new Client();let aliceId,bobId,helperId,threadId,suggestionId,ticketId,reportId,attachmentId;
  const pass='Strong-password-123!';
  await t.test('registration validates passwords, ignores supplied roles and creates secure sessions',async()=>{
   assert.equal((await alice.request('/register','POST',{username:'Alice',email:'alice@example.test',password:'short',confirm:'short'})).status,400);
   const r=await alice.request('/register','POST',{username:'Alice',email:'alice@example.test',password:pass,confirm:pass,role:'OWNER'});assert.equal(r.status,201);assert.equal(r.data.user.role,'PLAYER');aliceId=r.data.user.id;assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.ok(r.data.csrf);
   const b=await bob.request('/register','POST',{username:'Bob',email:'bob@example.test',password:pass,confirm:pass});assert.equal(b.status,201);bobId=b.data.user.id;
   const stored=db.prepare('SELECT password_hash FROM users WHERE id=?').get(aliceId).password_hash;assert.notEqual(stored,pass);assert.equal(db.prepare('SELECT token FROM sessions WHERE user_id=?').get(aliceId).token===alice.cookie.split('=')[1],false);
   const hash=await hashPassword(pass);for(const [name,role] of [['Owner','OWNER'],['Moderator','MODERATOR'],['Helper','HELPER'],['Admin','ADMIN']])db.prepare('INSERT INTO users(username,email,password_hash,role) VALUES (?,?,?,?)').run(name,name+'@example.test',hash,role);
   helperId=db.prepare("SELECT id FROM users WHERE username='Helper'").get().id;await owner.login('Owner');await mod.login('Moderator');await helper.login('Helper');await admin.login('Admin');
  });
  await t.test('login works with username and email; invalid credentials fail',async()=>{assert.equal((await guest.request('/login','POST',{login:'missing',password:pass})).status,401);assert.equal((await guest.request('/login','POST',{login:'Alice',password:'incorrect'})).status,401);await bob.login('bob@example.test');});
  await t.test('CSRF and untrusted origins are rejected',async()=>{assert.equal((await alice.request('/profile','PATCH',{}, {'X-CSRF-Token':'bad'})).status,403);assert.equal((await alice.request('/profile','PATCH',{}, {Origin:'https://evil.test'})).status,403);assert.equal((await guest.request('/register','POST',{}, {Origin:'https://evil.test'})).status,403);});
  await t.test('server-side profile validation keeps Minecraft names unverified',async()=>{assert.equal((await alice.request('/profile','PATCH',{minecraft:'Retro_Player',bio:'Salut, comunitate!',avatar:''})).status,200);let p=(await bob.request('/users/'+aliceId)).data;assert.equal(p.user.minecraft_verified,false);assert.equal('email' in p.user,false);assert.equal(p.private_counts,null);assert.equal((await alice.request('/profile','PATCH',{minecraft:'Bad name'})).status,400);assert.equal((await alice.request('/profile','PATCH',{minecraft:'Player',avatar:'javascript:alert(1)'})).status,400);});
  await t.test('players create public discussions, but cannot publish announcements',async()=>{
   const r=await alice.request('/threads','POST',{category_id:2,title:'Prima construcție RETRO',body:'Construim împreună o bază pentru comunitate.'});assert.equal(r.status,201);threadId=r.data.id;
   assert.equal((await alice.request('/threads','POST',{category_id:1,title:'Anunț fals',body:'Nu sunt administrator, nu pot publica aici.'})).status,403);
   assert.equal((await owner.request('/threads','POST',{category_id:1,title:'Bine ați venit!',body:'Acesta este anunțul oficial al comunității.'})).status,201);
   assert.equal((await guest.request('/threads','POST',{})).status,401);
  });
  await t.test('search, category filters, pagination and SQL injection strings stay safe',async()=>{
   assert.equal((await guest.request('/threads?q=construc')).data.total,1);assert.equal((await guest.request('/threads?category=announcements')).data.total,1);assert.equal((await guest.request('/threads?page=2')).data.items.length,0);assert.equal((await guest.request('/threads?q='+encodeURIComponent("' OR 1=1 --"))).data.total,0);
  });
  await t.test('reply, notification, edit authorization and moderation locks work',async()=>{
   assert.equal((await bob.request(`/threads/${threadId}/replies`,'POST',{body:'Foarte frumoasă construcția!'})).status,201);assert.equal((await alice.request('/notifications')).data.items.length,1);
   let r=(await alice.request('/threads/'+threadId)).data;const replyId=r.replies[0].id;assert.equal((await alice.request('/replies/'+replyId,'PATCH',{body:'Nu pot edita răspunsul altuia.'})).status,403);
   assert.equal((await bob.request('/replies/'+replyId,'PATCH',{body:'Am actualizat răspunsul meu.'})).status,200);
   assert.equal((await bob.request('/threads/'+threadId,'PATCH',{title:'Titlu furat'})).status,403);assert.equal((await alice.request('/threads/'+threadId,'PATCH',{locked:true})).status,403);
   assert.equal((await mod.request('/threads/'+threadId,'PATCH',{locked:true,pinned:true})).status,200);assert.equal((await alice.request(`/threads/${threadId}/replies`,'POST',{body:'Răspuns blocat'})).status,403);assert.equal((await alice.request('/threads/'+threadId,'DELETE')).status,403);
   assert.equal((await mod.request('/threads/'+threadId,'PATCH',{locked:false})).status,200);
  });
  await t.test('suggestion voting is unique and statuses require moderators',async()=>{const s=await alice.request('/threads','POST',{category_id:3,title:'Un eveniment de construcții',body:'Propun un concurs lunar cu tema aleasă de comunitate.'});suggestionId=s.data.id;await bob.request(`/threads/${suggestionId}/vote`,'POST',{value:1});await bob.request(`/threads/${suggestionId}/vote`,'POST',{value:1});assert.equal((await guest.request('/threads/'+suggestionId)).data.thread.score,1);await bob.request(`/threads/${suggestionId}/vote`,'POST',{value:-1});assert.equal((await guest.request('/threads/'+suggestionId)).data.thread.score,-1);assert.equal((await alice.request('/threads/'+suggestionId,'PATCH',{status:'implemented'})).status,403);assert.equal((await mod.request('/threads/'+suggestionId,'PATCH',{status:'planned'})).status,200);});
  await t.test('tickets and reports are private against guessed IDs and list filters',async()=>{
   const ticket=await alice.request('/cases','POST',{kind:'ticket',category:'Ajutor general',subject:'Nu mă pot conecta',body:'Am o problemă la conectarea pe server și am nevoie de ajutor.'});assert.equal(ticket.status,201);ticketId=ticket.data.id;
   const report=await alice.request('/cases','POST',{kind:'report',category:'Griefing',subject:'O construcție distrusă',player:'OtherPlayer',body:'Construcția mea a fost distrusă și am dovezi despre incident.',evidence:'https://example.test/evidence.png'});reportId=report.data.id;
   for(const id of [ticketId,reportId]){assert.equal((await bob.request('/cases/'+id)).status,404);assert.equal((await guest.request('/cases/'+id)).status,401);assert.equal((await helper.request('/cases/'+id)).status,404);assert.equal((await bob.request(`/cases/${id}/messages`,'POST',{body:'Mesaj neautorizat'})).status,404);}
   assert.equal((await bob.request('/cases')).data.total,0);assert.equal((await bob.request('/cases?staff=1')).status,403);assert.equal((await mod.request('/cases?staff=1')).data.total,2);
  });
  await t.test('helper assignment is scoped and internal notes never leak to players',async()=>{
   assert.equal((await mod.request('/cases/'+ticketId,'PATCH',{assigned_id:helperId,status:'in_progress'})).status,200);assert.equal((await helper.request('/cases/'+ticketId)).status,200);assert.equal((await helper.request('/cases?staff=1')).data.total,1);
   assert.equal((await helper.request('/cases/'+ticketId,'PATCH',{priority:'high'})).status,403);
   assert.equal((await helper.request(`/cases/${ticketId}/messages`,'POST',{body:'Notă confidențială pentru staff.',internal:true})).status,201);
   assert.equal((await alice.request(`/cases/${ticketId}/messages`,'POST',{body:'Notă internă falsă',internal:true})).status,403);
   let r=(await alice.request('/cases/'+ticketId)).data;assert.equal(r.messages.length,0);assert.equal(JSON.stringify(r).includes('confidențială'),false);
   assert.equal((await helper.request(`/cases/${ticketId}/messages`,'POST',{body:'Te rugăm să încerci din nou.',internal:false})).status,201);assert.equal((await alice.request(`/cases/${ticketId}/messages`,'POST',{body:'Acum mă pot conecta. Mulțumesc!'})).status,201);
   r=(await alice.request('/cases/'+ticketId)).data;assert.equal(r.messages.length,2);assert.ok(r.history.length>=2);assert.equal((await helper.request('/cases/'+ticketId)).data.messages.length,3);
   assert.equal((await helper.request('/cases/'+ticketId,'PATCH',{status:'closed'})).status,200);assert.equal((await alice.request(`/cases/${ticketId}/messages`,'POST',{body:'Mesaj după închidere'})).status,403);await mod.request('/cases/'+ticketId,'PATCH',{status:'open'});
  });
  await t.test('report review and appeals update status without game server actions',async()=>{assert.equal((await mod.request('/cases/'+reportId,'PATCH',{status:'resolved',priority:'high'})).status,200);assert.equal((await alice.request('/cases/'+reportId)).data.case.status,'resolved');const appeal={kind:'appeal',category:'Ban',subject:'Contestație sancțiune',player:'Retro_Player',body:'Vreau să explic contextul sancțiunii și să fie reanalizată.'};const r=await alice.request('/cases','POST',appeal);assert.equal(r.status,201);assert.equal((await alice.request('/cases','POST',appeal)).status,429);assert.equal((await mod.request('/cases/'+r.data.id,'PATCH',{status:'accepted'})).status,200);});
  await t.test('attachment validation, private downloads and ownership are enforced',async()=>{
   const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=';
   const r=await alice.request('/attachments','POST',{kind:'case',target_id:ticketId,name:'captura.png',data:png});assert.equal(r.status,201);attachmentId=r.data.id;
   assert.equal((await alice.request('/attachments/'+attachmentId)).status,200);assert.equal((await bob.request('/attachments/'+attachmentId)).status,404);assert.equal((await guest.request('/attachments/'+attachmentId)).status,401);assert.equal((await helper.request('/attachments/'+attachmentId)).status,200);
   assert.equal((await helper.request('/attachments/'+attachmentId,'DELETE')).status,403);assert.equal((await alice.request('/attachments','POST',{kind:'case',target_id:ticketId,name:'evil.png',data:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')})).status,400);
  });
  await t.test('role hierarchy rejects self-escalation and administrators assigning owners',async()=>{
   assert.equal((await alice.request(`/admin/users/${aliceId}/role`,'PATCH',{role:'OWNER'})).status,403);
   const ownerId=db.prepare("SELECT id FROM users WHERE role='OWNER'").get().id;assert.equal((await owner.request(`/admin/users/${ownerId}/role`,'PATCH',{role:'PLAYER'})).status,403);assert.equal((await admin.request(`/admin/users/${bobId}/role`,'PATCH',{role:'OWNER'})).status,403);
   assert.equal((await owner.request(`/admin/users/${bobId}/role`,'PATCH',{role:'HELPER'})).status,200);assert.equal((await bob.request('/bootstrap')).data.user,null);await owner.request(`/admin/users/${bobId}/role`,'PATCH',{role:'PLAYER'});await bob.login('Bob');
  });
  await t.test('admin category/settings edits persist and players cannot make them',async()=>{
   assert.equal((await alice.request('/admin/settings','PATCH',{rules:'Fake rules'})).status,403);
   assert.equal((await owner.request('/admin/settings','PATCH',{rules:'Respectă ceilalți jucători.',discord_url:'https://discord.gg/retro',ticket_categories:['Ajutor general','Conturi']})).status,200);
   assert.deepEqual((await guest.request('/bootstrap')).data.caseCategories.ticket,['Ajutor general','Conturi']);
   const c=await owner.request('/admin/categories','POST',{slug:'events',name:'Evenimente',description:'Evenimente în comunitate',restricted:true});assert.equal(c.status,201);assert.equal((await owner.request('/admin/categories/'+c.data.id,'PATCH',{name:'Evenimente RETRO',description:'Calendar comunitar',restricted:true})).status,200);
   assert.ok((await owner.request('/staff')).data.audit.length>5);assert.equal((await helper.request('/staff')).data.stats.reports,null);assert.equal((await helper.request('/admin/users')).status,403);
  });
  await t.test('notifications can only be read by the owner',async()=>{const a=await alice.request('/notifications'),id=a.data.items[0].id;await bob.request('/notifications/read','POST',{id});assert.equal(db.prepare('SELECT is_read FROM notifications WHERE id=?').get(id).is_read,0);await alice.request('/notifications/read','POST',{});assert.equal((await alice.request('/bootstrap')).data.unread,0);});
  await t.test('password reset uses one-time expiring tokens and revokes sessions',async()=>{
   assert.equal((await guest.request('/forgot','POST',{email:'alice@example.test'})).status,200);assert.equal(emails.length,1);const token=new URL(emails[0].link).hash.slice(1),newPass='Changed-password-123!';assert.equal((await guest.request('/reset','POST',{token,password:newPass,confirm:newPass})).status,200);assert.equal((await alice.request('/bootstrap')).data.user,null);assert.equal((await guest.request('/reset','POST',{token,password:newPass,confirm:newPass})).status,400);assert.equal((await alice.request('/login','POST',{login:'Alice',password:newPass})).status,200);assert.equal((await alice.request('/logout','POST',{})).status,200);assert.equal((await alice.request('/bootstrap')).data.user,null);
  });
  await t.test('HTTP app serves routes/assets with security headers and blocks file disclosure',async()=>{
   for(const asset of ['/app.js?v=20261019-nav1','/styles.css?v=20261019-nav1','/polish.css?v=20261019-nav1']){const response=await fetch(base+asset);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-cache, must-revalidate');}
   const r=await fetch(base+'/forum');assert.equal(r.status,200);assert.match(await r.text(),/lang="ro"/);assert.match(r.headers.get('content-security-policy'),/object-src 'none'/);assert.equal((await fetch(base+'/assets/retro-world.svg')).status,200);assert.equal((await fetch(base+'/server.mjs')).status,404);assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/api/health')).status,200);
  });
  await t.test('rate limits are persistent and enforced',async()=>{for(let i=0;i<11;i++)await guest.request('/login','POST',{login:'NoAccount',password:'wrong'});assert.equal((await guest.request('/login','POST',{login:'NoAccount',password:'wrong'})).status,429);});
  await t.test('data and migrations survive database restart',async()=>{
   await new Promise(r=>server.close(r));server=null;db.close();db=openDatabase(path);assert.equal(db.prepare('SELECT title FROM threads WHERE id=?').get(threadId).title,'Prima construcție RETRO');assert.ok(db.prepare('SELECT id FROM cases WHERE id=?').get(ticketId));assert.ok(db.prepare('SELECT id FROM attachments WHERE id=?').get(attachmentId));assert.equal(db.prepare('SELECT COUNT(*) n FROM migrations').get().n,6);assert.equal(db.prepare('SELECT COUNT(*) n FROM categories').get().n,9);
  });
 }finally{if(server)await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
});
