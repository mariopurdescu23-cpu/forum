(() => {
 'use strict';
 const root=document.documentElement, key='retro-theme';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const particles=new Set();
 let theme='classic';
 try { theme=localStorage.getItem(key)==='halloween'?'halloween':'classic'; } catch {}
 root.dataset.theme=theme;
 const pumpkin='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-3-4-10 0-9 7 0 5 5 8 9 7 4 1 9-2 9-7 1-7-6-11-9-7ZM12 6c-1-3 1-4 3-4M7 10l3 3H6Zm10 0-3 3h4ZM7 16l3 2 2-1 2 1 3-2"/></svg>';
 function sync() {
  const active=theme==='halloween';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',active?'#130e16':'#101014');
  document.querySelector('link[rel="icon"]')?.setAttribute('href',active?'/assets/retro-halloween.png':'/assets/retro-64x64.png');
  const logo=document.querySelector('.brand img');if(logo)logo.src=active?'/assets/retro-halloween.png':'/assets/retro-64x64.png';
  const toggle=document.querySelector('.theme-switch');if(toggle){toggle.setAttribute('aria-checked',String(active));toggle.title=active?'Revino la tema clasică':'Activează tema Halloween';}
 }
 function clearParticles(){for(const p of particles)p.remove();particles.clear();}
 function setTheme(value,save=true) {
  theme=value==='halloween'?'halloween':'classic';root.dataset.theme=theme;
  if(save)try{localStorage.setItem(key,theme);}catch{}
  if(theme==='classic')clearParticles();sync();
  const logo=document.querySelector('.brand img');
  if(logo&&!reduced.matches&&logo.animate)logo.animate([{transform:'rotate(-12deg) scale(.82)',opacity:.5},{transform:'rotate(4deg) scale(1.14)',opacity:1},{transform:'rotate(0) scale(1)',opacity:1}],{duration:480,easing:'cubic-bezier(.23,1,.32,1)'});
 }
 function mount(){
  const account=document.querySelector('.account');if(!account)return;
  document.querySelector('.brand')?.setAttribute('aria-label','RETRO SMP — Acasă');
  if(!account.querySelector('.theme-switch')){
   const button=document.createElement('button');button.type='button';button.className='theme-switch';button.setAttribute('role','switch');button.setAttribute('aria-label','Temă Halloween');
   button.innerHTML='<span class="theme-switch-label">Halloween</span><span class="theme-switch-track" aria-hidden="true"><span class="theme-switch-knob">'+pumpkin+'</span></span>';
   button.addEventListener('click',()=>setTheme(theme==='classic'?'halloween':'classic'));account.prepend(button);
  }
  sync();
 }
 // A bounded, event-driven burst: no canvas, pointer-move listener or persistent render loop.
 document.addEventListener('click',event=>{
  if(theme!=='halloween'||reduced.matches||event.detail===0||document.hidden)return;
  if(!event.target.closest('button:not(:disabled),.button,.thread-title,.side-link'))return;
  if(particles.size>24)return;
  for(let i=0;i<8;i++){
   const spark=document.createElement('i');spark.className='halloween-spark';spark.setAttribute('aria-hidden','true');spark.style.left=event.clientX+'px';spark.style.top=event.clientY+'px';document.body.append(spark);particles.add(spark);
   const angle=i*Math.PI/4,distance=24+(i%3)*12;
   const animation=spark.animate([{transform:'translate(-50%,-50%) scale(1)',opacity:1},{transform:`translate(calc(-50% + ${Math.cos(angle)*distance}px),calc(-50% + ${Math.sin(angle)*distance}px)) scale(0)`,opacity:0}],{duration:380+i*25,easing:'cubic-bezier(.23,1,.32,1)'});
   animation.finished.catch(()=>{}).finally(()=>{spark.remove();particles.delete(spark);});
  }
 },{passive:true});
 window.addEventListener('storage',event=>{if(event.key===key)setTheme(event.newValue,false);});
 reduced.addEventListener('change',()=>{if(reduced.matches)clearParticles();});
 document.addEventListener('visibilitychange',()=>{root.classList.toggle('theme-paused',document.hidden);if(document.hidden)clearParticles();});
 window.RetroTheme={mount};
 sync();
})();
