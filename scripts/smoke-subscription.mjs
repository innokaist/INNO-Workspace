import assert from 'node:assert/strict';
import {startLocalServer} from '../server/index.mjs';
const app=await startLocalServer({env:{...process.env,INNO_PORT:'0',INNO_DB_PATH:'.inno/smoke.sqlite',INNO_EXECUTOR_WORKSPACE:'.inno/smoke-executor'},logger:{log(){}}});
const url=new URL(app.onboardingUrl).origin;
const headers={authorization:`Bearer ${app.config.token}`,'content-type':'application/json'};
const request=async(p,body)=>{const r=await fetch(url+p,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v};
try{
const before=await request('/api/state');console.log('Codex connected:',before.capabilities.localCodex);
const {task}=await request('/api/tasks',{prompt:'This is a simple integration smoke test. Reply with exactly INNO_SMOKE_OK as summary. No tools, files, or subagents are needed.',type:'general'});
await request(`/api/tasks/${task.id}/run`,{provider:'codex',expectedVersion:task.version,materials:[]});
const until=Date.now()+180000;
let result;
while(Date.now()<until){await new Promise(r=>setTimeout(r,2000));const s=await request('/api/state');result=s.tasks.find(t=>t.id===task.id);if(!['running','claimed','queued'].includes(result.status))break;}
console.log(JSON.stringify({status:result?.status,answer:result?.messages?.at(-1)?.content,checkpoint:result?.checkpoint,artifacts:result?.artifacts?.map(x=>x.name)}));
assert.equal(result?.status,'completed');assert.match(result.messages.at(-1).content,/INNO_SMOKE_OK/);
console.log('REAL_SUBSCRIPTION_SMOKE_PASS');
}finally{await app.close();}
