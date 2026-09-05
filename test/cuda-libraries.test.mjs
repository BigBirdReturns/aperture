import test from 'node:test';
import assert from 'node:assert/strict';
import {installedCudaLibraries,cudaLibraryEnvironment} from '../lib/cuda-libraries.mjs';
import {nativeEnvironment} from '../lib/backends.mjs';
const dir='C:\\Installed\\Ollama\\lib\\ollama\\cuda_v13';
const cuda13=['cublas64_13.dll','cublasLt64_13.dll'];
const fakeStat=paths=>async p=>({isFile:()=>paths.includes(p.toLowerCase())});
const paths=(root,names)=>names.map(n=>(root+'\\'+n).toLowerCase());
test('CUDA DLL selection changes a copy of the child environment only',()=>{
 const base={Path:'C:\\Windows',CUDA_VISIBLE_DEVICES:'GPU-chosen',OTHER:'kept'};
 const result=cudaLibraryEnvironment(base,dir);
 assert.deepEqual(base,{Path:'C:\\Windows',CUDA_VISIBLE_DEVICES:'GPU-chosen',OTHER:'kept'});
 assert.equal(result.PATH,dir+';C:\\Windows');assert.equal(result.Path,undefined);
 assert.equal(result.CUDA_VISIBLE_DEVICES,'GPU-chosen');assert.equal(result.OTHER,'kept');
});
test('Reject relative and multiple CUDA library paths',()=>{
 for(const value of ['relative','C:\\one;C:\\two','C:\\bad\npath'])assert.throws(()=>cudaLibraryEnvironment({},value));
});
test('No selected library leaves the environment contents unchanged',()=>{
 const env={Path:'C:\\Windows'};assert.deepEqual(cudaLibraryEnvironment(env,null),env);
 assert.notEqual(cudaLibraryEnvironment(env,null),env);
});
test('Non-Windows does not inspect Windows library paths',async()=>{
 let reads=0;assert.deepEqual(await installedCudaLibraries({platform:'linux',stat:async()=>{reads++;}}),[]);
 assert.equal(reads,0);
});
test('Explicit CUDA 13 directory needs both cuBLAS components',async()=>{
 const env={APERTURE_CUDA_LIBRARY_DIR:dir};
 assert.equal((await installedCudaLibraries({platform:'win32',env,stat:fakeStat(paths(dir,cuda13))}))[0].abi,13);
 assert.deepEqual(await installedCudaLibraries({platform:'win32',env,stat:fakeStat(paths(dir,cuda13.slice(0,1)))}),[]);
});
test('CUDA 12 fallback also needs cudart',async()=>{
 const root='C:\\CUDA\\bin',names=['cublas64_12.dll','cublasLt64_12.dll','cudart64_12.dll'];
 const env={CUDA_PATH:'C:\\CUDA'};
 assert.equal((await installedCudaLibraries({platform:'win32',env,stat:fakeStat(paths(root,names))}))[0].abi,12);
 assert.deepEqual(await installedCudaLibraries({platform:'win32',env,stat:fakeStat(paths(root,names.slice(0,2)))}),[]);
});
test('Ollama adjacent libraries require an actual executable in that prefix',async()=>{
 const env={Path:'C:\\Installed\\Ollama'},files=paths(dir,cuda13);
 assert.deepEqual(await installedCudaLibraries({platform:'win32',env,stat:fakeStat(files)}),[]);
 files.push('c:\\installed\\ollama\\ollama.exe');
 assert.equal((await installedCudaLibraries({platform:'win32',env,stat:fakeStat(files)}))[0].directory,dir);
});
test('Toolkit bin/x64 and case-insensitive environment names are supported',async()=>{
 const root='C:\\CUDA\\bin\\x64';
 const found=await installedCudaLibraries({platform:'win32',env:{cuda_path:'C:\\CUDA'},stat:fakeStat(paths(root,cuda13))});
 assert.equal(found[0].directory,root);
});
test('Duplicate installed prefixes are deduplicated',async()=>{
 const root='C:\\CUDA\\bin',env={CUDA_PATH:'C:\\CUDA',CUDA_PATH_V13_1:'C:\\CUDA'};
 const found=await installedCudaLibraries({platform:'win32',env,stat:fakeStat(paths(root,cuda13))});assert.equal(found.length,1);
});
test('CUDA child keeps GPU selection and Vulkan does not inherit CUDA libraries',()=>{
 const plan={method:{backend:'cuda',gpu:{uuid:'GPU-chosen'},cudaLibraryDirectory:dir}};
 const result=nativeEnvironment(plan,{Path:'C:\\Windows'});assert.equal(result.CUDA_VISIBLE_DEVICES,'GPU-chosen');assert.equal(result.PATH,dir+';C:\\Windows');
 plan.method.backend='vulkan';plan.method.vulkanIndex=0;
 const other=nativeEnvironment(plan,{Path:'C:\\Windows'});assert.equal(other.Path,'C:\\Windows');assert.equal(other.PATH,undefined);
});

test('UNC library candidates never trigger automatic filesystem probes',async()=>{
 let reads=0;const unc='\\\\server\\share';
 assert.throws(()=>cudaLibraryEnvironment({},unc));
 const found=await installedCudaLibraries({platform:'win32',env:{PATH:unc,CUDA_PATH:unc,APERTURE_CUDA_LIBRARY_DIR:unc},stat:async()=>{reads++;return {isFile:()=>true};}});
 assert.deepEqual(found,[]);assert.equal(reads,0);
});
