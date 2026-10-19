import {waitUntil} from '@vercel/functions';
import {openRemoteDatabase} from '../lib/remote-db.mjs';
import {createApp} from '../lib/app.mjs';
import {createDiscord} from '../lib/discord.mjs';

let application;
async function initialize() {
 if(!process.env.APP_ORIGIN?.startsWith('https://') || process.env.COOKIE_SECURE!=='true')throw Error('Configure HTTPS APP_ORIGIN and COOKIE_SECURE=true.');
 const db=await openRemoteDatabase();
 const discord=createDiscord(db);
 return {handler:createApp(db,{discord,clientIP:req=>String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim()}),discord};
}
export default async function handler(req,res) {
 try {
  application ||= initialize().catch(error=>{application=null;throw error;});
  const app=await application;
  // A protected daily cron retries notifications even when nobody visits the site.
  if(new URL(req.url,process.env.APP_ORIGIN).pathname==='/api/cron/discord') {
   if(!process.env.CRON_SECRET || req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`){res.statusCode=401;res.end();return;}
   await app.discord.flush();res.setHeader('Content-Type','application/json');res.end('{"ok":true}');return;
  }
  await app.handler(req,res);
  waitUntil(app.discord.flush());
 } catch {
  console.error('Forum initialization/request failed. Check database configuration and migrations.');
  if(!res.headersSent){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Serviciul este temporar indisponibil.'}));}else res.end();
 }
}
