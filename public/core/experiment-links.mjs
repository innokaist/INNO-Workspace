import {parsePrismReport} from './research.mjs';
const str=v=>{if(typeof v!=='string')return '';if(v.length>2000)throw Error('텍스트 필드가 너무 깁니다. 자동으로 자르지 않습니다.');return v;};
const id=v=>{if(!['string','number'].includes(typeof v)||!String(v).trim()||String(v).length>200)throw Error('식별자가 없거나 잘못되었습니다.');return String(v);};
function read(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>10_000_000)throw Error('JSON은 10 MB 이하여야 합니다.');return JSON.parse(text);}
function unique(rows,key){const seen=new Set();for(const r of rows){if(seen.has(r[key]))throw Error('중복 식별자: '+r[key]);seen.add(r[key]);}return rows;}
export function parseNanoLots(text){const db=read(text);if(!db.lots||typeof db.lots!=='object'||Array.isArray(db.lots))throw Error('NanoLab 백업의 lots가 필요합니다.');const values=Object.values(db.lots);if(values.length>10000)throw Error('합성 기록은 10000개 이하여야 합니다.');return unique(values.filter(l=>!l?.deleted).map(l=>({serial:id(l.serial),name:str(l.name),type:str(l.type),date:str(l.date),parentSerial:l.src?.serial==null?null:id(l.src.serial)})),'serial');}
export function parseLedgerIndex(text){const db=read(text);if(db.format!=='inno-ledger-index-v1'||!Array.isArray(db.runs)||db.runs.length>10000)throw Error('Ledger Workspace 연결 색인이 필요합니다(최대 10000 Run).');return unique(db.runs.map(r=>({id:id(r.id),lotId:id(r.lotId),cellId:str(r.cellId),specimen:str(r.specimen),mountId:str(r.mountId),calibId:str(r.calibId),calibStatus:str(r.calibStatus),issuedAt:Number.isFinite(r.issuedAt)?r.issuedAt:null,file:{name:str(r.file?.name),relPath:str(r.file?.relPath),bytes:Number.isFinite(r.file?.bytes)?r.file.bytes:null,mtime:Number.isFinite(r.file?.mtime)?r.file.mtime:null}})),'id');}
export function linkExperiment(namespace,lots,runs,runId,prismText){
 if(typeof namespace!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(namespace))throw Error('연구 그룹 ID는 영문·숫자·밑줄·하이픈 1~80자로 입력하세요.');
 const run=runs.find(r=>r.id===runId);if(!run)throw Error('Ledger Run을 선택하세요.');
 const raw=read(prismText),report=parsePrismReport(prismText),lot=lots.find(l=>l.serial===run.lotId)||null;
 const sourceFile=str(raw.source?.file||raw.file);const warnings=[];
 if(!lot)warnings.push('이 Run의 lotId에 대응하는 NanoLab 합성 기록이 없습니다.');
 if(lot?.parentSerial&&!lots.some(l=>l.serial===lot.parentSerial))warnings.push('상위 합성 기록이 연결되지 않았습니다.');
 if(!sourceFile||!run.file.name)warnings.push('출처 파일명이 없어 일치 여부를 확인할 수 없습니다.');else if(sourceFile!==run.file.name)warnings.push('Prism 출처 파일명과 Ledger 원본 파일명이 다릅니다. 연결을 재확인하세요.');
 warnings.push('사용자가 선택한 연결입니다. 파일 내용 동일성·보정 유효성·분석 정확성을 검증한 것은 아닙니다.');
 const a=report.analysis;const analysis={};for(const k of ['paReport','paSource','paGridLimited','thresholdP','saturationP','paThreshold','paReportDlogP','paReportBasis','thresholdSource','thresholdOutOfRange','background'])if(['string','number','boolean'].includes(typeof a[k])||a[k]===null)analysis[k]=typeof a[k]==='string'?str(a[k]):a[k];
 return {format:'inno-experiment-link-v1',namespace,sampleId:namespace+':lot:'+encodeURIComponent(run.lotId),experimentId:namespace+':run:'+encodeURIComponent(run.id),matchMethod:'user-selected-run',sourceIdentityVerified:false,lot,run,analysis,units:{thresholdP:'W',saturationP:'W',paThreshold:'W',paReportDlogP:'log10(P/W)',paReport:'dimensionless'},prism:{engine:report.engine,sourceFile},warnings};
}

export async function experimentPacket(result){const text=JSON.stringify(result,null,2);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');return {text,name:'INNO-experiment-'+hash+'.json'};}

export function linkDirectExperiment(namespace,lots,serial,experimentId,prismText){
 const lot=lots.find(l=>l.serial===serial);if(!lot)throw Error('NanoLab 시료를 선택하세요.');
 const experiment=id(experimentId).trim();
 const base=linkExperiment(namespace,lots,[{id:experiment,lotId:serial,file:{name:''}}],experiment,prismText);
 const warnings=['사용자가 지정한 시료 연결입니다. 원본 파일 동일성·보정 유효성·분석 정확성은 검증하지 않았습니다.'];
 if(lot.parentSerial&&!lots.some(l=>l.serial===lot.parentSerial))warnings.push('상위 합성 기록이 연결되지 않았습니다.');
 if(!base.prism.sourceFile)warnings.push('Prism 출처 파일명이 없습니다.');
 return {...base,experimentId:namespace+':experiment:'+encodeURIComponent(experiment),matchMethod:'user-selected-sample',run:null,warnings};
}
