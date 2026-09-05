import readline from 'node:readline';
import {ApertureError,clean} from './common.mjs';
export function terminalUI({input=process.stdin,output=process.stdout}={}) {
  // Queue line events so pasted/piped responses are not lost between async steps.
  const rl=readline.createInterface({input,output,terminal:!!input.isTTY,crlfDelay:Infinity});
  const queue=[];let waiter=null,closed=false;
  rl.on('line',line=>{if(waiter){const w=waiter;waiter=null;w(line);}else queue.push(line);});
  rl.on('close',()=>{closed=true;if(waiter){const w=waiter;waiter=null;w(null);}});
  const say=s=>output.write(clean(s)+'\n');
  const ask=async prompt=>{
    output.write(clean(prompt)+' ');
    if(queue.length)return queue.shift();
    if(closed)return null;
    return new Promise(resolve=>{waiter=resolve;});
  };
  const confirm=async prompt=>/^(y|yes)$/i.test((await ask(prompt+' [y/N]'))?.trim()||'');
  const choose=async(labels,values=labels)=>{
    say(labels.map((s,i)=>`  ${i+1}. ${clean(s)}`).join('\n'));
    for(;;){
      const raw=await ask('Select the exact artifact (number; blank cancels):');
      if(raw==null||!raw.trim())throw new ApertureError('CANCELLED','No artifact was selected.');
      const i=Number(raw)-1;
      if(Number.isInteger(i)&&i>=0&&i<values.length)return values[i];
      say(`Enter a number from 1 to ${values.length}, or press Enter to cancel.`);
    }
  };
  const write=s=>output.write(clean(s));
  return {say,ask,confirm,choose,write,close:()=>rl.close()};
}
