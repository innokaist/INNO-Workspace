import {createServer} from 'node:net';
import {readdir,stat} from 'node:fs/promises';
import path from 'node:path';
export async function acquireBridgeLock(port=4174){const server=createServer(socket=>socket.destroy());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({port,host:'127.0.0.1',exclusive:true},resolve);});return {port:server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};}
export function retryableStatus(status){return status===undefined||status===408||status===429||status>=500;}
export async function checkRunStorage(root,{maxBytes=256*1024*1024,maxEntries=5000}={}){let bytes=0,entries=0;async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(++entries>maxEntries)throw Error('Desktop run storage entry limit reached. Review saved outputs.');const full=path.join(dir,item.name);if(item.isSymbolicLink())continue;if(item.isDirectory())await walk(full);else{bytes+=(await stat(full)).size;if(bytes>maxBytes)throw Error('Desktop run storage limit reached (256 MiB). Review saved outputs.');}}}try{await walk(root);}catch(e){if(e.code!=='ENOENT')throw e;}return {bytes,entries};}
