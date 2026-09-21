import {writeFile} from 'node:fs/promises';
import path from 'node:path';
export async function prepareHandoffInputs(task,directory){
 const ids=task.checkpoint?.handoff?.artifactIds??[];
 if(!Array.isArray(ids)||ids.length>20||new Set(ids).size!==ids.length)throw Error('Invalid handoff artifact manifest');
 let total=0;
 const files=ids.map((id,index)=>{
  const a=task.artifacts?.find(a=>a.id===id);if(!a||typeof a.content!=='string')throw Error('Handoff artifact missing');
  if(a.content.length>7000000)throw Error('Handoff artifact exceeds limit');
  if(a.encoding&&!['utf-8','base64'].includes(a.encoding))throw Error('Invalid handoff artifact encoding');
  const bytes=Buffer.from(a.content,a.encoding==='base64'?'base64':'utf8');
  if(a.encoding==='base64'&&bytes.toString('base64')!==a.content.replace(/\s/g,''))throw Error('Invalid handoff base64');
  total+=bytes.length;if(total>5000000)throw Error('Handoff generated files exceed 5 MB');
  const extension=String(a.name).match(/\.[a-z0-9]{1,8}$/i)?.[0]??'.bin';
  return {bytes,manifest:{name:String(a.name).slice(0,500),mime:a.mime,path:'inno-handoff-'+String(index+1).padStart(3,'0')+extension}};
 });
 for(const file of files)await writeFile(path.join(directory,file.manifest.path),file.bytes,{flag:'wx'});
 return files.map(file=>file.manifest);
}
