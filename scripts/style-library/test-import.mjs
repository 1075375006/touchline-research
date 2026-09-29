import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
test('imports profiles and protects existing styles and human edits',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'football-style-import-'));
 const file=path.join(dir,'test.sqlite');const d=new DatabaseSync(file);
 d.exec('CREATE TABLE writing_styles(id TEXT PRIMARY KEY,name TEXT,description TEXT,instructions TEXT,chars_per_minute INTEGER,enabled INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE writing_knowledge(id TEXT PRIMARY KEY,style_id TEXT REFERENCES writing_styles(id),title TEXT,content TEXT,enabled INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE writing_meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE audit(id INTEGER PRIMARY KEY,user_id TEXT,action TEXT,detail TEXT,created_at TEXT);CREATE TABLE writing_runs(id TEXT PRIMARY KEY,content TEXT);');
 d.prepare('INSERT INTO writing_styles VALUES(?,?,?,?,?,?,?,?)').run('builtin-evidence','Existing user style','','Do not change this original style',240,1,'before','before');
 d.prepare('INSERT INTO writing_runs VALUES(?,?)').run('historic','Keep historical content');
 const args=['scripts/style-library/import.mjs','--bundle','knowledge/football-styles','--db',file,'--authors','aile,chiyi'];
 try{
  let r=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(d.prepare('SELECT count(*) n FROM writing_styles').get().n,1);
  r=spawnSync(process.execPath,[...args,'--apply'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  assert.equal(d.prepare('SELECT count(*) n FROM writing_styles').get().n,3);
  assert.equal(d.prepare('SELECT count(*) n FROM writing_knowledge').get().n,12);
  assert.equal(d.prepare('SELECT content FROM writing_runs WHERE id=?').get('historic').content,'Keep historical content');
  assert.equal(d.prepare('SELECT instructions FROM writing_styles WHERE id=?').get('builtin-evidence').instructions,'Do not change this original style');
  const backups=fs.readdirSync(path.join(dir,'style-library-backups'));assert.equal(backups.length,1);
  const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'style-library-backups',backups[0]),'utf8'));assert.equal(snapshot.targetIds.length,2);assert.ok(snapshot.before.every(x=>x.rows===null));
  d.prepare('UPDATE writing_styles SET instructions=? WHERE id=?').run('User edited role','corpus-aile');
  r=spawnSync(process.execPath,[...args,'--apply'],{encoding:'utf8'});assert.notEqual(r.status,0);assert.ok(r.stderr.includes('refusing to overwrite'));
  assert.equal(d.prepare('SELECT instructions FROM writing_styles WHERE id=?').get('corpus-aile').instructions,'User edited role');
 }finally{d.close();fs.rmSync(dir,{recursive:true,force:true});}
});
