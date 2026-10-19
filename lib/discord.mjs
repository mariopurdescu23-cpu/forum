export function webhookURL(value) {
 if (!value) return null;
 const u = new URL(value);
 if (u.protocol !== 'https:' || !/^(?:(?:canary|ptb)\.)?discord(?:app)?\.com$/.test(u.hostname) || u.port || u.username || u.password || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/.test(u.pathname)) throw Error('DISCORD_WEBHOOK_URL invalid');
 u.searchParams.set('wait','true');
 return u.href;
}

export function createDiscord(db, {hook = process.env.DISCORD_WEBHOOK_URL, origin = process.env.APP_ORIGIN || 'http://localhost:3000', fetcher = fetch, clock = Date.now} = {}) {
 const endpoint = webhookURL(hook);
 let running = false, timer;
 const run = (sql,...args) => db.prepare(sql).run(...args);
 async function enqueueActivity({label,href,actor}) {
  if(!endpoint)return;
  const payload={content:`RETRO-MC.RO | ${label}${actor?`\n${actor}`:''}\n${origin.replace(/\/$/,'')}${href}`,allowed_mentions:{parse:[]}};
  await run('INSERT INTO discord_queue(payload) VALUES (?)',JSON.stringify(payload));
 }
 async function enqueue(c, event = 'Cerere nouă') {
  if (!endpoint) return;
  const kind = {ticket:'Tichet', report:'Reclamație', appeal:'Contestație'}[c.kind] || 'Cerere';
  const payload = {content:`${event}: ${kind} #${c.id}\n${origin.replace(/\/$/,'')}/cases/${c.id}`, allowed_mentions:{parse:[]}};
  await run('INSERT INTO discord_queue(payload) VALUES (?)',JSON.stringify(payload));
 }
 async function flush() {
  if (!endpoint || running) return;
  running = true;
  try {
   // Send serially; stop on a failure to respect the webhook's shared rate limit.
   const rows = await db.prepare("SELECT * FROM discord_queue WHERE state='pending' AND next_attempt<=? ORDER BY id LIMIT 3").all(clock());
   for (const row of rows) {
    const claim=await run("UPDATE discord_queue SET next_attempt=? WHERE id=? AND state='pending' AND next_attempt<=?",clock()+120000,row.id,clock());
    if(!claim.changes)continue;
    let retry = Math.min(3600000, 2000 * 2 ** Math.min(row.attempts,10)), error;
    try {
     const response = await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:row.payload,redirect:'error',signal:AbortSignal.timeout(8000)});
     if (response.ok) { await response.arrayBuffer(); await run("UPDATE discord_queue SET state='sent', attempts=attempts+1, last_error=NULL WHERE id=?",row.id); continue; }
     error = `HTTP ${response.status}`;
     if (response.status === 429) {
      const body = await response.json().catch(()=>({}));
      const seconds = Number(body.retry_after ?? response.headers.get('retry-after'));
      if (Number.isFinite(seconds) && seconds > 0) retry = Math.max(1000,Math.ceil(seconds*1000));
     } else { await response.arrayBuffer(); }
     if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      await run("UPDATE discord_queue SET state='failed', attempts=attempts+1, last_error=? WHERE id=?",error,row.id);
      console.error('Discord: notificare respinsă; verifică webhookul în .env.');
      break;
     }
    } catch { error = 'Network error'; }
    await run('UPDATE discord_queue SET attempts=attempts+1, next_attempt=?, last_error=? WHERE id=?',clock()+retry,error,row.id);
    break;
   }
  } finally { running = false; }
 }
 async function status() {
  return {configured:!!endpoint,counts:await db.prepare('SELECT state,COUNT(*) count FROM discord_queue GROUP BY state').all()};
 }
 function start() { if(endpoint&&!timer) { timer=setInterval(()=>void flush().catch(()=>console.error('Discord: eroare coadă.')),2000); timer.unref(); void flush().catch(()=>{}); } }
 async function stop() { clearInterval(timer); while(running) await new Promise(r=>setTimeout(r,25)); }
 return {enqueue,enqueueActivity,flush,status,start,stop};
}
