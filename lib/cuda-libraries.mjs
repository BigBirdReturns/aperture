import fs from 'node:fs/promises';
import path from 'node:path';
const win=path.win32;
const librarySets=[
  {abi:13,files:['cublas64_13.dll','cublasLt64_13.dll']},
  {abi:12,files:['cublas64_12.dll','cublasLt64_12.dll','cudart64_12.dll']}
];
const usable=p=>typeof p==='string'&&win.isAbsolute(p)&&/^[a-z]:[\\/]/i.test(p)&&!/[;\x00-\x1f]/.test(p);
/** A new child environment only. Never change process.env or a machine setting. */
export function cudaLibraryEnvironment(base,directory){
  const result={...base};
  if(directory==null)return result;
  if(!usable(directory))throw Error('CUDA library directory must be one absolute Windows path.');
  const keys=Object.keys(result).filter(k=>k.toUpperCase()==='PATH');
  const previous=keys.length?String(result[keys[0]]):'';
  for(const key of keys)delete result[key];
  result.PATH=directory+(previous?';'+previous:'');
  return result;
}
/** Bounded installed-prefix inspection, with no downloads or recursive search. */
export async function installedCudaLibraries({platform=process.platform,env=process.env,stat=fs.stat}={}){
  if(platform!=='win32')return [];
  const vars=Object.fromEntries(Object.entries(env).map(([k,v])=>[k.toUpperCase(),v]));
  const candidates=[],seen=new Set();
  function add(directory,source){
    if(!usable(directory)||candidates.length>=32)return;
    directory=win.normalize(directory);const key=directory.toLowerCase();
    if(!seen.has(key)){seen.add(key);candidates.push({directory,source});}
  }
  async function regular(p){try{return (await stat(p)).isFile();}catch{return false;}}
  add(vars.APERTURE_CUDA_LIBRARY_DIR,'explicit APERTURE_CUDA_LIBRARY_DIR');
  for(const key of Object.keys(vars).filter(k=>/^CUDA_PATH(?:_V\d+_\d+)?$/.test(k)).sort().slice(0,8)){
    if(!usable(vars[key]))continue;
    add(win.join(vars[key],'bin'),'installed CUDA toolkit');
    add(win.join(vars[key],'bin','x64'),'installed CUDA toolkit');
  }
  const ollamaRoots=String(vars.PATH??'').split(';').filter(usable).slice(0,96);
  if(usable(vars.LOCALAPPDATA))ollamaRoots.push(win.join(vars.LOCALAPPDATA,'Programs','Ollama'));
  if(usable(vars.PROGRAMFILES))ollamaRoots.push(win.join(vars.PROGRAMFILES,'Ollama'));
  for(const root of [...new Set(ollamaRoots)]){
    if(!await regular(win.join(root,'ollama.exe')))continue;
    for(const abi of [13,12])add(win.join(root,'lib','ollama',`cuda_v${abi}`),'installed Ollama CUDA libraries');
  }
  const found=[];
  for(const candidate of candidates){
    for(const set of librarySets){
      const present=await Promise.all(set.files.map(name=>regular(win.join(candidate.directory,name))));
      if(present.every(Boolean)){found.push({...candidate,abi:set.abi});break;}
    }
    if(found.length>=8)break;
  }
  return found;
}
