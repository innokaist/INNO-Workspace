const names=['comparison.md','ideas.md','review.md'];
const marker='선택한 문헌 목록(내용은 임시 연결 자료에서 조회):';
function decode(a){
 if(typeof a.content!=='string'||a.content.length>1_000_000)throw Error('invalid text');
 if(a.encoding==='base64')return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(a.content),c=>c.charCodeAt(0)));
 if(a.encoding&&a.encoding!=='utf-8')throw Error('unsupported encoding');
 return a.content;
}
export function auditLiterature(task){
 if(task?.prompt?.startsWith('문헌 결과 별도 검토 — inno-literature-review-v1')||task?.prompt?.startsWith('inno-literature-review-v1'))return null;
 if(!task||task.type!=='literature'||!task.prompt?.includes('inno-literature-evidence-v1')||task.status!=='completed')return null;
 const issues=[];let labels=[];
 try{const start=task.prompt.lastIndexOf(marker);if(start<0)throw Error();const manifest=JSON.parse(task.prompt.slice(start+marker.length).trim());if(!Array.isArray(manifest)||manifest.length<2||manifest.length>8||manifest.some((p,i)=>p.label!=='P'+(i+1)))throw Error();labels=manifest.map(p=>p.label);}catch{issues.push('문헌 목록을 확인할 수 없습니다. 요청의 목록을 확인하세요.');}
 const started=Date.parse(task.checkpoint?.claimedAt);
 if(!Number.isFinite(started))issues.push('최신 실행의 시작 시각을 확인할 수 없습니다.');
 const artifacts=(task.artifacts||[]).filter(a=>Number.isFinite(started)&&Date.parse(a.createdAt)>=started);
 let review='';
 for(const name of names){
  const matches=artifacts.filter(a=>a.name===name);
  if(matches.length!==1){issues.push(name+': 최신 실행 결과가 '+(matches.length?'중복되어 있습니다.':'없습니다.'));continue;}
  let text;try{text=decode(matches[0]);}catch{issues.push(name+': 텍스트를 읽을 수 없습니다.');continue;}
  if(!text.trim()){issues.push(name+': 내용이 비어 있습니다.');continue;}
  const refs=[...new Set(text.match(/\bP[1-9]\d*\b/g)||[])];
  if(!refs.length)issues.push(name+': 문헌 번호가 없습니다.');
  if(refs.some(r=>!labels.includes(r)))issues.push(name+': 선택 목록에 없는 문헌 번호가 있습니다.');
  if(name==='comparison.md'&&labels.some(l=>!refs.includes(l)))issues.push(name+': 비교표에 선택 문헌 번호가 누락되었습니다.');
  if(name==='review.md')review=text;
 }
 const summaries=(task.messages||[]).filter(m=>m.role==='assistant'&&Number.isFinite(started)&&Date.parse(m.createdAt)>=started).map(m=>m.content||'').join('\n');
 const note=summaries+'\n'+review+'\n'+(typeof task.checkpoint==='string'?task.checkpoint:task.checkpoint?.content||'');
 if(/검토.{0,35}(실패|오류)|review.{0,35}(failed|failure|unavailable)/i.test(note))issues.push('검토 실패가 보고되었습니다. 검토 범위와 후속 확인이 필요합니다.');
 const result={status:issues.length?'attention':'passed',issues,semanticVerified:false,independentReviewVerified:false};return result;
}
export function repairLiteraturePrompt(audit){
 return '문헌 결과의 다음 점검 항목을 확인하고 수정해 주세요. 원문이 필요하면 같은 자료를 다시 연결한 뒤 실행합니다.\n'+audit.issues.map(x=>'- '+x).join('\n')+'\ncomparison.md, ideas.md, review.md 세 문서를 모두 최신 결과로 반환하세요. 문헌 번호를 실제 근거와 대조하고 형식만 맞추기 위해 근거를 만들지 마세요. 독립 검토가 실행되지 않았다면 자기검토임을 명시하세요. 해결할 수 없는 항목은 이유와 추가로 필요한 자료를 남기세요.';
}
