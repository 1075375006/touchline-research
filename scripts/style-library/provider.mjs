import fs from 'node:fs';
import {createDecipheriv} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
export function configuredProvider() {
  const db = new DatabaseSync('/app/data/touchline.sqlite', {readOnly:true});
  const id = process.env.STYLE_PROVIDER_ID || '3122c160-2bb9-4ae7-888b-2dc0611dc241';
  const p = db.prepare('SELECT * FROM providers WHERE enabled=1 AND id=?').get(id);
  db.close();
  if (!p || !['openai','responses'].includes(p.type)) throw Error('Enabled provider unavailable');
  const key = Buffer.from(process.env.APP_SECRET || fs.readFileSync('/app/data/.encryption-key','utf8').trim(),'hex');
  const [iv,encrypted,tag] = p.secret.split(':');
  const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'hex'));
  decipher.setAuthTag(Buffer.from(tag,'hex'));
  const secret = decipher.update(encrypted,'hex','utf8') + decipher.final('utf8');
  const base = p.base_url.endsWith('/') ? p.base_url.slice(0,-1) : p.base_url;
  async function request(system, prompt, maxTokens = Number(p.max_tokens)) {
    const messages = [{role:'system',content:system},{role:'user',content:prompt}];
    const body = p.type === 'responses'
      ? {model:p.model,input:messages,stream:true,max_output_tokens:maxTokens,text:{format:{type:'json_object'}}}
      : {model:p.model,messages,max_tokens:maxTokens,response_format:{type:'json_object'},thinking:{type:'disabled'}};
    const response = await fetch(base + (p.type==='responses'?'/responses':'/chat/completions'), {
      method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},
      body:JSON.stringify(body),signal:AbortSignal.timeout(Math.max(Number(p.timeout_seconds)*1000,180000))
    });
    if(!response.ok) throw Error('Provider '+p.name+' HTTP '+response.status);
    let result;
    if(p.type==='responses'){
      let buffer='',final,delta='';const decoder=new TextDecoder();
      function line(text){
        if(!text.startsWith('data:'))return;
        const raw=text.slice(5).trim();if(!raw||raw==='[DONE]')return;
        const event=JSON.parse(raw);
        if(event.type==='response.output_text.delta')delta+=event.delta||'';
        if(event.type==='response.completed'||event.type==='response.incomplete')final=event.response;
        if(event.type==='response.failed'||event.type==='error')throw Error('Model response failed');
      }
      for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let at;while((at=buffer.indexOf(String.fromCharCode(10)))>=0){line(buffer.slice(0,at).trimEnd());buffer=buffer.slice(at+1);}}
      buffer+=decoder.decode();if(buffer.trim())line(buffer.trimEnd());
      if(!final)throw Error('Stream ended before completed response');
      result=final;if(!result.output_text&&delta)result.output_text=delta;
    }else result=await response.json();
    if(result.status==='incomplete'||result.choices?.[0]?.finish_reason==='length') throw Error('Model output truncated');
    const content = p.type==='responses'
      ? (result.output_text || result.output?.filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join(String.fromCharCode(10)))
      : result.choices?.[0]?.message?.content;
    if(typeof content!=='string'||!content) throw Error('No model content');
    const data=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1));
    return {data,usage:result.usage,model:result.model,providerId:p.id};
  }
  return {id:p.id,name:p.name,model:p.model,type:p.type,maxTokens:Number(p.max_tokens),request};
}
if (process.argv.includes('--probe')) {
  const client=configuredProvider();
  const response=await client.request('仅输出JSON。','输出字段ok值为true的JSON。',128);
  console.log(JSON.stringify({provider:client.name,model:response.model,data:response.data}));
}
