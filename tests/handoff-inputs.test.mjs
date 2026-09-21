import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareHandoffInputs} from '../server/handoff-inputs.mjs';
test('generated handoff artifacts become local files with safe names and exact bytes',async t=>{const directory=await mkdtemp(path.join(tmpdir(),'handoff-'));t.after(()=>rm(directory,{recursive:true,force:true}));const task={checkpoint:{handoff:{artifactIds:['a']}},artifacts:[{id:'a',name:'../../draft.md',mime:'text/markdown',content:'draft evidence',encoding:'utf-8'}]};const manifest=await prepareHandoffInputs(task,directory);assert.equal(manifest.length,1);assert.equal(await readFile(path.join(directory,manifest[0].path),'utf8'),'draft evidence');assert.ok(path.resolve(directory,manifest[0].path).startsWith(directory+path.sep));await assert.rejects(()=>prepareHandoffInputs({...task,artifacts:[]},directory),/missing/);});
