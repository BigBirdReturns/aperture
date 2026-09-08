import {ApertureError} from './common.mjs';

export const CAIRN_MATERIALIZATION_SCHEMA='aperture-cairn-materialization/1';
const exactRevision=value=>typeof value==='string'&&/^[0-9a-f]{40}$/i.test(value);
const exactDigest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);

export function validateCairnIntents(intents){
  if(!Array.isArray(intents)||!intents.length)throw new ApertureError('CAIRN_INTENT','At least one CAIRN artifact intent is required.');
  const keys=new Set();
  for(const intent of intents){
    if(!object(intent)||typeof intent.role!=='string'||!intent.role||typeof intent.locator!=='string'||!intent.locator)throw new ApertureError('CAIRN_INTENT','Each CAIRN intent requires a role and locator.');
    const key=`${intent.role}\n${intent.locator}`;
    if(keys.has(key))throw new ApertureError('CAIRN_INTENT','CAIRN artifact intents must be unique by role and locator.');
    keys.add(key);
    if(intent.revision!=null&&!exactRevision(intent.revision))throw new ApertureError('CAIRN_INTENT','A supplied artifact revision must be an exact 40-hex commit.');
  }
  return intents;
}

export function validateCairnMaterialization(value,intents){
  validateCairnIntents(intents);
  if(value?.schema!==CAIRN_MATERIALIZATION_SCHEMA||!['READY','HOLD'].includes(value.state))throw new ApertureError('CAIRN_MATERIALIZATION','CAIRN must return aperture-cairn-materialization/1 in READY or HOLD state.');
  if(value.state==='HOLD'){
    if(!Array.isArray(value.holds)||!value.holds.length)throw new ApertureError('CAIRN_MATERIALIZATION','A held CAIRN materialization requires explicit hold records.');
    return value;
  }
  if(!Array.isArray(value.artifacts)||value.artifacts.length!==intents.length)throw new ApertureError('CAIRN_MATERIALIZATION','CAIRN must materialize every admitted artifact intent exactly once.');
  const expected=new Map(intents.map(intent=>[`${intent.role}\n${intent.locator}`,intent]));
  const seen=new Set();
  for(const artifact of value.artifacts){
    const key=`${artifact?.role}\n${artifact?.locator}`,intent=expected.get(key);
    if(!intent||seen.has(key))throw new ApertureError('CAIRN_MATERIALIZATION','CAIRN returned an unexpected or repeated artifact.');
    seen.add(key);
    if(!exactRevision(artifact.resolvedRevision))throw new ApertureError('CAIRN_MATERIALIZATION','Every materialized artifact requires an exact resolved revision.');
    if(intent.revision&&artifact.resolvedRevision.toLowerCase()!==intent.revision.toLowerCase())throw new ApertureError('CAIRN_MATERIALIZATION','A materialized artifact changed its admitted revision.');
    if(!Array.isArray(artifact.files)||!artifact.files.length)throw new ApertureError('CAIRN_MATERIALIZATION','Every materialized artifact requires at least one retained file receipt.');
    for(const file of artifact.files){
      if(typeof file.name!=='string'||!file.name||!Number.isSafeInteger(file.bytes)||file.bytes<1||!exactDigest(file.sha256))throw new ApertureError('CAIRN_MATERIALIZATION','CAIRN file receipts require name, positive exact bytes, and SHA-256.');
    }
    if(typeof artifact.privatePath!=='string'||!artifact.privatePath)throw new ApertureError('CAIRN_MATERIALIZATION','Execution preparation requires a private local artifact path.');
  }
  return value;
}

export function publicCairnArtifacts(materialization){
  if(materialization?.state!=='READY')return [];
  return materialization.artifacts.map(artifact=>({role:artifact.role,locator:artifact.locator,resolvedRevision:artifact.resolvedRevision,files:artifact.files.map(file=>({name:file.name,bytes:file.bytes,sha256:file.sha256}))}));
}
