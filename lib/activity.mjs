// Build notifications from successful actions only. Never serialize request bodies.
export function forumActivity(method,path,data,user) {
 if(!['POST','PATCH','DELETE'].includes(method))return null;
 const actions={
  'POST /api/register':['Cont nou','/staff?tab=users'],
  'POST /api/login':['Autentificare','/staff?tab=users'],
  'POST /api/logout':['Deconectare','/staff?tab=users'],
  'POST /api/reset':['Parola resetata','/staff?tab=audit'],
  'PATCH /api/profile':['Profil actualizat',`/profile/${user?.id}`],
  'POST /api/threads':['Discutie noua',`/thread/${data.id}`],
  'POST /api/cases':['Cerere noua',`/cases/${data.id}`],
  'POST /api/attachments':['Captura atasata','/staff?tab=audit'],
  'POST /api/admin/categories':['Categorie creata','/staff?tab=categories'],
  'PATCH /api/admin/settings':['Configurare actualizata','/staff?tab=settings']
 };
 let action=actions[`${method} ${path}`],m;
 if((m=path.match(/^\/api\/threads\/(\d+)(?:\/(replies|vote))?$/))) {
  action=[m[2]==='replies'?'Raspuns nou':m[2]==='vote'?'Vot actualizat':method==='DELETE'?'Discutie stearsa':'Discutie actualizata',`/thread/${m[1]}`];
 }else if((m=path.match(/^\/api\/cases\/(\d+)(?:\/(messages))?$/))) {
  action=[m[2]?'Mesaj sau nota adaugata la cerere':'Cerere actualizata',`/cases/${m[1]}`];
 }else if((m=path.match(/^\/api\/replies\/(\d+)$/))) {
  action=[method==='DELETE'?'Raspuns sters':'Raspuns editat','/staff?tab=audit'];
 }else if((m=path.match(/^\/api\/attachments\/(\d+)$/))) {
  action=['Captura stearsa','/staff?tab=audit'];
 }else if((m=path.match(/^\/api\/admin\/users\/(\d+)\/role$/))) {
  action=[`Rol modificat pentru contul #${m[1]}`,`/profile/${m[1]}`];
 }else if(path.match(/^\/api\/admin\/categories\/\d+$/)) {
  action=['Categorie actualizata','/staff?tab=categories'];
 }
 if(!action)return null;
 const actor=data.user?.id||user?.id;
 const name=String(data.user?.username||user?.username||'Cont').replace(/[`*_~|\\<>]/g,'');
 return {label:action[0],href:action[1],actor:actor?`${name} (#${actor})`:'Vizitator'};
}
