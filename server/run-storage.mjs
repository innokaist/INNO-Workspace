import {existsSync,lstatSync,realpathSync,opendirSync,unlinkSync,rmdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const fail=message=>Object.assign(Error(message),{status:409});
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
export class RunStorage {
 constructor(root){this.root=path.resolve(root);}
 snapshot(tasks=[]){
  if(!existsSync(this.root))return {bytes:0,entries:0,runs:[]};
  if(lstatSync(this.root).isSymbolicLink()||!same(realpathSync(this.root),this.root))throw fail('저장 폴더 경로가 연결 경로입니다. 수동으로 확인하세요.');
  let entries=0,total=0;const runs=[];
  const walk=(full,relative,records,state)=>{
   if(++entries>10000)throw fail('10,000개 항목을 초과하여 조회를 중단했습니다. 저장 폴더를 직접 확인하세요.');
   const s=lstatSync(full);const linked=s.isSymbolicLink();
   const kind=linked?'link':s.isDirectory()?'directory':s.isFile()?'file':'other';
   records.push({relative,kind,size:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs,ino:s.ino});
   if(linked||kind==='other'){state.safe=false;return;}
   if(!same(realpathSync(full),full))throw fail('저장 경로가 변경되었습니다. 다시 조회하세요.');
   if(kind==='file'){state.bytes+=s.size;total+=s.size;return;}
   const d=opendirSync(full);try{let e;while((e=d.readSync()))walk(path.join(full,e.name),path.join(relative,e.name),records,state);}finally{d.closeSync();}
  };
  const d=opendirSync(this.root);try{let entry;while((entry=d.readSync())){
   const id=entry.name,records=[],state={bytes:0,safe:true};walk(path.join(this.root,id),'',records,state);records.sort((a,b)=>a.relative.localeCompare(b.relative));
   const task=tasks.find(t=>t.status==='completed'&&id===t.id+'-'+t.checkpoint?.generation+'-'+t.checkpoint?.executionId);
   const eligible=!!task&&state.safe&&records[0]?.kind==='directory';
   runs.push({id,title:task?.title??id,bytes:state.bytes,eligible,reason:!state.safe?'연결 경로 또는 특수 파일 포함':!task?'클라우드 완료 실행과 일치하지 않음':!eligible?'실행 폴더가 아님':'완료 확인',hash:createHash('sha256').update(JSON.stringify(records)).digest('hex'),records,files:records.filter(r=>r.kind==='file').slice(0,20).map(r=>r.relative)});
  }}finally{d.closeSync();}
  return {bytes:total,entries,runs};
 }
 list(tasks){const s=this.snapshot(tasks);return {...s,runs:s.runs.map(({records,...r})=>r),limitBytes:256*1024*1024,limitEntries:5000};}
 remove(selected,tasks){
  if(!Array.isArray(selected)||!selected.length||selected.length>50)throw fail('정리할 실행을 1~50개 선택하세요.');
  const snapshot=this.snapshot(tasks),seen=new Set();
  const targets=selected.map(item=>{if(!item||typeof item.id!=='string'||seen.has(item.id))throw fail('선택 항목이 잘못되었습니다.');seen.add(item.id);const r=snapshot.runs.find(r=>r.id===item.id);if(!r?.eligible||r.hash!==item.hash)throw fail('보호 대상이거나 파일이 변경되었습니다. 다시 조회하세요.');return r;});
  let removed=0;
  try{for(const run of targets){
   const base=path.resolve(this.root,run.id);if(path.dirname(base)!==this.root)throw fail('잘못된 저장 경로입니다.');
   const records=[...run.records].sort((a,b)=>b.relative.split(path.sep).length-a.relative.split(path.sep).length||b.relative.length-a.relative.length);
   for(const record of records){const target=path.resolve(base,record.relative);if(target!==base&&!target.startsWith(base+path.sep))throw fail('잘못된 하위 경로입니다.');const s=lstatSync(target);if(s.isSymbolicLink()||!same(realpathSync(target),target))throw fail('연결 경로는 정리할 수 없습니다.');if(record.kind==='file'){if(!s.isFile()||s.size!==record.size||s.mtimeMs!==record.mtime||s.ctimeMs!==record.ctime||s.ino!==record.ino)throw fail('파일이 변경되었습니다.');unlinkSync(target);}else if(record.kind==='directory'&&s.isDirectory())rmdirSync(target);else throw fail('파일 종류가 변경되었습니다.');}
   removed++;
  }}catch{throw fail('정리 중 변경 또는 접근 오류가 발생했습니다. '+removed+'개 폴더 정리 완료; 일부 파일만 정리되었을 수 있으므로 다시 조회하세요.');}
  return {removed};
 }
}
