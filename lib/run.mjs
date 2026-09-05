import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {ApertureError,appHome,mkdirPrivate,writeNew,jsonFile,exists,command,hashFile,RUNTIME_VERSION,now,localPath,GiB,gib} from './common.mjs';
import {scan} from './scan.mjs';
import {bindNative,nativeEnvironment} from './backends.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function npmCommand(args,{cwd,env=process.env}={}) {
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  for(const p of candidates)if(await exists(p))return command(process.execPath,[p,...args],{cwd,env,inherit:true,timeout:1200000});
  if(process.platform==='win32')throw new ApertureError('NPM_LOCATION','Run Aperture using npx so the npm installation can be resolved without a shell.');
  return command('npm',args,{cwd,env,inherit:true,timeout:1200000});
}
export async function ensureNative(ui,options={}) {
  const directory=path.join(appHome(),'runtimes',`node-llama-cpp-${RUNTIME_VERSION}`),meta=path.join(directory,'node_modules','node-llama-cpp','package.json');
  if(await exists(meta)) {
    if((await jsonFile(meta)).version===RUNTIME_VERSION)return directory;
    throw new ApertureError('RUNTIME_VERSION','An unexpected runtime exists at the managed path. It was not overwritten.');
  }
  ui.say(`Run requires node-llama-cpp ${RUNTIME_VERSION} and its platform binary. This is third-party native code, installed only in ${directory}. npm will download dependencies; their total transfer size has not been measured. No global install, driver change, or source compilation is permitted.`);
  if(!options.installApproved&&!await ui.confirm('Download that runtime and allow it to execute for this run?'))throw new ApertureError('CANCELLED','Runtime setup declined. Your configuration answer is still valid as a candidate.');
  await mkdirPrivate(directory);
  if(!await exists(path.join(directory,'package.json')))await writeNew(path.join(directory,'package.json'),{private:true});
  const r=await npmCommand(['install','--prefix',directory,`node-llama-cpp@${RUNTIME_VERSION}`,'--save-exact','--ignore-scripts','--no-audit','--no-fund'],{cwd:directory,env:{...process.env,NODE_LLAMA_CPP_SKIP_DOWNLOAD:'true'}});
  if(r.code!==0)throw new ApertureError('RUNTIME_INSTALL','The approved runtime installation failed. No model was loaded.');
  return directory;
}
export async function supervised(exe,args,env,seconds) {
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{env,shell:false,detached:process.platform!=='win32',stdio:['ignore','inherit','inherit'],windowsHide:true});
    let stopped=false,hard;
    function kill(force=false){try{if(process.platform==='win32')child.kill(force?'SIGKILL':'SIGTERM');else process.kill(-child.pid,force?'SIGKILL':'SIGTERM');}catch{}}
    const stop=()=>{stopped=true;kill();hard=setTimeout(()=>kill(true),3000);hard.unref();};
    const timer=setTimeout(stop,seconds*1000);timer.unref();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    const cleanup=()=>{clearTimeout(timer);clearTimeout(hard);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
    child.once('error',e=>{cleanup();reject(e);});child.once('close',code=>{cleanup();resolve({code,stopped});});
  });
}
export async function refreshed(plan) {
  const machine=await scan();
  if(machine.platform!==plan.machine.platform||machine.architecture!==plan.machine.architecture)throw new ApertureError('MACHINE_CHANGED','This answer was made for a different operating system or architecture. Run setup again.');
  if(plan.method.gpu) {
    const gpu=machine.gpu.devices.find(d=>d.uuid===plan.method.gpu.uuid&&!d.externalGate);
    if(!gpu||gpu.freeBytes<plan.method.gpuBudgetBytes)throw new ApertureError('GPU_CHANGED','The selected GPU or its available memory changed. Run setup again; no requirements were reduced.');
  }
  if((machine.memory.allocationHeadroomBytes??machine.memory.availableBytes)<plan.method.ramBudgetBytes)throw new ApertureError('RAM_CHANGED','Available RAM is below the saved budget. Run setup again.');
  return {...plan,machine};
}
export async function runNative(plan,ui,{experiment=false,...options}={}) {
  if(plan.blockers.length)throw new ApertureError('PLAN_BLOCKED',plan.blockers.join(' '));
  if(!plan.model.local)throw new ApertureError('MODEL_NOT_LOCAL','The selected weights must be acquired before execution.');
  const {prepareNativeFit}=await import('./native-fit.mjs');
  const prepared=await prepareNativeFit(plan,ui,options);
  const runtimeDirectory=prepared.runtimeDirectory;
  plan={...prepared.plan,method:{...prepared.plan.method,gpuLayers:prepared.plan.nativeFit.selected.gpuLayers}};
  const prompt=experiment?'Explain why a model checkpoint can exceed GPU memory, in three sentences.':options.prompt??await ui.ask('What should the model answer?');
  if(!prompt?.trim())throw new ApertureError('CANCELLED','No prompt supplied.');
  const seconds=options.seconds??600,tokens=options.tokens??128;
  if(!options.runApproved&&!await ui.confirm(`Load this exact model and generate up to ${tokens} tokens${experiment?' twice for the experiment':''}? Each worker is limited to ${seconds} seconds; preparation/hash time is additional.`))return null;
  ui.say('Verifying the complete local checkpoint before loading. Large models take time; no full hash was required to produce the earlier answer.');
  const modelContent=[];
  for(const f of plan.model.files){const stat=await fs.stat(f.path);if(stat.size!==f.bytes)throw new ApertureError('MODEL_CHANGED','A selected checkpoint file changed size.');const digest=await hashFile(f.path);if(f.sha256&&digest!==f.sha256)throw new ApertureError('MODEL_CHANGED','A checkpoint digest changed.');modelContent.push({name:f.name,bytes:stat.size,sha256:digest});}
  const directory=path.join(appHome(),'runs',`${Date.now()}-${process.pid}`);await mkdirPrivate(directory);
  const trials=[];
  for(let i=0;i<(experiment?2:1);i++){
    const resultFile=path.join(directory,`result-${i+1}.json`),jobFile=path.join(directory,`job-${i+1}.json`);
    await writeNew(jobFile,{plan,runtimeDirectory,modelContent,prompt,tokens,resultFile});
    const env=nativeEnvironment(plan);
    ui.say(experiment?`Experiment run ${i+1}/2:`:'Starting the selected model:');
    const result=await supervised(process.execPath,[path.join(root,'lib','native-worker.mjs'),jobFile],env,seconds);
    const detail=await exists(resultFile)?await jsonFile(resultFile):null;
    trials.push({number:i+1,status:result.stopped?'STOPPED':result.code===0&&detail?'COMPLETED':'FAILED',result:detail});
    if(trials.at(-1).status!=='COMPLETED')break;
    ui.say(`Observed: ${detail.deviceNames?.join(', ')||detail.backend||'CPU'}; ${detail.observedGpuLayers} GPU layers; context ${detail.observedContext}; response ${detail.generationSeconds.toFixed(2)} seconds${detail.outputTokenCount!=null?'; '+detail.outputTokenCount+' native output tokens':''}.`);
  }
  const requested=experiment?2:1;while(trials.length<requested)trials.push({number:trials.length+1,status:'NOT_STARTED',result:null});
  const completed=trials.filter(t=>t.status==='COMPLETED');
  const summary={schema:'aperture-runs/1',createdAt:now(),experiment,requested,completed:completed.length,
    status:completed.length===requested?'COMPLETED_NOT_TASK_QUALIFIED':'INCOMPLETE',trials,
    outputAgreement:completed.length===2?completed[0].result.text===completed[1].result.text:null,
    note:'Output agreement is not ground truth or numerical parity. Repeated runs may use a warm filesystem cache. No telemetry is uploaded.'};
  await writeNew(path.join(directory,'summary.json'),summary);
  ui.say(`Results saved locally in ${directory}. ${completed.length}/${requested} runs completed. Full records contain your prompt and generated text.`);
  return summary;
}
export async function runHf(plan,ui,{experiment=false,...options}={}) {
  if(plan.blockers.length)throw new ApertureError('PLAN_BLOCKED',plan.blockers.join(' '));
  plan=await refreshed(plan);
  let python=plan.machine.installed.python;
  if(!python)throw new ApertureError('PYTHON_REQUIRED','The safetensors route requires Python 3.10+ with a compatible PyTorch build. The Node-only answer is complete, but this execution adapter is not installed.');
  const pyPrefix=path.basename(python).toLowerCase()==='py.exe'?['-3']:[];
  const torch=await command(python,[...pyPrefix,'-c','import sys,torch; assert sys.version_info >= (3,10); print(torch.__version__)'],{timeout:30000});
  if(torch.code!==0)throw new ApertureError('TORCH_REQUIRED','The safetensors adapter needs an existing compatible Python/PyTorch installation. No model was substituted or driver changed.');
  const envDir=path.join(appHome(),'runtimes',`hf-${Date.now()}`);
  if(!await ui.confirm(`Prepare an isolated environment using your existing PyTorch ${torch.stdout.trim()}, download its helper packages, and allow execution?`))return null;
  await mkdirPrivate(path.dirname(envDir));
  const created=await command(python,[...pyPrefix,'-m','venv','--system-site-packages',envDir],{timeout:180000});
  if(created.code!==0)throw new ApertureError('VENV_FAILED','The isolated Python environment could not be created.');
  python=path.join(envDir,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const constraint=path.join(envDir,'constraints.txt');await writeNew(constraint,`torch==${torch.stdout.trim()}\n`);
  const installed=await command(python,['-m','pip','install','-r',path.join(root,'vendor','aperture-methods','requirements-hf.txt'),'-c',constraint],{inherit:true,timeout:1200000});
  if(installed.code!==0)throw new ApertureError('HF_INSTALL','The helper dependency installation failed.');
  const disk=await ui.confirm('Permit additional disk space for weight offload if the native device map requires it?');
  const directory=path.join(appHome(),'runs',`hf-${Date.now()}`);await mkdirPrivate(directory);
  const method=path.join(directory,'method.json'),engine=path.join(root,'vendor','aperture-methods');
  const environment={...process.env,PYTHONPATH:engine,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};
  const args=['-m','aperture_methods','configure','--model',plan.model.source.path,'--backend','hf','--gpu',plan.method.gpu?.uuid||'cpu','--context',String(plan.request.contextPerSequence),'--parallel','1','--ram',String(plan.method.ramBudgetBytes),'--reserve',String(plan.method.reserveBytes),'--out',method];
  if(plan.method.gpu)args.push('--gpu-memory',String(plan.method.gpuBudgetBytes));if(disk)args.push('--disk-offload');
  const configured=await command(python,args,{env:environment,inherit:true,timeout:3600000});
  if(configured.code!==0)throw new ApertureError('CONFIGURATION_FAILED','The backend could not admit the selected safetensors checkpoint.');
  const prompt=experiment?null:options.prompt??await ui.ask('What should the model answer?');
  if(!experiment&&!prompt?.trim())return null;
  if(!await ui.confirm(`Run ${experiment?'two bounded experiment trials':'a bounded generation'} for up to 600 seconds?`))return null;
  const runArgs=experiment?['-m','aperture_methods','experiment',method,'--acknowledge-experiment','--seconds','600','--repeats','2','--out',path.join(directory,'experiment')]:['-m','aperture_methods','run',method,'--prompt',prompt,'--tokens','128','--seconds','600','--chat','--out',path.join(directory,'generation')];
  const result=await supervised(python,runArgs,environment,610);
  ui.say(`Backend exit: ${result.code}; local records: ${directory}.`);return result;
}
