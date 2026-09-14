import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopBridge} from '../server/desktop-bridge.mjs';
function box(){let value=null;return {read:()=>value,write:v=>{value=v;},clear:()=>{value=null;}};}
test('lost completion response retries saved output without executing AI twice',async()=>{
 const outbox=box();let runs=0,completes=0;const request=async(route)=>{if(route.endsWith('poll'))return {claim:{task:{id:'t'},executionId:'e',generation:1}};if(route.endsWith('complete')){if(++completes===1)throw Error('network');return {task:{status:'completed'}};}};
 const bridge=createDesktopBridge({request,outbox,runner:{run:async()=>{runs++;return {content:'ok'};}}});await assert.rejects(()=>bridge.tick());assert.ok(outbox.read());await bridge.tick();assert.equal(runs,1);assert.equal(completes,2);assert.equal(outbox.read(),null);
});
test('concurrent ticks never run two jobs on one desktop',async()=>{let resolve;let polls=0;const gate=new Promise(r=>resolve=r);const bridge=createDesktopBridge({outbox:box(),request:async()=>{polls++;await gate;return {claim:null};},runner:{}});const a=bridge.tick();await bridge.tick();resolve();await a;assert.equal(polls,1);});
test('lost ownership aborts the local process and never uploads its output',async()=>{let uploaded=false;const bridge=createDesktopBridge({outbox:box(),heartbeatMs:5,request:async p=>{if(p.endsWith('poll'))return {claim:{task:{id:'t'},executionId:'e',generation:1}};if(p.endsWith('renew'))throw Object.assign(Error('stale'),{status:409});uploaded=true;},runner:{run:({signal})=>new Promise((res,rej)=>signal.addEventListener('abort',()=>rej(Error('aborted'))))}});await assert.rejects(()=>bridge.tick());assert.equal(uploaded,false);});

import {acquireBridgeLock,retryableStatus,checkRunStorage} from '../server/bridge-runtime.mjs';
test('exclusive process lock prevents multiple local consumers and releases cleanly',async()=>{const lock=await acquireBridgeLock(0);try{await assert.rejects(()=>acquireBridgeLock(lock.port),{code:'EADDRINUSE'});}finally{await lock.close();}const reopened=await acquireBridgeLock(lock.port);await reopened.close();});
test('transient HTTP errors remain retryable while permanent errors stop',()=>{for(const s of [undefined,408,429,500,502,503])assert.equal(retryableStatus(s),true);for(const s of [400,401,403,409,413])assert.equal(retryableStatus(s),false);});

test('stop during poll never launches the arriving claim',async()=>{let release,runs=0;const bridge=createDesktopBridge({outbox:box(),request:()=>new Promise(r=>release=r),runner:{run:()=>{runs++;}}});const tick=bridge.tick();bridge.stop();release({claim:{task:{id:'t'},executionId:'e',generation:1}});await tick;assert.equal(runs,0);});
