// Native code stays in a child process. The parent owns the terminal and permissions.
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {nativeOptions} from './native-session.mjs';
import {verifyNativeDevice} from './backends.mjs';
import {jsonFile,RUNTIME_VERSION,ApertureError,clean} from './common.mjs';
import {startSystemMemoryWatchdog,abortFailure} from './memory-watchdog.mjs';
let llama,model,context,session,api,job,watchdog,busy=false,stopping=false;
const controller=new AbortController();
const send=m=>{if(process.connected)process.send(m);};
async function close(){
  if(stopping)return;stopping=true;controller.abort();
  for(const o of [session,context,model,llama]){try{await o?.dispose?.();}catch{}}
  await watchdog?.stop?.();
  process.disconnect?.();
}
process.on('SIGTERM',()=>{controller.abort();if(!busy)void close();});
process.on('disconnect',()=>{controller.abort();setTimeout(()=>process.exit(0),1000).unref();});
try{
  job=await jsonFile(process.argv[2]);
  watchdog=startSystemMemoryWatchdog(job.plan,controller,{onPressure:reason=>{send({type:'fatal',code:reason.code,message:clean(reason.message)});if(!busy)void close();}});
  const require=createRequire(path.join(job.runtimeDirectory,'package.json'));
  const meta=await jsonFile(path.join(job.runtimeDirectory,'node_modules','node-llama-cpp','package.json'));
  if(meta.version!==RUNTIME_VERSION)throw new ApertureError('RUNTIME_VERSION','The installed runtime version changed.');
  api=await import(pathToFileURL(require.resolve('node-llama-cpp')).href);
  const opts=nativeOptions(job.plan),start=performance.now();
  llama=await api.getLlama(opts.llama);
  if(llama.gpu!==opts.llama.gpu)throw new ApertureError('BACKEND_CHANGED','The requested execution backend was not selected.');
  await verifyNativeDevice(llama,job.plan);
  model=await llama.loadModel({...opts.model,loadSignal:controller.signal});
  if(job.plan.nativeFit&&model.gpuLayers!==job.plan.nativeFit.selected.gpuLayers)throw new ApertureError('PLACEMENT_CHANGED','Loaded GPU layer count differs from the assessed placement.');
  context=await model.createContext({...opts.context,createSignal:controller.signal});
  const sequence=context.getSequence();
  if(sequence.contextSize<job.plan.request.contextPerSequence||sequence.contextSize>job.plan.request.contextPerSequence+255)throw new ApertureError('CONTEXT_CHANGED','The runtime changed the requested context.');
  session=new api.LlamaChatSession({contextSequence:sequence});
  const initialHistory=structuredClone(session.getChatHistory());
  send({type:'ready',backend:llama.gpu,context:sequence.contextSize,gpuLayers:model.gpuLayers,loadSeconds:(performance.now()-start)/1000});
  process.on('message',async m=>{
    if(m?.type==='stop'){controller.abort();if(!busy)await close();return;}
    if(busy||stopping){send({type:'error',message:'The session is busy.'});return;}
    if(m?.type==='reset'){session.setChatHistory(structuredClone(initialHistory));send({type:'reset'});return;}
    if(m?.type!=='prompt'||typeof m.text!=='string'||Buffer.byteLength(m.text)>1024*1024){send({type:'error',message:'Expected a bounded text prompt.'});return;}
    busy=true;const start=performance.now();
    try{
      const text=await session.prompt(m.text,{maxTokens:job.tokens??1024,signal:controller.signal,onTextChunk:text=>send({type:'chunk',text})});
      if(typeof text!=='string'||!text.trim())throw new ApertureError('EMPTY_OUTPUT','The model returned no usable text.');
      send({type:'result',text,seconds:(performance.now()-start)/1000,memoryWatchdog:watchdog.summary()});
    }catch(e){const cause=abortFailure(e,controller);send({type:'error',code:cause.code||'GENERATION_FAILED',message:clean(cause.message)});}
    finally{busy=false;if(controller.signal.aborted)await close();}
  });
}catch(e){const cause=abortFailure(e,controller);send({type:'fatal',message:clean(cause.message),code:cause.code||'NATIVE_LOAD',memoryWatchdog:watchdog?.summary?.()??null});process.exitCode=2;await close();}
