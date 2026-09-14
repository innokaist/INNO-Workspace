import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createDesktopServer} from '../server/desktop-http.mjs';
import {acquireBridgeLock,retryableStatus,checkRunStorage} from '../server/bridge-runtime.mjs';
import {readFileSync,writeFileSync,renameSync,unlinkSync,existsSync,mkdirSync,readdirSync,statSync} from 'node:fs';
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
const request=async(route,body)=>{if(body!==undefined&&Buffer.byteLength(JSON.stringify(body))>700000)throw Object.assign(Error('Result saved locally; cloud transfer limit exceeded.'),{status:413});const response=await fetch(new URL(route,endpoint),{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Object.assign(Error(`INNO HTTP ${response.status}`),{status:response.status});return response.json();};
let codexCommand='codex';
if(process.platform==='win32'&&process.env.LOCALAPPDATA){
 const binRoot=path.join(process.env.LOCALAPPDATA,'OpenAI','Codex','bin');
 if(existsSync(binRoot)){
  const installed=readdirSync(binRoot,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(binRoot,e.name,'codex.exe')).filter(existsSync).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
  if(installed.length)codexCommand=installed[0];
 }
}
const runner=createCodexRunner({spawnProcess:(command,args,options)=>spawn(command==='codex'?codexCommand:command,args,options),cwd:path.join(privateDir,'desktop-runs'),managedDelivery:true});
if(!await runner.available())throw Error('Sign in to Codex using your ChatGPT subscription before starting the desktop bridge.');
const lock=await acquireBridgeLock();
const bridge=createDesktopBridge({request,runner,outbox,beforeClaim:()=>checkRunStorage(path.join(privateDir,'desktop-runs')),onError:e=>console.error(e.status?'INNO result delivery HTTP '+e.status:'INNO execution interrupted; saved results are retained.')});
const localTokenPath=path.join(privateDir,'desktop-access-token.txt');
if(!existsSync(localTokenPath))writeFileSync(localTokenPath,randomBytes(32).toString('base64url'),{mode:0o600});
const localToken=readFileSync(localTokenPath,'utf8').trim();
const desktopServer=createDesktopServer({token:localToken,publicDir:path.join(root,'public'),request,bridge});
try{await new Promise((resolve,reject)=>{desktopServer.once('error',reject);desktopServer.listen(4175,'127.0.0.1',resolve);});}catch(e){await lock.close();throw e;}
writeFileSync(path.join(privateDir,'DESKTOP-ACCESS.md'),'# Desktop cloud workspace\n\n[Open desktop cloud workspace](http://127.0.0.1:4175/#token='+encodeURIComponent(localToken)+')\n\nThis private link opens the same cloud tasks and reads selected sources locally. Do not share it.\n');
let stopping=false,wake;
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{stopping=true;bridge.stop();wake?.();});
console.log('Desktop source connection: open .inno/DESKTOP-ACCESS.md');
console.log('INNO desktop bridge connected. One task at a time; Ctrl+C to stop.');
let delay=15000,lastError='';
while(!stopping){
 try{if(stopping)break;const worked=await bridge.tick();delay=worked?15000:Math.min(60000,delay*1.5);if(worked)console.log('INNO result delivered.');lastError='';}
 catch(e){const message=e.status===409?'Execution changed. Review .inno/desktop-pending.json before resuming.':e.status===401?'Cloud authentication failed.':e.message;if(message!==lastError){console.error(message);lastError=message;}delay=Math.min(60000,delay*2);if(!retryableStatus(e.status))break;}
 if(!stopping)await new Promise(resolve=>{const timer=setTimeout(resolve,delay);wake=()=>{clearTimeout(timer);resolve();};});
}

await bridge.settled();
await new Promise(resolve=>desktopServer.close(resolve));
await lock.close();
