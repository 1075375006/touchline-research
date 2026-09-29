from pathlib import Path
import json,hashlib,collections,re,sys
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'knowledge/football-styles';NL=chr(10)
manifest=json.loads((BASE/'manifest.json').read_text())
all_records=[];all_stats=[];issues=[];missing=[]
receipts=list((BASE/'results').glob('*.json'))
receipts=[json.loads(p.read_text()) for p in receipts if not p.name.endswith('.error.json')]
found={}
for receipt in receipts:
 for i,source_id in enumerate(receipt['sourceIds']):
  match=[r for r in receipt['data']['records'] if r['id']==source_id]
  if len(match)!=1 or source_id in found:raise ValueError('duplicate or missing analysis '+source_id)
  found[source_id]={'analysis':match[0],'sourceHash':receipt['sourceHashes'][i],'processedAt':receipt['processedAt'],'model':receipt.get('recordModels',{}).get(source_id,receipt['model'])}
for f in manifest['files']+manifest['excludedFiles']:
 actual=hashlib.sha256((ROOT/f['source']).read_bytes()).hexdigest()
 if actual!=f['sha256']:raise ValueError('Source changed '+f['source'])
for author in manifest['authors']:
 folder=BASE/author['slug'];records=[json.loads(l) for l in (folder/'corpus.jsonl').read_text().splitlines()]
 merged=[];md=['# '+author['author']+' · 逐篇公开论证拆解','','说明：以下只分析所提供原稿的论证与表达，不认证足球事实。direction 是对倾向表达的辅助标记，必须与 kind 和实际观点一起读；none 不表示没有价值观点或规则主张，尤其不应把非赛果观点误读为比赛预测。来源行号指向本次整理时的原文。body 代表存在可分析正文，不代表外部确认其等于原视频完整字幕；partial 为发现截断/片段；missing 为缺失或占位；graphic 为有文字的图文作品。','']
 for r in records:
  if r['id'] not in found:raise ValueError('Not analyzed: '+r['id'])
  entry=found[r['id']];v=entry['analysis']
  for key in ['availability','kind','direction','claim','bridge','counter','ending','risk']:
   if not isinstance(v.get(key),str) or not v[key].strip():raise ValueError('Incomplete field '+r['id']+' '+key)
  if not isinstance(v.get('steps'),list) or any(not isinstance(x,str) for x in v['steps']):raise ValueError('Invalid steps '+r['id'])
  if entry['sourceHash']!=r['sha256']:raise ValueError('Hash mismatch '+r['id'])
  for quote in v['anchors']:
   if quote not in r['text']:raise ValueError('Anchor mismatch '+r['id'])
  info={k:x for k,x in r.items() if k!='text'};info.update(v);info['analysisModel']=entry['model'];info['processedAt']=entry['processedAt'];merged.append(info);all_records.append(info)
  md+=['## '+r['title'],'','- 记录ID：'+r['id'],'- 来源：['+r['source']+':'+str(r['startLine'])+'](<'+str(ROOT/r['source'])+':'+str(r['startLine'])+'>)','- 原视频ID：'+str(r.get('videoId') or '原文未提供'),' - 文本可用性 / 稿型 / 方向：'+v['availability']+' / '+v['kind']+' / '+v['direction'],'','**实际观点**：'+v['claim'],'','**公开推进路径**','']
  md += [str(i+1)+'. '+step for i,step in enumerate(v['steps'])]
  md+=['','**关键桥梁**：'+v['bridge'],'','**反证处理**：'+v['counter'],'','**收束方式**：'+v['ending'],'','**局限与跳步**：'+v['risk'],'','**原文锚点**','']
  md += ['> '+q.replace(NL,NL+'> ') for q in v['anchors']]
  md+=['','---','']
  if v['availability'] in ['missing','partial']:missing.append(info)
 availability=dict(collections.Counter(r['availability'] for r in merged));directions=dict(collections.Counter(r['direction'] for r in merged));kinds=dict(collections.Counter(r['kind'] for r in merged))
 stats={**author,'analyzedRecords':len(merged),'availability':availability,'directions':directions,'kinds':kinds,'uniqueKnownVideoIds':len({r['videoId'] for r in records if r['videoId']})};all_stats.append(stats)
 (folder/'analyses.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+NL for r in merged))
 (folder/'逐篇拆解.md').write_text(NL.join(md))
 (folder/'coverage.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+NL)
 if '--records-only' in sys.argv:continue
 style=json.loads((folder/'style.json').read_text())
 case_ids=list(dict.fromkeys(re.findall(r'[a-z]+-[a-f0-9]{12}',NL.join([style['instructions']]+[k['content'] for k in style['knowledge']]))))
 source_by_id={r['id']:r for r in records}
 for cid in case_ids:
  if cid not in source_by_id:raise ValueError('Untraceable style case '+cid)
 readme=['# '+style['name'],'',style['description'],'','## 语料覆盖','',f'本地记录 {len(records)} 条；可用性分布：'+json.dumps(availability,ensure_ascii=False)+'。相同视频不同版本分别处理。','', '这是一种基于现有语料归纳的功能角色，不代表作者本人。默认语速 240 字/分钟是可编辑建议，未进行声音实测。','', '## 角色提示词','',style['instructions'],'']
 for index_number,k in enumerate(style['knowledge'],1):
  readme+=['## '+k['title'],'',k['content'],'']
  (folder/(str(index_number).zfill(2)+'-'+k['key']+'.md')).write_text('# '+k['title']+NL*2+k['content']+NL)
 readme+=['## 案例出处索引','']
 for cid in case_ids:
  r=source_by_id[cid];readme+=['- '+cid+'：'+r['title']+'；'+r['source']+':'+str(r['startLine'])+'；视频ID '+str(r['videoId'] or '未提供')]
 (folder/'README.md').write_text(NL.join(readme)+NL)
 (folder/'角色提示词.md').write_text('# '+style['name']+' · 角色提示词'+NL*2+style['instructions']+NL)
 if len(style['instructions'])>8000:raise ValueError('Instructions too long')
 if sum(len(k['content'].encode('utf-16-le'))//2 for k in style['knowledge'] if k['enabled'])>20000:raise ValueError('Knowledge too long')
all_source_ids={r['id'] for r in all_records}
if set(found)!=all_source_ids:raise ValueError('Unmapped analysis records')
def usage_items(value):
 if isinstance(value,list):
  for item in value:yield from usage_items(item)
 elif isinstance(value,dict):yield value
usage=[u for r in receipts for u in usage_items(r.get('usage',{}))]
coverage={'asOf':'2026-09-30','sourceFiles':len(manifest['files']),'records':len(all_records),'analyzedRecords':len(found),'complete':True,'characters':sum(a['characters'] for a in all_stats),'authors':all_stats,'availability':dict(collections.Counter(r['availability'] for r in all_records)),'directions':dict(collections.Counter(r['direction'] for r in all_records)),'method':'All source records analyzed in full; configured-model analysis with three directly read editorial completions and three risk-field corrections; ID/hash/quote checks and representative editorial review; no football fact verification','inputSourceFilesUnchanged':True,'extractionReceipts':len(receipts),'tokenUsage':{'successfulReceiptsOnly':True,'input':sum(u.get('prompt_tokens',u.get('input_tokens',0)) for u in usage),'output':sum(u.get('completion_tokens',u.get('output_tokens',0)) for u in usage)}}
(BASE/'coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+NL)
by_video=collections.defaultdict(list)
for r in all_records:
 if r['videoId']:by_video[(r['slug'],r['videoId'])].append(r)
versions=[{'author':rr[0]['author'],'videoId':key[1],'records':[{'id':r['id'],'availability':r['availability'],'source':r['source'],'startLine':r['startLine']} for r in rr]} for key,rr in by_video.items() if len(rr)>1]
(BASE/'versions.json').write_text(json.dumps(versions,ensure_ascii=False,indent=2)+NL)
report=['# 缺失、截断与版本说明','','这里统计文件内的文案记录，不等于独立视频数。缺失记录可能被另一个同ID版本补足。以下结论只基于现有原文，未另行访问视频。','']
for r in missing:
 other=[x for x in by_video.get((r['slug'],r['videoId']),[]) if x['id']!=r['id'] and x['availability'] in ['body','graphic']]
 index_audit=[]
for item in manifest['excludedFiles']:
 if item['source'].endswith('.DS_Store'):continue
 matching=[a for a in all_stats if a['author'] in item['source']]
 if len(matching)!=1:continue
 author=matching[0];content=(ROOT/item['source']).read_text()
 indexed_ids=set(re.findall(r'(?<![0-9])[0-9]{19}(?![0-9])',content))
 known={str(r['videoId']) for r in all_records if r['slug']==author['slug'] and r['videoId']}
 unknown=sorted(indexed_ids-known)
 index_audit.append({'author':author['author'],'source':item['source'],'indexedVideoIds':len(indexed_ids),'unmatchedVideoIds':unknown})
(BASE/'source-index-audit.json').write_text(json.dumps(index_audit,ensure_ascii=False,indent=2)+NL)
report+=['## 视频索引核对','','索引中的ID未匹配，不一定表示文案缺失：部分正文没有原视频ID。这些仅列为待核对，不计作已读正文。','']
for item in index_audit:report+=['- '+item['author']+'｜'+item['source']+'：索引 '+str(item['indexedVideoIds'])+' 个ID；未匹配 '+str(len(item['unmatchedVideoIds']))+' 个。完整ID见 source-index-audit.json。']
report+=['## '+r['author']+'｜'+r['title'],'','- 状态：'+r['availability'],'- 记录：'+r['id'],'- 来源：'+r['source']+':'+str(r['startLine']),'- 说明：'+r['risk'],'- 同ID可用版本：'+('、'.join(x['id'] for x in other) or '未按视频ID匹配到；无ID的版本可能仍有重叠'),'']
report+=['## 元数据与标题数量不能代替正文','','- 天才足球分类目录名称宣称90个视频，实际分出50个标题小节；另有最近10条文件，合计60条记录，其中含重复与缺失。','- 炮哥文件自述23个作品，实际可分篇标题为22条；不凭简介补造第23条。','- 博扬各分册实际小节合计356条，文件自述全库362条；差额不作为已获得字幕。','']
(BASE/'缺失与版本说明.md').write_text(NL.join(report))
if '--records-only' in sys.argv:
 print(json.dumps({'recordsComplete':True,'records':coverage['records'],'availability':coverage['availability'],'profilesFinalized':False},ensure_ascii=False));sys.exit(0)
index=['# 作者风格索引与调用路由','','每次选择一种主风格，再输入本场核验材料、方向或无方向、稿型和时长。案例是写法研究，不能当作新比赛事实。','','| 作者 | 风格 / 适用入口 | 本地记录 | 正文 / 片段 / 缺失 / 图文 |','|---|---|---:|---|']
for a in all_stats:
 s=json.loads((BASE/a['slug']/'style.json').read_text());av=a['availability'];index+=['| ['+a['author']+']('+a['slug']+'/README.md) | '+s['description'].replace('|',' / ')+' | '+str(a['records'])+' | '+' / '.join(str(av.get(k,0)) for k in ['body','partial','missing','graphic'])+' |']
index+=['','## 通用调用提示','','请选择【作者风格】。讨论【主题/对阵】，面向【受众】，写【时长/字数】的【稿型】。研究材料是【已核验事实与出处】；待检验的方向是【假设，或无预设方向】；最强反证是【反证/未知】。按照该风格的核心推导机制组织，但方向强度不得超过材料。先给我一个简短的公开论证提纲（不是私有思维链），再写口播稿。没有足够材料得出方向时，转成看点/条件分支稿。','', '## 如何追溯','','角色和知识条目 → 案例记录ID → 作者 analyses.jsonl / 逐篇拆解.md → 原文件与行号。原始输入及哈希保存在 corpus.jsonl 与 manifest.json，批次回执保存在 results。','']
(BASE/'作者风格索引.md').write_text(NL.join(index))
print(json.dumps({'complete':True,'records':coverage['records'],'authors':len(all_stats),'availability':coverage['availability'],'styles':len(all_stats),'knowledgeItems':sum(len(json.loads((BASE/a['slug']/'style.json').read_text())['knowledge']) for a in all_stats)},ensure_ascii=False))
