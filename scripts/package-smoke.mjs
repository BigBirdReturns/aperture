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
try{
  const info=JSON.parse(run(['pack','--json','--pack-destination',tmp]));
  const archive=path.join(tmp,info[0].filename);
  const output=run(['exec','--yes','--package',archive,'--','aperture','--version']).trim();
  const expected=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
  if(output!==expected)throw new Error('Installed executable version mismatch: '+output);
  console.log('Clean npm package install and executable version: PASS');
}finally{await fs.rm(tmp,{recursive:true,force:true});}
