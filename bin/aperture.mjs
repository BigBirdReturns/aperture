#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {terminalUI} from '../lib/ui.mjs';
import {wizard,resume,listSaved} from '../lib/wizard.mjs';
import {positive,clean} from '../lib/common.mjs';
import {VERSION} from '../lib/version.mjs';
let ui;
try{
  const{values,positionals}=parseArgs({allowPositionals:true,options:{
    help:{type:'boolean',short:'h'},version:{type:'boolean',short:'v'},model:{type:'string'},context:{type:'string'},parallel:{type:'string'},cpu:{type:'boolean'},'gpu-layers':{type:'string'},
    'allow-scan':{type:'boolean'},'allow-network':{type:'boolean'},'answer-only':{type:'boolean'},out:{type:'string'},
    'allow-download':{type:'boolean'},'allow-install':{type:'boolean'},'allow-run':{type:'boolean'},prompt:{type:'string'},tokens:{type:'string'},seconds:{type:'string'},once:{type:'boolean'}
  }});
  if(values.help)console.log(`Aperture ${VERSION}

  aperture                         Scan -> chosen model -> configuration -> chat
  aperture setup                   Same guided setup
  aperture list                    Your saved configurations
  aperture chat ANSWER.json         Resume a local chat; /new and /exit supported
  aperture run ANSWER.json          Generate one answer and record the run
  aperture experiment ANSWER.json   Two opt-in bounded trials

  --model PATH_OR_HTTPS_LINK        Local GGUF/folder, HF link, hf:owner/repo
  --context N                      Tokens per session (default 4096)
  --parallel N                     Preserve an explicit session requirement
  --cpu                            Explicit CPU-only route
  --gpu-layers N                   Pin a layer count for supported GGUF execution
  --answer-only                    Print configuration without installing/running
  --out FILE                       Save configuration to a new JSON file
  --prompt TEXT                    Prompt for run/chat; --once exits chat after it
  --tokens N                       Generated token limit (run 128; chat 1024)
  --seconds N                      Single-run timeout (default 600)

Explicit automation permissions, each independent:
  --allow-scan                      Read hardware observations
  --allow-network                   Read bounded model metadata
  --allow-download                  Download/reuse the selected weights
  --allow-install                   Install the isolated pinned native runtime
  --allow-run                       Execute the selected local model

No scan or model access occurs with --help or --version. No initial runtime
installation, lifecycle scripts, telemetry, account or API key is required.
Model architecture support comes from the selected runtime; fit and speed
remain predictions until the configuration actually runs.`);
  else if(values.version)console.log(VERSION);
  else{
    const command=positionals[0]||'setup';
    if(!['setup','list','run','chat','experiment'].includes(command))throw new Error('Unknown command. Use aperture --help.');
    const options={model:values.model,context:values.context?positive(values.context,'Context'):4096,contextExplicit:!!values.context,
      parallel:values.parallel?positive(values.parallel,'Sessions',1024):1,cpu:!!values.cpu,gpuLayers:values['gpu-layers']!==undefined?Number(values['gpu-layers']):null,
      scanApproved:!!values['allow-scan'],networkApproved:!!values['allow-network'],downloadApproved:!!values['allow-download'],installApproved:!!values['allow-install'],runApproved:!!values['allow-run'],
      answerOnly:!!values['answer-only'],out:values.out,prompt:values.prompt,once:!!values.once,
      tokens:values.tokens?positive(values.tokens,'Tokens',32768):undefined,seconds:values.seconds?positive(values.seconds,'Seconds',3600):undefined};
    ui=terminalUI();let result;
    if(command==='list')await listSaved(ui);
    else if(command==='setup'){
      if(positionals.length>1)throw new Error('Supply the model with --model.');
      result=await wizard(ui,options);
    }else{
      if(positionals.length!==2)throw new Error('Specify one saved configuration JSON file.');
      if(command==='chat'&&options.runApproved&&!options.prompt&&options.once)throw new Error('--once requires --prompt.');
      result=await resume(positionals[1],ui,{...options,chat:command==='chat',experiment:command==='experiment'});
    }
    if(result?.status==='INCOMPLETE')process.exitCode=2;
  }
}catch(e){console.error(`${e.code||'APERTURE'}: ${clean(e.message)}`);process.exitCode=e.code==='CANCELLED'?0:2;}
finally{ui?.close();}
