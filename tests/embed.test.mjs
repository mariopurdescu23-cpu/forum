import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';
import {discordEmbed} from '../lib/discord-embed.mjs';

test('case embeds show updated state and bounded details without credentials or internal messages',async()=>{
 const db=openDatabase(':memory:');
 try{
  db.prepare("INSERT INTO users(username,email,password_hash,minecraft) VALUES ('Player','private@email.test','secret-password','MinecraftPlayer')").run();
  db.prepare("INSERT INTO cases(kind,author_id,subject,category,body,status,priority) VALUES ('ticket',1,'Problema in joc','Ajutor general',?,'closed','high')").run('Detalii '.repeat(3000));
  db.prepare("INSERT INTO case_messages(case_id,author_id,body,internal) VALUES (1,1,'secret-internal-note',1)").run();
  const result=await discordEmbed(db,{label:'Cerere actualizata',href:'/cases/1',actor:'Owner'},'https://forum.retro-mc.ro');
  const panel=result.components[0],content=panel.components.filter(c=>c.type===10).map(c=>c.content).join('\n');
  assert.equal(result.flags,32768);
  assert.equal(panel.accent_color,0xef3340);
  assert.match(content,/Ajutor general • RETRO-MC/);
  assert.match(content,/Închis/);
  assert.match(content,/Ridicată/);
  assert.match(content,/MinecraftPlayer/);
  assert.ok(panel.components.some(c=>c.type===14));
  assert.equal(panel.components.find(c=>c.type===1).components[0].url,'https://forum.retro-mc.ro/cases/1');
  assert.ok(content.length<4000);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(!JSON.stringify(result).includes('private@email'));
  assert.deepEqual(result.allowed_mentions,{parse:[]});
 }finally{db.close();}
});
