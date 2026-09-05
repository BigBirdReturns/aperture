import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {jsonFile, writeNew, RUNTIME_VERSION, ApertureError, clean} from './common.mjs';
import {nativeOptions} from './native-session.mjs';
import {verifyNativeDevice} from './backends.mjs';
import {assessFit} from './fit-policy.mjs';

let llama, job;
try {
  job = await jsonFile(process.argv[2]);
  const meta = await jsonFile(path.join(job.runtimeDirectory, 'node_modules/node-llama-cpp/package.json'));
  if (meta.version !== RUNTIME_VERSION) throw new ApertureError('RUNTIME_VERSION', 'The pinned native runtime changed.');
  const require = createRequire(path.join(job.runtimeDirectory, 'package.json'));
  const api = await import(pathToFileURL(require.resolve('node-llama-cpp')).href);
  const opts = nativeOptions(job.plan);
  llama = await api.getLlama(opts.llama);
  if (llama.gpu !== opts.llama.gpu) throw new ApertureError('BACKEND_CHANGED', 'Native assessment changed the selected backend.');
  await verifyNativeDevice(llama, job.plan);
  // The runtime sees only approved local header snapshots; it performs no network fetch.
  const info = await api.readGgufFileInfo(job.headerPath, {sourceType: 'filesystem',
    readTensorInfo: true, spliceSplitFiles: true, logWarnings: false});
  if (info.splicedParts !== job.components.length || !info.fullTensorInfo?.length ||
      info.fullTensorInfo.length !== Number(info.totalTensorCount))
    throw new ApertureError('FIT_SOURCE', 'The complete selected tensor table was not read.');
  const insights = await api.GgufInsights.from(info, llama);
  const fit = await assessFit(insights, job.plan, opts);
  await writeNew(job.resultFile, {schema: 'aperture-native-fit/1', assessedAt: new Date().toISOString(),
    runtime: `node-llama-cpp@${RUNTIME_VERSION}`, backend: llama.gpu || 'cpu',
    deviceNames: job.plan.method.expectedDeviceNames ?? [], source: job.plan.model.source,
    components: job.components, splicedParts: info.splicedParts, ...fit,
    checkpointAcquired: false, modelLoaded: false, inferenceRun: false});
} catch (e) {
  process.exitCode = 2;
  if (job?.resultFile) await writeNew(job.resultFile, {schema: 'aperture-native-fit/1',
    status: 'UNAVAILABLE', error: {code: e.code ?? e.name, message: clean(e.message)},
    checkpointAcquired: false, modelLoaded: false, inferenceRun: false});
  else console.error(clean(e.message));
} finally { await llama?.dispose(); }
