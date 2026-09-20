import {createServer} from 'node:net';
import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
export async function acquireBridgeLock(port=4174){const server=createServer(socket=>socket.destroy());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({port,host:'127.0.0.1',exclusive:true},resolve);});return {port:server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};}
export function retryableStatus(status){return status===undefined||status===408||status===429||status>=500;}
export async function checkRunStorage(root,{maxBytes=256*1024*1024,maxEntries=5000}={}){let bytes=0,entries=0;async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(++entries>maxEntries)throw Error('Desktop run storage entry limit reached. Review saved outputs.');const full=path.join(dir,item.name);if(item.isSymbolicLink())continue;if(item.isDirectory())await walk(full);else{bytes+=(await stat(full)).size;if(bytes>maxBytes)throw Error('Desktop run storage limit reached (256 MiB). Review saved outputs.');}}}try{await walk(root);}catch(e){if(e.code!=='ENOENT')throw e;}return {bytes,entries};}

export function startupPortMessage(error){
 if(error?.code!=='EADDRINUSE')return null;
 return 'INNO 시작 안내: 로컬 포트 '+error.port+'을 이미 사용 중입니다. 다른 INNO 창이 실행 중이면 그대로 두고 .inno/DESKTOP-ACCESS.md의 링크로 접속하세요. 접속되지 않으면 해당 포트를 사용하는 프로그램을 확인하세요. 기존 프로그램은 종료하지 않았습니다.';
}
