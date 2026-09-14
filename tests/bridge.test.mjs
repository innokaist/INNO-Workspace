import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {D1_SCHEMA,D1TaskStore} from '../worker/store.mjs';
import {CloudBridge} from '../worker/bridge.mjs';
class TestD1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new TestD1Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return {success: true, results: this.database.prepare(this.sql).all(...this.values)}; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {success: true, results: [], meta: {changes: Number(result.changes)}};
  }
}

class TestD1Database {
  constructor() { this.database = new DatabaseSync(':memory:'); this.database.exec(D1_SCHEMA); }
  prepare(sql) { return new TestD1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}


async function fixture(){const db=new TestD1Database();const store=new D1TaskStore(db);const bridge=new CloudBridge(store);const task=await store.createTask({prompt:'Say hello'});return {db,store,bridge,task};}
test('queue only explicitly requested tasks; duplicate claims cannot launch twice',async()=>{const {bridge,store,task}=await fixture();assert.equal(await bridge.claim(),null);await bridge.enqueue(task.id,{expectedVersion:task.version});const outcomes=await Promise.allSettled([bridge.claim(),bridge.claim()]);assert.equal(outcomes.filter(x=>x.status==='fulfilled'&&x.value).length,1);assert.equal((await store.requireTask(task.id)).status,'running');});
test('completion retry after lost response is idempotent',async()=>{const {bridge,store,task}=await fixture();await bridge.enqueue(task.id,{expectedVersion:1});const c=await bridge.claim();const input={...c,content:'hello',artifacts:[{name:'hello.md',mime:'text/markdown',content:'hello'}]};delete input.task;await bridge.complete(task.id,input);await bridge.complete(task.id,input);const t=await store.requireTask(task.id);assert.equal(t.messages.filter(m=>m.role==='assistant').length,1);assert.equal(t.artifacts.length,1);});
test('pause fences renewal and late result; materials are never queued',async()=>{const {bridge,store,task}=await fixture();await assert.rejects(()=>bridge.enqueue(task.id,{expectedVersion:1,materials:[{name:'secret',text:'private'}]}));await bridge.enqueue(task.id,{expectedVersion:1});const c=await bridge.claim();const t=await store.requireTask(task.id);await store.applyAction(task.id,{action:'pause',expectedVersion:t.version});await assert.rejects(()=>bridge.renew(task.id,c));await assert.rejects(()=>bridge.complete(task.id,{...c,content:'late'}));});

test('new attachments added after queueing prevent source-free execution',async()=>{const {bridge,store,task}=await fixture();const queued=await bridge.enqueue(task.id,{expectedVersion:1});await store.applyAction(task.id,{action:'attachments',expectedVersion:queued.version,attachments:[{name:'paper.txt',source:'file'}]});assert.equal(await bridge.claim(),null);assert.equal((await store.requireTask(task.id)).status,'waiting_connection');});
test('expired execution pauses without rerun and its saved result recovers once',async()=>{const {bridge,store,task}=await fixture();await bridge.enqueue(task.id,{expectedVersion:1});const c=await bridge.claim();store.now=()=>new Date(Date.now()+180000).toISOString();assert.equal(await bridge.claim(),null);assert.equal((await store.requireTask(task.id)).status,'paused');await bridge.complete(task.id,{...c,content:'saved result'});await bridge.complete(task.id,{...c,content:'saved result'});const t=await store.requireTask(task.id);assert.equal(t.status,'completed');assert.equal(t.messages.filter(m=>m.role==='assistant').length,1);});

import {createWorker} from '../worker/index.mjs';
test('authenticated HTTP queue to completion contract persists only one result',async()=>{const db=new TestD1Database();const worker=createWorker();const env={DB:db,ACCESS_TOKEN:'test-secret-01234567890123456789'};const call=(p,b,auth=true)=>worker.fetch(new Request('https://inno.example'+p,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+env.ACCESS_TOKEN}:{})},body:JSON.stringify(b)}),env);assert.equal((await call('/api/desktop/poll',{},false)).status,401);const {task}=await (await call('/api/tasks',{prompt:'hello'})).json();assert.equal((await call('/api/tasks/'+task.id+'/run',{provider:'codex',expectedVersion:1})).status,202);const {claim}=await (await call('/api/desktop/poll',{})).json();const body={executionId:claim.executionId,generation:claim.generation,content:'hello'};assert.equal((await call('/api/desktop/'+task.id+'/renew',body)).status,200);for(let i=0;i<2;i++)assert.equal((await call('/api/desktop/'+task.id+'/complete',body)).status,200);assert.equal((await new D1TaskStore(db).requireTask(task.id)).messages.length,2);});

test('direct source claim validates exact source names and task version',async()=>{const {bridge,store,task}=await fixture();const t=await store.applyAction(task.id,{action:'attachments',expectedVersion:1,attachments:[{name:'paper.txt',path:'folder/paper.txt',source:'file'}]});await assert.rejects(()=>bridge.start(task.id,{expectedVersion:t.version,sourceNames:[]}));assert.equal((await store.requireTask(task.id)).status,'ready');const c=await bridge.start(task.id,{expectedVersion:t.version,sourceNames:['folder/paper.txt']});assert.equal(c.task.status,'running');await assert.rejects(()=>bridge.start(task.id,{expectedVersion:t.version,sourceNames:['folder/paper.txt']}));});

test('URL-only direct task cannot pretend its source was supplied',async()=>{const {bridge,store,task}=await fixture();const t=await store.applyAction(task.id,{action:'attachments',expectedVersion:1,attachments:[{name:'paper',source:'url',url:'https://example.org/paper'}]});await assert.rejects(()=>bridge.start(task.id,{expectedVersion:t.version,sourceNames:[]}),/URL references/);assert.equal((await store.requireTask(task.id)).status,'ready');});

test('new user input after expiry fences saved output recovery',async()=>{const {bridge,store,task}=await fixture();await bridge.enqueue(task.id,{expectedVersion:1});const c=await bridge.claim();store.now=()=>new Date(Date.now()+180000).toISOString();await bridge.claim();const t=await store.requireTask(task.id);await store.applyAction(task.id,{action:'message',expectedVersion:t.version,content:'Changed request'});await assert.rejects(()=>bridge.complete(task.id,{...c,content:'obsolete'}));});

test('expiry transition racing completion is refetched without duplicate delivery',async()=>{const {bridge,store,task}=await fixture();await bridge.enqueue(task.id,{expectedVersion:1});const c=await bridge.claim();const replace=store.replaceTask.bind(store);let inject=true;store.replaceTask=async(id,version,update)=>{if(inject){inject=false;await replace(id,version,t=>({...t,status:'paused',version:t.version+1,updatedAt:store.now(),checkpoint:{...t.checkpoint,interruptedBy:'lease_expiry',interruptedVersion:t.version+1}}));}return replace(id,version,update);};await bridge.complete(task.id,{...c,content:'saved'});assert.equal((await store.requireTask(task.id)).messages.filter(m=>m.role==='assistant').length,1);});
