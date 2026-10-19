import {openRemoteDatabase} from '../lib/remote-db.mjs';
const username=process.argv[2];
if(!username)throw Error('Usage: npm run owner:remote -- username');
const db=await openRemoteDatabase();
const tx=await db.client.transaction('write');
try {
 if((await tx.execute("SELECT id FROM users WHERE role='OWNER'")).rows.length)throw Error('An owner already exists. Use the admin panel.');
 const user=(await tx.execute({sql:'SELECT id FROM users WHERE username=?',args:[username]})).rows[0];
 if(!user)throw Error('Register the account in the forum first.');
 await tx.execute({sql:"UPDATE users SET role='OWNER' WHERE id=?",args:[user.id]});
 await tx.execute({sql:"INSERT INTO audit(actor_id,action,target) VALUES (?,'bootstrap_owner',?)",args:[user.id,String(user.id)]});
 await tx.commit();console.log('Owner assigned.');
}catch(error){await tx.rollback();throw error;}finally{tx.close();db.close();}
