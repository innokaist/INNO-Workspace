export function parseRevision(value){if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value))return undefined;const revision=Number(value);return Number.isSafeInteger(revision)?revision:undefined;}
