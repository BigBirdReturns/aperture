import fs from 'node:fs/promises';
import path from 'node:path';
import {ApertureError, HEADER_LIMIT, fileName, localPath, headerFile, jsonFile, exists, clean} from './common.mjs';

// These inspections read metadata only. They are not full-content verification.
export function parseGguf(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 0, 4) !== 'GGUF') throw new ApertureError('NOT_GGUF', 'The selected artifact does not have a GGUF header.');
  const version = buffer.readUInt32LE(4);
  if (![2, 3].includes(version)) throw new ApertureError('GGUF_VERSION', 'This inspector supports little-endian GGUF versions 2 and 3.');
  let offset = 8, operations = 0;
  const need = n => { if (!Number.isSafeInteger(n) || n < 0 || offset + n > buffer.length) throw new ApertureError('HEADER_LIMIT', 'GGUF metadata exceeds the bounded header read or is truncated.'); };
  const u64 = () => { need(8); const n = buffer.readBigUInt64LE(offset); offset += 8; if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApertureError('HEADER_VALUE', 'GGUF metadata integer is too large.'); return Number(n); };
  const u32 = () => { need(4); const n = buffer.readUInt32LE(offset); offset += 4; return n; };
  const string = (keep = true) => { const n = u64(); need(n); const s = keep ? buffer.toString('utf8', offset, offset + n) : undefined; offset += n; return s; };
  const tensors = u64(), count = u64(), metadata = Object.create(null);
  if (count > 100000 || tensors > 10000000) throw new ApertureError('HEADER_VALUE', 'GGUF header declares an unreasonable metadata count.');
  function value(type, keep, depth = 0) {
    if (++operations > 1000000 || depth > 2) throw new ApertureError('HEADER_VALUE', 'GGUF metadata exceeds the parser work limit.');
    if (type === 8) return string(keep);
    if (type === 9) {
      const itemType = u32(), n = u64();
      if (n > 1000000) throw new ApertureError('HEADER_VALUE', 'GGUF array exceeds the parser work limit.');
      const widths = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8};
      if (widths[itemType]) { const bytes = widths[itemType] * n; need(bytes); offset += bytes; return undefined; }
      for (let i = 0; i < n; i++) value(itemType, false, depth + 1);
      return undefined;
    }
    const readers = {0:['readUInt8',1],1:['readInt8',1],2:['readUInt16LE',2],3:['readInt16LE',2],4:['readUInt32LE',4],5:['readInt32LE',4],6:['readFloatLE',4],7:['readUInt8',1],10:['readBigUInt64LE',8],11:['readBigInt64LE',8],12:['readDoubleLE',8]};
    if (!readers[type]) throw new ApertureError('HEADER_VALUE', 'Unrecognized GGUF metadata type.');
    const [method, bytes] = readers[type]; need(bytes); let n = buffer[method](offset); offset += bytes;
    if (typeof n === 'bigint') n = n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(n) : null;
    return n;
  }
  let complete = true;
  try {
    for (let i = 0; i < count; i++) {
      const key = string(), keep = /^(general\.(architecture|name|file_type)|split\.(count|no)|[a-z0-9_]+\.(block_count|context_length|embedding_length|attention\.(head_count|head_count_kv|key_length|value_length)))$/.test(key);
      const v = value(u32(), keep);
      if (keep && v !== undefined) metadata[key] = v;
    }
  } catch (e) { if (e.code !== 'HEADER_LIMIT') throw e; complete = false; }
  return {version, tensors, metadata, complete};
}
export function parseSource(input) {
  let s = String(input).trim();
  if (s.startsWith('hf:')) s = 'https://huggingface.co/' + s.slice(3).replace(/^\/\//, '');
  if (/^https?:/i.test(s)) {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new ApertureError('SOURCE_URL', 'Use an HTTPS model link without embedded credentials or fragments.');
    if ([...u.searchParams.keys()].some(k => k !== 'download')) throw new ApertureError('SOURCE_URL', 'Use a stable model link without signed credentials in its query. HF_TOKEN can authorize Hugging Face access.');
    if (u.hostname === 'huggingface.co' || u.hostname === 'www.huggingface.co') {
      const pieces = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (pieces.length < 2 || ['spaces', 'datasets', 'collections'].includes(pieces[0])) throw new ApertureError('MODEL_LINK', 'Choose a model repository, not a dataset, collection, or Space.');
      const repo = pieces.slice(0, 2).join('/');
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/').some(p => ['.', '..'].includes(p))) throw new ApertureError('MODEL_LINK', 'Invalid model repository name.');
      let revision = 'main', filename = null;
      if (pieces.length > 2) {
        if (!['resolve', 'blob', 'tree'].includes(pieces[2]) || !pieces[3]) throw new ApertureError('MODEL_LINK', 'Use the repository page or a direct model-file link.');
        revision = pieces[3];
        if (pieces[2] !== 'tree') filename = fileName(pieces.slice(4).join('/'));
        else if (pieces.length > 4) throw new ApertureError('MODEL_LINK', 'Paste a model-file link or the repository root, rather than a subfolder page.');
      }
      return {kind: 'hf', repo, revision, filename};
    }
    if (!u.pathname.toLowerCase().endsWith('.gguf')) throw new ApertureError('MODEL_LINK', 'For this host, use a direct HTTPS .gguf file link. Repository pages are supported on Hugging Face.');
    return {kind: 'url', url: u.toString(), filename: fileName(path.posix.basename(decodeURIComponent(u.pathname)))};
  }
  return {kind: 'local', path: localPath(s)};
}
async function responseBytes(response, max) {
  const length = Number(response.headers.get('content-length'));
  if (length > max) { await response.body?.cancel(); throw new ApertureError('METADATA_LIMIT', 'The metadata response exceeds the permitted read limit.'); }
  let n = 0; const chunks = [];
  if (!response.body) throw new ApertureError('EMPTY_RESPONSE', 'The model source returned no body.');
  for await (const chunk of response.body) { n += chunk.length; if (n > max) throw new ApertureError('METADATA_LIMIT', 'The metadata response exceeds the permitted read limit.'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
export async function request(url, {fetcher = fetch, headers = {}, timeout = 20000} = {}) {
  let u = new URL(url);
  for (let i = 0; i < 6; i++) {
    if (u.protocol !== 'https:' || u.username || u.password) throw new ApertureError('SOURCE_URL', 'Model redirects must remain HTTPS and contain no embedded credentials.');
    const h = {...headers};
    if (u.hostname === 'huggingface.co' && process.env.HF_TOKEN) h.Authorization = `Bearer ${process.env.HF_TOKEN}`;
    const r = await fetcher(u.toString(), {headers: h, redirect: 'manual', signal: AbortSignal.timeout(timeout)});
    if ([301,302,303,307,308].includes(r.status)) {
      const target = r.headers.get('location'); await r.body?.cancel();
      if (!target) throw new ApertureError('REDIRECT', 'The model source returned a redirect without a destination.');
      u = new URL(target, u); continue;
    }
    if (!r.ok) { await r.body?.cancel(); throw new ApertureError('SOURCE_HTTP', `Model-source HTTP ${r.status}. Gated/private repositories require existing access and HF_TOKEN; no access restrictions are bypassed.`); }
    return r;
  }
  throw new ApertureError('REDIRECT', 'The model source exceeded the redirect limit.');
}
async function jsonUrl(url, fetcher) { return JSON.parse((await responseBytes(await request(url, {fetcher}), HEADER_LIMIT)).toString('utf8')); }
export async function remoteHeader(url, fetcher = fetch) {
  const r = await request(url, {fetcher, headers: {Range: `bytes=0-${HEADER_LIMIT-1}`, 'Accept-Encoding': 'identity'}});
  const range = r.headers.get('content-range'), length = r.headers.get('content-length');
  const match = range?.match(/^bytes 0-(\d+)\/(\d+)$/);
  if (r.status === 206 && !match) { await r.body?.cancel(); throw new ApertureError('RANGE_RESPONSE', 'The source returned an invalid byte range.'); }
  if (r.status !== 206 && (!length || Number(length) > HEADER_LIMIT)) { await r.body?.cancel(); throw new ApertureError('RANGE_REQUIRED', 'The server ignored bounded header reads. No full model download was approved.'); }
  const bytes = match ? Number(match[2]) : Number(length);
  if (!Number.isSafeInteger(bytes) || bytes < 24) { await r.body?.cancel(); throw new ApertureError('SOURCE_SIZE', 'The source did not report a valid complete file size.'); }
  return {buffer: await responseBytes(r, HEADER_LIMIT), bytes};
}
export function groupGgufs(names) {
  return names.filter(n => (n.endsWith('.gguf') && !/-\d{5}-of-\d{5}\.gguf$/.test(n)) || /-00001-of-\d{5}\.gguf$/.test(n));
}
export function shards(filename) {
  const m = filename.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/);
  if (!m) return [filename];
  const n = Number(m[3]);
  if (Number(m[2]) < 1 || Number(m[2]) > n || n < 1 || n > 10000) throw new ApertureError('FIRST_SHARD_REQUIRED', 'The numbered GGUF shard has an invalid index or count.');
  return Array.from({length:n}, (_,i) => `${m[1]}-${String(i+1).padStart(5,'0')}-of-${m[3]}.gguf`);
}
const aux = ['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','tokenizer.model','vocab.json','merges.txt','special_tokens_map.json','added_tokens.json','chat_template.jinja'];
export async function inspectLocal(source, choose) {
  let p = source.path, stat = await fs.stat(p);
  if (stat.isDirectory()) {
    const names = await fs.readdir(p);
    const hasHf = names.includes('config.json') && (names.includes('model.safetensors') || names.includes('model.safetensors.index.json'));
    const candidates = [...groupGgufs(names), ...(hasHf ? ['[safetensors checkpoint in this folder]'] : [])];
    if (!candidates.length) throw new ApertureError('MODEL_FORMAT', 'This folder has no standard GGUF or safetensors checkpoint. Only the selected folder was examined; nothing was searched recursively.');
    const selection = candidates.length === 1 ? candidates[0] : await choose(candidates);
    if (selection !== '[safetensors checkpoint in this folder]') p = path.join(p, selection);
    else return inspectLocalHf(p);
  }
  if (!p.toLowerCase().endsWith('.gguf')) {
    if (path.basename(p) === 'config.json' || path.basename(p).endsWith('.safetensors')) return inspectLocalHf(path.dirname(p));
    throw new ApertureError('MODEL_FORMAT', 'Choose a GGUF file, a safetensors checkpoint folder, or its config.json.');
  }
  const files = [];
  for (const name of shards(path.basename(p))) {
    const full = path.join(path.dirname(p), name), s = await fs.stat(full);
    if (!s.isFile()) throw new ApertureError('MISSING_SHARD', 'All model shards must be regular files.');
    files.push({name, path:full, bytes:s.size, mtimeMs:s.mtimeMs});
  }
  p = files[0].path;
  const head = await headerFile(p), gguf = parseGguf(head.buffer);
  if (gguf.metadata['split.count'] != null && gguf.metadata['split.count'] !== files.length) throw new ApertureError('MISSING_SHARD', 'The header shard count differs from the complete selected set.');
  return {kind:'gguf', name:path.basename(p), source:{kind:'local', path:p}, files, bytes:files.reduce((n,f)=>n+f.bytes,0), gguf,
    contentVerification:'HEADERS_ONLY_NOT_FULL_HASH', local:true};
}
async function inspectLocalHf(dir) {
  const config = await jsonFile(path.join(dir,'config.json'));
  let weightFiles;
  if (await exists(path.join(dir,'model.safetensors.index.json'))) {
    const index = await jsonFile(path.join(dir,'model.safetensors.index.json'));
    weightFiles = [...new Set(Object.values(index.weight_map || {}))].map(fileName);
    if (!weightFiles.length || weightFiles.some(n=>!n.endsWith('.safetensors'))) throw new ApertureError('CHECKPOINT_INDEX','The checkpoint index must enumerate safetensors weights.');
  } else weightFiles = ['model.safetensors'];
  const files=[];
  for (const name of weightFiles) {
    const p=path.join(dir,name), {buffer,bytes,mtimeMs}=await headerFile(p,8);
    if (buffer.length!==8 || buffer.readBigUInt64LE() > BigInt(HEADER_LIMIT) || Number(buffer.readBigUInt64LE())+8>bytes) throw new ApertureError('SAFETENSORS_HEADER','Invalid or over-limit safetensors header.');
    files.push({name,path:p,bytes,mtimeMs});
  }
  return {kind:'hf',name:path.basename(dir),source:{kind:'local',path:dir},files,bytes:files.reduce((n,f)=>n+f.bytes,0),config,
    local:true,contentVerification:'FILE_SIZES_AND_CONFIG_NOT_FULL_HASH'};
}
export async function inspectRemote(source, choose, {fetcher=fetch}={}) {
  if (source.kind==='url') {
    if (shards(source.filename).length>1) throw new ApertureError('SHARD_SOURCE','For split GGUF downloads, use a Hugging Face repository link or existing local shards.');
    const head=await remoteHeader(source.url,fetcher);
    return {kind:'gguf',name:source.filename,source,local:false,bytes:head.bytes,gguf:parseGguf(head.buffer),files:[{name:source.filename,bytes:head.bytes,url:source.url}],contentVerification:'REMOTE_HEADERS_ONLY'};
  }
  const base=`https://huggingface.co/api/models/${source.repo}/revision/${encodeURIComponent(source.revision)}?blobs=true`;
  const info=await jsonUrl(base,fetcher);
  if (!/^[0-9a-f]{40}$/.test(info.sha||'')) throw new ApertureError('REVISION_UNRESOLVED','The repository did not return an immutable commit.');
  const revision=info.sha, siblings=new Map((info.siblings||[]).map(f=>[fileName(f.rfilename),f]));
  const url=n=>`https://huggingface.co/${source.repo}/resolve/${revision}/${n.split('/').map(encodeURIComponent).join('/')}`;
  const sizeOf=n=>siblings.get(n)?.size ?? siblings.get(n)?.lfs?.size;
  let selected=source.filename;
  if (selected==='config.json' || selected==='model.safetensors' || selected==='model.safetensors.index.json') selected='[original safetensors checkpoint]';
  if (!selected) {
    const choices=groupGgufs([...siblings.keys()]);
    if (siblings.has('config.json') && (siblings.has('model.safetensors')||siblings.has('model.safetensors.index.json'))) choices.push('[original safetensors checkpoint]');
    if (!choices.length) throw new ApertureError('MODEL_FORMAT','No standard GGUF or safetensors checkpoint was found in the selected repository.');
    selected=choices.length===1?choices[0]:await choose(choices.map(n=>n==='[original safetensors checkpoint]'?n:`${n} (${sizeOf(n)==null?'size unavailable':(sizeOf(n)/1024**3).toFixed(2)+' GiB'})`),choices);
  }
  if (selected.endsWith('.gguf')) selected=shards(selected)[0];
  const sourcePinned={...source,revision,filename:selected==='[original safetensors checkpoint]'?null:selected};
  if (selected.endsWith('.gguf')) {
    const names=shards(selected);
    const files=names.map(name=>({name,bytes:sizeOf(name),sha256:(siblings.get(name)?.lfs?.sha256 || siblings.get(name)?.lfs?.oid),url:url(name)}));
    validateFiles(files);
    const head=await remoteHeader(url(selected),fetcher);
    if (head.bytes!==files[0].bytes) throw new ApertureError('SOURCE_SIZE_CHANGED','File metadata and byte-range response disagree.');
    return {kind:'gguf',name:selected,source:sourcePinned,files,bytes:files.reduce((n,f)=>n+f.bytes,0),gguf:parseGguf(head.buffer),local:false,contentVerification:'PINNED_REVISION_HEADERS_ONLY'};
  }
  if (selected!=='[original safetensors checkpoint]') throw new ApertureError('MODEL_FORMAT','Choose the repository root for a safetensors checkpoint, or an exact GGUF file.');
  const config=await jsonUrl(url('config.json'),fetcher);
  let weights=['model.safetensors'];
  if (siblings.has('model.safetensors.index.json')) {
    const index=await jsonUrl(url('model.safetensors.index.json'),fetcher);
    weights=[...new Set(Object.values(index.weight_map||{}))].map(fileName);
    if (!weights.length||weights.some(n=>!n.endsWith('.safetensors'))) throw new ApertureError('CHECKPOINT_INDEX','Invalid safetensors shard list.');
  }
  const names=[...new Set([...weights,...aux.filter(n=>siblings.has(n)),...(siblings.has('model.safetensors.index.json')?['model.safetensors.index.json']:[])])];
  const files=names.map(name=>({name,bytes:sizeOf(name),sha256:(siblings.get(name)?.lfs?.sha256 || siblings.get(name)?.lfs?.oid),url:url(name)}));
  validateFiles(files);
  return {kind:'hf',name:source.repo,source:sourcePinned,files,bytes:weights.reduce((n,f)=>n+sizeOf(f),0),downloadBytes:files.reduce((n,f)=>n+f.bytes,0),config,local:false,contentVerification:'PINNED_REVISION_METADATA_ONLY'};
}
function validateFiles(files) {
  if (files.some(f=>!Number.isSafeInteger(f.bytes)||f.bytes<=0)) throw new ApertureError('SOURCE_SIZE','Missing file or unbounded file sizes. No full download was attempted.');
}
