import {usageRows} from './core/execution-usage.mjs';
import {experimentPacket} from './core/experiment-links.mjs?v=direct-1';
import {createExperimentLinks} from './experiment-links.mjs?v=direct-1';
import {buildLiteratureReview} from './core/literature-review.mjs';
import {auditLiterature,repairLiteraturePrompt} from './core/literature-quality.mjs';
const literatureAudits=new WeakMap();
import {buildLiteratureWorkflow} from './core/literature-workflow.mjs';
import {createStorageUI} from './run-storage.mjs';
import {failureGuidance} from './core/failures.mjs';
import {createRecordImportUI} from './record-import.mjs';
import {WorkspaceClient,exportBundle,parseBundle,validateEndpoint} from './core/client.mjs';
import {AttachmentSession} from './core/attachments.mjs';
import {extractConnectedText} from './core/extract.mjs';
import {INTEGRATIONS,parseRefAtlas,parsePrismReport,searchPapers} from './core/research.mjs';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={ready:'실행 대기',queued:'실행 대기',claimed:'실행 준비',running:'진행 중',paused:'일시정지',waiting_user:'결정 대기',waiting_quota:'한도 대기',waiting_connection:'연결 대기',failed:'실행 실패',cancelled:'취소됨',completed:'완료',pending:'대기',proposed:'제안',done:'완료'};
const typeNames={general:'일반 작업',literature:'문헌 · 아이디어',analysis:'분석 · Figure',writing:'논문 · 문서',presentation:'발표자료',career:'CV · 지원서'};
const names={workspace:'작업실',research:'연구 자료',integrations:'연결 앱',usage:'사용량'};
const session=new AttachmentSession();
const selectedPapers=new Set();
let client,activeId=null,view='workspace',draftAttachments=[],papers=[],prismReports=[],busy=false,refreshing=false,previewUrls=[],lastRendered='';
const storageUI=createStorageUI(()=>client);
const recordImports=createRecordImportUI({getClient:()=>client,onDone:()=>refresh()});
const state=()=>client?.state||{tasks:[],capabilities:{},usage:[]};
const current=()=>state().tasks.find(t=>t.id===activeId);
const attachments=()=>current()?.attachments||draftAttachments;
const bytes=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
const date=v=>{const d=new Date(v);return Number.isNaN(+d)?'':d.toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});};
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),6500);}
async function guarded(fn){if(busy)return;busy=true;try{await fn();}catch(e){toast(e.message||'작업을 처리하지 못했습니다.');if(e.status===409){await refresh();toast('다른 기기에서 변경된 최신 기록을 불러왔습니다. 내용을 확인하고 다시 시도하세요.');}}finally{busy=false;renderControls();}}
function linkSafe(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function openDialog(id){$(id).showModal();}
function closeSidebar(){$('sidebar').classList.remove('open');$('sidebar-scrim').classList.remove('open');}
function setView(next){view=next;for(const key of Object.keys(names))$(`${key}-view`).classList.toggle('hidden',key!==next);$('view-title').textContent=names[next];document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===next));closeSidebar();if(next==='research')renderResearch();if(next==='usage')renderUsage();}
function selectTask(id){activeId=id;lastRendered='';localStorage.setItem('inno-active-task',id||'');setView('workspace');render();$('conversation-scroll').scrollTop=$('conversation-scroll').scrollHeight;}
function newTask(){activeId=null;localStorage.removeItem('inno-active-task');draftAttachments=[];lastRendered='';$('prompt').value='';setView('workspace');render();$('prompt').focus();}
function renderList(){
 const query=$('task-search').value.toLowerCase();const tasks=state().tasks.filter(t=>`${t.title} ${t.prompt}`.toLowerCase().includes(query)).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
 $('task-count').textContent=state().tasks.length;
 $('task-list').innerHTML=tasks.length?tasks.map(t=>`<button class="task-item ${t.id===activeId?'active':''}" data-task="${esc(t.id)}"><span class="task-item-title">${esc(t.title)}</span><small>${esc(statusNames[t.status]||t.status)} · ${esc(date(t.updatedAt))}</small></button>`).join(''):'<p class="task-list-empty">기록된 작업이 없습니다.<br>첫 번째 질문을 남겨보세요.</p>';
}
function renderMessages(){
 const t=current();$('welcome').classList.toggle('hidden',!!t);$('task-toolbar').classList.toggle('hidden',!t);
 if(!t){$('messages').innerHTML='';return;}
 $('task-title').textContent=t.title;$('task-type-label').textContent=typeNames[t.type]||'WORKSPACE';$('task-status').textContent=statusNames[t.status]||t.status;$('task-status').className=`status ${t.status}`;
 const key=t.id+':'+t.version;if(lastRendered===key)return;lastRendered=key;
 const wasBottom=$('conversation-scroll').scrollHeight-$('conversation-scroll').scrollTop-$('conversation-scroll').clientHeight<130;
 $('messages').innerHTML=(t.messages||[]).map(m=>`<article class="message ${['user','assistant','system'].includes(m.role)?m.role:'system'}"><div class="message-head"><strong>${m.role==='user'?'YOU':m.role==='assistant'?'INNO · ASSISTANT':'WORKSPACE · 상태 기록'}</strong><span>${esc(date(m.createdAt))}</span></div><div class="message-body">${esc(m.content)}</div></article>`).join('');
 if(t.status==='waiting_user'){
  const d=document.createElement('div');d.className='decision-box';d.innerHTML='<p>진행에 필요한 결정이 있습니다. 아래 대화창에 선택이나 수정 요청을 남기세요.</p>';
  const choices=t.decision?.options||[];
  for(const option of choices){const b=document.createElement('button');b.textContent=typeof option==='string'?option:option.label||option.title||'';if(option.pros||option.cons){const s=document.createElement('small');s.textContent=`장점: ${option.pros||'미제공'} · 단점: ${option.cons||'미제공'}`;b.append(s);}b.onclick=()=>guarded(()=>act('decide',{content:typeof option==='string'?option:option.label||option.title}));d.append(b);}
  $('messages').append(d);
 }
 const sessionUrl=t.sessionUrl||t.checkpoint?.sessionUrl;
 if(sessionUrl&&linkSafe(sessionUrl)){const a=document.createElement('a');a.className='text-button';a.href=linkSafe(sessionUrl);a.target='_blank';a.rel='noopener noreferrer';a.textContent='클라우드 실행 세션 열기 ↗';$('messages').append(a);}
 if(wasBottom)requestAnimationFrame(()=>$('conversation-scroll').scrollTop=$('conversation-scroll').scrollHeight);
}
function connected(a){return a.source==='url'||session.list().some(x=>x.id===a.id);}
function renderAttachments(){
 const items=attachments();$('attachment-count').textContent=items.length;
 $('attachment-chips').innerHTML=items.map(a=>`<span class="attachment-chip"><span class="chip-name" data-preview="${esc(a.id)}" tabindex="0" role="button">${connected(a)?'◇':'↻'} ${esc(a.name)}</span><button type="button" data-remove="${esc(a.id)}" aria-label="${esc(a.name)} 연결 해제">×</button></span>`).join('');
 $('attachment-detail').innerHTML=items.length?items.map(a=>`<div class="file-row"><span class="file-icon">${a.source==='url'?'↗':'▤'}</span><div><button data-preview="${esc(a.id)}">${esc(a.path||a.name)}</button><small class="${connected(a)?'':'unavailable'}">${a.source==='url'?'링크 참조':`${bytes(a.size)} · ${connected(a)?'연결됨':'다시 연결 필요'}`}</small></div></div>`).join(''):'<p class="small-copy">파일이나 폴더를 연결해 시작하세요.</p>';
}
function renderPlan(){
 const t=current(),plan=t?.plan||[];
 $('agent-plan').innerHTML=plan.length?plan.map((p,i)=>`<div class="agent-item ${p.status==='running'?'running':''}"><span class="agent-number">${p.status==='completed'||p.status==='done'?'✓':String(i+1).padStart(2,'0')}</span><div><strong>${esc(p.label||p.role)}</strong><small>${esc(statusNames[p.status]||'제안')} ${p.role&&p.label&&p.role!==p.label?`· ${esc(p.role)}`:''}</small></div></div>`).join(''):'<div class="panel-empty"><div class="empty-orbit">◇</div><p>요청에 맞는 역할을<br>필요한 만큼 구성합니다.</p></div>';
 const checkpoint=typeof t?.checkpoint==='string'?t.checkpoint:t?.checkpoint?.content;
 $('checkpoint-card').innerHTML=checkpoint?`<span>↻</span><div><strong>저장된 재개 지점</strong><p>${esc(checkpoint)}</p></div>`:'<span>↻</span><div><strong>맥락은 계속 이어집니다</strong><p>작업 기록과 결정 사항을 저장합니다.<br>원본은 필요할 때 다시 연결하세요.</p></div>';
 const handoffs=t?.checkpoint?.handoffHistory||[];if(handoffs.length){const box=document.createElement('div');box.className='small-copy';const heading=document.createElement('strong');heading.textContent='제공자 인계 기록 ('+handoffs.length+'/2)';box.append(heading);for(const h of handoffs){const line=document.createElement('p');line.textContent=(h.from==='claude'?'Claude':'Codex')+' → '+(h.to==='claude'?'Claude':'Codex')+' · '+h.reason;box.append(line);}if(t.status==='queued'){const pending=document.createElement('p');pending.textContent=t.checkpoint.provider==='codex'?'Codex 실행 대기 중 · 연결된 데스크톱이 켜져 있어야 이어집니다.':'Claude 실행 연결 대기 중';box.append(pending);}$('checkpoint-card').lastElementChild.append(box);}
 const recovery=failureGuidance(t);if(recovery){$('checkpoint-card').lastElementChild.insertAdjacentHTML('beforeend',`<div role="status"><strong>${esc(recovery.title)}</strong><p>${esc(recovery.detail)}${recovery.retryNotBefore?' 서버 재시도 안내: '+esc(date(recovery.retryNotBefore))+' (구독 한도 초기화 시각은 아닙니다).':''} 자동 재실행은 하지 않습니다. 원본이 필요하면 다시 연결하세요.</p></div>`);}
 const quality=t?(literatureAudits.has(t)?literatureAudits.get(t):auditLiterature(t)):null;if(t)literatureAudits.set(t,quality);let qualityPanel=$('literature-quality');if(!qualityPanel){qualityPanel=document.createElement('div');qualityPanel.id='literature-quality';$('artifacts').before(qualityPanel);}qualityPanel.replaceChildren();if(quality){const heading=document.createElement('strong');heading.textContent=quality.status==='passed'?'문헌 결과 형식 점검 통과':'문헌 결과 확인 필요';qualityPanel.append(heading);const detail=document.createElement('p');detail.className='small-copy';detail.textContent='실행 완료와 별도인 형식 점검입니다. 주장·수치의 정확성과 독립 검토 여부는 검증하지 않습니다.';qualityPanel.append(detail);const reviewButton=document.createElement('button');reviewButton.className='text-button';reviewButton.textContent='별도 검토 작업 준비';reviewButton.onclick=()=>guarded(prepareSeparateReview);qualityPanel.append(reviewButton);for(const issue of quality.issues){const item=document.createElement('p');item.className='small-copy';item.textContent=issue;qualityPanel.append(item);}if(quality.issues.length){const button=document.createElement('button');button.className='text-button';button.textContent='수정 요청 준비';button.onclick=()=>{if($('prompt').value.trim()){toast('작성 중인 요청을 먼저 기록하거나 비워 주세요.');return;}$('prompt').value=repairLiteraturePrompt(quality);$('prompt').focus();toast('수정 요청을 준비했습니다. 자료 연결을 확인하고 작업 기록 후 실행하세요.');};qualityPanel.append(button);}}
 const artifacts=t?.artifacts||[];$('artifact-count').textContent=artifacts.length;
 $('artifacts').innerHTML=artifacts.length?artifacts.map(a=>`<div class="artifact-row" role="button" tabindex="0" data-artifact="${esc(a.id)}"><span>▤</span><div><strong>${esc(a.name)}</strong><small>${esc(a.mime||'text/plain')}</small></div><span>↓</span></div>`).join(''):'<p class="small-copy">생성된 결과물이 여기에 모입니다.</p>';
}
function renderControls(){
 $('storage-button').hidden=!state().capabilities?.runStorage;
 $('local-records-button').hidden=!state().capabilities?.localRecordImport;
 const t=current(),c=state().capabilities||{},provider=$('provider').value;const available=provider==='codex'?(c.localCodex||c.cloudCodex):c.claudeRoutine;
 const running=t?.status==='running'||t?.status==='claimed'||t?.status==='queued';const terminal=t?.status==='cancelled'||t?.status==='completed';
 $('run-button').disabled=!t||busy||running||terminal;
 $('run-button').innerHTML=`${t?.status==='queued'?'데스크톱 실행 대기':running?'실행 중':t?.status==='paused'?'이어서 실행':'작업 실행'} <span>↗</span>`;
 $('executor-status').textContent=client?.remote?(available?provider==='codex'?(c.desktopSources?'같은 클라우드 작업 · 선택한 원본은 이 PC에서만 Codex에 전달합니다.':c.cloudCodex?(state().desktop?.online?'데스크톱 연결됨 · 같은 클라우드 작업에 결과를 저장합니다.':'데스크톱 오프라인 · 실행 요청을 대기열에 보관합니다.'):'이 서버의 Codex 구독으로 실행합니다.'):'연결된 클라우드 Routine으로 실행합니다.':provider==='codex'?'이 서버에 Codex 실행기가 연결되지 않았습니다.':'서버에 Claude Routine 설정이 필요합니다.'):'실행기를 연결하세요. 현재는 작업을 기록할 수 있습니다.';
 $('pause-button').disabled=!t||busy||terminal||t.status==='paused';$('cancel-button').disabled=!t||busy||terminal;
 $('edit-plan').disabled=!t||busy||running||terminal;
 $('prompt').placeholder=t?t.status==='waiting_user'?'선택 또는 수정 요청을 남겨주세요.':'추가 요청이나 방향을 남겨주세요.':'어떤 작업을 함께할까요?';
 $('composer').querySelector('[type=submit]').disabled=busy||running||t?.status==='cancelled';
}
function syncStatus(error){const s=$('sync-status');s.className='sync-badge';if(error){s.textContent='연결 오류 · 변경 미동기화';s.classList.add('error');return;}if(client?.remote){s.textContent=`동기화 ${client.lastSync?new Date(client.lastSync).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):''}`;s.classList.add('connected');$('connection-label').textContent=state().capabilities?.desktopSources?'클라우드 + 이 PC 자료':'서버 연결됨';}else{s.textContent='이 기기 보관';$('connection-label').textContent='이 기기 보관';}}
function render(){renderList();renderMessages();renderAttachments();renderPlan();renderControls();if(view==='usage')renderUsage();}
async function refresh(){if(refreshing||!client)return;refreshing=true;const viewKey=()=>JSON.stringify([state().revision,state().capabilities,state().desktop?.online,state().localDesktop]);const before=viewKey();try{await client.refresh();syncStatus();if(before!==viewKey())render();else renderControls();}catch(e){syncStatus(e);}finally{refreshing=false;}}
async function act(action,extra={}){const t=current();if(!t)return;await client.action(t.id,{action,expectedVersion:t.version,...extra});render();}
async function updateAttachments(next){if(current())await act('attachments',{attachments:next});else{draftAttachments=next;renderAttachments();}}
async function addFiles(files){const added=session.addFiles(files);const merged=new Map(attachments().map(a=>[a.id,a]));for(const a of added)merged.set(a.id,a);await updateAttachments([...merged.values()]);toast(`${added.length}개 파일을 연결했습니다. 원본은 업로드하지 않았습니다.`);}
async function addFolder(){try{if('showDirectoryPicker'in window){const h=await window.showDirectoryPicker({mode:'read'});const added=await session.addDirectory(h);const merged=new Map(attachments().map(a=>[a.id,a]));for(const a of added)merged.set(a.id,a);await updateAttachments([...merged.values()]);toast(`${added.length}개 파일을 연결했습니다.`);}else $('folder-input').click();}catch(e){if(e.name!=='AbortError')throw e;}}
async function preview(id){
 const a=attachments().find(x=>x.id===id)||session.list().find(x=>x.id===id);if(!a)return;
 $('preview-title').textContent=a.name;$('preview-content').replaceChildren();
 if(a.source==='url'){const p=document.createElement('p');p.textContent='연결된 링크입니다. 내용을 가져오거나 저장하지 않았습니다.';const link=document.createElement('a');link.textContent=a.url;link.href=linkSafe(a.url)||'#';link.target='_blank';link.rel='noopener noreferrer';$('preview-content').append(p,link);}
 else if(!connected(a)){$('preview-content').textContent='원본을 다시 연결해 주세요. 이름, 경로, 크기와 수정 시각이 같은 파일을 선택하면 기존 작업에 다시 연결됩니다.';}
 else{
  const file=await session.getFile(id);const info=document.createElement('p');info.className='small-copy';info.textContent=`${a.path} · ${bytes(a.size)} · 원본 영구 저장 없음`;$('preview-content').append(info);
  if(file.type.startsWith('image/')||file.type==='application/pdf'){const url=URL.createObjectURL(file);previewUrls.push(url);const element=document.createElement(file.type==='application/pdf'?'iframe':'img');element.src=url;if(element.tagName==='IFRAME')element.setAttribute('sandbox','');else element.alt=a.name;$('preview-content').append(element);}
  else{const r=await extractConnectedText(await session.getFile(id));const pre=document.createElement('pre');pre.textContent=r.status==='unavailable'?`이 형식은 원본 참조로 연결됩니다. 해당 분석 앱에서 열어 결과 JSON이나 텍스트를 연결하세요.\n${r.reason||''}`:r.text;$('preview-content').append(pre);if(r.status==='truncated'){const p=document.createElement('p');p.textContent=`미리보기는 앞부분 ${bytes(r.bytesRead)}만 표시합니다.`;$('preview-content').append(p);}}
 }
 openDialog('preview-dialog');
}
function download(name,content,mime='text/plain',encoding){let value=content;if(encoding==='base64'){const binary=atob(content);value=Uint8Array.from(binary,c=>c.charCodeAt(0));}const blob=value instanceof Blob?value:new Blob([value],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportRecords(all=false){const tasks=!all&&current()?[current()]:state().tasks;download(`INNO-${current()&&!all?'task':'workspace'}-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(exportBundle({tasks}),null,2),'application/json');toast('작업 기록을 내보냈습니다. 연결 원본 내용은 포함하지 않습니다.');}
async function run(){
 const t=current();if(!t)return;
 const c=state().capabilities||{},provider=$('provider').value;
 if(!client.remote||(provider==='codex'?!(c.localCodex||c.cloudCodex):!c.claudeRoutine)){showSettings();toast('선택한 AI 실행기가 연결된 서버를 설정하세요.');return;}
 if(provider==='codex'&&c.cloudCodex&&!c.desktopSources&&t.attachments?.length)throw new Error('이 PC의 데스크톱 연결 화면에서 같은 작업을 열고 원본을 다시 연결하세요. 휴대폰에서 PC 원본을 직접 읽을 수는 없습니다.');
 if(provider==='codex'&&c.desktopSources&&t.attachments?.some(a=>a.source==='url'))throw new Error('링크만으로 원문을 읽을 수는 없습니다. 해당 문서 파일을 연결한 뒤 링크 참조를 해제하세요.');
 const missing=(t.attachments||[]).filter(a=>a.source!=='url'&&!connected(a));if(missing.length)throw new Error(`${missing.length}개 원본의 연결이 끊겼습니다. 파일 또는 폴더를 다시 연결하세요.`);
 const materials=[];let total=0;const unsupported=[];
 for(const a of t.attachments||[]){if(a.source==='url')continue;const r=await extractConnectedText(await session.getFile(a.id),{maxChars:Math.min(200000,600000-total)});if(r.status==='unavailable'){unsupported.push(a.name);continue;}if(r.status==='truncated')throw new Error(`${a.name}은 텍스트 전송 범위를 초과합니다. 필요한 부분을 별도 텍스트로 연결하세요. 자동으로 잘라 분석하지 않습니다.`);total+=new TextEncoder().encode(r.text).byteLength;materials.push({name:a.path||a.name,text:r.text});if(total>600000)throw new Error('한 번에 조회할 텍스트 범위를 초과했습니다. 자료를 나눠 연결하세요.');}
 if(unsupported.length)throw new Error(`${unsupported.slice(0,3).join(', ')}: 이 실행 경로의 텍스트 조회를 지원하지 않습니다. Prism/Analytics에서 분석한 JSON 또는 추출한 텍스트를 연결하세요.`);
 if(t.status==='paused'||t.status==='failed'||t.status==='waiting_connection'||t.status==='waiting_quota')await act('resume');
 await client.run(t.id,{provider,materials,expectedVersion:current().version});await refresh();toast('실행 요청을 보냈습니다. 진행 상태와 결과를 기다리는 중입니다.');
}
function renderResearch(){
 $('literature-workflow').textContent=`선택 논문으로 비교 작업 준비 (${selectedPapers.size})`;
 const found=$('paper-search').value.trim()?searchPapers(papers,$('paper-search').value,80):papers.slice(0,80);
 if(!papers.length&&!prismReports.length)return;
 $('research-results').innerHTML=prismReports.map((r,i)=>`<article class="paper-card"><div class="paper-meta"><span>PRISM ANALYSIS</span><span>${esc(r.engine?.version||r.engine?.name||r.engine||'엔진 미기재')}</span></div><h3>${esc(r.name)}</h3><p>원본 출처와 분석 파라미터를 포함한 연결 결과</p><button data-prism="${i}">분석 JSON 보기 ↗</button></article>`).join('')+found.map(p=>`<article class="paper-card"><div class="paper-meta"><span>${esc(p.year||'연도 미기재')}</span><span>${esc(p.venue||'')}</span><span class="status">${({'metadata':'메타데이터만','abstract':'초록 포함','full-text':'전문 범위 표시'})[p.evidenceScope]||'범위 미확인'}</span></div><label class="paper-selection"><input type="checkbox" data-select-paper="${esc(p.id)}" ${selectedPapers.has(p.id)?'checked':''}> 비교할 논문 선택</label><h3>${esc(p.title)}</h3><p>${esc((p.abstract||'초록이 없습니다. 본문을 읽은 것으로 간주하지 않습니다.').slice(0,600))}</p><div class="paper-meta">${p.doi?`<a href="https://doi.org/${encodeURI(p.doi)}" target="_blank" rel="noopener noreferrer">${esc(p.doi)} ↗</a>`:''}<button data-paper="${esc(p.id)}">이 논문으로 질문하기</button></div></article>`).join('')+(!found.length&&papers.length?'<p class="small-copy">일치하는 논문이 없습니다.</p>':'');
}
const integrationDescriptions={Scheduler:'합성과 광학 측정 일정을 확인하고 계획을 이어갑니다.',NanoLab:'합성 계획, lot, ICP 조성과 수율을 관리합니다.',Ledger:'시료와 측정, 보정 및 채택 결과를 연결합니다.',Prism:'광학 측정 HDF5와 power scan, rise time을 분석합니다.',Analytics:'전자현미경 이미지와 EDS 자료를 분석합니다.',RefAtlas:'논문 수집, 근거 검색과 연구 문헌 탐색을 이어갑니다.'};
function renderIntegrations(){
 const list=Array.isArray(INTEGRATIONS)?INTEGRATIONS:Object.values(INTEGRATIONS);
 $('integration-grid').innerHTML=list.map((x,i)=>{const name=x.name||x.label||x.id;const key=Object.keys(integrationDescriptions).find(k=>String(name).toLowerCase().includes(k.toLowerCase()));const url=linkSafe(x.url||x.href||x.appUrl||x.repositoryUrl||'');return `<article class="integration-card"><div class="integration-mark">${['◷','⚗','▦','⌁','⊞','⌕'][i%6]}</div><h2>${esc(name)}</h2><p>${esc(x.description||integrationDescriptions[key]||'기존 연구 플랫폼 연결')}</p>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${x.linkKind==='app'?'앱 열기':'저장소 열기'} ↗</a>`:'<span class="small-copy">연결 주소 설정 필요</span>'}</article>`;}).join('');
}
function renderUsage(){
 let executionPanel=$('execution-usage');if(!executionPanel){executionPanel=document.createElement('section');executionPanel.id='execution-usage';$('usage-cards').after(executionPanel);}const rows=usageRows(state().tasks);executionPanel.innerHTML='<h2>작업별 최근 완료 실행</h2><p class="small-copy">실행기가 반환한 관측값입니다. 최근 50개 작업의 마지막 보고값을 표시하며 전체 누적량·구독 잔여량이 아닙니다. 실행 도중·중단된 실행·이전 기록의 사용량은 없을 수 있습니다.</p>'+ (rows.length?rows.map(r=>'<article class="usage-card"><strong>'+esc(r.title)+'</strong><p>'+esc(r.provider)+' · '+esc(date(r.completedAt))+'</p><p>입력 '+(r.inputTokens===null?'확인 불가':r.inputTokens.toLocaleString())+' · 출력 '+(r.outputTokens===null?'확인 불가':r.outputTokens.toLocaleString())+' 토큰</p></article>').join(''):'<p>관측된 작업별 토큰 기록이 아직 없습니다.</p>');

 let records=state().usage||[];if(!Array.isArray(records))records=Object.entries(records).map(([provider,u])=>({provider,...(u||{})}));
 $('usage-cards').innerHTML=['codex','claude'].map(provider=>{const u=records.find(x=>String(x.provider).toLowerCase()===provider)||{};const percent=typeof u.usedPercent==='number'?Math.min(100,Math.max(0,u.usedPercent)):null;return `<article class="usage-card"><span class="eyebrow">${provider==='codex'?'OPENAI':'ANTHROPIC'}</span><h2>${provider==='codex'?'Codex':'Claude'}</h2><div class="usage-value">${percent===null?'한도 확인 불가':`${percent.toFixed(0)}% 사용`}</div>${percent===null?'':`<progress value="${percent}" max="100" aria-label="구독 사용률"></progress>`}<p>${esc(u.source||'이 연결에서 구독 잔여량을 아직 받지 못했습니다.')}<br>${u.updatedAt?`갱신 ${esc(date(u.updatedAt))}`:'갱신 기록 없음'}</p><dl><dt>최근 제공자 보고 입력 토큰</dt><dd>${u.inputTokens==null?'확인 불가':Number(u.inputTokens).toLocaleString()}</dd><dt>최근 제공자 보고 출력 토큰</dt><dd>${u.outputTokens==null?'확인 불가':Number(u.outputTokens).toLocaleString()}</dd><dt>한도 초기화</dt><dd>${u.resetAt?esc(date(u.resetAt)):'확인 불가'}</dd></dl><a class="text-button" href="${provider==='codex'?'https://chatgpt.com/codex/settings/usage':'https://claude.ai/settings/usage'}" target="_blank" rel="noopener noreferrer">공식 사용량 확인 ↗</a></article>`;}).join('');
}
function showSettings(){$('server-url').value=client?.baseUrl||location.origin;$('server-token').value=client?.token||'';$('settings-error').textContent='';openDialog('settings-dialog');}
async function configure(e){e.preventDefault();const button=e.submitter;button.disabled=true;try{const baseUrl=validateEndpoint($('server-url').value),token=$('server-token').value.trim();const candidate=new WorkspaceClient({baseUrl,token,remote:true});await candidate.refresh();client=candidate;sessionStorage.setItem('inno-token',token);localStorage.setItem('inno-server',baseUrl);sessionStorage.setItem('inno-remote','1');activeId=null;lastRendered='';syncStatus();render();$('settings-dialog').close();toast('서버에 연결했습니다. 이 탭이 열려 있는 동안 5초마다 상태를 확인합니다.');}catch(error){$('settings-error').textContent=error.message;}finally{button.disabled=false;}}

$('composer').addEventListener('submit',e=>{e.preventDefault();guarded(async()=>{const prompt=$('prompt').value.trim();if(!prompt)return;if(current()){await act(current().status==='waiting_user'?'decide':'message',{content:prompt});}else{const t=await client.create({prompt,type:$('task-type').value,attachments:draftAttachments});activeId=t.id;localStorage.setItem('inno-active-task',t.id);draftAttachments=[];lastRendered='';} $('prompt').value='';render();requestAnimationFrame(()=>$('conversation-scroll').scrollTop=$('conversation-scroll').scrollHeight);toast(client.remote?'작업을 서버에 기록했습니다. 실행 버튼으로 시작하세요.':'작업을 이 기기에 기록했습니다. AI 실행은 서버 연결이 필요합니다.');});});
$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('composer').requestSubmit();}});
$('new-task').onclick=newTask;$('task-search').oninput=renderList;
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{$('prompt').value=b.dataset.prompt;$('task-type').value=b.dataset.type;$('prompt').focus();});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.addEventListener('click',e=>{const t=e.target.closest('[data-task]');if(t)selectTask(t.dataset.task);const p=e.target.closest('[data-preview]');if(p)guarded(()=>preview(p.dataset.preview));const r=e.target.closest('[data-remove]');if(r)guarded(async()=>{await updateAttachments(attachments().filter(a=>a.id!==r.dataset.remove));session.remove(r.dataset.remove);renderAttachments();});const a=e.target.closest('[data-artifact]');if(a){const artifact=current()?.artifacts.find(x=>x.id===a.dataset.artifact);if(artifact)try{download(artifact.name,artifact.content,artifact.mime,artifact.encoding);}catch(err){toast(err.message);}}});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();newTask();}if(e.key==='Enter'&&e.target.matches('[data-preview],[data-artifact]'))e.target.click();});
$('attach-button').onclick=()=>$('file-input').click();$('folder-button').onclick=()=>guarded(addFolder);
for(const id of ['file-input','folder-input'])$(id).onchange=e=>guarded(async()=>{await addFiles(e.target.files);e.target.value='';});
$('add-link').onclick=()=>openDialog('link-dialog');$('link-form').onsubmit=e=>{e.preventDefault();guarded(async()=>{const a=session.addUrl($('link-url').value);await updateAttachments([...attachments().filter(x=>x.id!==a.id),a]);$('link-dialog').close();$('link-url').value='';});};
$('provider').onchange=renderControls;$('run-button').onclick=()=>guarded(run);$('pause-button').onclick=()=>guarded(()=>act('pause'));$('cancel-button').onclick=()=>guarded(()=>act('cancel'));
$('export-button').onclick=()=>exportRecords();$('settings-export').onclick=()=>exportRecords(true);
$('settings-button').onclick=showSettings;$('connect-executor').onclick=showSettings;$('settings-form').onsubmit=configure;
$('offline-button').onclick=()=>guarded(async()=>{client=new WorkspaceClient();sessionStorage.removeItem('inno-token');sessionStorage.removeItem('inno-remote');await client.refresh();activeId=null;lastRendered='';syncStatus();render();$('settings-dialog').close();toast('이 기기의 작업 보관함으로 전환했습니다. 서버 기록은 서버에 남아 있습니다.');});
$('storage-button').onclick=()=>guarded(()=>storageUI.open());
$('local-records-button').onclick=()=>guarded(()=>recordImports.fromLocal());
$('restore-button').onclick=()=>$('restore-input').click();$('restore-input').onchange=e=>guarded(async()=>{const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024)throw new Error('작업 기록 파일은 20 MB 이하여야 합니다.');const text=await file.text();if(client.remote){await recordImports.fromBundle(parseBundle(text));e.target.value='';return;}const count=await client.restore(text);render();toast(`${count}개 작업을 가져왔습니다. 원본은 다시 연결하세요.`);e.target.value='';});
$('edit-plan').onclick=()=>{$('plan-text').value=(current()?.plan||[]).map(x=>x.label||x.role).join('\n');openDialog('plan-dialog');};
$('plan-form').onsubmit=e=>{e.preventDefault();guarded(async()=>{const labels=$('plan-text').value.split('\n').map(s=>s.trim()).filter(Boolean);if(!labels.length||labels.length>6)throw new Error('역할은 1개에서 6개 사이로 구성하세요.');await act('plan',{plan:labels.map((label,i)=>({id:`role-${i+1}`,role:label,label,status:'pending',instructions:label}))});$('plan-dialog').close();});};
$('task-menu').onclick=()=>{if(!current())return;const t=current();$('preview-title').textContent='작업 기록';$('preview-content').innerHTML=`<pre>${esc(JSON.stringify(exportBundle({tasks:[t]}),null,2))}</pre>`;openDialog('preview-dialog');};
$('preview-dialog').addEventListener('close',()=>{previewUrls.forEach(u=>URL.revokeObjectURL(u));previewUrls=[];$('preview-content').replaceChildren();});
$('mobile-menu').onclick=()=>{$('sidebar').classList.add('open');$('sidebar-scrim').classList.add('open');};$('sidebar-scrim').onclick=closeSidebar;
$('detail-toggle').onclick=()=>$('detail-panel').classList.toggle('open');$('detail-close').onclick=()=>$('detail-panel').classList.remove('open');
if(localStorage.getItem('inno-theme')==='dark')document.body.classList.add('dark');$('theme-button').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('inno-theme',document.body.classList.contains('dark')?'dark':'light');};
$('import-research').onclick=()=>$('research-input').click();$('paper-search').oninput=renderResearch;
$('research-input').onchange=e=>guarded(async()=>{let count=0;for(const file of e.target.files){if(file.size>30*1024*1024)throw new Error('문헌 색인 JSON은 30 MB 이하로 연결하세요.');const text=await file.text();const raw=JSON.parse(text);if(raw.analysis&&('paReport'in raw.analysis)){const r=parsePrismReport(text);prismReports.push({...r,name:file.name});}else{const incoming=parseRefAtlas(text);const map=new Map(papers.map(p=>[p.id,p]));incoming.forEach(p=>map.set(p.id,p));papers=[...map.values()];count+=incoming.length;}}renderResearch();toast(`${count}편의 문헌 · ${prismReports.length}개 분석 결과가 세션에 연결됐습니다.`);e.target.value='';});
$('research-results').onclick=e=>{const b=e.target.closest('[data-paper]');if(b){const p=papers.find(x=>x.id===b.dataset.paper);newTask();$('task-type').value='literature';$('prompt').value=`다음 자료에서 확인할 수 있는 주장과 추가 확인이 필요한 내용을 구분해줘.\n제목: ${p.title}\nDOI: ${p.doi||'없음'}\n읽기 범위: 서지정보만 연결됨 (내용 분석에는 원문이나 초록 파일을 연결하세요.)`;$('prompt').focus();}const q=e.target.closest('[data-prism]');if(q){$('preview-title').textContent=prismReports[+q.dataset.prism].name;$('preview-content').innerHTML=`<pre>${esc(JSON.stringify(prismReports[+q.dataset.prism],null,2))}</pre>`;openDialog('preview-dialog');}};

// A horizontal swipe closes mobile drawers while vertical scrolling remains native.
for(const [id,close] of [['sidebar',closeSidebar],['detail-panel',()=>$('detail-panel').classList.remove('open')]]){
 let touch=null;const panel=$(id);
 panel.addEventListener('touchstart',e=>{if(e.touches.length===1&&!e.target.closest('input,textarea,select'))touch={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
 panel.addEventListener('touchend',e=>{if(!touch||innerWidth>1020)return;const end=e.changedTouches[0],dx=end.clientX-touch.x,dy=end.clientY-touch.y;touch=null;if(Math.abs(dx)>75&&Math.abs(dx)>Math.abs(dy)*2&&((id==='sidebar'&&dx<0)||(id==='detail-panel'&&dx>0)))close();},{passive:true});
}

let dragCounter=0;document.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].includes('Files')){dragCounter++;$('drop-overlay').classList.remove('hidden');}});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(--dragCounter<=0){dragCounter=0;$('drop-overlay').classList.add('hidden');}});document.addEventListener('drop',e=>{e.preventDefault();dragCounter=0;$('drop-overlay').classList.add('hidden');guarded(async()=>{const items=[...e.dataTransfer.items];const handles=[];if(items.some(i=>typeof i.getAsFileSystemHandle==='function')){const pending=items.filter(i=>i.kind==='file').map(i=>i.getAsFileSystemHandle());for(const h of await Promise.all(pending)){if(h?.kind==='directory')handles.push(h);}}for(const h of handles){const added=await session.addDirectory(h);await updateAttachments([...attachments(),...added]);}const files=[...e.dataTransfer.files].filter(f=>f.size||f.type);if(files.length)await addFiles(files);else if(!handles.length)toast('이 브라우저에서는 폴더 연결 버튼을 사용하세요.');});});
document.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();guarded(()=>addFiles(files));}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('online',refresh);window.addEventListener('offline',()=>syncStatus(new Error('offline')));

async function init(){
 let token=sessionStorage.getItem('inno-token')||'',baseUrl=localStorage.getItem('inno-server')||'',remote=sessionStorage.getItem('inno-remote')==='1';
 const hash=new URLSearchParams(location.hash.slice(1));if(hash.has('token')){token=hash.get('token');baseUrl=location.origin;remote=true;sessionStorage.setItem('inno-token',token);sessionStorage.setItem('inno-remote','1');history.replaceState(null,'',location.pathname+location.search);}
 client=new WorkspaceClient({token,baseUrl:remote?baseUrl:'',remote});
 try{await client.refresh();syncStatus();}catch(e){syncStatus(e);if(remote)toast('서버 연결에 실패했습니다. 설정에서 주소와 토큰을 확인하세요.');else toast('브라우저 저장 공간을 사용할 수 없습니다. 서버 연결이 필요합니다.');}
 activeId=state().tasks.some(t=>t.id===localStorage.getItem('inno-active-task'))?localStorage.getItem('inno-active-task'):null;
 renderIntegrations();render();renderUsage();
 setInterval(()=>{if(!document.hidden&&!busy)refresh();},5000);
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
init().catch(e=>toast(e.message));

$('research-results').addEventListener('change',e=>{const input=e.target.closest('[data-select-paper]');if(!input)return;if(input.checked)selectedPapers.add(input.dataset.selectPaper);else selectedPapers.delete(input.dataset.selectPaper);$('literature-workflow').textContent=`선택 논문으로 비교 작업 준비 (${selectedPapers.size})`;});
async function prepareLiterature(reconnect=false){const workflow=await buildLiteratureWorkflow(papers.filter(p=>selectedPapers.has(p.id)));const file=new File([workflow.text],workflow.name,{type:'text/plain',lastModified:0});if(reconnect){session.addFiles([file]);renderAttachments();toast('선택한 논문 자료를 다시 연결했습니다. 기존 작업을 열어 연결 상태를 확인하세요.');return;}newTask();$('task-type').value=workflow.type;$('prompt').value=workflow.prompt;await addFiles([file]);toast('문헌 비교 요청과 임시 자료를 준비했습니다. 연구 목적을 수정하고 작업 기록 후 AI 실행을 누르세요.');}
$('literature-workflow').onclick=()=>guarded(()=>prepareLiterature());
$('literature-reconnect').onclick=()=>guarded(()=>prepareLiterature(true));

async function prepareSeparateReview(){
 if($('prompt').value.trim())throw Error('작성 중인 요청을 먼저 기록하거나 비워 주세요.');
 const task=current();const sources=(task?.attachments||[]).filter(a=>/^refatlas-evidence-[a-f0-9]{64}\.txt$/.test(a.name));
 if(sources.length!==1)throw Error('원래 문헌 자료 하나를 다시 연결하세요.');
 if(!connected(sources[0]))throw Error('연구 자료에서 같은 문헌을 선택하고 선택 자료 다시 연결을 누르세요.');
 const source=await session.getFile(sources[0].id);if(!source)throw Error('연구 자료에서 같은 문헌을 선택해 자료를 다시 연결하세요.');
 const review=await buildLiteratureReview(task,await source.text());
 const file=new File([review.text],review.name,{type:'text/plain',lastModified:0});
 newTask();$('task-type').value=review.type;$('prompt').value=review.prompt;await addFiles([source,file]);
 toast('별도 검토 요청을 준비했습니다. 작업 기록 후 실행하세요.');
}

createExperimentLinks({root:$('experiment-links'),prepareTask:async result=>{if($('prompt').value.trim())throw Error('작성 중인 요청을 먼저 기록하거나 비워 주세요.');const packet=await experimentPacket(result);const file=new File([packet.text],packet.name,{type:'application/json',lastModified:0});newTask();$('task-type').value='analysis';$('prompt').value='연결된 실험 요약의 출처·불일치·추가 확인 사항을 정리해 주세요. 원시 측정 데이터나 합성 조건 전체를 읽은 것으로 표현하지 마세요. PA 하한 여부와 단위를 유지하고 인과관계는 단정하지 마세요.\n시료 ID: '+result.sampleId+'\n실험 ID: '+result.experimentId;await addFiles([file]);toast('연결 메타데이터로 작업을 준비했습니다. 원시 데이터 분석에는 해당 원본도 연결하세요.');}});
