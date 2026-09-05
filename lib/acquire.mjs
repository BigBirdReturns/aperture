import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {request} from './models.mjs';
import {ApertureError,GiB,fileName,writeNew,jsonFile,exists,hashFile} from './common.mjs';

export function acquisitionKey(model){
  return createHash('sha256').update(JSON.stringify({source:model.source,files:model.files.map(({name,bytes,sha256,url})=>({name,bytes,sha256,url}))})).digest('hex').slice(0,24);
}
export async function reuseCachedAcquisition(model,destination){
  if(model.local)return model;
  if(model.kind!=='gguf'||!Array.isArray(model.files)||!model.files.length)return null;
  if(!await exists(destination))return null;
  const key=acquisitionKey(model),marker=path.join(destination,'.aperture-download.json');
  const folder=await fs.lstat(destination);
  if(!folder.isDirectory()||folder.isSymbolicLink()||!await exists(marker))throw new ApertureError('CACHE_PATH','The managed cache path is not an Aperture transfer. Nothing was changed.');
  const markerStat=await fs.lstat(marker);
  if(!markerStat.isFile()||markerStat.isSymbolicLink()||markerStat.size>1024)throw new ApertureError('CACHE_PATH','The managed cache marker changed. Nothing was loaded.');
  if((await jsonFile(marker,1024)).key!==key)throw new ApertureError('DOWNLOAD_IDENTITY','The saved transfer belongs to a different artifact.');
  const records=[];
  for(const item of model.files){
    const name=fileName(item.name),target=path.join(destination,name),receiptPath=target+'.sha256';
    if(!await exists(target))return null;
    const stat=await fs.lstat(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.bytes)throw new ApertureError('CACHE_CHANGED','A cached model component changed. It was not overwritten.');
    let receipt=null;
    if(await exists(receiptPath)){
      const receiptStat=await fs.lstat(receiptPath);
      if(!receiptStat.isFile()||receiptStat.isSymbolicLink()||receiptStat.size>128)throw new ApertureError('CACHE_CHANGED','A cached model checksum record changed.');
      receipt=(await fs.readFile(receiptPath,'utf8')).trim().toLowerCase();
    }
    const provider=typeof item.sha256==='string'?item.sha256.toLowerCase():null,expected=provider||receipt;
    if(!expected||!/^[0-9a-f]{64}$/.test(expected)||(provider&&receipt&&provider!==receipt))
      throw new ApertureError('CACHE_CHANGED','A cached model checksum record does not match the selected artifact.');
    records.push({name,path:target,bytes:stat.size,sha256:expected,upstreamSha256Expected:!!provider});
  }
  return {...model,local:true,source:{kind:'local',path:model.kind==='gguf'?records[0].path:destination},acquiredFrom:model.source,files:records,
    contentVerification:'CACHE_PATH_AND_EXPECTED_HASH_BOUND_FULL_HASH_PENDING'};
}
export async function acquire(model,destination,{approved=false,fetcher=fetch,onProgress=()=>{}}={}){
  if(!approved)throw new ApertureError('DOWNLOAD_NOT_APPROVED','Model downloads require separate permission.');
  if(model.local)return model;
  const total=model.files.reduce((n,f)=>n+f.bytes,0),key=acquisitionKey(model);
  if(!Number.isSafeInteger(total)||total<=0)throw new ApertureError('DOWNLOAD_SIZE','No bounded download size is available.');
  const parent=path.dirname(path.resolve(destination));
  const marker=path.join(destination,'.aperture-download.json');
  if(await exists(destination)){
    if(!(await fs.lstat(destination)).isDirectory()||!await exists(marker))throw Object.assign(new Error('The destination exists but is not an Aperture download. Nothing was overwritten.'),{code:'EEXIST'});
    if((await jsonFile(marker)).key!==key)throw new ApertureError('DOWNLOAD_IDENTITY','The saved transfer belongs to a different artifact.');
  }else{
    const stat=await fs.statfs(parent);
    if(stat.bavail*stat.bsize<total+GiB)throw new ApertureError('DOWNLOAD_SPACE','The destination lacks checkpoint space plus a 1 GiB reserve.');
    await fs.mkdir(destination,{mode:0o700});await writeNew(marker,{schema:'aperture-download/1',key});
  }
  let completed=0;const records=[];
  for(const item of model.files){
    const name=fileName(item.name),target=path.join(destination,name),partial=target+'.part',metaPath=partial+'.json';
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    if(await exists(target)){
      const st=await fs.lstat(target);
      if(!st.isFile()||st.size!==item.bytes)throw new ApertureError('CACHE_CHANGED','A cached model component changed. It was not overwritten.');
      const sha256=await hashFile(target);
      const receiptPath=target+'.sha256';
      const expected=item.sha256||(await exists(receiptPath)?(await fs.readFile(receiptPath,'utf8')).trim():null);
      if(!expected||sha256!==expected)throw new ApertureError('CACHE_CHANGED','A cached model component failed its content check.');
      completed+=st.size;records.push({name,path:target,bytes:st.size,sha256,upstreamSha256Verified:!!item.sha256});onProgress(completed,total);continue;
    }
    let offset=0,prior={};
    if(await exists(partial)){
      const st=await fs.lstat(partial);if(!st.isFile())throw new ApertureError('CACHE_PATH','Partial model must be a regular file.');
      if(await exists(metaPath))prior=await jsonFile(metaPath);
      if(st.size<=item.bytes&&(item.sha256||prior.etag&&!prior.etag.startsWith('W/')))offset=st.size;
    }
    const free=await fs.statfs(parent);
    if(free.bavail*free.bsize<item.bytes-offset+GiB)throw new ApertureError('DOWNLOAD_SPACE','Free space is insufficient to finish this component.');
    // A complete partial file is rechecked before being promoted, never re-downloaded blindly.
    if(offset!==item.bytes){
      const headers=offset?{Range:`bytes=${offset}-`,...(prior.etag?{'If-Range':prior.etag}:{})}:{};
      const response=await request(item.url,{fetcher,headers,timeout:3600000});
      if(offset&&response.status===206){
        const match=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if(!match||Number(match[1])!==offset||Number(match[3])!==item.bytes){await response.body?.cancel();throw new ApertureError('DOWNLOAD_RANGE','The resumed byte range does not match the approved file.');}
      }else if(offset&&response.status===200)offset=0;
      else if(response.status!==200){await response.body?.cancel();throw new ApertureError('DOWNLOAD_RANGE','Unexpected model-transfer response.');}
      const stated=response.headers.get('content-length');
      if(stated!=null&&Number(stated)!==item.bytes-offset){await response.body?.cancel();throw new ApertureError('DOWNLOAD_CHANGED','The source size changed after approval.');}
      const etag=response.headers.get('etag');
      await fs.writeFile(metaPath,JSON.stringify({etag}),{mode:0o600});
      const file=await fs.open(partial,await exists(partial)?'r+':'wx',0o600);
      let bytes=offset;
      try{
        await file.truncate(offset);
        if(!response.body)throw new ApertureError('EMPTY_RESPONSE','The model source returned no data.');
        for await(const chunk of response.body){
          if(bytes+chunk.length>item.bytes)throw new ApertureError('DOWNLOAD_BUDGET','The response exceeded its approved size.');
          let pos=0;
          while(pos<chunk.length){const{bytesWritten}=await file.write(chunk,pos,chunk.length-pos,bytes+pos);if(!bytesWritten)throw new Error('Short write');pos+=bytesWritten;}
          bytes+=chunk.length;onProgress(completed+bytes,total);
        }
      }finally{await file.close();}
      if(bytes!==item.bytes)throw new ApertureError('DOWNLOAD_TRUNCATED','Transfer interrupted. Run the same selection again to resume.');
    }
    const sha256=await hashFile(partial);
    if(item.sha256&&sha256!==item.sha256){
      await fs.rename(partial,partial+'.invalid-'+Date.now());
      throw new ApertureError('DOWNLOAD_HASH','Bytes disagree with the provider SHA-256; the invalid partial was quarantined.');
    }
    await fs.rename(partial,target);await fs.writeFile(target+'.sha256',sha256+'\n',{mode:0o600});
    await fs.unlink(metaPath).catch(()=>{});completed+=item.bytes;
    records.push({name,path:target,bytes:item.bytes,sha256,upstreamSha256Verified:!!item.sha256});
  }
  const receipt=path.join(destination,'aperture-acquisition.json');
  if(!await exists(receipt))await writeNew(receipt,{source:model.source,files:records,bytes:completed});
  return {...model,local:true,source:{kind:'local',path:model.kind==='gguf'?records[0].path:destination},acquiredFrom:model.source,files:records,contentVerification:'SHA256_COMPUTED_PROVIDER_HASH_CHECKED_WHEN_AVAILABLE'};
}
