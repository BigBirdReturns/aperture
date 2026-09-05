import path from 'node:path';
import fs from 'node:fs/promises';
import {scan} from './scan.mjs';
import {parseSource,inspectLocal,inspectRemote} from './models.mjs';
import {makePlan,explain} from './routes.mjs';
import {describeHardware,storageAt,matchingVolume} from './hardware.mjs';
import {acquire,acquisitionKey,reuseCachedAcquisition} from './acquire.mjs';
import {VERSION} from './version.mjs';
import {ApertureError,appHome,writeNew,mkdirPrivate,gib,jsonFile} from './common.mjs';

export async function wizard(ui,options={},deps={}){
  const probe=deps.scan||scan,local=deps.inspectLocal||inspectLocal,remote=deps.inspectRemote||inspectRemote;
  ui.say(`\n  APERTURE ${VERSION}\n  Your model, configured for your machine.\n`);
  ui.say('01  MACHINE\nRead-only CPU, integrated/discrete GPU, neural accelerator, RAM/commit, drives, links and runtime inspection. No personal-folder search, benchmarks, model loading or uploads.');
  if(!options.scanApproved&&!await ui.confirm('Allow that read-only hardware scan?')){ui.say('Stopped. Nothing was scanned.');return {status:'SCAN_DECLINED'};}
  const machine=await probe();
  ui.say('\n'+describeHardware(machine));
  ui.say('\n02  MODEL\nPaste a Hugging Face link, direct HTTPS GGUF link, or local file/folder. You can drag a file into this terminal. Use hf:owner/model for a repository.');
  let input=options.model,model,networkApproved=!!options.networkApproved;
  for(;;){
    input=input||await ui.ask('Model link or location:');
    if(!input?.trim()){ui.say('No model selected.');return {status:'NO_MODEL'};}
    try{
      const source=parseSource(input);
      if(source.kind==='local')model=await local(source,ui.choose);
      else{
        if(!networkApproved){
          ui.say('The model host receives metadata requests, not your hardware profile. Header reads are bounded; weights are not downloaded. Existing HF_TOKEN can authorize gated models.');
          if(!await ui.confirm('Allow those model-metadata network requests?'))return {status:'NETWORK_DECLINED'};
          networkApproved=true;
        }
        model=await remote(source,ui.choose);
      }
      break;
    }catch(e){
      if(options.model||e.code==='CANCELLED')throw e;
      ui.say(`Could not inspect that source: ${e.message}\nCorrect the link/path, or press Enter to finish.`);input=null;
    }
  }
  const plan=makePlan(machine,model,options);
  if(model.local&&!deps.inspectLocal){plan.modelStorage=await storageAt(model.source.path);plan.modelStorage.volume=matchingVolume(model.source.path,machine.hardware?.volumes||[]);}
  ui.say(explain(plan));
  if(plan.modelStorage)ui.say('Selected model filesystem: '+(plan.modelStorage.volume?.mount||plan.modelStorage.observedPath)+'; '+gib(plan.modelStorage.freeBytes)+' free. Existing weights remain in place.');
  if(options.out){await writeNew(path.resolve(options.out),plan);ui.say(`Configuration saved: ${path.resolve(options.out)}`);}
  if(options.answerOnly)return plan;
  ui.say('03  USE IT\n  1. Start a local chat\n  2. Save this configuration\n  3. Run a bounded experiment\n  4. Generate one answer\n  Enter: finish without downloads or execution');
  let action=options.prompt?'4':null;
  for(;!action;){action=(await ui.ask('Your choice:'))?.trim();if(!action||['1','2','3','4'].includes(action))break;ui.say('Choose 1, 2, 3 or 4, or press Enter.');}
  if(!action)return plan;
  if(action==='2'){
    const destination=path.join(appHome(),'answers',`${Date.now()}-${process.pid}.json`);await writeNew(destination,plan);
    ui.say(`Saved ${destination}\nResume: aperture chat "${destination}"`);return plan;
  }
  if(action==='3'&&!await ui.confirm('Allow two opt-in benchmark repetitions? Results stay local; no uploads or background enrollment.'))return plan;
  if(plan.blockers.length){ui.say('The changes listed above are required by this adapter. Your selected model was not replaced.');return plan;}
  return await executePlan(plan,ui,{...options,networkApproved,experiment:action==='3',chat:action==='1'},deps);
}
async function bindCachedModel(plan,ui,deps={}){
  if(plan.model.local)return plan;
  const destination=path.join(appHome(),'models',acquisitionKey(plan.model));
  const cached=await (deps.reuseCachedAcquisition||reuseCachedAcquisition)(plan.model,destination);
  if(!cached)return plan;
  ui.say('Managed cache: the exact selected GGUF is already present. No model-host request or weight transfer is needed; complete hashes are checked again before loading.');
  return {...plan,model:cached};
}
export async function executePlan(plan,ui,{experiment=false,chat:chatMode=false,...options}={},deps={}){
  if(plan.blockers.length)throw new ApertureError('PLAN_BLOCKED',plan.blockers.join(' '));
  let active=await bindCachedModel(plan,ui,deps);
  if(active.model.kind==='gguf'&&!active.model.local){
    const prepare=deps.prepareNativeFit||(await import('./native-fit.mjs')).prepareNativeFit;
    active=(await prepare(active,ui,options,'before weight download')).plan;
  }
  if(!active.model.local){
    const total=active.model.downloadBytes||active.model.bytes;
    if(!options.downloadApproved&&!await ui.confirm(`Download or resume missing bytes for the exact selected model (${gib(total)}) in the local Aperture cache? Completed managed files are reused without this permission.`))return null;
    const cache=path.join(appHome(),'models');await mkdirPrivate(cache);
    const destination=path.join(cache,acquisitionKey(active.model));let last=-1;
    const acquired=await (deps.acquire||acquire)(active.model,destination,{approved:true,onProgress:(done,all)=>{const pct=Math.floor(done/all*100);if(pct>=last+10||pct===100&&last!==100){ui.say(`Model files ${pct}% (${gib(done)} / ${gib(all)})`);last=pct;}}});
    active={...active,model:acquired};
  }
  if(deps.run)return deps.run(active,ui,{experiment});
  const saved=path.join(appHome(),'answers',`${Date.now()}-${process.pid}.json`);await writeNew(saved,active);
  ui.say(`Configuration saved for next time: ${saved}`);
  if(chatMode&&active.model.kind==='gguf'){const{chat}=await import('./chat.mjs');return chat(active,ui,options);}
  const{runNative,runHf}=await import('./run.mjs');
  return active.model.kind==='gguf'?runNative(active,ui,{...options,experiment}):runHf(active,ui,{...options,experiment});
}
export async function resume(file,ui,options={},deps={}){
  let plan=await jsonFile(file);
  if(plan.schema!=='aperture-answer/1'||!plan.model||!plan.request||!Array.isArray(plan.blockers))throw new ApertureError('ANSWER_FORMAT','Choose an Aperture configuration JSON file.');
  plan=await bindCachedModel(plan,ui,deps);
  ui.say(explain(plan));
  if(!options.runApproved&&!await ui.confirm('Use this locally generated configuration and recheck hardware? Only resume files you trust.'))return null;
  if(options.experiment&&!await ui.confirm('Run an opt-in two-trial experiment with local-only results?'))return null;
  return executePlan(plan,ui,options,deps);
}
export async function listSaved(ui){
  const dir=path.join(appHome(),'answers');let names;
  try{names=(await fs.readdir(dir)).filter(n=>n.endsWith('.json')).sort().reverse();}catch{ui.say('No saved configurations yet. Run aperture setup.');return;}
  for(const name of names){try{const p=await jsonFile(path.join(dir,name));ui.say(`${p.model.name}\n  ${p.method.backend}; context ${p.request.contextPerSequence}\n  ${path.join(dir,name)}`);}catch{}}
}
