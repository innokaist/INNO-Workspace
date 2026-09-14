import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTask} from '../public/core/tasks.mjs';
import {prepareImport} from '../public/core/imports.mjs';
test('import preserves history and output but excludes source bytes and execution credentials',async()=>{const t=createTask({prompt:'history'});t.status='running';t.checkpoint={content:'verified progress',executionId:'old-owner',generation:9,token:'SECRET'};t.attachments=[{id:'a',name:'a.txt',source:'file',content:'SOURCE_BYTES',token:'SECRET'}];t.artifacts=[{id:'out',name:'answer.md',mime:'text/markdown',content:'real output'}];const p=await prepareImport(t);assert.equal(p.task.status,'paused');assert.equal(p.task.artifacts[0].content,'real output');assert.equal(p.task.checkpoint.content,'verified progress');assert.equal(JSON.stringify(p).includes('SECRET'),false);assert.equal(JSON.stringify(p).includes('SOURCE_BYTES'),false);assert.equal(JSON.stringify(p).includes('old-owner'),false);assert.equal(p.hash,(await prepareImport(t)).hash);});
test('malformed records fail rather than silently losing history',async()=>{const t=createTask({prompt:'test'});t.messages=[{role:'alien',content:'bad'}];await assert.rejects(()=>prepareImport(t));});

import {DatabaseSync} from 'node:sqlite';
import {D1_SCHEMA,D1TaskStore} from '../worker/store.mjs';
import {RecordImporter} from '../worker/imports.mjs';
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



test('repeat import after cloud edits never overwrites cloud content',async()=>{const store=new D1TaskStore(new TestD1Database()),i=new RecordImporter(store),t=createTask({prompt:'local history'});assert.equal((await i.import(t)).status,'created');const cloud=await store.requireTask(t.id);await store.applyAction(t.id,{action:'message',expectedVersion:cloud.version,content:'new cloud request'});assert.equal((await i.import(t)).status,'skipped');assert.equal((await store.requireTask(t.id)).messages.at(-1).content,'new cloud request');const modified={...t,prompt:'different local history'};assert.equal((await i.import(modified)).status,'conflict');const copied=await i.import(modified,{copy:true});assert.equal(copied.status,'created');assert.notEqual(copied.id,t.id);assert.equal((await i.import(modified,{copy:true})).status,'skipped');});
test('concurrent imports produce exactly one persisted task',async()=>{const store=new D1TaskStore(new TestD1Database()),i=new RecordImporter(store),t=createTask({prompt:'same'});const results=await Promise.all([i.import(t),i.import(t)]);assert.deepEqual(results.map(r=>r.status).sort(),['created','skipped']);assert.equal((await store.listTasks()).length,1);});

import {createWorker} from '../worker/index.mjs';
test('import HTTP endpoint is authenticated and idempotent',async()=>{const worker=createWorker(),env={DB:new TestD1Database(),ACCESS_TOKEN:'test-token-01234567890123456789'},task=createTask({prompt:'HTTP import'});const send=(auth=true)=>worker.fetch(new Request('https://inno.example/api/imports',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+env.ACCESS_TOKEN}:{})},body:JSON.stringify({task})}),env);assert.equal((await send(false)).status,401);assert.equal((await (await send()).json()).status,'created');assert.equal((await (await send()).json()).status,'skipped');});
