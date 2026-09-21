import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCodexRunner} from '../server/runners.mjs';
test('runner applies catalog policy, native concurrency limit, and durable labeled report',async()=>{
 let args,input='';const spawnProcess=(_c,a)=>{args=a;const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.stdin.on('data',c=>input+=c);p.stdin.on('finish',()=>{p.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary:'answer',routing:{understanding:'goal',assignments:[],review:'checked'}})}})+'\n');p.emit('close',0)});return p;};
 const run=createCodexRunner({spawnProcess,ensureDirectory:()=>{},runDirectory:()=>process.cwd(),modelCatalog:async()=>[{model:'gpt-6-astra',efforts:['high'],isDefault:true}]});
 const result=await run.run({task:{id:'t',prompt:'work'}});
 assert.ok(args.includes('agents.max_concurrent_threads_per_session=2'));assert.match(input,/BEFORE spawning/);assert.match(input,/gpt-6-astra/);assert.equal(result.artifacts.at(-1).name,'inno-model-routing.json');assert.equal(JSON.parse(result.artifacts.at(-1).content).runtimeVerified,false);
});

