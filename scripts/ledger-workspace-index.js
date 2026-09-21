function innoWorkspaceIndex(state) {
 const rows=Object.values(state.runs||{});if(rows.length>10000)throw Error('Run 10000개를 초과했습니다.');
 const string=v=>{if(typeof v!=='string')return '';if(v.length>2000)throw Error('필드가 너무 깁니다. 자동으로 자르지 않습니다.');return v;};
 return {format:'inno-ledger-index-v1',exportedAt:new Date().toISOString(),runs:rows.map(r=>({id:string(r.id),lotId:string(r.lotId),cellId:string(r.cellId),specimen:string(r.specimen),mountId:string(r.mountId),calibId:string(r.calibId),calibStatus:string(r.calibStatus),issuedAt:Number.isFinite(r.issuedAt)?r.issuedAt:null,file:{name:string(r.file?.name),relPath:string(r.file?.relPath),bytes:Number.isFinite(r.file?.bytes)?r.file.bytes:null,mtime:Number.isFinite(r.file?.mtime)?r.file.mtime:null}}))};
}
