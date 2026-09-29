import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const argv=process.argv.slice(2);
const value=(flag,fallback)=>{const i=argv.indexOf(flag);return i<0?fallback:argv[i+1];};
const directory=path.resolve(value('--bundle','knowledge/football-styles'));
const database=path.resolve(value('--db','data/touchline.sqlite'));
const apply=argv.includes('--apply');
const meta=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
const selected=value('--authors','').split(',').filter(Boolean);
const entries=meta.authors.filter(a=>!selected.length||selected.includes(a.slug)).map(a=>({author:a.author,slug:a.slug,style:JSON.parse(fs.readFileSync(path.join(directory,a.slug,'style.json'),'utf8'))}));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function check(v,a){
 if(v.id!=='corpus-'+a.slug||!v.name?.includes(a.author)||v.name.length>80)throw Error('Invalid style identity: '+a.slug);
 if(typeof v.description!=='string'||v.description.length>500)throw Error('Invalid description');
 if(typeof v.instructions!=='string'||v.instructions.length<10||v.instructions.length>8000)throw Error('Invalid role instructions');
 if(!Number.isInteger(v.charsPerMinute)||v.charsPerMinute<120||v.charsPerMinute>360)throw Error('Invalid rate');
 if(typeof v.enabled!=='boolean'||!Array.isArray(v.knowledge)||!v.knowledge.length)throw Error('Invalid style structure');
 let total=0;const keys=new Set();
 for(const k of v.knowledge){
  if(!/^[a-z0-9-]+$/.test(k.key)||keys.has(k.key))throw Error('Invalid knowledge key');keys.add(k.key);
  if(typeof k.title!=='string'||!k.title.trim()||k.title.length>120)throw Error('Invalid knowledge title');
  if(typeof k.content!=='string'||!k.content.trim()||k.content.length>10000)throw Error('Invalid knowledge content');
  if(typeof k.enabled!=='boolean')throw Error('Invalid knowledge enabled flag');
  if(k.enabled)total+=k.content.length;
 }
 if(total>20000)throw Error('Knowledge exceeds writing context limit: '+v.id);
 return total;
}
const summary=entries.map(a=>({id:a.style.id,name:a.style.name,knowledge:a.style.knowledge.length,enabledCharacters:check(a.style,a),instructionsCharacters:a.style.instructions.length}));
if(!fs.existsSync(database))throw Error('Database does not exist: '+database);
const d=new DatabaseSync(database);d.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
for(const table of ['writing_styles','writing_knowledge','writing_meta','audit'])if(!d.prepare('SELECT name FROM sqlite_master WHERE name=? AND type=?').get(table,'table'))throw Error('Application writing schema is not initialized: '+table);
const managedPrefix='football-style-library-v1:';
function current(id){const s=d.prepare('SELECT * FROM writing_styles WHERE id=?').get(id);return s?{style:s,knowledge:d.prepare('SELECT * FROM writing_knowledge WHERE style_id=? ORDER BY id').all(id)}:null;}
for(const a of entries){
 const old=current(a.style.id);if(!old)continue;
 const stamp=d.prepare('SELECT value FROM writing_meta WHERE key=?').get(managedPrefix+a.style.id);
 if(!stamp||JSON.parse(stamp.value).rowHash!==hash(old))throw Error('Existing style was not managed by this import or was edited; refusing to overwrite: '+a.style.id);
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',database,styles:summary},null,2));
if(apply){
 const now=new Date().toISOString();const out=path.resolve(value('--backup-dir',path.join(path.dirname(database),'style-library-backups')));fs.mkdirSync(out,{recursive:true,mode:0o700});
 const rollback=path.join(out,'before-'+now.replaceAll(':','-')+'.json');
 const prior={createdAt:now,database,targetIds:entries.map(a=>a.style.id),before:entries.map(a=>({id:a.style.id,rows:current(a.style.id),meta:d.prepare('SELECT * FROM writing_meta WHERE key=?').get(managedPrefix+a.style.id)||null}))};
 fs.writeFileSync(rollback,JSON.stringify(prior,null,2)+String.fromCharCode(10),{mode:0o600,flag:'wx'});
 const insertS=d.prepare('INSERT INTO writing_styles(id,name,description,instructions,chars_per_minute,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,instructions=excluded.instructions,chars_per_minute=excluded.chars_per_minute,enabled=excluded.enabled,updated_at=excluded.updated_at');
 const insertK=d.prepare('INSERT INTO writing_knowledge(id,style_id,title,content,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,enabled=excluded.enabled,updated_at=excluded.updated_at');
 d.exec('BEGIN IMMEDIATE');
 try{
  // Recheck within the transaction so concurrent UI edits cannot be overwritten.
  for(const before of prior.before)if(hash(current(before.id))!==hash(before.rows))throw Error('Concurrent style edit: '+before.id);
  for(const {style:s} of entries){
   insertS.run(s.id,s.name,s.description,s.instructions,s.charsPerMinute,Number(s.enabled),now,now);
   for(const k of s.knowledge)insertK.run(s.id+'-'+k.key,s.id,k.title,k.content,Number(k.enabled),now,now);
   d.prepare('INSERT INTO writing_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(managedPrefix+s.id,JSON.stringify({bundleHash:hash(s),rowHash:hash(current(s.id)),importedAt:now}));
  }
  d.prepare('INSERT INTO audit(user_id,action,detail,created_at) VALUES(NULL,?,?,?)').run('football_style_library_import',JSON.stringify({source:'local authorized corpus task',styles:entries.map(a=>a.style.id),rollback}),now);
  d.exec('COMMIT');
 }catch(e){d.exec('ROLLBACK');throw e;}
 console.log(JSON.stringify({applied:entries.length,knowledge:entries.reduce((n,a)=>n+a.style.knowledge.length,0),rollback}));
}
for(const {style:s} of entries){if(apply){const r=current(s.id);if(r.style.instructions!==s.instructions||r.knowledge.length!==s.knowledge.length||s.knowledge.some(k=>!r.knowledge.some(x=>x.id===s.id+'-'+k.key&&x.content===k.content)))throw Error('Readback differs: '+s.id);}}
d.close();
