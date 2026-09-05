import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {bindNative, nativeEnvironment} from './backends.mjs';
import {headerFile, HEADER_LIMIT, ApertureError, appHome, mkdirPrivate, writeNew, jsonFile, command, fileName} from './common.mjs';
import {remoteHeader, parseGguf} from './models.mjs';
import {explainFit, requireFit} from './fit-policy.mjs';

const TOTAL_PREFIX_LIMIT = 64 * 1024 ** 2;
export async function stageFitHeaders(model, directory, {fetcher = fetch} = {}) {
  if (!Array.isArray(model.files) || !model.files.length || model.files.length > 64 ||
      model.files.some(f => !Number.isSafeInteger(f.bytes) || f.bytes < 24) ||
      model.files.reduce((sum, f) => sum + Math.min(f.bytes, HEADER_LIMIT), 0) > TOTAL_PREFIX_LIMIT)
    throw new ApertureError('FIT_HEADER_LIMIT', 'Native fit metadata is limited to 64 MiB total and 8 MiB per component. No checkpoint download was started.');
  const records = [], seen = new Set();
  for (const f of model.files) {
    const name = fileName(f.name);
    if (seen.has(name)) throw new ApertureError('FIT_SOURCE', 'Repeated model component name.');
    seen.add(name);
    const head = model.local ? await headerFile(f.path) : await remoteHeader(f.url, fetcher);
    if (head.bytes !== f.bytes) throw new ApertureError('MODEL_CHANGED', 'Model size changed after selection.');
    const scalar = parseGguf(head.buffer);
    if (!scalar.complete || scalar.tensors > 100000)
      throw new ApertureError('FIT_HEADER_LIMIT', 'The selected metadata exceeds the bounded fit reader.');
    const target = path.join(directory, name); await mkdirPrivate(path.dirname(target));
    await fs.writeFile(target, head.buffer, {flag: 'wx', mode: 0o600});
    records.push({name, bytes: f.bytes, prefixBytes: head.buffer.length,
      prefixSHA256: createHash('sha256').update(head.buffer).digest('hex')});
  }
  return {path: path.join(directory, model.files[0].name), records};
}
export async function prepareNativeFit(plan, ui, options = {}, phase = 'before loading') {
  if (plan.model.kind !== 'gguf') throw new ApertureError('FIT_UNAVAILABLE', 'Native GGUF fit is not a safetensors adapter.');
  if (plan.blockers.length) throw new ApertureError('PLAN_BLOCKED', plan.blockers.join(' '));
  if (!plan.model.local && !options.networkApproved && !options.downloadApproved &&
      !await ui.confirm('Allow bounded model-header requests for native fit, before any weight download?'))
    throw new ApertureError('CANCELLED', 'Native fit metadata access declined. No weights were acquired.');
  const {refreshed, ensureNative} = await import('./run.mjs');
  plan = await refreshed(plan);
  const runtimeDirectory = await ensureNative(ui, options);
  plan = await bindNative(plan, runtimeDirectory, ui);
  const parent = path.join(appHome(), 'fits'); await mkdirPrivate(parent);
  const directory = await fs.mkdtemp(path.join(parent, 'assessment-'));
  const headers = path.join(directory, 'headers'); await mkdirPrivate(headers);
  const resultFile = path.join(directory, 'assessment.json');
  try {
    ui.say('Checking the fixed-context native memory estimate before acquisition/loading. Bounded prefixes: at most 8 MiB per shard and 64 MiB total; no full checkpoint acquisition.');
    const staged = await stageFitHeaders(plan.model, headers);
    const jobFile = path.join(directory, 'job.json');
    await writeNew(jobFile, {plan, runtimeDirectory, headerPath: staged.path,
      components: staged.records, resultFile});
    const result = await command(process.execPath,
      [fileURLToPath(new URL('./native-fit-worker.mjs', import.meta.url)), jobFile],
      {env: nativeEnvironment(plan), timeout: 180000});
    if (result.timedOut) throw new ApertureError('FIT_TIMEOUT', 'Native assessment timed out. No checkpoint acquisition or model load was started.');
    let fit;
    try { fit = await jsonFile(resultFile); }
    catch { throw new ApertureError('FIT_UNAVAILABLE', 'The isolated native estimator did not return a complete result. No checkpoint acquisition or model load was started.'); }
    if (result.code !== 0 || fit.status === 'UNAVAILABLE')
      throw new ApertureError('FIT_UNAVAILABLE', fit.error?.message || 'Native fit assessment failed.');
    if (fit.schema !== 'aperture-native-fit/1' || fit.context !== plan.request.contextPerSequence ||
        fit.sequences !== plan.request.parallel)
      throw new ApertureError('FIT_UNAVAILABLE', 'Native assessment changed the requested context or sequence count.');
    ui.say(explainFit(fit, phase)); ui.say(`Native assessment saved locally: ${resultFile}`);
    requireFit(fit);
    return {plan: {...plan, nativeFit: fit}, runtimeDirectory};
  } finally {
    // Only this invocation's temporary metadata is removed, never model or runtime caches.
    await fs.rm(headers, {recursive: true, force: true});
    await fs.unlink(path.join(directory, 'job.json')).catch(() => {});
  }
}
