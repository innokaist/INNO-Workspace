export function createDesktopBridge({request,runner,outbox,heartbeatMs=15000}){
 let busy=false,stopped=false,controller;
 async function deliver(record){await request(`/api/desktop/${encodeURIComponent(record.taskId)}/${record.action}`,record.input);outbox.clear();}
 return {
  stop(){stopped=true;controller?.abort();},
  async tick(){
   if(busy||stopped)return false;busy=true;
   try{
    const pending=outbox.read();if(pending){await deliver(pending);return true;}
    const {claim}=await request('/api/desktop/poll',{});if(!claim||stopped)return false;
    const {task,executionId,generation}=claim;const owner={executionId,generation};controller=new AbortController();
    let monitorError,renewal=null;
    const timer=setInterval(()=>{if(renewal)return;renewal=request(`/api/desktop/${encodeURIComponent(task.id)}/renew`,owner).catch(e=>{monitorError=e;controller.abort();}).finally(()=>{renewal=null;});},heartbeatMs);
    let result,runError;
    try{result=await runner.run({task,...owner,materials:[],signal:controller.signal});}catch(e){runError=e;}
    finally{clearInterval(timer);if(renewal)await renewal;}
    if(monitorError)throw monitorError;
    if(controller.signal.aborted)throw Error('Desktop execution stopped');
    const record={taskId:task.id,action:runError?'fail':'complete',input:runError?{...owner,error:'Desktop executor failed. Inspect the local runner; retry explicitly.',status:runError.code==='QUOTA_EXCEEDED'?'waiting_quota':'failed'}:{...owner,content:result.content,checkpoint:result.checkpoint,artifacts:result.artifacts}};
    outbox.write(record);await deliver(record);return true;
   }finally{busy=false;controller=null;}
  }
 };
}
