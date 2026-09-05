import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {command, clean, gib} from './common.mjs';

const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const nonnegative = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function graphicsDomain(name, platform, architecture) {
  if (platform === 'darwin' && architecture === 'arm64') return 'system';
  if (/Intel.*(?:UHD|Iris|HD Graphics|Arc\(TM\) Graphics)/i.test(name)) return 'system';
  return 'unknown';
}
export function isNeuralDevice(device) {
  return device.PNPClass === 'ComputeAccelerator' || /\bNPU\b|Neural Processing|AI Boost|Ryzen AI|Hexagon/i.test(device.Name || '');
}
const WINDOWS_CORE_QUERY = String.raw`
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$r=[ordered]@{}; $errors=@()
try {$r.cpu=@(Get-CimInstance Win32_Processor -Property Name,NumberOfCores,NumberOfLogicalProcessors | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors)} catch {$errors+='CPU enumeration unavailable'}
try {$r.ram=@(Get-CimInstance Win32_PhysicalMemory -Property Capacity,ConfiguredClockSpeed,DeviceLocator | Select-Object Capacity,ConfiguredClockSpeed,DeviceLocator)} catch {$errors+='DIMM enumeration unavailable'}
try {$r.memory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -Property AvailableBytes,CommittedBytes,CommitLimit | Select-Object AvailableBytes,CommittedBytes,CommitLimit} catch {$errors+='Memory/commit observation unavailable'}
try {$r.display=@(Get-CimInstance Win32_VideoController -Property Name,DriverVersion,PNPDeviceID,Status | Select-Object Name,DriverVersion,PNPDeviceID,Status)} catch {$errors+='Display enumeration unavailable'}
try {
  $pnp=@(Get-CimInstance Win32_PnPEntity -Property Name,PNPClass,Status,PNPDeviceID)
  $r.npu=@($pnp | Where-Object {$_.PNPClass -eq 'ComputeAccelerator' -or $_.Name -match '\bNPU\b|Neural Processing|AI Boost|Ryzen AI|Hexagon'} | Select-Object Name,PNPClass,Status,PNPDeviceID)
  $r.links=@($pnp | Where-Object {$_.Name -match 'Thunderbolt|USB4 Host|USB4 Router'} | Select-Object Name,PNPClass,Status)
} catch {$errors+='NPU enumeration unavailable'; $errors+='External link enumeration unavailable'}
$r.errors=$errors; $r | ConvertTo-Json -Depth 7 -Compress
`;
const WINDOWS_EXTENDED_QUERY = String.raw`
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$r=[ordered]@{}; $errors=@()
try {$r.disks=@(Get-Disk | Select-Object Number,FriendlyName,BusType,Size,IsBoot,IsSystem)} catch {$errors+='Disk enumeration unavailable'}
try {$r.physical=@(Get-PhysicalDisk | Select-Object DeviceId,FriendlyName,MediaType,BusType,Size)} catch {$errors+='Physical disk enumeration unavailable'}
try {$r.volumes=@(Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,FileSystemType,Size,SizeRemaining)} catch {$errors+='Volume enumeration unavailable'}
try {$r.partitions=@(Get-Partition | Where-Object DriveLetter | Select-Object DiskNumber,PartitionNumber,DriveLetter,Size)} catch {$errors+='Partition mapping unavailable'}
try {$r.network=@(Get-NetAdapter -Physical | Select-Object InterfaceDescription,LinkSpeed,Status)} catch {$errors+='Network adapter enumeration unavailable'}
$r.errors=$errors; $r | ConvertTo-Json -Depth 7 -Compress
`;
export function normalizeWindows(data) {
  return {
    status: list(data.errors).length ? 'PARTIAL' : 'OBSERVED', errors:list(data.errors),
    cpu:list(data.cpu).map(c=>({name:clean(c.Name),cores:nonnegative(c.NumberOfCores),threads:nonnegative(c.NumberOfLogicalProcessors)})),
    memory:{availableBytes:nonnegative(data.memory?.AvailableBytes),commitLimitBytes:nonnegative(data.memory?.CommitLimit),committedBytes:nonnegative(data.memory?.CommittedBytes)},
    modules:list(data.ram).map(m=>({bytes:nonnegative(m.Capacity),configuredRate:nonnegative(m.ConfiguredClockSpeed),location:clean(m.DeviceLocator),rateBasis:'SMBIOS configured rate; not measured bandwidth'})),
    graphics:list(data.display).map(g=>({id:g.PNPDeviceID,name:clean(g.Name),driver:g.DriverVersion,status:g.Status,memoryDomain:graphicsDomain(g.Name,'win32',process.arch),capacityBytes:null})),
    neural:list(data.npu).filter(isNeuralDevice).map(n=>({id:n.PNPDeviceID,name:clean(n.Name),status:n.Status,runtime:'REQUIRES_MODEL_SPECIFIC_ADAPTER',memoryDomain:'unknown'})),
    neuralStatus: list(data.errors).includes('NPU enumeration unavailable') ? 'UNAVAILABLE' : 'ENUMERATED',
    disks:list(data.disks).map(d=>({id:String(d.Number),name:clean(d.FriendlyName),bus:d.BusType,bytes:nonnegative(d.Size),boot:!!d.IsBoot})),
    physicalDisks:list(data.physical).map(d=>({id:String(d.DeviceId),name:clean(d.FriendlyName),media:d.MediaType,bus:d.BusType,bytes:nonnegative(d.Size)})),
    volumes:list(data.volumes).map(v=>({mount:v.DriveLetter+':\\',filesystem:v.FileSystemType,bytes:nonnegative(v.Size),freeBytes:nonnegative(v.SizeRemaining),diskId:String(list(data.partitions).find(p=>p.DriveLetter===v.DriveLetter)?.DiskNumber??'unknown')})),
    links:list(data.links).map(l=>({name:clean(l.Name),status:l.Status,negotiatedBandwidth:null})),
    network:list(data.network).map(n=>({name:clean(n.InterfaceDescription),linkRate:n.LinkSpeed,status:n.Status,measuredThroughput:null}))
  };
}
async function text(file) { return (await fs.readFile(file,'utf8')).trim(); }
async function optionalText(file) { try {return await text(file);} catch {return null;} }
async function jsonCommand(exe,args,timeout=20000) {
  const r=await command(exe,args,{timeout});
  if (r.code!==0 || r.timedOut) throw Error(exe+' inventory did not complete');
  return JSON.parse(r.stdout.replace(/^\uFEFF/,''));
}
export function mergeWindowsInventory(core={},extended={},failures=[]) {
  return normalizeWindows({...core,...extended,errors:[...list(core.errors),...list(extended.errors),...failures]});
}
export async function windowsInventory({run=jsonCommand}={}) {
  const [core,extended]=await Promise.allSettled([
    run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',WINDOWS_CORE_QUERY],20000),
    run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',WINDOWS_EXTENDED_QUERY],15000)
  ]);
  const failures=[];
  if(core.status==='rejected')failures.push('Core Windows inventory unavailable: '+clean(core.reason?.message??core.reason));
  if(extended.status==='rejected')failures.push('Extended Windows inventory unavailable: '+clean(extended.reason?.message??extended.reason));
  const result=mergeWindowsInventory(core.status==='fulfilled'?core.value:{},extended.status==='fulfilled'?extended.value:{},failures);
  if(core.status==='rejected'&&extended.status==='rejected')result.status='UNAVAILABLE';
  return result;
}
export async function storageAt(location) {
  const requested=path.resolve(location); let probe=requested;
  while (true) {
    try {
      const stat=await fs.stat(probe);
      if (!stat.isDirectory()) probe=path.dirname(probe);
      const s=await fs.statfs(probe);
      return {path:requested,observedPath:probe,freeBytes:Number(s.bavail)*Number(s.bsize),totalBytes:Number(s.blocks)*Number(s.bsize),status:'OBSERVED',bandwidth:null};
    } catch (e) {
      const parent=path.dirname(probe);
      if (parent===probe) return {path:requested,observedPath:null,freeBytes:null,totalBytes:null,status:'UNAVAILABLE',bandwidth:null};
      probe=parent;
    }
  }
}
export function matchingVolume(location,volumes,platform=process.platform) {
  const norm=s=>platform==='win32'?s.replace(/\//g,'\\').toLowerCase():s;
  const target=norm(location);
  return volumes.filter(v=>{const base=norm(v.mount).replace(/[\\/]+$/,'');return target===base || target.startsWith(base+(platform==='win32'?'\\':'/'));}).sort((a,b)=>b.mount.length-a.mount.length)[0]??null;
}
export function flattenBlockDevices(devices) {
  const result=[];
  function walk(d,parent=null) {
    if (d.type==='loop'||d.type==='rom') return;
    result.push({id:d.name,parentId:parent,type:d.type,name:clean(d.model||d.name),bytes:nonnegative(d.size),bus:d.tran||null,rotationalReported:d.rota??null,mounts:list(d.mountpoints).filter(Boolean)});
    for(const child of list(d.children)) walk(child,d.name);
  }
  for(const device of list(devices)) walk(device);
  return result;
}
async function linuxInventory() {
  const errors=[], graphics=[], neural=[], links=[];
  const pciRoot='/sys/bus/pci/devices';
  let entries=[];try{entries=(await fs.readdir(pciRoot)).slice(0,512);}catch{errors.push('PCI enumeration unavailable');}
  let labels='';try{labels=(await command('lspci',['-Dnn'],{timeout:6000})).stdout;}catch{}
  for(const id of entries) {
    const p=path.join(pciRoot,id),cls=await optionalText(path.join(p,'class'));
    if(!cls)continue;
    const line=labels.split('\n').find(l=>l.startsWith(id+' '))||id;
    const isGraphics=/^0x03/.test(cls),isAccelerator=/^0x12/.test(cls);
    if(!isGraphics&&!isAccelerator&&!/Thunderbolt|USB4/i.test(line))continue;
    const name=clean(line.replace(/^\S+\s+[^:]+:\s*/,''));
    let driver=null;try{driver=path.basename(await fs.readlink(path.join(p,'driver')));}catch{}
    const vendor=await optionalText(path.join(p,'vendor'));
    const item={id,name,driver,vendor,deviceId:await optionalText(path.join(p,'device')),status:driver?'DRIVER_BOUND':'NO_BOUND_DRIVER_OBSERVED',memoryDomain:isGraphics?graphicsDomain(name,'linux',process.arch):'unknown',capacityBytes:null};
    if(isGraphics)graphics.push(item);
    if(isAccelerator)neural.push({...item,runtime:'REQUIRES_MODEL_SPECIFIC_ADAPTER'});
    links.push({id,name,currentLinkSpeed:await optionalText(path.join(p,'current_link_speed')),currentLinkWidth:await optionalText(path.join(p,'current_link_width')),maxLinkSpeed:await optionalText(path.join(p,'max_link_speed')),maxLinkWidth:await optionalText(path.join(p,'max_link_width')),measuredThroughput:null});
  }
  let blocks=[];try{blocks=flattenBlockDevices((await jsonCommand('lsblk',['--json','--bytes','--output','NAME,TYPE,SIZE,ROTA,TRAN,MODEL,MOUNTPOINTS'])).blockdevices);}catch{errors.push('Block device enumeration unavailable');}
  const mounts=[...new Set(['/',...blocks.flatMap(b=>b.mounts)])].slice(0,64),volumes=[];
  for(const mount of mounts){const s=await storageAt(mount);volumes.push({mount,bytes:s.totalBytes,freeBytes:s.freeBytes,diskId:blocks.find(b=>b.mounts.includes(mount))?.id??null});}
  const memoryText=await optionalText('/proc/meminfo')||'';
  const mem=k=>{const match=memoryText.match(new RegExp('^'+k+':\\s+(\\d+)','m'));return match?Number(match[1])*1024:null;};
  const cpuText=await optionalText('/proc/cpuinfo')||'';
  return {status:errors.length?'PARTIAL':'OBSERVED',errors,cpu:[],modules:[],
    memory:{availableBytes:mem('MemAvailable'),swapTotalBytes:mem('SwapTotal'),swapFreeBytes:mem('SwapFree'),commitLimitBytes:mem('CommitLimit'),committedBytes:mem('Committed_AS'),commitBasis:'Linux overcommit accounting; not Windows commit headroom'},
    cpuFeatures:(cpuText.match(/^(?:flags|Features)\s*:\s*(.*)$/m)?.[1]||'').split(/\s+/).filter(Boolean),
    graphics,neural,neuralStatus:errors.includes('PCI enumeration unavailable')?'UNAVAILABLE':'PCI_ENUMERATED_NON_PCI_UNKNOWN',
    disks:blocks.filter(b=>b.type==='disk'),physicalDisks:[],volumes,links,network:[]};
}
export async function cgroupMemory() {
  // Current cgroup and its ancestors can each impose a tighter allocation ceiling.
  const membership=await optionalText('/proc/self/cgroup');
  const relative=membership?.split('\n').find(s=>s.startsWith('0::'))?.slice(3);
  if(!relative || relative.split('/').includes('..'))return null;
  const root='/sys/fs/cgroup',leaf=path.resolve(root,'.'+relative);
  if(leaf!==root&&!leaf.startsWith(root+'/'))return null;
  const observations=[];let p=leaf;
  for(let i=0;i<64;i++) {
    const limit=await optionalText(path.join(p,'memory.max')),used=await optionalText(path.join(p,'memory.current'));
    if(/^\d+$/.test(limit||'')&&/^\d+$/.test(used||''))observations.push({capacity:Number(limit),remaining:Math.max(0,Number(limit)-Number(used))});
    if(p===root)break;p=path.dirname(p);
  }
  return observations.length?{totalBytes:Math.min(...observations.map(o=>o.capacity)),availableBytes:Math.min(...observations.map(o=>o.remaining)),basis:'Current cgroup-v2 and ancestor limits'}:null;
}
async function macInventory() {
  const data=await jsonCommand('system_profiler',['SPHardwareDataType','SPDisplaysDataType','SPNVMeDataType','SPStorageDataType','SPThunderboltDataType','-json'],25000);
  const graphics=list(data.SPDisplaysDataType).map(g=>({id:g._name,name:clean(g.sppci_model||g._name),memoryDomain:graphicsDomain(g.sppci_model||g._name,'darwin',process.arch),capacityBytes:null,status:'OS_ENUMERATED'}));
  const volumes=list(data.SPStorageDataType).map(v=>({mount:v.mount_point||null,bytes:nonnegative(v.size_in_bytes),freeBytes:nonnegative(v.free_space_in_bytes),filesystem:v.file_system,diskId:v.bsd_name})).filter(v=>v.mount);
  const disks=list(data.SPNVMeDataType).flatMap(c=>list(c._items).map(d=>({id:d.bsd_name||d._name,name:clean(d._name),bus:'NVMe',bytes:nonnegative(d.size_in_bytes),linkSpeed:d.link_speed,linkWidth:d.link_width})));
  return {status:'OBSERVED',errors:[],cpu:[],modules:[],memory:{},graphics,neural:[],neuralStatus:process.arch==='arm64'?'APPLE_NEURAL_ENGINE_NOT_INDEPENDENTLY_ENUMERATED':'UNAVAILABLE',disks,physicalDisks:[],volumes,links:list(data.SPThunderboltDataType).map(l=>({name:clean(l._name),linkRate:l.link_speed||null,measuredThroughput:null})),network:[]};
}
export async function platformInventory() {
  try {
    if(process.platform==='win32')return await windowsInventory();
    if(process.platform==='linux')return await linuxInventory();
    if(process.platform==='darwin')return await macInventory();
    throw Error('No platform inventory adapter for '+process.platform);
  } catch(e) {return {status:'UNAVAILABLE',errors:[clean(e.message)],cpu:[],modules:[],memory:{},graphics:[],neural:[],neuralStatus:'UNAVAILABLE',disks:[],physicalDisks:[],volumes:[],links:[],network:[]};}
}
export function describeHardware(machine) {
  const h=machine.hardware,lines=[`${machine.cpu}; ${machine.logicalCpus} available logical CPUs`,
    `RAM: ${gib(machine.memory.availableBytes)} available / ${gib(machine.memory.totalBytes)} OS-visible physical. Shared graphics does not add another RAM bank.`];
  if(machine.memory.commitHeadroomBytes!=null)lines.push(`Windows commit headroom: ${gib(machine.memory.commitHeadroomBytes)} (not additional RAM).`);
  if(h){
    for(const g of h.graphics)lines.push(`Graphics: ${g.name}${g.memoryDomain==='system'?' [shares system RAM]':''}`);
    for(const n of h.neural)lines.push(`Neural accelerator: ${n.name} [detected; needs a model-specific NPU adapter]`);
    if(!h.neural.length)lines.push(`Neural accelerator inventory: ${h.neuralStatus}; no executable NPU route inferred.`);
    for(const v of h.volumes)lines.push(`Volume ${v.mount}: ${gib(v.freeBytes)} free / ${gib(v.bytes)}; disk ${v.diskId??'unresolved'}`);
    for(const d of h.disks)lines.push(`Storage: ${d.name}; ${d.bus||'bus unreported'}; ${gib(d.bytes)}`);
    for(const d of h.physicalDisks||[])lines.push(`Physical media: ${d.name}; ${d.media||'type unreported'}; ${d.bus||'bus unreported'}; ${gib(d.bytes)}`);
    for(const l of h.links)lines.push(`Link: ${l.name}${l.currentLinkSpeed?' / '+l.currentLinkSpeed+' x'+l.currentLinkWidth:''}; throughput unmeasured`);
    for(const e of h.errors)lines.push(`Inventory limitation: ${e}`);
  }
  for(const g of machine.gpu.devices)lines.push(`CUDA device ${g.index}: ${g.name}; ${gib(g.freeBytes)} free / ${gib(g.totalBytes)} dedicated VRAM`);
  lines.push(`Managed-file destination: ${machine.storage.path}; ${gib(machine.storage.freeBytes)} free.`);
  return lines.join('\n');
}
