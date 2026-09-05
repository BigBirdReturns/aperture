import fs from 'node:fs/promises';
import path from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ensureNative,refreshed} from './run.mjs';
import {bindNative,nativeEnvironment} from './backends.mjs';
import {ApertureError,appHome,mkdirPrivate,writeNew,hashFile,clean} from './common.mjs';

export async function chat(plan,ui,options={}){
  if(plan.blockers.length)throw new ApertureError('PLAN_BLOCKED',plan.blockers.join(' '));
  if(plan.model.kind!=='gguf'||!plan.model.local)throw new ApertureError('CHAT_FORMAT','Interactive chat currently requires a local GGUF.');
  plan=await refreshed(plan);
  const runtimeDirectory=await ensureNative(ui,options);
  plan=await bindNative(plan,runtimeDirectory,ui);
  if(!options.runApproved&&!await ui.confirm('Load this configuration for a local chat session? /exit releases it; the maximum session is one hour.'))return;
  ui.say('Checking your selected files, then loading the model. No other model or service is stopped.');
  for(const f of plan.model.files){
    const s=await fs.stat(f.path);
    if(s.size!==f.bytes)throw new ApertureError('MODEL_CHANGED','A selected file changed size. Run setup again.');
    if(f.sha256&&await hashFile(f.path)!==f.sha256)throw new ApertureError('MODEL_CHANGED','A selected file changed content.');
  }
  const directory=path.join(appHome(),'sessions',`${Date.now()}-${process.pid}`);await mkdirPrivate(directory);
  const job=path.join(directory,'session.json');await writeNew(job,{plan,runtimeDirectory,tokens:options.tokens??1024});
  const child=fork(fileURLToPath(new URL('./chat-worker.mjs',import.meta.url)),[job],{
    env:nativeEnvironment(plan),
    stdio:['ignore','inherit','inherit','ipc'],windowsHide:true
  });
  let waiting=null,exited=false;const pending=[];
  const deliver=m=>{if(m.type==='chunk'){ui.write?.(m.text);return;}if(waiting){const f=waiting;waiting=null;f(m);}else pending.push(m);};
  child.on('message',deliver);
  child.on('error',e=>deliver({type:'fatal',message:e.message}));
  child.on('exit',code=>{exited=true;deliver({type:'fatal',message:`Native session ended (exit ${code}).`});});
  const next=()=>pending.length?Promise.resolve(pending.shift()):new Promise(resolve=>waiting=resolve);
  let hard;
  const stop=()=>{if(child.connected)child.send({type:'stop'});hard=setTimeout(()=>child.kill('SIGKILL'),5000);hard.unref();};
  const timer=setTimeout(stop,3600_000);timer.unref();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const ready=await next();
    if(ready.type!=='ready')throw new ApertureError('NATIVE_LOAD',ready.message||'The model did not become ready.');
    ui.say(`Ready: ${ready.backend||'CPU'}, ${ready.gpuLayers} GPU layers, ${ready.context.toLocaleString()} tokens of context.`);
    ui.say('Chat locally. /new clears conversation context; /exit closes the model. Chat text is not saved by Aperture.');
    let first=options.prompt;
    while(!exited){
      const text=first??await ui.ask('\nYou:');first=undefined;
      if(text==null||text.trim()==='/exit')break;
      if(!text.trim())continue;
      if(text.trim()==='/new'){child.send({type:'reset'});await next();ui.say('Conversation context cleared.');continue;}
      child.send({type:'prompt',text});const result=await next();ui.say('');
      if(result.type==='fatal')throw new ApertureError('NATIVE_SESSION',result.message);
      if(result.type==='error')ui.say(`Generation stopped: ${result.message}`);
      else if(!ui.write)ui.say(result.text);
      if(options.once)break;
    }
  }finally{
    clearTimeout(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    if(!exited)stop();
    // Only the transient job is removed. Existing model/runtime files stay available.
    await fs.unlink(job).catch(()=>{});
    if(!exited)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,6000).unref();});
    clearTimeout(hard);
  }
}
