import {ConflictError,ValidationError} from '../public/core/tasks.mjs';

export class CloudBridge {
  constructor(store){this.store=store;}
  async enqueue(id,input){
    if(input.materials?.length)throw new ValidationError('Desktop source transfer is not connected. Reconnect sources on the desktop; source content is never queued.');
    return this.store.replaceTask(id,input.expectedVersion,t=>{
      if(!['ready','failed','waiting_connection','waiting_quota'].includes(t.status))throw new ConflictError('Task must be ready before queueing.',t.version);
      if(t.attachments.length)throw new ValidationError('This task needs source reconnection before desktop execution.');
      const now=this.store.now();return {...t,status:'queued',version:t.version+1,updatedAt:now,checkpoint:{...t.checkpoint,provider:'codex',status:'queued',updatedAt:now}};
    });
  }
  async claim(){
    await this.seen();
    const expired=await this.store.db.prepare("SELECT body FROM tasks WHERE json_extract(body,'$.status')='running' AND json_extract(body,'$.checkpoint.provider')='codex' AND json_extract(body,'$.checkpoint.expiresAt') < ?1 ORDER BY updated_at ASC LIMIT 1").bind(this.store.now()).first();
    if(expired){const t=JSON.parse(expired.body);try{await this.store.replaceTask(t.id,t.version,current=>({...current,status:'paused',version:current.version+1,updatedAt:this.store.now(),checkpoint:{...current.checkpoint,status:'paused',content:'Desktop connection expired. Review saved progress before explicitly resuming.'}}));}catch(e){if(!(e instanceof ConflictError))throw e;}}
    const row=await this.store.db.prepare("SELECT body FROM tasks WHERE json_extract(body,'$.status')='queued' ORDER BY updated_at ASC LIMIT 1").first();
    if(!row)return null;
    const t=JSON.parse(row.body);
    if(t.checkpoint?.provider!=='codex')return null;
    if(t.attachments.length){await this.store.markWaiting(t.id,{expectedVersion:t.version,provider:'codex',reason:'Source reconnection required.'});return null;}
    try{return await this.store.claimExecution(t.id,{provider:'codex',expectedVersion:t.version,leaseMs:120000});}catch(e){if(e instanceof ConflictError)return null;throw e;}
  }
  async seen(){
    const now=Date.parse(this.store.now());
    await this.store.db.prepare("INSERT INTO metadata (key,value) VALUES ('desktop_seen',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE metadata.value < ?2").bind(now,now-60000).run();
  }
  async presence(){const row=await this.store.db.prepare("SELECT value FROM metadata WHERE key='desktop_seen'").first();return {lastSeen:row?.value??null,online:!!row&&Date.parse(this.store.now())-row.value<180000};}
  async renew(id,input){
    await this.seen();
    const t=await this.store.requireTask(id);
    return this.store.replaceTask(id,t.version,current=>{
      this.store.assertExecution(current,input);
      if(Date.parse(current.checkpoint.expiresAt)<=Date.parse(this.store.now()))throw new ConflictError('Execution lease expired',current.version);
      const now=this.store.now();return {...current,version:current.version+1,updatedAt:now,checkpoint:{...current.checkpoint,updatedAt:now,expiresAt:new Date(Date.parse(now)+120000).toISOString()}};
    });
  }
  async fail(id,input){
    const t=await this.store.requireTask(id);
    if(['failed','waiting_quota'].includes(t.status)&&t.checkpoint?.executionId===input.executionId&&t.checkpoint?.generation===input.generation)return t;
    return this.store.failExecution(id,input);
  }
  async complete(id,input){
    const t=await this.store.requireTask(id);
    if(t.status==='completed'&&t.checkpoint?.executionId===input.executionId&&t.checkpoint?.generation===input.generation)return t;
    this.store.assertExecution(t,input);
    if(Date.parse(t.checkpoint.expiresAt)<=Date.parse(this.store.now()))throw new ConflictError('Execution lease expired',t.version);
    return this.store.finishExecution(id,input);
  }
}
