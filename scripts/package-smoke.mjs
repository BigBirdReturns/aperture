import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
let npm;for(const candidate of candidates){try{await fs.access(candidate);npm=candidate;break;}catch{}}
if(!npm)throw new Error("Cannot locate this Node installation npm CLI. Run through npm exec.");
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'aperture-install-'));
function run(args){const r=spawnSync(process.execPath,[npm,...args],{cwd:root,encoding:'utf8',env:{...process.env,npm_config_cache:path.join(tmp,'cache')}});if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout;}
function values(value,result=[]){
  if(Array.isArray(value))for(const item of value)values(item,result);
  else if(value&&typeof value==='object')for(const item of Object.values(value))values(item,result);
  else if(typeof value==='string')result.push(value);
  return result;
}
function keys(value,result=[]){
  if(Array.isArray(value))for(const item of value)keys(item,result);
  else if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){result.push(key);keys(item,result);}
  return result;
}
try{
  const info=JSON.parse(run(['pack','--json','--pack-destination',tmp]));
  const archive=path.join(tmp,info[0].filename);
  const output=run(['exec','--yes','--package',archive,'--','aperture','--version']).trim();
  const expected=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
  if(output!==expected)throw new Error('Installed executable version mismatch: '+output);
  const supportFile=path.join(tmp,'support.json');
  run(['exec','--yes','--package',archive,'--','aperture','support','--allow-scan','--out',supportFile]);
  const support=JSON.parse(await fs.readFile(supportFile,'utf8'));
  if(support.schema!=='aperture-support/1'||support.apertureVersion!==expected)throw new Error('Installed support receipt identity mismatch.');
  const forbidden=new Set(['path','observedPath','uuid','id','mount','diskId','location']);
  const present=keys(support).filter(key=>forbidden.has(key));
  if(present.length)throw new Error('Support receipt exposed local identifier keys: '+present.join(', '));
  const strings=values(support),privateValues=[tmp,os.homedir(),os.hostname()].filter(Boolean);
  if(strings.some(value=>privateValues.some(secret=>value===secret||value.includes(secret))))throw new Error('Support receipt exposed a local path or host name.');
  console.log('Clean npm package install, executable version, and redacted support receipt: PASS');
}finally{await fs.rm(tmp,{recursive:true,force:true});}
