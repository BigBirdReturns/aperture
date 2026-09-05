import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {isNeuralDevice,normalizeWindows,graphicsDomain,flattenBlockDevices,matchingVolume,storageAt} from '../lib/hardware.mjs';
import {deviceBudget,chooseVulkan,nativeEnvironment,verifyNativeDevice} from '../lib/backends.mjs';
import {makePlan} from '../lib/routes.mjs';
import {nativeOptions} from '../lib/native-session.mjs';
const GiB=1024**3;
const machine={platform:'win32',architecture:'x64',cpu:'Test CPU',logicalCpus:8,memory:{totalBytes:16*GiB,availableBytes:8*GiB,allocationHeadroomBytes:6*GiB},gpu:{devices:[],appleUnifiedMemory:false},storage:{path:os.tmpdir(),freeBytes:40*GiB},hardware:{graphics:[],neural:[],errors:[],volumes:[],disks:[],links:[],neuralStatus:'ENUMERATED'}};
const model={kind:'gguf',name:'synthetic.gguf',bytes:GiB,local:true,source:{path:'synthetic.gguf'},gguf:{metadata:{'general.architecture':'llama','llama.context_length':8192}}};
test('Input devices are not neural accelerators',()=>assert.equal(isNeuralDevice({Name:'USB Input Device',PNPClass:'HIDClass'}),false));
test('AI Boost and accelerator device class remain visible',()=>{assert.ok(isNeuralDevice({Name:'Intel(R) AI Boost'}));assert.ok(isNeuralDevice({Name:'Device',PNPClass:'ComputeAccelerator'}));});
test('Windows incomplete memory is unknown rather than zero',()=>assert.equal(normalizeWindows({}).memory.availableBytes,null));
test('Windows singleton device objects normalize into arrays',()=>assert.equal(normalizeWindows({display:{Name:'Intel(R) UHD Graphics 770'}}).graphics.length,1));
test('Windows volume identity joins to its partition disk',()=>assert.equal(normalizeWindows({volumes:{DriveLetter:'D',Size:100,SizeRemaining:30},partitions:{DriveLetter:'D',DiskNumber:5}}).volumes[0].diskId,'5'));
test('Intel integrated graphics is charged to system RAM',()=>assert.equal(graphicsDomain('Intel(R) Arc(TM) Graphics','win32','x64'),'system'));
test('Discrete Intel Arc is not automatically called shared memory',()=>assert.equal(graphicsDomain('Intel Arc A770','win32','x64'),'unknown'));
test('Apple Silicon memory is shared',()=>assert.equal(graphicsDomain('Apple M4','darwin','arm64'),'system'));
test('Virtual block devices are excluded and disk parents preserved',()=>{const r=flattenBlockDevices([{name:'loop0',type:'loop'},{name:'sda',type:'disk',children:[{name:'sda1',type:'part',mountpoints:['/models']}]}]);assert.equal(r.length,2);assert.equal(r[1].parentId,'sda');});
test('Storage matching honors mount boundaries',()=>{assert.equal(matchingVolume('/models-other/a',[{mount:'/models'},{mount:'/'}],'linux').mount,'/');});
test('Windows volume matching ignores case',()=>assert.equal(matchingVolume('d:\\models\\x',[{mount:'D:\\'}],'win32').mount,'D:\\'));
test('New application directory inherits real parent free space',async()=>{const r=await storageAt(path.join(os.tmpdir(),'aperture-not-created-892934','nested'));assert.equal(r.status,'OBSERVED');assert.ok(r.freeBytes>0);});
test('Shared GPU and CPU provisional budgets are not added twice',()=>{const r=deviceBudget(machine,{names:['Intel(R) UHD Graphics 770'],vram:{free:12*GiB,total:16*GiB}});assert.equal(r.memoryDomain,'system');assert.ok(r.ramBudgetBytes+r.budgetBytes<=6*GiB*0.7);});
test('Unknown memory topology also gets conservative shared treatment',()=>{const r=deviceBudget(machine,{names:['Unknown accelerator'],vram:{free:12*GiB,total:16*GiB}});assert.ok(r.ramBudgetBytes+r.budgetBytes<=6*GiB*0.7);});
test('Vulkan free memory is bounded by independent NVIDIA observation',()=>{const m={...machine,gpu:{devices:[{name:'RTX Test',freeBytes:2*GiB}]}};assert.equal(deviceBudget(m,{names:['RTX Test'],vram:{free:7*GiB,total:8*GiB}}).freeBytes,2*GiB);});
test('Native capacity missing free bytes is refused',()=>assert.throws(()=>deviceBudget(machine,{names:['Test'],vram:{total:GiB}}),/incomplete/));
test('Explicit Vulkan device ambiguity is refused',()=>assert.throws(()=>chooseVulkan([{index:0,names:['Intel A']},{index:1,names:['Intel B']}],'Intel'),/More than one/));
test('Native numeric device selection is exact',()=>assert.equal(chooseVulkan([{index:2,names:['Intel'],screen:{budgetBytes:1}}],'2').index,2));
test('Native worker device readback refuses changes',async()=>{await assert.rejects(verifyNativeDevice({getGpuDeviceNames:async()=>['Other']},{method:{expectedDeviceNames:['Intel']}}),/changed/);});
test('Child selection does not inherit an unrelated Vulkan device',()=>{const e=nativeEnvironment({method:{backend:'cpu'}},{GGML_VK_VISIBLE_DEVICES:'9',CUDA_VISIBLE_DEVICES:'9'});assert.equal(e.GGML_VK_VISIBLE_DEVICES,undefined);assert.equal(e.CUDA_VISIBLE_DEVICES,'');});
test('Vulkan worker receives the selected native index',()=>assert.equal(nativeEnvironment({method:{backend:'vulkan',vulkanIndex:2}},{}).GGML_VK_VISIBLE_DEVICES,'2'));
test('Explicit NPU preserves the checkpoint and reports missing numerical adapter',()=>{const p=makePlan(machine,model,{backend:'npu',context:8192,contextExplicit:true});assert.equal(p.model,model);assert.equal(p.request.contextPerSequence,8192);assert.equal(p.method.backend,'npu');assert.ok(p.blockers.some(b=>b.includes('NPU numerical adapter')));});
test('Explicit Vulkan route is available without NVIDIA',()=>{const p=makePlan(machine,model,{backend:'vulkan',device:'Intel'});assert.equal(p.method.backend,'vulkan');assert.equal(p.request.device,'Intel');});
test('Windows RAM budget respects commit headroom',()=>assert.ok(makePlan(machine,model,{cpu:true}).method.ramBudgetBytes<=6*GiB*0.7));
test('Explicit CUDA with no eligible NVIDIA device is blocked',()=>assert.ok(makePlan(machine,model,{backend:'cuda'}).blockers.length));
test('Contradictory CPU and GPU backend requests fail',()=>assert.throws(()=>makePlan(machine,model,{cpu:true,backend:'vulkan'}),/cannot be combined/));
test('Thread request above usable CPU count fails',()=>assert.throws(()=>makePlan(machine,model,{threads:99}),/Thread count/));
test('Runtime options preserve explicit context and CPU threads',()=>{const p=makePlan(machine,model,{backend:'vulkan',context:8192,contextExplicit:true,threads:3});const o=nativeOptions(p);assert.equal(o.context.contextSize,8192);assert.equal(o.context.threads,3);assert.equal(o.context.failedCreationRemedy,false);});
test('Vulkan padding uses native free capacity, not a fictional VRAM sum',()=>{const p=makePlan(machine,model,{backend:'vulkan'});p.method.gpuBudgetBytes=GiB;p.method.nativeObservation={vram:{free:4*GiB}};assert.equal(nativeOptions(p).llama.vramPadding,3*GiB);});

test('A supervised numerical worker receives stdin EOF without consuming controller input',async()=>{const {supervised}=await import('../lib/run.mjs');const r=await supervised(process.execPath,['-e',"process.stdin.on('end',()=>process.exit(0));process.stdin.resume()"],process.env,2);assert.equal(r.code,0);assert.equal(r.stopped,false);});
test('Automatic routing can use CPU when dedicated GPUs have no reserved headroom',()=>{
  const m={...machine,gpu:{devices:[{name:'RTX Test',uuid:'GPU-test',totalBytes:24*GiB,freeBytes:GiB,externalGate:false}],appleUnifiedMemory:false}};
  const p=makePlan(m,model);assert.equal(p.method.backend,'cpu');assert.equal(p.blockers.length,0);assert.equal(p.method.backendFallback,'CPU_AFTER_LOW_GPU_HEADROOM');
});
test('Vulkan cannot bypass an existing accelerator capacity gate',()=>{
  const m={...machine,gpu:{devices:[{name:'CMP Test',freeBytes:GiB,externalGate:true}]}};
  assert.throws(()=>deviceBudget(m,{names:['CMP Test'],vram:{free:GiB,total:2*GiB}}),/qualification gate/);
});
test('An explicitly selected GGUF engine blob does not require renaming',async()=>{
  const fs=await import('node:fs/promises'),{inspectLocal}=await import('../lib/models.mjs');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aperture-opaque-'));
  try {
    const header=Buffer.alloc(24);header.write('GGUF');header.writeUInt32LE(3,4);
    const file=path.join(dir,'sha256-synthetic');await fs.writeFile(file,header);
    const result=await inspectLocal({kind:'local',path:file});assert.equal(result.kind,'gguf');assert.equal(result.source.path,file);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
