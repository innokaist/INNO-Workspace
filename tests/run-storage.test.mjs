import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';
import {RunStorage} from '../server/run-storage.mjs';
const task={id:'11111111-1111-4111-8111-111111111111',title:'완료 작업',status:'completed',checkpoint:{generation:1,executionId:'22222222-2222-4222-8222-222222222222'}};
const id=task.id+'-1-'+task.checkpoint.executionId;
function fixture(t){const root=mkdtempSync(path.join(tmpdir(),'inno-storage-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(path.join(root,id));writeFileSync(path.join(root,id,'result.txt'),'result');return {root,store:new RunStorage(root)};}
test('inventory counts bytes and selected completed run can be removed',t=>{const {root,store}=fixture(t);const view=store.list([task]);assert.equal(view.bytes,6);assert.equal(view.runs[0].eligible,true);store.remove([{id,hash:view.runs[0].hash}],[task]);assert.equal(existsSync(path.join(root,id)),false);});
test('changed content and noncompleted or unknown tasks are protected',t=>{const {root,store}=fixture(t);const run=store.list([task]).runs[0];writeFileSync(path.join(root,id,'new.txt'),'new');assert.throws(()=>store.remove([run],[task]),/변경/);assert.ok(existsSync(path.join(root,id,'result.txt')));assert.equal(store.list([{...task,status:'running'}]).runs[0].eligible,false);assert.throws(()=>store.remove([run],[]));assert.throws(()=>store.remove([{id:'../outside',hash:'x'}],[task]));});
test('linked directories never authorize deletion outside the storage root',t=>{const {root,store}=fixture(t);const outside=mkdtempSync(path.join(tmpdir(),'inno-outside-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));writeFileSync(path.join(outside,'keep.txt'),'keep');symlinkSync(outside,path.join(root,id,'link'),'junction');assert.equal(store.list([task]).runs[0].eligible,false);assert.throws(()=>store.remove([{id,hash:'x'}],[task]));assert.equal(readFileSync(path.join(outside,'keep.txt'),'utf8'),'keep');});

test('all selections are checked before any removal',t=>{const {root,store}=fixture(t);const first=store.list([task]).runs[0];assert.throws(()=>store.remove([first,{id:'missing',hash:'x'}],[task]));assert.equal(existsSync(path.join(root,id,'result.txt')),true);});
