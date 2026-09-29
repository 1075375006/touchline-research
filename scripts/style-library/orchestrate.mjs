import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=process.argv[2]||'/tmp/football-style-work';
const authors=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).authors;
const active=new Map(),failed=new Set();
function tally(){const counts={};for(const file of fs.readdirSync(path.join(root,'results'))){if(!file.endsWith('.json')||file.endsWith('.error.json'))continue;try{const r=JSON.parse(fs.readFileSync(path.join(root,'results',file),'utf8'));counts[r.slug]=(counts[r.slug]||0)+r.data.records.length;}catch{}}return counts;}
const start=Date.now();
while(Date.now()-start<2*60*60*1000){
 const counts=tally();let finished=0;
 for(const a of authors){
  if(fs.existsSync(path.join(root,a.slug,'style.json'))){finished++;continue;}
  if(active.size>=2||active.has(a.slug)||failed.has(a.slug)||counts[a.slug]!==a.records)continue;
  const log=fs.openSync(path.join(root,a.slug,'synthesis.log'),'a');
  const child=spawn(process.execPath,[path.join(root,'synthesize.mjs'),root,a.slug],{stdio:['ignore',log,log]});
  active.set(a.slug,child);console.log(JSON.stringify({started:a.slug,records:a.records}));
  child.on('exit',code=>{fs.closeSync(log);active.delete(a.slug);if(code!==0)failed.add(a.slug);console.log(JSON.stringify({finished:a.slug,code}));});
 }
 console.log(JSON.stringify({styles:finished,totalAuthors:authors.length,active:[...active.keys()],failed:[...failed],analyzedRecords:Object.values(counts).reduce((a,b)=>a+b,0)}));
 if(finished===authors.length)break;
 if(failed.size&&active.size===0&&authors.every(a=>fs.existsSync(path.join(root,a.slug,'style.json'))||failed.has(a.slug)))break;
 await new Promise(r=>setTimeout(r,20000));
}
if(failed.size)process.exitCode=1;
