// This must be a file entrypoint: native test children cannot inherit --input-type=module.
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {jsonFile,RUNTIME_VERSION} from './common.mjs';
let llama;
try {
  const [directory,backend]=process.argv.slice(2);
  if(!['cuda','vulkan','metal','cpu'].includes(backend))throw Error('Unknown backend');
  const meta=await jsonFile(path.join(directory,'node_modules/node-llama-cpp/package.json'));
  if(meta.version!==RUNTIME_VERSION)throw Error('Native runtime version mismatch');
  const resolve=createRequire(path.join(directory,'package.json'));
  const api=await import(pathToFileURL(resolve.resolve('node-llama-cpp')).href);
  llama=await api.getLlama({gpu:backend==='cpu'?false:backend,build:'never',skipDownload:true,progressLogs:false});
  if(llama.gpu!==(backend==='cpu'?false:backend))throw Error('Native backend changed');
  const result={backend,names:await llama.getGpuDeviceNames(),vram:await llama.getVramState(),ram:await llama.getRamState(),supportsGpuOffloading:llama.supportsGpuOffloading};
  console.log('APERTURE_BACKEND='+JSON.stringify(result));
} catch(e){console.error(e.message);process.exitCode=2;}
finally {await llama?.dispose();}
