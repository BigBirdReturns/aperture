import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {generate} from './native-session.mjs';
import {jsonFile,writeNew,clean,ApertureError,RUNTIME_VERSION} from './common.mjs';
import {startSystemMemoryWatchdog,abortFailure} from './memory-watchdog.mjs';
let job,controller,watchdog;
try{
  process.stderr.write('Opening execution job\n');
  job=await jsonFile(process.argv[2]);
  const require=createRequire(path.join(job.runtimeDirectory,'package.json'));
  const packageMeta=await jsonFile(path.join(job.runtimeDirectory,'node_modules','node-llama-cpp','package.json'));
  if(packageMeta.version!==RUNTIME_VERSION)throw new ApertureError('RUNTIME_VERSION','The installed runtime does not match the pinned version.');
  process.stderr.write('Importing managed native runtime\n');
  const api=await import(pathToFileURL(require.resolve('node-llama-cpp')).href);
  controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
  watchdog=startSystemMemoryWatchdog(job.plan,controller);
  let result;
  try{result=await generate(api,job.plan,{prompt:job.prompt,tokens:job.tokens,signal:controller.signal,onStage:s=>process.stderr.write(clean(s)+'\n'),onText:s=>process.stdout.write(clean(s))});}
  catch(error){throw abortFailure(error,controller);}
  finally{await watchdog.stop();}
  await writeNew(job.resultFile,{...result,modelContent:job.modelContent,memoryWatchdog:watchdog.summary()});process.stdout.write('\n');
}catch(e){
  const cause=abortFailure(e,controller);
  const failure={status:'FAILED',code:cause.code||'RUN_FAILED',message:clean(cause.message),memoryWatchdog:watchdog?.summary?.()??null};
  if(job?.resultFile)try{await writeNew(job.resultFile,failure);}catch{}
  process.stderr.write(`${failure.code}: ${failure.message}\n`);process.exitCode=2;
}
