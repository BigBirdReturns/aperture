import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
export const GiB = 1024 ** 3;
export const HEADER_LIMIT = 8 * 1024 ** 2;
export const RUNTIME_VERSION = '3.20.0';
export class ApertureError extends Error {
  constructor(code, message) { super(message); this.name = 'ApertureError'; this.code = code; }
}
export const clean = s => String(s).replace(/[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/g, '').replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
export const gib = n => Number.isFinite(n) ? `${(n / GiB).toFixed(2)} GiB` : 'unmeasured';
export const now = () => new Date().toISOString();
export const exists = async p => { try { await fs.access(p); return true; } catch { return false; } };
export const appHome = () => path.resolve(process.env.APERTURE_HOME || path.join(os.homedir(), '.aperture'));
export function positive(value, name, max = 1048576) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new ApertureError('INVALID_INPUT', `${name} must be a positive integer no larger than ${max}.`);
  return n;
}
export function fileName(value) {
  if (typeof value !== 'string' || !value || /[\\:\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '..' || p === '.')) {
    throw new ApertureError('INVALID_FILE_NAME', 'The source contains an unsafe relative filename.');
  }
  return value;
}
export function localPath(s) {
  let v = String(s).trim();
  if (v.startsWith('& ')) v = v.slice(2).trim(); // PowerShell drag-and-drop prefix
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (v === '~') v = os.homedir();
  if (v.startsWith('~/') || v.startsWith('~\\')) v = path.join(os.homedir(), v.slice(2));
  return path.resolve(v);
}
export async function mkdirPrivate(p) { await fs.mkdir(p, {recursive: true, mode: 0o700}); }
export async function writeNew(p, value) {
  await mkdirPrivate(path.dirname(p));
  await fs.writeFile(p, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
}
export async function jsonFile(p, max = HEADER_LIMIT) {
  const stat = await fs.stat(p);
  if (!stat.isFile() || stat.size > max) throw new ApertureError('METADATA_LIMIT', 'Selected JSON metadata is not a bounded regular file.');
  return JSON.parse(await fs.readFile(p, 'utf8'));
}
export async function headerFile(p, max = HEADER_LIMIT) {
  const file = await fs.open(p, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new ApertureError('NOT_A_FILE', 'Choose a regular model file.');
    const buffer = Buffer.alloc(Math.min(stat.size, max));
    let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return {buffer: buffer.subarray(0, offset), bytes: stat.size, mtimeMs: stat.mtimeMs};
  } finally { await file.close(); }
}
export async function hashFile(p) {
  const handle = await fs.open(p, 'r');
  const hash = createHash('sha256');
  try { for await (const chunk of handle.createReadStream()) hash.update(chunk); return hash.digest('hex'); }
  finally { await handle.close(); }
}
export async function command(exe, args, {timeout = 8000, env = process.env, inherit = false, cwd} = {}) {
  return new Promise((resolve, reject) => {
    // The interactive controller owns stdin; managed commands inherit output only.
    const child = spawn(exe, args, {env, cwd, shell: false, windowsHide: true, stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe']});
    let out = '', err = '', expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); }, timeout);
    timer.unref();
    if (!inherit) {
      child.stdout.on('data', b => { out += b.toString(); if (out.length > 2e6) child.kill(); });
      child.stderr.on('data', b => { err += b.toString(); if (err.length > 2e6) child.kill(); });
    }
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('close', code => { clearTimeout(timer); resolve({code, stdout: out, stderr: err, timedOut: expired}); });
  });
}
export async function which(names) {
  for (const name of names) {
    for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']) {
        const p = path.resolve(dir, name + ext);
        try { if ((await fs.stat(p)).isFile()) return p; } catch {}
      }
    }
  }
  return null;
}
