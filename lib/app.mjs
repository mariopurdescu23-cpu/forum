import {forumActivity} from './activity.mjs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomToken, digest, hashPassword, checkPassword, fail, text, choice, url, password, rank, roles } from './security.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const now = () => new Date().toISOString();
export const caseCategories = {
 ticket: ['Ajutor general', 'Probleme cu contul', 'Magazin și cumpărături', 'Probleme tehnice', 'Asistență în joc', 'Altele'],
 report: ['Cheating / Hacking', 'Exploatarea bugurilor', 'Griefing', 'Hărțuire', 'Înșelătorie', 'Comportament nepotrivit', 'Altele'],
 appeal: ['Ban', 'Mute', 'Altele']
};
const statuses = {ticket:['open','in_progress','waiting','closed'],report:['pending','reviewing','resolved','rejected'],appeal:['pending','reviewing','accepted','denied']};
const suggestionStatuses = ['submitted','considering','planned','development','implemented','rejected'];
const publicUser = u => ({id:u.id,username:u.username,role:u.role,minecraft:u.minecraft,bio:u.bio,avatar:u.avatar,created_at:u.created_at,minecraft_verified:false});
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};

export function createApp(db, config = {}) {
 const origin = config.origin || process.env.APP_ORIGIN || 'http://localhost:3000';
 const secure = config.secure ?? process.env.COOKIE_SECURE === 'true';
 const get = (sql,...args) => db.prepare(sql).get(...args);
 const all = (sql,...args) => db.prepare(sql).all(...args);
 const run = (sql,...args) => db.prepare(sql).run(...args);
 const categoriesForCases = async () => {
  const result={...caseCategories};
  for(const kind of ['ticket','report']){const saved=(await get('SELECT value FROM settings WHERE key=?',kind+'_categories'))?.value;if(saved)result[kind]=JSON.parse(saved);}
  return result;
 };
 const attachmentsFor = async (kind,id) => (await all(`SELECT id,name,mime,owner_id,created_at FROM attachments WHERE ${kind==='thread'?'thread_id':'case_id'}=? ORDER BY id`,id));
 const audit = async (user, action, target, details = '') => (await run('INSERT INTO audit(actor_id,action,target,details) VALUES (?,?,?,?)',user.id,action,String(target),details));
 const notify = async (userId,title,href) => (await run('INSERT INTO notifications(user_id,title,href) VALUES (?,?,?)',userId,title,href));
 const requireUser = user => { if (!user) fail(401,'Conectează-te pentru a continua.'); return user; };
 const requireRole = (user, minimum) => { requireUser(user); if (rank(user)<roles.indexOf(minimum)) fail(403,'Nu ai permisiunea necesară.'); };
 const canCase = (user,c) => !!user && (user.id===c.author_id || rank(user)>=2 || (user.role==='HELPER' && c.kind==='ticket' && c.assigned_id===user.id));
 const staffCase = (user,c) => !!user && (rank(user)>=2 || (user.role==='HELPER' && c.kind==='ticket' && c.assigned_id===user.id));
 async function limit(key, max, seconds) {
  const time=Date.now();
  (await run('DELETE FROM limits WHERE expires_at<?',time));
  (await run('INSERT INTO limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,time+seconds*1000));
  if((await get('SELECT count FROM limits WHERE key=?',key)).count>max) fail(429,'Prea multe încercări. Revino puțin mai târziu.');
 }
 async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415,'Trimite datele în format JSON.');
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>(req.url==='/api/attachments'?2900000:100000)) fail(413,'Conținutul este prea mare.'); chunks.push(chunk); }
  try { const b=JSON.parse(Buffer.concat(chunks).toString('utf8')); if(!b||typeof b!=='object'||Array.isArray(b)) throw Error(); return b; } catch { fail(400,'Datele trimise nu sunt valide.'); }
 }
 async function session(req) {
  const token=(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('retro_session='))?.slice(14);
  if(!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (await get('SELECT u.*,s.csrf,s.token session_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?',digest(token),Date.now()));
 }
 async function setSession(res,userId) {
  const token=randomToken(), csrf=randomToken();
  (await run('DELETE FROM sessions WHERE expires_at<?',Date.now()));
  (await run('INSERT INTO sessions VALUES (?,?,?,?)',digest(token),userId,csrf,Date.now()+30*86400000));
  res.setHeader('Set-Cookie',`retro_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure?'; Secure':''}`);
  return csrf;
 }
 async function sendReset(email,link) {
  if(config.sendReset) return config.sendReset(email,link);
  if(!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],subject:'Resetează parola RETRO SMP',text:`Ai solicitat resetarea parolei. Linkul expiră în 30 de minute:\n${link}\nDacă nu ai trimis cererea, ignoră acest mesaj.`}),signal:AbortSignal.timeout(8000)});
  if(!response.ok) throw Error('Email delivery failed');
 }
 async function staffNotify(c) {
  for(const u of (await all("SELECT id FROM users WHERE role IN ('MODERATOR','ADMIN','OWNER')"))) (await notify(u.id,`Cerere nouă #${c.id}: ${c.kind==='ticket'?'tichet':c.kind==='report'?'raport':'contestație'}`,`/cases/${c.id}`));

 }
 function page(url) { return Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page')||'1',10)||1)); }
 async function thread(id) {const t=(await get('SELECT t.*,u.username,c.slug,c.name category_name FROM threads t JOIN users u ON u.id=t.author_id JOIN categories c ON c.id=t.category_id WHERE t.id=? AND t.deleted=0',id));if(!t)fail(404,'Discuția nu există.');return t;}
 async function privateCase(id,user) {requireUser(user);const c=(await get('SELECT c.*,u.username,a.username assigned_name FROM cases c JOIN users u ON u.id=c.author_id LEFT JOIN users a ON a.id=c.assigned_id WHERE c.id=?',id));if(!c||!canCase(user,c))fail(404,'Cererea nu există sau nu îți este accesibilă.');return c;}
 const threadSummary = `SELECT t.*,u.username,c.slug,c.name category_name,(SELECT COUNT(*) FROM replies r WHERE r.thread_id=t.id AND r.deleted=0) reply_count,COALESCE((SELECT SUM(value) FROM votes v WHERE v.thread_id=t.id),0) score FROM threads t JOIN users u ON u.id=t.author_id JOIN categories c ON c.id=t.category_id`;

 return async function handler(req,res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  let activityUser=null;
  const send=async(data,status=200)=>{
   if(status<400&&config.discord?.enqueueActivity){
    const event=forumActivity(req.method,new URL(req.url,origin).pathname,data,activityUser);
    if(event)try{await config.discord.enqueueActivity(event);}catch{console.error('Discord: activitatea nu a putut fi adaugata in coada.');}
   }
   res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));
  };
  try {
   const u=new URL(req.url,origin), path=u.pathname, method=req.method;
   if(!path.startsWith('/api/')) {
    if(method!=='GET'&&method!=='HEAD')fail(405,'Metodă neacceptată.');
    const shared=path.startsWith('/assets/');
    const base=shared?resolve(root,'public/assets'):resolve(root,'public');
    const relative=shared?decodeURIComponent(path.slice(8)):decodeURIComponent(path.slice(1));
    if(relative.split(/[\\/]/).some(part=>part.startsWith('.')))fail(404,'Fișier inexistent.');
    let file=resolve(base,relative || 'index.html');
    if(!file.startsWith(base+sep))fail(404,'Fișier inexistent.');
    if(!shared&&!extname(file)) file=resolve(base,'index.html');
    if(!mime[extname(file)])fail(404,'Fișier inexistent.');
    try { if(!(await stat(file)).isFile())fail(404,'Fișier inexistent.'); const data=await readFile(file);res.setHeader('Content-Type',mime[extname(file)]);res.setHeader('Cache-Control',['.html','.js','.css'].includes(extname(file))?'no-cache, must-revalidate':'public, max-age=3600');res.end(method==='HEAD'?undefined:data);return;}catch(e){if(e.code==='ENOENT')fail(404,'Fișier inexistent.');throw e;}
   }
   res.setHeader('Cache-Control','no-store');
   if(path==='/api/health'&&method==='GET') return send({ok:!!(await get('SELECT 1 ok'))});
   const user=(await session(req));activityUser=user;
   const clientIP=config.clientIP?.(req)||req.socket.remoteAddress;
   if(!['GET','HEAD'].includes(method)) {
    // Both Origin and a per-session token are required for authenticated writes.
    if(req.headers.origin!==origin)fail(403,'Originea cererii nu este permisă.');
    if(user&&req.headers['x-csrf-token']!==user.csrf)fail(403,'Sesiunea formularului a expirat. Reîncarcă pagina.');
    (await limit(`write:${user?.id || clientIP}`,120,60));
   }
   if(path==='/api/bootstrap'&&method==='GET') return send({user:user?{...publicUser(user),email:user.email}:null,csrf:user?.csrf||null,categories:(await all('SELECT c.*,(SELECT COUNT(*) FROM threads t WHERE t.category_id=c.id AND t.deleted=0) thread_count FROM categories c')),settings:Object.fromEntries((await all('SELECT * FROM settings')).map(s=>[s.key,s.value])),caseCategories:(await categoriesForCases()),stats:{users:(await get('SELECT COUNT(*) n FROM users')).n,threads:(await get('SELECT COUNT(*) n FROM threads WHERE deleted=0')).n},unread:user?(await get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND is_read=0',user.id)).n:0,password_reset_available:!!(config.sendReset || (process.env.RESEND_API_KEY&&process.env.MAIL_FROM))});
   if(path==='/api/register'&&method==='POST') {
    (await limit(`register:${clientIP}`,5,3600));const b=await body(req);
    const username=text(b.username,'Nume',3,24);if(!/^[\p{L}\p{N}_-]+$/u.test(username))fail(400,'Numele poate conține litere, cifre, _ și -.');
    const email=text(b.email,'Email',3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Adresa de email nu este validă.');
    const pass=password(b.password);if(pass!==b.confirm)fail(400,'Parolele nu coincid.');
    const hash=await hashPassword(pass);
    if((await get('SELECT id FROM users WHERE username=? OR email=?',username,email)))fail(409,'Numele sau adresa de email este deja folosită.');
    const id=Number((await run('INSERT INTO users(username,email,password_hash) VALUES (?,?,?)',username,email,hash)).lastInsertRowid);
    return send({csrf:(await setSession(res,id)),user:publicUser((await get('SELECT * FROM users WHERE id=?',id)))},201);
   }
   if(path==='/api/login'&&method==='POST') {
    (await limit(`login-ip:${clientIP}`,25,900));const b=await body(req);const login=text(b.login,'Email sau nume',1,254);(await limit(`login-user:${digest(login.toLowerCase())}`,10,900));
    const candidate=(await get('SELECT * FROM users WHERE username=? OR email=?',login,login));
    const pass=typeof b.password==='string'&&b.password.length<=128?b.password:'';
    // Same-cost verification for unknown accounts.
    const valid=await checkPassword(pass,candidate?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if(!candidate||!valid)fail(401,'Numele sau parola este incorectă.');
    if(user)(await run('DELETE FROM sessions WHERE token=?',user.session_token));
    return send({csrf:(await setSession(res,candidate.id)),user:publicUser(candidate)});
   }
   if(path==='/api/logout'&&method==='POST') {requireUser(user);(await run('DELETE FROM sessions WHERE token=?',user.session_token));res.setHeader('Set-Cookie',`retro_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?'; Secure':''}`);return send({ok:true});}
   if(path==='/api/forgot'&&method==='POST') {
    (await limit(`forgot:${clientIP}`,5,3600));const b=await body(req);const email=text(b.email,'Email',3,254);
    if(!config.sendReset&&!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM))fail(503,'Resetarea prin email nu este configurată. Contactează administratorul.');
    const account=(await get('SELECT id,email FROM users WHERE email=?',email));
    if(account){const token=randomToken();(await run('DELETE FROM resets WHERE user_id=? OR expires_at<?',account.id,Date.now()));(await run('INSERT INTO resets VALUES (?,?,?)',digest(token),account.id,Date.now()+1800000));try{await sendReset(account.email,`${origin}/reset#${token}`);}catch{console.error('Emailul de resetare nu a putut fi trimis.');}}
    return send({message:'Dacă adresa aparține unui cont, vei primi un link de resetare.'});
   }
   if(path==='/api/reset'&&method==='POST') {
    (await limit(`reset:${clientIP}`,10,900));const b=await body(req);const token=text(b.token,'Token',64,64),pass=password(b.password);if(pass!==b.confirm)fail(400,'Parolele nu coincid.');
    const hash=await hashPassword(pass);
    const reset=(await get('SELECT * FROM resets WHERE token=? AND expires_at>?',digest(token),Date.now()));if(!reset)fail(400,'Linkul a expirat sau a fost folosit. Solicită unul nou.');
    const tokenHash=digest(token),time=Date.now();
    const changes=await db.batch([
     {sql:'UPDATE users SET password_hash=? WHERE id=(SELECT user_id FROM resets WHERE token=? AND expires_at>?)',args:[hash,tokenHash,time]},
     {sql:'DELETE FROM sessions WHERE user_id=(SELECT user_id FROM resets WHERE token=? AND expires_at>?)',args:[tokenHash,time]},
     {sql:'DELETE FROM resets WHERE user_id=(SELECT user_id FROM resets WHERE token=? AND expires_at>?)',args:[tokenHash,time]}
    ]);
    if(!changes[0].changes)fail(400,'Link expirat sau deja folosit.');
    return send({message:'Parola a fost schimbată. Te poți conecta.'});
   }
   if(path==='/api/profile'&&method==='PATCH') {
    requireUser(user);const b=await body(req);const minecraft=typeof b.minecraft==='string'?b.minecraft.trim():'';if(minecraft&&!/^[A-Za-z0-9_]{3,16}$/.test(minecraft))fail(400,'Numele Minecraft trebuie să aibă 3–16 litere, cifre sau _.');
    (await run('UPDATE users SET minecraft=?,bio=?,avatar=? WHERE id=?',minecraft,text(b.bio||'','Descriere',0,500),url(b.avatar),user.id));return send({ok:true});
   }
   let match=path.match(/^\/api\/users\/(\d+)$/);
   if(match&&method==='GET') {const id=Number(match[1]),p=(await get('SELECT * FROM users WHERE id=?',id));if(!p)fail(404,'Utilizatorul nu există.');return send({user:publicUser(p),posts:(await get('SELECT COUNT(*) n FROM threads WHERE author_id=? AND deleted=0',id)).n+(await get('SELECT COUNT(*) n FROM replies WHERE author_id=? AND deleted=0',id)).n,private_counts:user?.id===id||rank(user)>=2?(await all('SELECT kind,COUNT(*) count FROM cases WHERE author_id=? GROUP BY kind',id)):null,activity:(await all(`${threadSummary} WHERE t.author_id=? AND t.deleted=0 ORDER BY t.created_at DESC LIMIT 10`,id))});}
   if(path==='/api/threads'&&method==='GET') {
    const p=page(u),q=(u.searchParams.get('q')||'').slice(0,100),category=u.searchParams.get('category')||'',status=u.searchParams.get('status')||'';
    const where='t.deleted=0 AND (?=\'\' OR c.slug=?) AND (?=\'\' OR t.title LIKE ? OR t.body LIKE ?) AND (?=\'\' OR t.status=?)';const args=[category,category,q,`%${q}%`,`%${q}%`,status,status];
    const sort=u.searchParams.get('sort')==='popular'?'score DESC,t.updated_at DESC':'t.pinned DESC,t.updated_at DESC';
    return send({items:(await all(`${threadSummary} WHERE ${where} ORDER BY ${sort} LIMIT 20 OFFSET ?`,...args,(p-1)*20)),total:(await get(`SELECT COUNT(*) n FROM threads t JOIN categories c ON c.id=t.category_id WHERE ${where}`,...args)).n,page:p});
   }
   if(path==='/api/threads'&&method==='POST') {
    requireUser(user);(await limit(`thread:${user.id}`,12,3600));const b=await body(req);const c=(await get('SELECT * FROM categories WHERE id=?',Number(b.category_id)));if(!c)fail(400,'Alege o categorie.');if(c.restricted)requireRole(user,'ADMIN');
    const id=Number((await run('INSERT INTO threads(category_id,author_id,title,body) VALUES (?,?,?,?)',c.id,user.id,text(b.title,'Titlu',5,160),text(b.body,'Conținut',10,20000))).lastInsertRowid);return send({id},201);
   }
   match=path.match(/^\/api\/threads\/(\d+)$/);
   if(match) {
    const id=Number(match[1]),t=(await thread(id));
    if(method==='GET') {(await run('UPDATE threads SET views=views+1 WHERE id=?',id));const p=page(u);return send({thread:{...t,views:t.views+1,score:(await get('SELECT COALESCE(SUM(value),0) n FROM votes WHERE thread_id=?',id)).n,my_vote:user?(await get('SELECT value FROM votes WHERE thread_id=? AND user_id=?',id,user.id))?.value||0:0},replies:(await all('SELECT r.*,u.username,u.role FROM replies r JOIN users u ON u.id=r.author_id WHERE r.thread_id=? AND r.deleted=0 ORDER BY r.id LIMIT 20 OFFSET ?',id,(p-1)*20)),reply_count:(await get('SELECT COUNT(*) n FROM replies WHERE thread_id=? AND deleted=0',id)).n,attachments:(await attachmentsFor('thread',id)),page:p});}
    if(method==='PATCH') {
     requireUser(user);const b=await body(req),moderator=rank(user)>=2;
     if(t.author_id!==user.id&&!moderator)fail(403,'Poți modifica doar discuțiile tale.');
     if(t.locked&&!moderator)fail(403,'Discuția este închisă.');
     if(['pinned','locked','status','category_id'].some(k=>k in b)&&!moderator)fail(403,'Doar echipa poate modera discuțiile.');
     const title=b.title===undefined?t.title:text(b.title,'Titlu',5,160),content=b.body===undefined?t.body:text(b.body,'Conținut',10,20000);
     let category=t.category_id;if(b.category_id!==undefined){const c=(await get('SELECT * FROM categories WHERE id=?',Number(b.category_id)));if(!c)fail(400,'Categorie invalidă.');if(c.restricted)requireRole(user,'ADMIN');category=c.id;}
     const status=b.status===undefined?t.status:choice(b.status,suggestionStatuses);if(b.status!==undefined&&t.slug!=='suggestions')fail(400,'Statusul este disponibil pentru sugestii.');
     (await run('UPDATE threads SET title=?,body=?,category_id=?,pinned=?,locked=?,status=?,updated_at=? WHERE id=?',title,content,category,b.pinned===undefined?t.pinned:Number(!!b.pinned),b.locked===undefined?t.locked:Number(!!b.locked),status,now(),id));
     if(moderator)(await audit(user,'thread_update',id,JSON.stringify({status,pinned:b.pinned,locked:b.locked})));
     if(status!==t.status)(await notify(t.author_id,'Statusul sugestiei tale a fost actualizat.',`/thread/${id}`));
     return send({ok:true});
    }
    if(method==='DELETE') {requireUser(user);if(t.author_id!==user.id&&rank(user)<2)fail(403,'Nu poți șterge această discuție.');if(t.locked&&rank(user)<2)fail(403,'Discuția este închisă.');(await run('UPDATE threads SET deleted=1 WHERE id=?',id));(await audit(user,'thread_delete',id));return send({ok:true});}
   }
   match=path.match(/^\/api\/threads\/(\d+)\/replies$/);
   if(match&&method==='POST') {requireUser(user);(await limit(`reply:${user.id}`,30,600));const t=(await thread(Number(match[1])));if(t.locked)fail(403,'Discuția este închisă.');const b=await body(req);(await run('INSERT INTO replies(thread_id,author_id,body) VALUES (?,?,?)',t.id,user.id,text(b.body,'Răspuns',2,10000)));(await run('UPDATE threads SET updated_at=? WHERE id=?',now(),t.id));const recipients=(await all('SELECT DISTINCT author_id id FROM replies WHERE thread_id=? AND deleted=0 UNION SELECT author_id id FROM threads WHERE id=?',t.id,t.id));for(const r of recipients)if(r.id!==user.id)(await notify(r.id,`${user.username} a răspuns la o discuție urmărită.`,`/thread/${t.id}`));return send({ok:true},201);}
   match=path.match(/^\/api\/replies\/(\d+)$/);
   if(match&&['PATCH','DELETE'].includes(method)) {requireUser(user);const r=(await get('SELECT * FROM replies WHERE id=? AND deleted=0',Number(match[1])));if(!r)fail(404,'Răspunsul nu există.');const t=(await thread(r.thread_id));if(r.author_id!==user.id&&rank(user)<2)fail(403,'Nu poți modifica acest răspuns.');if(t.locked&&rank(user)<2)fail(403,'Discuția este închisă.');if(method==='DELETE')(await run('UPDATE replies SET deleted=1 WHERE id=?',r.id));else{const b=await body(req);(await run('UPDATE replies SET body=? WHERE id=?',text(b.body,'Răspuns',2,10000),r.id));}(await audit(user,'reply_'+method.toLowerCase(),r.id));return send({ok:true});}
   match=path.match(/^\/api\/threads\/(\d+)\/vote$/);
   if(match&&method==='POST') {requireUser(user);const t=(await thread(Number(match[1])));if(t.slug!=='suggestions')fail(400,'Poți vota doar sugestii.');if(t.locked)fail(403,'Sugestia este închisă.');const b=await body(req);choice(b.value,[-1,0,1],'Vot');if(b.value===0)(await run('DELETE FROM votes WHERE thread_id=? AND user_id=?',t.id,user.id));else (await run('INSERT INTO votes VALUES (?,?,?) ON CONFLICT(thread_id,user_id) DO UPDATE SET value=excluded.value',t.id,user.id,b.value));return send({ok:true});}
   if(path==='/api/cases'&&method==='GET') {
    requireUser(user);const kind=u.searchParams.get('kind')||'',status=u.searchParams.get('status')||'',category=u.searchParams.get('category')||'',p=page(u),staff=u.searchParams.get('staff')==='1';
    if(staff)requireRole(user,'HELPER');
    const access=!staff?'c.author_id=?':rank(user)>=2?'1=1':'c.kind=\'ticket\' AND c.assigned_id=?';const args=!staff||rank(user)<2?[user.id]:[];
    const where=`${access} AND (?='' OR c.kind=?) AND (?='' OR c.status=?) AND (?='' OR c.category=?)`;args.push(kind,kind,status,status,category,category);
    return send({items:(await all(`SELECT c.*,u.username,a.username assigned_name FROM cases c JOIN users u ON u.id=c.author_id LEFT JOIN users a ON a.id=c.assigned_id WHERE ${where} ORDER BY c.updated_at DESC LIMIT 20 OFFSET ?`,...args,(p-1)*20)),total:(await get(`SELECT COUNT(*) n FROM cases c WHERE ${where}`,...args)).n,page:p});
   }
   if(path==='/api/cases'&&method==='POST') {
    requireUser(user);(await limit(`case:${user.id}`,10,3600));const b=await body(req),kind=choice(b.kind,Object.keys(statuses),'Tip');
    if(kind==='appeal'){const hours=Math.max(1,Number(config.appealCooldownHours || process.env.APPEAL_COOLDOWN_HOURS)||24);if((await get("SELECT id FROM cases WHERE author_id=? AND kind='appeal' AND created_at>?",user.id,new Date(Date.now()-hours*3600000).toISOString())))fail(429,`Poți trimite o contestație la fiecare ${hours} ore.`);}
    let player=typeof b.player==='string'?b.player.trim():'';if(kind!=='ticket'&&!/^[A-Za-z0-9_]{3,16}$/.test(player))fail(400,'Introdu un nume Minecraft valid.');
    const incident=b.incident_date||'';if(incident&&(!/^\d{4}-\d{2}-\d{2}$/.test(incident)||!Number.isFinite(Date.parse(incident))||incident>now().slice(0,10)))fail(400,'Data incidentului nu este validă.');
    const id=Number((await run('INSERT INTO cases(kind,author_id,subject,category,body,player,incident_date,evidence,status) VALUES (?,?,?,?,?,?,?,?,?)',kind,user.id,text(b.subject,'Subiect',5,160),choice(b.category,(await categoriesForCases())[kind],'Categorie'),text(b.body,'Descriere',20,20000),player,incident,url(b.evidence),statuses[kind][0])).lastInsertRowid);(await run('INSERT INTO case_events(case_id,actor_id,message) VALUES (?,?,?)',id,user.id,'Cerere creată.'));(await staffNotify({id,kind}));return send({id},201);
   }
   match=path.match(/^\/api\/cases\/(\d+)$/);
   if(match) {
    const c=(await privateCase(Number(match[1]),user)),staff=staffCase(user,c);
    if(method==='GET')return send({case:c,can_manage:staff,messages:(await all('SELECT m.*,u.username,u.role FROM case_messages m JOIN users u ON u.id=m.author_id WHERE m.case_id=? AND (?=1 OR m.internal=0) ORDER BY m.id',c.id,Number(staff))),attachments:(await attachmentsFor('case',c.id)),history:(await all('SELECT e.*,u.username FROM case_events e JOIN users u ON u.id=e.actor_id WHERE e.case_id=? ORDER BY e.id',c.id)),staff:staff?(await all("SELECT id,username,role FROM users WHERE role IN ('HELPER','MODERATOR','ADMIN','OWNER')")):[],statuses:statuses[c.kind]});
    if(method==='PATCH') {
     if(!staff)fail(403,'Doar echipa poate modifica cererea.');const b=await body(req);
     if(user.role==='HELPER'&&(b.assigned_id!==undefined||b.priority!==undefined))fail(403,'Atribuirea și prioritatea sunt gestionate de moderatori.');
     const status=b.status===undefined?c.status:choice(b.status,statuses[c.kind],'Status'),priority=b.priority===undefined?c.priority:choice(b.priority,['low','normal','high'],'Prioritate');
     let assigned=c.assigned_id;if(b.assigned_id!==undefined){assigned=b.assigned_id===null||b.assigned_id===''?null:Number(b.assigned_id);if(assigned!==null){const a=(await get('SELECT * FROM users WHERE id=?',assigned));if(!a||rank(a)<(c.kind==='ticket'?1:2))fail(400,'Membrul ales nu poate gestiona această cerere.');}}
     (await run('UPDATE cases SET status=?,priority=?,assigned_id=?,updated_at=? WHERE id=?',status,priority,assigned,now(),c.id));(await audit(user,'case_update',c.id,JSON.stringify({status,priority,assigned})));(await run('INSERT INTO case_events(case_id,actor_id,message) VALUES (?,?,?)',c.id,user.id,JSON.stringify({status,priority,assigned:assigned?(await get('SELECT username FROM users WHERE id=?',assigned)).username:null})));if(status!==c.status)(await notify(c.author_id,`Status actualizat pentru cererea #${c.id}.`,`/cases/${c.id}`));if(assigned&&assigned!==c.assigned_id)(await notify(assigned,`Ți-a fost atribuită cererea #${c.id}.`,`/cases/${c.id}`));return send({ok:true});
    }
   }
   match=path.match(/^\/api\/cases\/(\d+)\/messages$/);
   if(match&&method==='POST') {const c=(await privateCase(Number(match[1]),user)),staff=staffCase(user,c),b=await body(req);(await limit(`message:${user.id}`,40,600));if(b.internal&&!staff)fail(403,'Notele interne sunt rezervate echipei.');if(['closed','resolved','rejected','accepted','denied'].includes(c.status)&&!staff)fail(403,'Cererea este închisă.');const internal=Number(!!b.internal);(await run('INSERT INTO case_messages(case_id,author_id,body,internal) VALUES (?,?,?,?)',c.id,user.id,text(b.body,'Mesaj',2,10000),internal));(await run('UPDATE cases SET updated_at=? WHERE id=?',now(),c.id));if(staff){(await audit(user,internal?'case_note':'case_reply',c.id));if(!internal&&user.id!==c.author_id)(await notify(c.author_id,`Echipa a răspuns la cererea #${c.id}.`,`/cases/${c.id}`));}else{for(const member of (await all("SELECT id FROM users WHERE role IN ('MODERATOR','ADMIN','OWNER') OR id=?",c.assigned_id)))if(member.id!==user.id)(await notify(member.id,`Răspuns nou la cererea #${c.id}.`,`/cases/${c.id}`));}return send({ok:true},201);}
   if(path==='/api/notifications'&&method==='GET') {requireUser(user);return send({items:(await all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100',user.id))});}
   if(path==='/api/notifications/read'&&method==='POST') {requireUser(user);const b=await body(req);if(b.id)(await run('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?',Number(b.id),user.id));else (await run('UPDATE notifications SET is_read=1 WHERE user_id=?',user.id));return send({ok:true});}
   if(path==='/api/admin/discord'&&method==='GET') {requireRole(user,'ADMIN');return send((await config.discord?.status()) || {configured:false,counts:[]});}
   if(path==='/api/staff'&&method==='GET') {
    requireRole(user,'HELPER');const moderator=rank(user)>=2;
    return send({stats:{users:(await get('SELECT COUNT(*) n FROM users')).n,threads:(await get('SELECT COUNT(*) n FROM threads WHERE deleted=0')).n,tickets:(await get(`SELECT COUNT(*) n FROM cases WHERE kind='ticket' AND status!='closed' ${moderator?'':'AND assigned_id=?'}`,...(moderator?[]:[user.id]))).n,reports:moderator?(await get("SELECT COUNT(*) n FROM cases WHERE kind='report' AND status IN ('pending','reviewing')")).n:null,appeals:moderator?(await get("SELECT COUNT(*) n FROM cases WHERE kind='appeal' AND status IN ('pending','reviewing')")).n:null},recent:(await all(`${threadSummary} WHERE t.deleted=0 ORDER BY t.created_at DESC LIMIT 8`)),audit:rank(user)>=3?(await all('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100')):[]});
   }
   if(path==='/api/admin/users'&&method==='GET') {requireRole(user,'ADMIN');const p=page(u),q=(u.searchParams.get('q')||'').slice(0,100);return send({items:(await all('SELECT id,username,role,created_at FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 30 OFFSET ?',`%${q}%`,(p-1)*30)),total:(await get('SELECT COUNT(*) n FROM users WHERE username LIKE ?',`%${q}%`)).n,page:p});}
   match=path.match(/^\/api\/admin\/users\/(\d+)\/role$/);
   if(match&&method==='PATCH') {requireRole(user,'ADMIN');const target=(await get('SELECT * FROM users WHERE id=?',Number(match[1]))),b=await body(req),role=choice(b.role,roles,'Rol');if(!target)fail(404,'Contul nu există.');if(target.id===user.id)fail(403,'Nu îți poți modifica propriul rol.');if(user.role!=='OWNER'&&(rank(target)>=rank(user)||roles.indexOf(role)>=rank(user)))fail(403,'Nu poți modifica roluri egale sau superioare.');(await run('UPDATE users SET role=? WHERE id=?',role,target.id));(await run('DELETE FROM sessions WHERE user_id=?',target.id));(await audit(user,'role_change',target.id,`${target.role} -> ${role}`));return send({ok:true});}
   if(path==='/api/admin/categories'&&method==='POST') {requireRole(user,'ADMIN');const b=await body(req),slug=text(b.slug,'Identificator',2,40);if(!/^[a-z0-9-]+$/.test(slug))fail(400,'Identificatorul acceptă litere mici, cifre și cratimă.');if((await get('SELECT id FROM categories WHERE slug=?',slug)))fail(409,'Identificatorul există deja.');const id=Number((await run('INSERT INTO categories(slug,name,description,restricted) VALUES (?,?,?,?)',slug,text(b.name,'Nume',2,80),text(b.description,'Descriere',0,200),Number(!!b.restricted))).lastInsertRowid);(await audit(user,'category_create',id));return send({id},201);}
   match=path.match(/^\/api\/admin\/categories\/(\d+)$/);
   if(match&&method==='PATCH') {requireRole(user,'ADMIN');const b=await body(req),c=(await get('SELECT * FROM categories WHERE id=?',Number(match[1])));if(!c)fail(404,'Categoria nu există.');(await run('UPDATE categories SET name=?,description=?,restricted=? WHERE id=?',text(b.name,'Nume',2,80),text(b.description,'Descriere',0,200),['announcements','rules'].includes(c.slug)?1:Number(!!b.restricted),c.id));(await audit(user,'category_update',c.id));return send({ok:true});}
   if(path==='/api/admin/settings'&&method==='PATCH') {requireRole(user,'ADMIN');const b=await body(req);const values={};for(const key of ['discord_url','rules','privacy','terms'])if(key in b)values[key]=key==='discord_url'?url(b[key]):text(b[key],key,0,20000);for(const key of ['ticket_categories','report_categories'])if(key in b){if(!Array.isArray(b[key])||b[key].length<1||b[key].length>20)fail(400,'Definește între 1 și 20 de categorii.');values[key]=JSON.stringify([...new Set(b[key].map(v=>text(v,'Categorie',2,80)))]);}for(const [key,value] of Object.entries(values))(await run('UPDATE settings SET value=? WHERE key=?',value,key));(await audit(user,'settings_update','forum'));return send({ok:true});}
   if(path==='/api/attachments'&&method==='POST') {
    requireUser(user);(await limit(`upload:${user.id}`,15,3600));const b=await body(req),kind=choice(b.kind,['thread','case'],'Destinație'),id=Number(b.target_id);
    if(kind==='thread'){const t=(await thread(id));if(t.author_id!==user.id&&rank(user)<2)fail(403,'Poți atașa capturi doar la discuțiile tale.');if(t.locked)fail(403,'Discuția este închisă.');}
    else{const c=(await privateCase(id,user));if(['closed','resolved','rejected','accepted','denied'].includes(c.status)&&!staffCase(user,c))fail(403,'Cererea este închisă.');}
    if((await attachmentsFor(kind,id)).length>=10)fail(400,'Poți atașa cel mult 10 capturi unei cereri sau discuții.');
    if(typeof b.data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.data))fail(400,'Fișier invalid.');const data=Buffer.from(b.data,'base64');
    if(data.length>2*1024*1024||data.length<24)fail(400,'Captura trebuie să aibă cel mult 2 MB.');
    let type='';
    if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&data.subarray(12,16).toString()==='IHDR'&&data.readUInt32BE(16)>0&&data.readUInt32BE(20)>0&&data.readUInt32BE(16)<=10000&&data.readUInt32BE(20)<=10000&&data.subarray(-8,-4).toString()==='IEND')type='image/png';
    else if(data[0]===255&&data[1]===216&&data[2]===255&&data[data.length-2]===255&&data[data.length-1]===217)type='image/jpeg';
    if(!type)fail(400,'Sunt acceptate doar capturi PNG sau JPEG valide.');
    if((await get('SELECT COALESCE(SUM(length(data)),0) n FROM attachments WHERE owner_id=?',user.id)).n+data.length>20*1024*1024)fail(400,'Ai atins limita de 20 MB de atașamente. Șterge capturi vechi.');
    const name=text(b.name,'Nume fișier',1,120).replace(/[^\p{L}\p{N}_. -]/gu,'_');
    const attachment=Number((await run('INSERT INTO attachments(owner_id,thread_id,case_id,name,mime,data) VALUES (?,?,?,?,?,?)',user.id,kind==='thread'?id:null,kind==='case'?id:null,name,type,data)).lastInsertRowid);(await audit(user,'attachment_add',attachment));return send({id:attachment},201);
   }
   match=path.match(/^\/api\/attachments\/(\d+)$/);
   if(match&&['GET','DELETE'].includes(method)) {
    const a=(await get('SELECT * FROM attachments WHERE id=?',Number(match[1])));if(!a)fail(404,'Atașamentul nu există.');
    if(a.case_id)(await privateCase(a.case_id,user));else (await thread(a.thread_id));
    if(method==='DELETE'){requireUser(user);if(user.id!==a.owner_id&&rank(user)<2)fail(403,'Nu poți șterge acest atașament.');(await run('DELETE FROM attachments WHERE id=?',a.id));(await audit(user,'attachment_delete',a.id));return send({ok:true});}
    res.setHeader('Content-Type',a.mime);res.setHeader('Content-Disposition',`attachment; filename="capture.${a.mime==='image/png'?'png':'jpg'}"; filename*=UTF-8''${encodeURIComponent(a.name)}`);res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.end(Buffer.from(a.data));return;
   }
   fail(404,'Pagina solicitată nu există.');
  } catch(error) {
   if(!error.status) console.error('Eroare internă:',error.code || error.message);
   if(!res.headersSent)send({error:error.status?error.message:'A apărut o eroare. Încearcă din nou.'},error.status||500);
   else res.end();
  }
 };
}
