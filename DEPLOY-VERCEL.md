# Forum RETRO pe Vercel + Turso

Aplicația păstrează schema SQLite, conturile, rolurile, discuțiile, cererile și atașamentele. În producție, datele sunt în Turso, nu pe discul temporar al Vercel. Local, `npm start` folosește în continuare SQLite din `data/`.

## 1. Baza de date

Creează o bază Turso pe planul Free. Copiază URL-ul și tokenul în `.env`, fără să le comiți în Git:

```dotenv
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

Pentru a păstra datele din arhivă, importă într-o bază Turso **goală**, apoi aplică migrările noi:

```powershell
npm ci
npm run import:remote -- ./data/forum.sqlite
npm run migrate:remote
```

Importul este tranzacțional și refuză să suprascrie o bază care conține deja tabele. Citește și datele SQLite din WAL. Arhiva originală `W:\forum.rar` rămâne copia inițială.

Pentru o instalare nouă, fără datele din arhivă, rulează doar `npm run migrate:remote`. Nu rula migrarea înaintea importului dacă vrei să imporți baza veche.

## 2. Proiectul Vercel

Publică folderul `forum` într-un repository privat și importă-l în Vercel. Root Directory trebuie să fie `forum` dacă repository-ul conține și alte proiecte. Folosește presetul Other și Node.js 24.x; configurația este în `vercel.json`.

Adaugă variabilele în Vercel, pentru mediul Production:

```dotenv
APP_ORIGIN=https://forum.retro-mc.ro
COOKIE_SECURE=true
NODE_ENV=production
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
CRON_SECRET=valoare-lunga-aleatoare
```

Pentru resetarea parolelor prin email, configurează și `RESEND_API_KEY` și `MAIL_FROM`. Fără ele, interfața indică faptul că resetarea nu este disponibilă.

Nu utiliza prefixul `NEXT_PUBLIC_` pentru tokenuri sau webhook. Baza locală, `.env`, capturile QA și dependențele sunt excluse din upload prin `.vercelignore`.

## 3. Domeniul

Adaugă `forum.retro-mc.ro` în Settings → Domains. Configurează în DNS înregistrarea exactă indicată de Vercel și așteaptă activarea HTTPS. Pentru testarea unui domeniu temporar, APP_ORIGIN trebuie să fie exact acel domeniu, apoi trebuie făcut redeploy.

## 4. Administrator și Discord

Dacă baza importată are deja OWNER, folosește acel cont. Altfel, înregistrează contul pe forum și rulează local, cu aceleași credențiale Turso:

```powershell
npm run owner:remote -- numele-contului
```

Creează un webhook într-un canal text Discord destinat echipei și setează `DISCORD_WEBHOOK_URL` în Vercel. Se trimit tipul cererii, numărul și linkul către forum la creare, răspuns și actualizare. Conținutul mesajelor, dovezile și notele interne rămân pe forum. Notificările nu declanșează mențiuni.

Trimiterile sunt înregistrate în baza de date. Vercel `waitUntil` le procesează după cereri; notificările temporar eșuate sunt reîncercate la vizite ulterioare și prin cronul zilnic compatibil cu Hobby. Livrarea poate fi întârziată dacă nu există trafic. După un timeout ambiguu la Discord, o reîncercare poate produce un duplicat. Erorile permanente, de exemplu webhook șters, apar ca `failed` în panoul echipei → Configurare.

Planurile gratuite au limite de utilizare. Nu activa depășiri facturabile dacă vrei să rămâi la cost zero. Verifică eligibilitatea proiectului pentru Vercel Hobby.

## Verificare

```powershell
npm run check
npm test
npm run test:browser
```

După publicare: înregistrare, autentificare, creare tichet, primire notificare Discord, răspuns din staff, verificarea confidențialității cu alt cont și verificarea datelor după redeploy. Configurarea externă și livrarea reală Discord necesită conturile și secretele proprietarului.

Surse: [Turso](https://docs.turso.tech/sdk/ts/reference), [planuri Turso](https://turso.tech/pricing), [Vercel waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Discord Webhooks](https://docs.discord.com/developers/resources/webhook).

## Jurnal Discord extins

Webhookul primeste notificari pentru conturi noi, autentificari/deconectari, resetari de parola reusite, profiluri, discutii, raspunsuri, voturi, cereri, mesaje si note la cereri, atasamente, roluri, categorii si setari. Se afiseaza actiunea, autorul si linkul; nu se transmit corpul mesajelor, emailuri, parole, tokenuri sau continutul notelor interne. Vizualizarile paginilor si marcarile notificarilor ca citite nu genereaza mesaje Discord.

## Embeduri Discord

Notificarile noi folosesc embeduri rosii. Cererile includ status, responsabil, prioritate, numele Minecraft, subiect, descrierea initiala (trunchiata la 1024 caractere) si linkul dovezilor. Continutul notelor interne si al conversatiei nu este transmis. Canalul webhookului trebuie sa fie accesibil echipei care gestioneaza cererile. Gestionarea se face prin linkul din embed, pe forum; butoanele interactive necesita o aplicatie Discord separata. Aceasta sectiune inlocuieste descrierea anterioara a formatului mesajelor.
