import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {redactScan,supportReceipt} from '../lib/support.mjs';
import {GiB} from '../lib/common.mjs';

const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'aperture-support-test-'));
const machine={
  schema:'aperture-scan/1',startedAt:'2026-09-05T12:00:00.000Z',observedAt:'2026-09-05T12:00:02.500Z',host:'PRIVATE-HOST',
  platform:'win32',architecture:'x64',cpu:'TEST CPU',logicalCpus:20,
  memory:{totalBytes:32*GiB,availableBytes:12*GiB,allocationHeadroomBytes:10*GiB,commitHeadroomBytes:null,installedBytes:32*GiB,swapTotalBytes:null,swapFreeBytes:null,basis:'OS physical memory'},
  storage:{path:'C:\\Users\\Alice\\.aperture',observedPath:'C:\\Users\\Alice',status:'OBSERVED',totalBytes:2*GiB,freeBytes:GiB},
  hardware:{status:'PARTIAL',errors:['Core Windows inventory unavailable: C:\\Users\\Alice\\secret.txt'],
    cpu:[{name:'TEST CPU',cores:14,threads:20}],memory:{},modules:[{bytes:16*GiB,configuredRate:5600,location:'PRIVATE DIMM SLOT',rateBasis:'SMBIOS configured rate'}],
    graphics:[{id:'PCI\\VEN_PRIVATE',name:'Intel Arc Graphics',driver:'1.2.3',status:'OK',memoryDomain:'system',capacityBytes:null}],
    neural:[{id:'PCI\\NPU_PRIVATE',name:'Intel AI Boost',status:'OK',runtime:'REQUIRES_MODEL_SPECIFIC_ADAPTER',memoryDomain:'system'}],neuralStatus:'ENUMERATED',
    disks:[{id:'disk-private',name:'PRIVATE DRIVE NAME',type:'disk',bus:'NVMe',bytes:2*GiB,boot:true,rotationalReported:false}],
    physicalDisks:[{id:'SERIAL-PRIVATE',name:'PRIVATE PHYSICAL DRIVE',media:'SSD',bus:'NVMe',bytes:2*GiB}],
    volumes:[{mount:'C:\\PRIVATE-LABEL',diskId:'disk-private',filesystem:'NTFS',bytes:2*GiB,freeBytes:GiB}],
    links:[{id:'PCI-LINK-PRIVATE',name:'Thunderbolt Controller',status:'OK',currentLinkSpeed:'16 GT/s',currentLinkWidth:'4'}],
    network:[{name:'PRIVATE WI-FI ADAPTER 00:11:22:33:44:55',linkRate:'1 Gbps',status:'Up',measuredThroughput:null}]},
  gpu:{devices:[{index:0,uuid:'GPU-PRIVATE-UUID',name:'RTX TEST',driver:'580.1',totalBytes:8*GiB,freeBytes:6*GiB,capacity:'DRIVER_REPORTED',externalGate:false}]},
  installed:{python:'C:\\Users\\Alice\\python.exe',llamaServer:'C:\\PRIVATE\\llama-server.exe'},
  notMeasured:['model performance'],privacy:'PRIVATE RAW SCAN NOTICE'
};
function fakeUI(answer=false){const log=[];return {log,say:value=>log.push(value),write:value=>log.push(value),confirm:async()=>answer};}

test('support receipt rejects a non-scan object',()=>assert.throws(()=>redactScan({}),error=>error.code==='SCAN_FORMAT'));
test('support receipt retains useful classes and removes stable local identifiers',()=>{
  const receipt=redactScan(machine),encoded=JSON.stringify(receipt);
  assert.equal(receipt.schema,'aperture-support/1');
  assert.equal(receipt.scan.durationMs,2500);
  assert.equal(receipt.cpu.logicalCpus,20);
  assert.equal(receipt.memory.commitHeadroomBytes,null);
  assert.equal(receipt.graphics[0].name,'Intel Arc Graphics');
  assert.equal(receipt.neural.devices[0].name,'Intel AI Boost');
  assert.equal(receipt.nvidia[0].name,'RTX TEST');
  assert.equal(receipt.storage.logicalDevices[0].bus,'NVMe');
  assert.equal(receipt.scan.errorClasses[0],'Core Windows inventory unavailable');
  for(const secret of ['PRIVATE-HOST','Alice','GPU-PRIVATE-UUID','PCI\\VEN_PRIVATE','PCI\\NPU_PRIVATE','disk-private','SERIAL-PRIVATE','PRIVATE DRIVE NAME','PRIVATE PHYSICAL DRIVE','PRIVATE-LABEL','PRIVATE WI-FI ADAPTER','python.exe','llama-server.exe','PRIVATE RAW SCAN NOTICE','PRIVATE DIMM SLOT'])assert.equal(encoded.includes(secret),false,secret);
});
test('support receipt denial stops before hardware scan',async()=>{
  let scans=0;const result=await supportReceipt(fakeUI(false),{}, {scan:async()=>{scans++;return machine;}});
  assert.equal(result.status,'SCAN_DECLINED');assert.equal(scans,0);
});
test('approved support receipt writes a new redacted file and refuses overwrite',async()=>{
  const out=path.join(tmp,'support.json'),ui=fakeUI();
  const result=await supportReceipt(ui,{scanApproved:true,out},{scan:async()=>machine});
  const saved=JSON.parse(await fs.readFile(out,'utf8'));
  assert.equal(saved.schema,'aperture-support/1');assert.equal(result.schema,saved.schema);
  assert.equal(JSON.stringify(saved).includes('GPU-PRIVATE-UUID'),false);
  await assert.rejects(supportReceipt(ui,{scanApproved:true,out},{scan:async()=>machine}),error=>error.code==='EEXIST');
});
test('approved stdout receipt is emitted without writing a file',async()=>{
  const ui=fakeUI(),result=await supportReceipt(ui,{scanApproved:true},{scan:async()=>machine});
  assert.equal(result.schema,'aperture-support/1');assert.match(ui.log[0],/^\{/);assert.match(ui.log[0],/REDACTED_SUPPORT_RECEIPT_REVIEW_REQUIRED/);
});
