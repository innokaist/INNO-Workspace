import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SqliteTaskStore} from '../server/store.mjs';
import {LocalRecords} from '../server/local-records.mjs';
test('missing local database is not created by browsing',async()=>{const p=path.join(tmpdir(),'missing-inno-'+crypto.randomUUID()+'.sqlite');assert.deepEqual((await new LocalRecords(p).list()).records,[]);assert.equal(existsSync(p),false);});
test('local selection uses fingerprint and rereads without changing the source',async t=>{const dir=mkdtempSync(path.join(tmpdir(),'inno-import-'));const db=new SqliteTaskStore(path.join(dir,'tasks.sqlite'));t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});const task=db.createTask({prompt:'local source'});const reader=new LocalRecords(path.join(dir,'tasks.sqlite'));const rows=await reader.list();const chosen=rows.records[0];assert.equal(chosen.id,task.id);assert.equal('messages' in chosen,false);const imported=await reader.read(task.id,chosen.hash);assert.equal(imported.id,task.id);assert.equal(db.requireTask(task.id).version,1);db.applyAction(task.id,{action:'message',expectedVersion:1,content:'changed'});await assert.rejects(()=>reader.read(task.id,chosen.hash),{status:409});});
