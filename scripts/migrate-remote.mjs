import {openRemoteDatabase} from '../lib/remote-db.mjs';
const db=await openRemoteDatabase({migrate:true});
db.close();
console.log('Remote migrations applied.');
