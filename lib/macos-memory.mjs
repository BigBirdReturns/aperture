import os from 'node:os';
import {command, clean} from './common.mjs';

const safeBytes = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const positiveBytes = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

export function parseMacMemoryPressure(text, hostTotalBytes = os.totalmem()) {
  const source = clean(text ?? '');
  const percentMatch = source.match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i);
  const percentage = percentMatch ? Number(percentMatch[1]) : NaN;
  const hostTotal = positiveBytes(hostTotalBytes);
  if (!hostTotal || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;

  let reportedTotalBytes = null;
  const totalMatch = source.match(/The system has\s+(\d+)\s+\((\d+)\s+pages with a page size of\s+(\d+)\)/i);
  if (totalMatch) {
    const bytes = positiveBytes(totalMatch[1]);
    const pages = positiveBytes(totalMatch[2]);
    const pageSize = positiveBytes(totalMatch[3]);
    if (bytes && pages && pageSize) {
      const derived = pages * pageSize;
      if (Number.isSafeInteger(derived) && Math.abs(bytes - derived) <= pageSize) reportedTotalBytes = bytes;
    }
  }

  const totalBytes = reportedTotalBytes === null ? hostTotal : Math.min(hostTotal, reportedTotalBytes);
  return {
    totalBytes,
    availableBytes: Math.floor(totalBytes * percentage / 100),
    pressureFreePercent: percentage,
    pressureReportedTotalBytes: reportedTotalBytes,
    basis: 'macOS memory_pressure -Q available percentage; pressure-reclaimable capacity shares one pool with Metal'
  };
}

export async function observeMacMemory({
  run = command,
  totalBytes = os.totalmem(),
  rawFreeBytes = os.freemem(),
  timeout = 5000
} = {}) {
  const total = positiveBytes(totalBytes) ?? 0;
  const raw = Math.min(total, safeBytes(rawFreeBytes) ?? 0);
  try {
    const result = await run('/usr/bin/memory_pressure', ['-Q'], {timeout});
    if (result?.code === 0 && !result.timedOut) {
      const parsed = parseMacMemoryPressure(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, total);
      if (parsed) {
        return {
          ...parsed,
          availableBytes: Math.min(parsed.totalBytes, Math.max(raw, parsed.availableBytes)),
          rawFreeBytes: raw,
          status: 'OBSERVED',
          error: null
        };
      }
    }
  } catch {}
  return {
    totalBytes: total,
    availableBytes: raw,
    rawFreeBytes: raw,
    pressureFreePercent: null,
    pressureReportedTotalBytes: null,
    basis: 'Node os.freemem raw free pages; macOS pressure-aware observation unavailable',
    status: 'FALLBACK',
    error: 'macOS pressure-aware memory observation unavailable; raw free pages used'
  };
}
