import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const root=process.argv[2] || '/tmp/football-style-work';
const dbPath=process.argv[3] || '/app/data/touchline.sqlite';
const db=new DatabaseSync(dbPath,{readOnly:true});
const authors=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).authors;
const results=[];
for(const author of authors){
  const profile=JSON.parse(fs.readFileSync(path.join(root,author.slug,'style.json'),'utf8'));
  const installed=db.prepare('SELECT * FROM writing_styles WHERE id=?').get(profile.id);
  assert.ok(installed,'Missing style '+profile.id);
  for(const field of ['name','description','instructions'])assert.equal(installed[field],profile[field],profile.id+' '+field);
  assert.equal(installed.chars_per_minute,profile.charsPerMinute);
  assert.equal(installed.enabled,1);
  const knowledge=db.prepare('SELECT title,content,enabled FROM writing_knowledge WHERE style_id=?').all(profile.id);
  assert.equal(knowledge.length,profile.knowledge.length);
  for(const expected of profile.knowledge){
    const matches=knowledge.filter(k=>k.title===expected.title);
    assert.equal(matches.length,1,profile.id+' '+expected.title);
    assert.equal(matches[0].content,expected.content);
    assert.equal(matches[0].enabled,1);
  }
  assert.ok(knowledge.reduce((n,k)=>n+k.content.length,0)<=20000);
  results.push({id:profile.id,name:installed.name,knowledge:knowledge.length,exactMatch:true});
}
console.log(JSON.stringify({verified:true,authors:results.length,knowledge:results.reduce((n,r)=>n+r.knowledge,0),styles:results},null,2));
db.close();
