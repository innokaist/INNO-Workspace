import {acquireBridgeLock,retryableStatus,checkRunStorage} from '../server/bridge-runtime.mjs';
import {readFileSync,writeFileSync,renameSync,unlinkSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCodexRunner} from '../server/runners.mjs';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const privateDir=path.join(root,'.inno');mkdirSync(privateDir,{recursive:true});
const endpoint=new URL(process.env.INNO_CLOUD_URL||'https://inno-workspace-api.innokaist.workers.dev');
if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('Cloud endpoint must be an HTTPS origin');
const token=readFileSync(path.join(privateDir,'cloud-access-token.txt'),'utf8').trim();
const pendingPath=path.join(privateDir,'desktop-pending.json');
const outbox={read:()=>existsSync(pendingPath)?JSON.parse(readFileSync(pendingPath,'utf8')):null,write:record=>{const raw=JSON.stringify(record);writeFileSync(pendingPath+'.tmp',raw,{mode:0o600});renameSync(pendingPath+'.tmp',pendingPath);},clear:()=>{if(existsSync(pendingPath))unlinkSync(pendingPath);}};
const request=async(route,body)=>{if(Buffer.byteLength(JSON.stringify(body))>700000)throw Object.assign(Error('Result saved locally; cloud transfer limit exceeded.'),{status:413});const response=await fetch(new URL(route,endpoint),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Object.assign(Error(`INNO HTTP ${response.status}`),{status:response.status});return response.json();};
const runner=createCodexRunner({cwd:path.join(privateDir,'desktop-runs'),managedDelivery:true});
if(!await runner.available())throw Error('Sign in to Codex using your ChatGPT subscription before starting the desktop bridge.');
const lock=await acquireBridgeLock();
const bridge=createDesktopBridge({request,runner,outbox});
let stopping=false,wake;
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{stopping=true;bridge.stop();wake?.();});
console.log('INNO desktop bridge connected. One task at a time; Ctrl+C to stop.');
let delay=15000,lastError='';
while(!stopping){
 try{if(!outbox.read())await checkRunStorage(path.join(privateDir,'desktop-runs'));if(stopping)break;const worked=await bridge.tick();delay=worked?15000:Math.min(60000,delay*1.5);if(worked)console.log('INNO result delivered.');lastError='';}
 catch(e){const message=e.status===409?'Execution changed. Review .inno/desktop-pending.json before resuming.':e.status===401?'Cloud authentication failed.':e.message;if(message!==lastError){console.error(message);lastError=message;}delay=Math.min(60000,delay*2);if(!retryableStatus(e.status))break;}
 if(!stopping)await new Promise(resolve=>{const timer=setTimeout(resolve,delay);wake=()=>{clearTimeout(timer);resolve();};});
}

await lock.close();
