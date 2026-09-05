import {scan} from './scan.mjs';
import {ApertureError, clean, localPath, now, writeNew} from './common.mjs';
import {VERSION} from './version.mjs';

const list=value=>value==null?[]:Array.isArray(value)?value:[value];
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
const text=value=>value==null?null:clean(value);
export function hardwareName(value){
  const candidate=text(value);
  if(!candidate)return null;
  if(/^(?:[0-9a-f]{4}:)?[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/i.test(candidate))return null;
  if(/^(?:PCI|USB|ACPI|HID|ROOT)\\/i.test(candidate))return null;
  if(/(?:^|[^0-9a-f])(?:[0-9a-f]{2}:){5}[0-9a-f]{2}(?:$|[^0-9a-f])/i.test(candidate))return null;
  if(/^[a-z]:[\\/]|^\//i.test(candidate))return null;
  return candidate;
}
const ERROR_CLASSES=[
  'CPU enumeration unavailable',
  'DIMM enumeration unavailable',
  'Memory/commit observation unavailable',
  'Display enumeration unavailable',
  'NPU enumeration unavailable',
  'External link enumeration unavailable',
  'Disk enumeration unavailable',
  'Physical disk enumeration unavailable',
  'Volume enumeration unavailable',
  'Partition mapping unavailable',
  'Network adapter enumeration unavailable',
  'Core Windows inventory unavailable',
  'Extended Windows inventory unavailable',
  'PCI enumeration unavailable',
  'Block device enumeration unavailable'
];
function errorClass(value){
  const valueText=text(value)||'';
  return ERROR_CLASSES.find(item=>valueText.startsWith(item))||'Unclassified inventory provider error';
}
function durationMs(machine){
  const start=Date.parse(machine.startedAt),end=Date.parse(machine.observedAt);
  return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?end-start:null;
}
export function redactScan(machine){
  if(!machine||machine.schema!=='aperture-scan/1')throw new ApertureError('SCAN_FORMAT','A support receipt requires an Aperture scan.');
  const hardware=machine.hardware||{};
  const errors=[...new Set(list(hardware.errors).map(errorClass))];
  return {
    schema:'aperture-support/1',createdAt:now(),apertureVersion:VERSION,
    runtime:{nodeVersion:process.version,platform:text(machine.platform),architecture:text(machine.architecture)},
    scan:{durationMs:durationMs(machine),inventoryStatus:text(hardware.status)||'UNKNOWN',errorClasses:errors},
    cpu:{model:hardwareName(machine.cpu),logicalCpus:finite(machine.logicalCpus),topology:list(hardware.cpu).map(item=>({model:hardwareName(item.name),cores:finite(item.cores),threads:finite(item.threads)}))},
    memory:{
      totalBytes:finite(machine.memory?.totalBytes),availableBytes:finite(machine.memory?.availableBytes),allocationHeadroomBytes:finite(machine.memory?.allocationHeadroomBytes),
      commitHeadroomBytes:finite(machine.memory?.commitHeadroomBytes),installedBytes:finite(machine.memory?.installedBytes),swapTotalBytes:finite(machine.memory?.swapTotalBytes),
      swapFreeBytes:finite(machine.memory?.swapFreeBytes),basis:text(machine.memory?.basis),
      modules:list(hardware.modules).map(item=>({bytes:finite(item.bytes),configuredRate:finite(item.configuredRate),rateBasis:text(item.rateBasis)}))
    },
    graphics:list(hardware.graphics).map(item=>({name:hardwareName(item.name),driver:text(item.driver),status:text(item.status),memoryDomain:text(item.memoryDomain),capacityBytes:finite(item.capacityBytes)})),
    neural:{status:text(hardware.neuralStatus),devices:list(hardware.neural).map(item=>({name:hardwareName(item.name),status:text(item.status),runtime:text(item.runtime),memoryDomain:text(item.memoryDomain)}))},
    nvidia:list(machine.gpu?.devices).map(item=>({index:finite(item.index),name:hardwareName(item.name),driver:text(item.driver),totalBytes:finite(item.totalBytes),freeBytes:finite(item.freeBytes),capacity:text(item.capacity),externalGate:!!item.externalGate})),
    storage:{
      selectedDestination:{status:text(machine.storage?.status),totalBytes:finite(machine.storage?.totalBytes),freeBytes:finite(machine.storage?.freeBytes)},
      logicalDevices:list(hardware.disks).map(item=>({type:text(item.type),bus:text(item.bus),bytes:finite(item.bytes),boot:item.boot===undefined?null:!!item.boot,rotationalReported:item.rotationalReported??null})),
      physicalDevices:list(hardware.physicalDisks).map(item=>({media:text(item.media),bus:text(item.bus),bytes:finite(item.bytes)})),
      volumes:list(hardware.volumes).map(item=>({filesystem:text(item.filesystem),bytes:finite(item.bytes),freeBytes:finite(item.freeBytes)}))
    },
    links:list(hardware.links).map(item=>({name:hardwareName(item.name),status:text(item.status),currentLinkSpeed:text(item.currentLinkSpeed),currentLinkWidth:text(item.currentLinkWidth),maxLinkSpeed:text(item.maxLinkSpeed),maxLinkWidth:text(item.maxLinkWidth),linkRate:text(item.linkRate),measuredThroughput:finite(item.measuredThroughput)})),
    network:list(hardware.network).map(item=>({linkRate:text(item.linkRate),status:text(item.status),measuredThroughput:finite(item.measuredThroughput)})),
    installed:{python:!!machine.installed?.python,llamaServer:!!machine.installed?.llamaServer},
    unmeasured:list(machine.notMeasured).map(text),
    sharing:{
      classification:'REDACTED_SUPPORT_RECEIPT_REVIEW_REQUIRED',
      omitted:['host and user names','local paths and mount labels','device and partition identifiers','GPU UUIDs','drive product names and serials','network adapter names and addresses','model locations','prompts and generated text','credentials and environment variables'],
      caution:'Hardware model names, driver versions, exact capacities, and the receipt timestamp can still fingerprint a machine. Inspect the JSON before sharing.'
    }
  };
}
export async function supportReceipt(ui,options={},deps={}){
  if(!options.scanApproved){
    ui.say('Aperture can create a reduced hardware receipt for support. The scan remains local and excludes model access, network requests, stress tests, and automatic uploads.');
    if(!await ui.confirm('Read the local hardware inventory for this receipt?'))return {status:'SCAN_DECLINED'};
  }
  const receipt=redactScan(await (deps.scan||scan)());
  if(options.out){
    const target=localPath(options.out);await writeNew(target,receipt);
    ui.say(`Redacted support receipt saved to ${target}. Review it before sharing.`);
  }else (ui.write||ui.say)(JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}
