import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {command, which, now, clean} from './common.mjs';
export function parseNvidia(text) {
  const devices = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const row = line.split(',').map(x => x.trim());
    if (row.length !== 6) continue;
    const [index, uuid, name, total, free, driver] = row;
    if (!/^GPU-[a-z0-9-]+$/i.test(uuid) || !Number.isFinite(Number(total)) || !Number.isFinite(Number(free))) continue;
    const totalBytes = Number(total) * 1048576, freeBytes = Number(free) * 1048576;
    if (freeBytes < 0 || totalBytes <= 0 || freeBytes > totalBytes) continue;
    devices.push({index: Number(index), uuid, name: clean(name), totalBytes, freeBytes, driver, capacity: 'DRIVER_REPORTED', externalGate: /CMP/i.test(name)});
  }
  return devices;
}
export async function scan({storage = process.cwd()} = {}) {
  let total = os.totalmem(), available = os.freemem(), basis = 'operating-system';
  if (process.platform === 'linux') {
    try {
      const data = await fs.readFile('/proc/meminfo', 'utf8');
      const value = k => Number(data.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1]) * 1024;
      if (Number.isFinite(value('MemAvailable'))) available = value('MemAvailable');
      const [limit, used] = await Promise.all([fs.readFile('/sys/fs/cgroup/memory.max', 'utf8'), fs.readFile('/sys/fs/cgroup/memory.current', 'utf8')]);
      if (/^\d+\s*$/.test(limit) && /^\d+\s*$/.test(used)) {
        total = Math.min(total, Number(limit)); available = Math.min(available, Math.max(0, Number(limit) - Number(used))); basis = 'OS plus cgroup-v2 root limit';
      }
    } catch {}
  }
  let disk = null, p = path.resolve(storage);
  try { const s = await fs.statfs(p); disk = s.bavail * s.bsize; } catch {}
  let devices = [], gpuObservation = 'NVIDIA inventory unavailable; absence is not proof of no GPU.';
  const smi = await which(['nvidia-smi']);
  if (smi) {
    try {
      const r = await command(smi, ['--query-gpu=index,uuid,name,memory.total,memory.free,driver_version', '--format=csv,noheader,nounits']);
      if (r.code === 0) { devices = parseNvidia(r.stdout); gpuObservation = 'NVIDIA driver inventory'; }
    } catch {}
  }
  const isApple = process.platform === 'darwin' && process.arch === 'arm64';
  return {
    schema: 'aperture-scan/1', observedAt: now(), platform: process.platform, architecture: process.arch,
    cpu: clean(os.cpus()[0]?.model || 'unknown'), logicalCpus: os.availableParallelism?.() || os.cpus().length,
    memory: {totalBytes: total, availableBytes: available, basis}, storage: {path: p, freeBytes: disk},
    gpu: {devices, observation: gpuObservation, appleUnifiedMemory: isApple},
    installed: {llamaServer: await which(['llama-server']), python: await which(['python3', 'python', 'py'])},
    notMeasured: ['bandwidth', 'latency', 'GPU stability', 'model performance', 'non-NVIDIA discrete GPU capacity'],
    privacy: 'Local only. No home-directory traversal, browser data, credentials, prompts, uploads, or stress tests.'
  };
}
