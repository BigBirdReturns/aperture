import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {generate} from './native-session.mjs';
import {jsonFile,writeNew,clean,ApertureError,RUNTIME_VERSION} from './common.mjs';
try{
  const job=await jsonFile(process.argv[2]);
  const require=createRequire(path.join(job.runtimeDirectory,'package.json'));
  const packageMeta=await jsonFile(path.join(job.runtimeDirectory,'node_modules','node-llama-cpp','package.json'));
  if(packageMeta.version!==RUNTIME_VERSION)throw new ApertureError('RUNTIME_VERSION','The installed runtime does not match the pinned version.');
  const api=await import(pathToFileURL(require.resolve('node-llama-cpp')).href);
  const stop=new AbortController();process.once('SIGTERM',()=>stop.abort());process.once('SIGINT',()=>stop.abort());
  const sample=setInterval(()=>{if(process.memoryUsage().rss>(job.plan.method.sharedMemoryBudgetBytes??job.plan.method.ramBudgetBytes))stop.abort(new Error('RAM watchdog limit'));},250);sample.unref();
  let result;
  try{result=await generate(api,job.plan,{prompt:job.prompt,tokens:job.tokens,signal:stop.signal,onText:s=>process.stdout.write(clean(s))});}
  finally{clearInterval(sample);}
  await writeNew(job.resultFile,{...result,modelContent:job.modelContent});process.stdout.write('\n');
}catch(e){process.stderr.write(`${e.code||'RUN_FAILED'}: ${clean(e.message)}\n`);process.exitCode=2;}
