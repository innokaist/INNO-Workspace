import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {prepareImport} from '../public/core/imports.mjs';
export class LocalRecords {
 constructor(filename){this.filename=filename;}
 async withDatabase(fn){if(!existsSync(this.filename))return null;const db=new DatabaseSync(this.filename,{readOnly:true});try{return await fn(db);}finally{db.close();}}
 async list(cursor=''){
  if(typeof cursor!=='string'||cursor.length>200)throw Object.assign(Error('Invalid cursor'),{status:400});
  return await this.withDatabase(async db=>{
   const rows=db.prepare("SELECT id,json_extract(body,'$.title') AS title,json_extract(body,'$.status') AS status,updated_at,length(CAST(body AS BLOB)) AS bytes,CASE WHEN length(CAST(body AS BLOB))<=900000 THEN body ELSE NULL END AS body FROM tasks WHERE id>? ORDER BY id LIMIT 51").all(cursor);
   const records=[];for(const row of rows.slice(0,50)){try{if(!row.body)throw Error('Record exceeds transfer size; original preserved');const p=await prepareImport(JSON.parse(row.body));records.push({id:row.id,title:row.title,status:row.status,updatedAt:row.updated_at,bytes:row.bytes,hash:p.hash});}catch(e){records.push({id:row.id,title:row.title,status:row.status,bytes:row.bytes,error:e.message});}}
   return {records,nextCursor:rows.length>50?records.at(-1).id:null};
  })??{records:[],nextCursor:null};
 }
 async read(id,expectedHash){
  if(typeof id!=='string'||typeof expectedHash!=='string')throw Object.assign(Error('Record ID and fingerprint are required'),{status:400});
  const result=await this.withDatabase(async db=>{
   const row=db.prepare('SELECT CASE WHEN length(CAST(body AS BLOB))<=900000 THEN body ELSE NULL END AS body FROM tasks WHERE id=?').get(id);
   if(!row?.body)throw Object.assign(Error('Local record is missing or too large'),{status:404});
   const p=await prepareImport(JSON.parse(row.body));if(p.hash!==expectedHash)throw Object.assign(Error('Local record changed. Refresh the list and select it again.'),{status:409});return p.task;
  });if(!result)throw Object.assign(Error('Local database is missing'),{status:404});return result;
 }
}
