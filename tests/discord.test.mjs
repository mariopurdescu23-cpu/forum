import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openRemoteDatabase} from '../lib/remote-db.mjs';
import {createDiscord,webhookURL} from '../lib/discord.mjs';

test('Discord persists retries, respects rate limits and prevents concurrent delivery',async()=>{
 const db=await openRemoteDatabase({url:'file::memory:',migrate:true});
 let time=1000,calls=0;
 const options={hook:'https://discord.com/api/webhooks/123/test-token',origin:'https://forum.retro-mc.ro',clock:()=>time,
  fetcher:async(url,request)=>{
   calls++;assert.equal(new URL(url).searchParams.get('wait'),'true');
   const payload=JSON.parse(request.body);
   assert.deepEqual(payload.allowed_mentions,{parse:[]});
   assert.equal(payload.embeds[0].url,'https://forum.retro-mc.ro/cases/7');
   assert.ok(!JSON.stringify(payload).includes('secret'));
   return calls===1?new Response(JSON.stringify({retry_after:5}),{status:429}):new Response('{}',{status:200});
  }};
 try {
  const first=createDiscord(db,options);
  await first.enqueue({kind:'ticket',id:7,body:'secret'});
  await first.flush();
  assert.equal((await first.status()).counts[0].state,'pending');
  await first.flush();assert.equal(calls,1);
  // A new worker reads the persisted retry after its deadline.
  time+=5001;
  await Promise.all([createDiscord(db,options).flush(),createDiscord(db,options).flush()]);
  assert.equal(calls,2);
  assert.equal((await first.status()).counts[0].state,'sent');
  const disabled=createDiscord(db,{hook:''});await disabled.enqueue({id:8,kind:'report'});
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM discord_queue').get()).n,1);
  assert.throws(()=>webhookURL('https://discord.com.evil.test/api/webhooks/123/token'));
  assert.throws(()=>webhookURL('http://discord.com/api/webhooks/123/token'));
 }finally{db.close();}
});
