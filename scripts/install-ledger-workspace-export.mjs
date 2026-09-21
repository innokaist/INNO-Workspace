import {readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';
const target=path.resolve(process.argv[2]||'');if(path.basename(target)!=='INNO Ledger.html')throw Error('대상 INNO Ledger.html 경로를 지정하세요.');
const original=await readFile(target,'utf8');if(original.includes('btnWorkspaceIndex')){console.log('Workspace export is already installed.');process.exit(0);}
const helper=await readFile(new URL('./ledger-workspace-index.js',import.meta.url),'utf8');
const edits=[
 ['<h3>동기화</h3>','<h3>동기화</h3><button class="btn sm" id="btnWorkspaceIndex" disabled>Workspace 연결 색인 내보내기</button><p class="hint">로드된 Run의 식별자와 파일 참조만 내보냅니다. 원본·첨부·계정 정보는 제외합니다.</p>'],
 ['  async function onLoggedIn() {',helper+'\n  async function onLoggedIn() {\n    $("#btnWorkspaceIndex").disabled=true;\n    $("#btnWorkspaceIndex").onclick=()=>{try{const data=innoWorkspaceIndex(state);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download="INNO_Ledger_workspace.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(data.runs.length+"개 Run 색인을 내보냈습니다. 원본은 포함하지 않습니다.");}catch(e){toast(e.message);}};'],
 ['      state.runs = runs;','      state.runs = runs;\n      $("#btnWorkspaceIndex").disabled=false;']
];
let changed=original;for(const [from,to] of edits){if(changed.split(from).length!==2)throw Error('Ledger 구조가 달라 자동 수정하지 않았습니다: '+from);changed=changed.replace(from,to);}
const backup=new URL('../.inno/ledger-before-workspace-export.html',import.meta.url);await mkdir(new URL('../.inno/',import.meta.url),{recursive:true});await writeFile(backup,original,{flag:'wx'});
if(await readFile(target,'utf8')!==original)throw Error('수정 도중 대상 파일이 변경됐습니다.');await writeFile(target,changed);console.log('Installed Ledger export. Original backup is in Workspace .inno.');
