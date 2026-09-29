from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'knowledge/football-styles'
names={'aile':'艾乐的战术板 · 空间对位与机会转化','chiyi':'驰一指南 · 时间线纠偏与对位推导','laoxu':'老许的足球世界 · 比分重解与条件反转','make':'马克放大镜 · 条件翻转与功能缺口','tiancai':'天才足球 · 胜负手锚定与强度分级','mubiao':'目标爱足球 · 清单分层与多场方向','paoge':'炮哥的体育世界 · 赛制约束与链路复现','fanpeidong':'说球的范佩东 · 条件转换与比赛路径','boyang':'博扬足球 · 争议拆因与规则推演','chengzi':'橙子北看台 · 赛制分支与条件修正','leishu':'雷叔聊球 · 连环设问与利益链叙事'}
contract='【调用优先规则】以上模板中的变量只用于输入和设计，成稿必须用本次材料填好，不能把未填写的占位符留在口播正文。缺失事实如实说明，不能补造。论证检验顺序与成稿呈现顺序分开：先核验材料，成稿可以沿用作者先抛判断、问题或悬念再解释的呈现方式，不必把检验清单念给观众。默认输出可录制的口播正文；只有调用者明确要求才额外输出简短公开论证提纲。应用要求JSON或证据ID时，遵循应用的输出结构。历史案例仅用于说明作者的写法，不能作为本场事实；材料薄弱时降低方向强度。无方向模板若未在本作者现有正文中实际出现，应视为审慎迁移方案，不冒称作者惯例。角色不冒充作者本人，不沿用原稿自报战绩、身份和营销承诺。'
for p in BASE.glob('*/style.json'):
 v=json.loads(p.read_text());slug=p.parent.name;v['name']=names[slug]
 for field in ['instructions','description']:
  v[field]=v[field].replace(chr(92)*2+'n',chr(10)).replace(chr(92)+'n',chr(10))
 for item in v['knowledge']:
  item['content']=item['content'].replace(chr(92)*2+'n',chr(10)).replace(chr(92)+'n',chr(10))
 if slug=='leishu' and '【本风格的连环设问】' not in v['instructions']:
  v['instructions']='【本风格的连环设问】把连续设问作为换判断的桥：先摆观众熟悉的说法，指出表面不相容的信息，拆概念或账目，追问谁承担成本、谁受到约束，再用下一个问题推进到主题判断。每次揭示都须有材料兑现；谁受益只能产生待验证假设，不能代替因果证据。知识或轶事稿可以止于解释、反差和开放问题。'+chr(10)*2+v['instructions']
 v['instructions']=v['instructions'].replace('变量占位保留在稿件中供用户替换。','成稿须填写变量，未确认的信息如实说明。').replace('无法确认就写“据可核对的公开信息”或留空。','无法确认则明确说明信息未确认，不把未知包装成已核实。')
 if '【调用优先规则】' in v['instructions']:v['instructions']=v['instructions'].split('【调用优先规则】')[0].rstrip()
 v['instructions']+=chr(10)*2+contract
 for k in v['knowledge']:
  k['content']=k['content'].replace('保留变量占位供用户替换。','模板中的变量在调用时填写；成稿不保留未填写的占位符。').replace('变量占位保留在稿件中供用户替换。','调用时填好变量，成稿不保留未填写的占位符。')
 rr=[json.loads(l) for l in (p.parent/'corpus.jsonl').read_text().splitlines()];byid={r['id']:r for r in rr}
 refs=list(dict.fromkeys(re.findall(r'[a-z]+-[a-f0-9]{12}',chr(10).join([v['instructions']]+[k['content'] for k in v['knowledge']]))))
 lines=['【案例出处索引】']
 for rid in refs:
  if rid not in byid:raise ValueError('Invalid case reference '+rid)
  r=byid[rid];lines.append(rid+'：'+r['title']+'；'+r['source']+':'+str(r['startLine'])+'；视频ID '+str(r['videoId'] or '未提供'))
 k=next(k for k in v['knowledge'] if k['key']=='invocation')
 if '【案例出处索引】' not in k['content']:k['content']+=chr(10)*2+chr(10).join(lines)
 if len(v['instructions'])>8000 or any(len(k['content'])>10000 for k in v['knowledge']) or sum(len(k['content']) for k in v['knowledge'])>20000:raise ValueError('Length overflow '+slug)
 p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+chr(10))
 print(slug,len(v['instructions']),sum(len(k['content']) for k in v['knowledge']))
