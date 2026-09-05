import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const moduleUrl=new URL('../lib/common.mjs',import.meta.url).href;
const childCode="process.stdin.resume();process.stdin.once('end',()=>{console.log('CHILD_EOF');console.error('CHILD_STDERR');});";
for(const inherit of [false,true]){
 test(`managed command closes stdin while inherit=${inherit}`,{timeout:25000},async()=>{
  const fixture=[
   `import {command} from ${JSON.stringify(moduleUrl)};`,
   "import readline from 'node:readline';",
   'const ui=readline.createInterface({input:process.stdin,output:process.stdout});',
   `try{const r=await command(process.execPath,['-e',${JSON.stringify(childCode)}],{inherit:${inherit},timeout:8000});console.log('RESULT='+JSON.stringify(r));}finally{ui.close();}`
  ].join('\n');
  const observed=await new Promise((resolve,reject)=>{
   const p=spawn(process.execPath,['--input-type=module','-e',fixture],{stdio:['pipe','pipe','pipe'],windowsHide:true});
   let out='',err='';const timer=setTimeout(()=>p.kill(),20000);
   // Keep the controller input open, as it is in the interactive wizard.
   p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);
   p.once('error',e=>{clearTimeout(timer);reject(e);});
   p.once('close',code=>{clearTimeout(timer);p.stdin.destroy();resolve({code,out,err});});
  });
  assert.equal(observed.code,0,observed.err);
  const result=JSON.parse(observed.out.split(/\r?\n/).find(s=>s.startsWith('RESULT=')).slice(7));
  assert.equal(result.timedOut,false,'Child must receive EOF without waiting for controller input.');
  assert.equal(result.code,0);
  assert.match(inherit?observed.out:result.stdout,/CHILD_EOF/);
  assert.match(inherit?observed.err:result.stderr,/CHILD_STDERR/);
 });
}
