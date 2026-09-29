from pathlib import Path
import json,re,hashlib,collections
ROOT=Path(__file__).resolve().parents[2]
SRC=ROOT/'足球文案库'; OUT=ROOT/'knowledge/football-styles'; OUT.mkdir(parents=True,exist_ok=True)
AUTHORS={'老许的足球世界':'laoxu','驰一指南':'chiyi','马克放大镜':'make','天才足球':'tiancai','目标爱足球':'mubiao','炮哥的体育世界':'paoge','说球的范佩东':'fanpeidong','博扬足球':'boyang','橙子北看台':'chengzi','艾乐的战术板':'aile','雷叔聊球':'leishu'}
files=[]; records=[]; excluded=[]
for p in sorted(SRC.rglob('*')):
 if not p.is_file():continue
 rel=str(p.relative_to(ROOT)); raw=p.read_bytes()
 if p.suffix not in ['.md','.txt'] or '视频ID列表' in p.name:
  excluded.append({'source':rel,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'reason':'视频元数据/ID清单或系统文件，不是文案正文'});continue
 author=next((a for a in AUTHORS if a in rel),None)
 if not author:raise ValueError(rel)
 s=raw.decode('utf-8-sig');lines=s.splitlines(keepends=True)
 if p.suffix=='.txt':
  starts=[i for i,l in enumerate(lines) if re.match(r'^(?:【视频[0-9]+】|视频[0-9]+[：:])',l)]
 else:
  starts=[i for i,l in enumerate(lines) if l.startswith('## ') and ('视频ID' in l or author in ['目标爱足球','天才足球']) and '提取说明' not in l]
 if not starts:starts=[0]
 spans=[]
 for j,a in enumerate(starts):
  b=starts[j+1] if j+1<len(starts) else len(lines)
  text=''.join(lines[a:b]).strip(); title=lines[a].strip().lstrip('#').strip()
  vid=re.search(r'(?:视频)?ID[：:][ ]*([0-9]{15,22})',text)
  vid=vid.group(1) if vid else None
  norm=str().join(text.split())
  uid=AUTHORS[author]+'-'+hashlib.sha256((rel+':'+str(a+1)).encode()).hexdigest()[:12]
  item={'id':uid,'author':author,'slug':AUTHORS[author],'source':rel,'title':title,'videoId':vid,'startLine':a+1,'endLine':b,'chars':len(text),'sha256':hashlib.sha256(text.encode()).hexdigest(),'text':text}
  records.append(item);spans.append(uid)
 files.append({'source':rel,'author':author,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'chars':len(s),'lines':len(lines),'preambleLines':starts[0],'records':spans})
# Only exact normalized body duplicates are shared; same-video differing content remains separate.
seen={}
for r in records:
 body=re.sub(r'^(?:#{1,6} .*|【视频.*|视频[0-9]+[：:].*|(?:视频)?ID[：:].*|发布时间[：:].*|时长[：:].*|[=-]{3,})$','',r['text'],flags=re.M)
 h=hashlib.sha256(str().join(body.split()).encode()).hexdigest()
 if len(body.strip())>100 and (r['slug'],h) in seen:r['duplicateOf']=seen[(r['slug'],h)]
 else:seen[(r['slug'],h)]=r['id']
for slug in AUTHORS.values():
 d=OUT/slug;d.mkdir(exist_ok=True)
 rr=[r for r in records if r['slug']==slug]
 (d/'corpus.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+chr(10) for r in rr))
manifest={'version':1,'asOf':'2026-09-30','sourceRoot':'足球文案库','authors':[{'author':a,'slug':sl,'records':sum(r['slug']==sl for r in records),'characters':sum(r['chars'] for r in records if r['slug']==sl),'exactDuplicateRecords':sum(bool(r.get('duplicateOf')) for r in records if r['slug']==sl)} for a,sl in AUTHORS.items()],'files':files,'excludedFiles':excluded,'rules':['现有文件覆盖不等于作者全部作品；不信任文件名宣称的全部或90条。','每条均保留原文及行号；相同视频ID的不同版本不自动丢弃。','没有字幕、占位、截断以及图文作品必须由全文分析标记；不将索引当正文。','事实只作写法研究，不作为当前足球事实依据。']}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+chr(10))
print(json.dumps({'authors':manifest['authors'],'sourceFiles':len(files),'excludedFiles':len(excluded),'records':len(records),'chars':sum(r['chars'] for r in records)},ensure_ascii=False,indent=2))
