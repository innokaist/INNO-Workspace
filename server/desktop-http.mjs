import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath,stat} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>750000)throw Object.assign(Error('Request exceeds 750000 bytes'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}}
export function createDesktopServer({token,publicDir,request,bridge}){
 if(typeof token!=='string'||token.length<24)throw Error('A strong local token is required');
 const root=path.resolve(publicDir instanceof URL?fileURLToPath(publicDir):publicDir);
 const server=createServer(async(req,res)=>{
  try{
   const port=server.address()?.port,hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
   if(!hosts.has(req.headers.host))return json(res,403,{error:'Invalid local host'});
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Cross-origin access is not allowed'});
   const url=new URL(req.url,`http://${req.headers.host}`),p=url.pathname;
   if(p.startsWith('/api/')){
    const expected=Buffer.from('Bearer '+token),actual=Buffer.from(req.headers.authorization||'');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return json(res,401,{error:'unauthorized'});
    if(req.method==='GET'&&p==='/api/state'){const state=await request(p);return json(res,200,{...state,capabilities:{...state.capabilities,desktopSources:true},localDesktop:bridge.status()});}
    const run=p.match(/^\/api\/tasks\/([^/]+)\/run$/);
    if(req.method==='POST'&&run){const input=await body(req);if(input.provider==='codex')return json(res,202,{task:await bridge.startTask(decodeURIComponent(run[1]),input)});if(input.provider==='claude')return json(res,202,await request(p,input));return json(res,400,{error:'Invalid provider'});}
    if(req.method==='POST'&&(p==='/api/tasks'||/^\/api\/tasks\/[^/]+\/actions$/.test(p)))return json(res,p==='/api/tasks'?201:200,await request(p,await body(req)));
    return json(res,404,{error:'not found'});
   }
   if(req.method!=='GET')return json(res,404,{error:'not found'});
   const candidate=path.resolve(root,p==='/'?'index.html':decodeURIComponent(p).replace(/^\/+/,''));
   const realRoot=await realpath(root),file=await realpath(candidate);
   if(!file.startsWith(realRoot+path.sep)||!MIME[path.extname(file)])return json(res,404,{error:'not found'});
   if(!(await stat(file)).isFile())return json(res,404,{error:'not found'});
   res.writeHead(200,{'content-type':MIME[path.extname(file)],'cache-control':'no-cache','x-content-type-options':'nosniff'});const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch(e){if(res.headersSent){res.destroy();return;}json(res,e.status||e.statusCode||(e.name==='ValidationError'?400:e.code==='ENOENT'?404:500),{error:e.status===401?'Cloud authentication failed':e.message});}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;return server;
}
