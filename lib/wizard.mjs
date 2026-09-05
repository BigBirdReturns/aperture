import path from 'node:path';
import fs from 'node:fs/promises';
import {scan} from './scan.mjs';
import {parseSource,inspectLocal,inspectRemote} from './models.mjs';
import {makePlan,explain} from './routes.mjs';
import {describeHardware,storageAt,matchingVolume} from './hardware.mjs';
import {acquire,acquisitionKey} from './acquire.mjs';
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
  const plan=makePlan(machine,model,options);ui.say(explain(plan));
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
  return await executePlan(plan,ui,{...options,experiment:action==='3',chat:action==='1'},deps);
}
export async function executePlan(plan,ui,{experiment=false,chat:chatMode=false,...options}={},deps={}){
  if(plan.blockers.length)throw new ApertureError('PLAN_BLOCKED',plan.blockers.join(' '));
  let active=plan;
  if(!plan.model.local){
    const total=plan.model.downloadBytes||plan.model.bytes;
    if(!options.downloadApproved&&!await ui.confirm(`Download/reuse the exact selected model (${gib(total)}) in the local Aperture cache? Interrupted downloads resume when the source supports ranges.`))return null;
    const cache=path.join(appHome(),'models');await mkdirPrivate(cache);
    const destination=path.join(cache,acquisitionKey(plan.model));let last=-1;
    const acquired=await (deps.acquire||acquire)(plan.model,destination,{approved:true,onProgress:(done,all)=>{const pct=Math.floor(done/all*100);if(pct>=last+10||pct===100&&last!==100){ui.say(`Model files ${pct}% (${gib(done)} / ${gib(all)})`);last=pct;}}});
    active={...plan,model:acquired};
  }
  if(deps.run)return deps.run(active,ui,{experiment});
  const saved=path.join(appHome(),'answers',`${Date.now()}-${process.pid}.json`);await writeNew(saved,active);
  ui.say(`Configuration saved for next time: ${saved}`);
  if(chatMode&&active.model.kind==='gguf'){const{chat}=await import('./chat.mjs');return chat(active,ui,options);}
  const{runNative,runHf}=await import('./run.mjs');
  return active.model.kind==='gguf'?runNative(active,ui,{...options,experiment}):runHf(active,ui,{...options,experiment});
}
export async function resume(file,ui,options={}){
  const plan=await jsonFile(file);
  if(plan.schema!=='aperture-answer/1'||!plan.model||!plan.request||!Array.isArray(plan.blockers))throw new ApertureError('ANSWER_FORMAT','Choose an Aperture configuration JSON file.');
  ui.say(explain(plan));
  if(!options.runApproved&&!await ui.confirm('Use this locally generated configuration and recheck hardware? Only resume files you trust.'))return null;
  if(options.experiment&&!await ui.confirm('Run an opt-in two-trial experiment with local-only results?'))return null;
  return executePlan(plan,ui,options);
}
export async function listSaved(ui){
  const dir=path.join(appHome(),'answers');let names;
  try{names=(await fs.readdir(dir)).filter(n=>n.endsWith('.json')).sort().reverse();}catch{ui.say('No saved configurations yet. Run aperture setup.');return;}
  for(const name of names){try{const p=await jsonFile(path.join(dir,name));ui.say(`${p.model.name}\n  ${p.method.backend}; context ${p.request.contextPerSequence}\n  ${path.join(dir,name)}`);}catch{}}
}
