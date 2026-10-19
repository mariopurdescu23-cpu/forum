const text=(value,max=1024)=>String(value||'Nespecificat').replace(/[`*_~|\\<>]/g,'').slice(0,max);
const statuses={open:'Deschis',in_progress:'În lucru',waiting:'Așteaptă răspuns',closed:'Închis',pending:'În așteptare',reviewing:'În analiză',resolved:'Rezolvat',rejected:'Respins',accepted:'Acceptat',denied:'Respins'};
const priorities={low:'Scăzută',normal:'Normală',high:'Ridicată'};

export async function discordEmbed(db,event,origin) {
 const base=origin.replace(/\/$/,'');
 const embed={
  title:text(`${event.label} • RETRO-MC`,256),
  description:`${text(event.actor||'Echipa')} · ${text(event.label,160)}`,
  color:0xef3340,
  url:base+event.href,
  fields:[],
  footer:{text:'RETRO-MC.RO • Activitate forum'},
  timestamp:new Date().toISOString()
 };
 const match=event.href.match(/^\/cases\/(\d+)$/);
 if(match){
  // Explicit selection prevents accidental disclosure of emails, passwords or internal notes.
  const c=await db.prepare('SELECT c.id,c.kind,c.category,c.subject,c.body,c.player,c.evidence,c.status,c.priority,c.updated_at,u.username,u.minecraft,a.username assigned_name FROM cases c JOIN users u ON u.id=c.author_id LEFT JOIN users a ON a.id=c.assigned_id WHERE c.id=?').get(Number(match[1]));
  if(c){
   const kind={ticket:'💬 Tichet',report:'🚩 Reclamație',appeal:'⚖️ Contestație'}[c.kind]||'Cerere';
   embed.title=text(`${kind} #${c.id} • ${c.category} • RETRO-MC`,256);
   embed.description=`**${text(event.label,160)}**\n${text(event.actor||c.username)} · Solicitare de la **${text(c.username)}**`;
   embed.fields=[
    {name:'Starea cererii',value:`**Status:** ${statuses[c.status]||text(c.status)}\n**Preluat de:** ${text(c.assigned_name||'Nepreluat')}\n**Prioritate:** ${priorities[c.priority]||text(c.priority)}\n**Ultima actualizare:** ${text(c.updated_at,40)}`},
    {name:'Numele în Minecraft',value:text(c.minecraft||c.username),inline:true},
    ...(c.player?[{name:c.kind==='report'?'Jucător reclamat':'Jucător',value:text(c.player),inline:true}]:[]),
    {name:'Subiectul solicitării',value:text(c.subject)},
    {name:'Detaliile solicitării',value:text(c.body)},
    {name:'Link dovezi / captură',value:text(c.evidence)},
    {name:'Gestionare',value:`[Deschide cererea pe forum](${embed.url})`}
   ];
   embed.footer.text='RETRO-MC.RO • Staff Tickets';
  }
 }else{
  embed.fields=[{name:'Acțiune',value:text(event.label),inline:true},{name:'Membru',value:text(event.actor||'Vizitator'),inline:true},{name:'Forum',value:`[Deschide în forum](${embed.url})`}];
 }
 return {username:'RETRO-MC » FORUM',embeds:[embed],allowed_mentions:{parse:[]}};
}
