// Synthetic control tests. Native hardware observations are recorded separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assessFit, fitBudgets, compareRequirements, explainFit, requireFit, estimateGuardBytes, VRAM_ESTIMATE_GUARD_CAP_BYTES} from '../lib/fit-policy.mjs';
import {stageFitHeaders, prepareNativeFit} from '../lib/native-fit.mjs';
import {executePlan} from '../lib/wizard.mjs';
import {nativeOptions} from '../lib/native-session.mjs';
import {HEADER_LIMIT} from '../lib/common.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aperture-fit-test-'));
const originalHome = process.env.APERTURE_HOME; process.env.APERTURE_HOME = root;
const plan = () => ({blockers: [], request: {contextPerSequence: 2048, parallel: 1},
  machine: {memory: {availableBytes: 20}}, model: {kind: 'gguf', local: false, bytes: 8,
    source: {kind: 'hf', repo: 'fixture/model', revision: 'a'.repeat(40)}, files: []},
  method: {backend: 'vulkan', ramBudgetBytes: 5, gpuBudgetBytes: 5, gpuLayers: 'fit'}});
const insight = () => ({totalLayers: 3, modelSize: 8,
  estimateModelResourceRequirementsV2: async ({gpuLayers}) => ({cpuRam: 4 - gpuLayers, gpuVram: gpuLayers * 2}),
  estimateContextResourceRequirementsV2: async () => ({cpuRam: 1, gpuVram: 1})});
const runFit = (p = plan(), i = insight()) => assessFit(i, p, nativeOptions(p));
const zero = {cpuRam: 0, gpuVram: 0};
const ui = () => ({log: [], say(s) {this.log.push(s);}, confirm: async () => false});
test('automatic fit searches layers and keeps fixed context and batch', async () => {
  const p = plan(), i = insight(), calls = [];
  i.estimateContextResourceRequirementsV2 = async o => {calls.push(o); return {cpuRam: 1, gpuVram: 1};};
  const fit = await runFit(p, i);
  assert.equal(fit.selected.gpuLayers, 2); assert.equal(fit.tensorPayloadBytes, 8);
  assert.ok(calls.every(o => o.contextSize === 2048 && o.sequences === 1 && o.batchSize === 512));
  assert.equal(p.method.gpuLayers, 'fit');
});
test('payload larger than GPU budget can still fit split execution', async () => {
  const fit = await runFit(); assert.ok(fit.tensorPayloadBytes > fit.budgets.vram); requireFit(fit);
});
test('automatic fit retains a bounded GPU estimate guard', async () => {
  const GiB = 1024 ** 3, raw = 6 * GiB, p = plan();
  p.method.ramBudgetBytes = 10 * GiB; p.method.gpuBudgetBytes = raw;
  const guard = estimateGuardBytes(raw);
  assert.equal(guard, VRAM_ESTIMATE_GUARD_CAP_BYTES);
  const i = {totalLayers: 2, modelSize: 9 * GiB,
    estimateModelResourceRequirementsV2: async ({gpuLayers}) => ({
      cpuRam: GiB, gpuVram: gpuLayers === 2 ? raw - 1 : raw - guard - 1
    }),
    estimateContextResourceRequirementsV2: async () => ({cpuRam: 0, gpuVram: 0})};
  const fit = await runFit(p, i);
  assert.equal(fit.budgets.observedVram, raw);
  assert.equal(fit.budgets.vram, raw - guard);
  assert.equal(fit.candidates[0].fits, false);
  assert.equal(fit.selected.gpuLayers, 1);
});
test('small GPU budgets use a proportional estimate guard', () => {
  assert.equal(estimateGuardBytes(1000), 50);
});
test('explicit layer count is assessed once and never reduced', async () => {
  const p = plan(); p.method.gpuLayers = 3; const fit = await runFit(p);
  assert.equal(fit.status, 'DOES_NOT_FIT_ESTIMATE'); assert.equal(fit.candidates.length, 1);
  assert.equal(fit.nearest.gpuLayers, 3); assert.throws(() => requireFit(fit), e => e.code === 'MODEL_DOES_NOT_FIT');
});
test('no-fitting result checks every supported layer count', async () => {
  const p = plan(); p.method.ramBudgetBytes = 0; p.method.gpuBudgetBytes = 0;
  const fit = await runFit(p); assert.equal(fit.candidates.length, 4); assert.equal(fit.selected, null);
});
test('zero GPU layers is reported as CPU model execution', async () => {
  const p = plan(); p.method.gpuLayers = 0;
  assert.match(explainFit(await runFit(p), 'before download'), /Zero GPU layers means CPU/);
});
test('invalid and excessive native layer counts are refused', async () => {
  for (const n of [null, 0, 513, NaN]) await assert.rejects(runFit(plan(), {...insight(), totalLayers: n}));
  const p = plan(); p.method.gpuLayers = 4; await assert.rejects(runFit(p), e => e.code === 'GPU_LAYERS');
});
test('unknown native byte estimates cannot become a fitting zero', () => {
  for (const n of [undefined, null, NaN, Infinity, -1]) assert.throws(() => compareRequirements({cpuRam: n, gpuVram: 0}, zero, {ram: 10, vram: 10, shared: null}));
});
test('integrated and Metal memory is constrained by one shared total', () => {
  const r = compareRequirements({cpuRam: 4, gpuVram: 4}, zero, {ram: 5, vram: 5, shared: 6});
  assert.equal(r.fits, false); assert.equal(r.shortfall.shared, 2);
  const p = plan(); p.method.backend = 'metal'; p.method.gpuBudgetBytes = null;
  assert.equal(fitBudgets(p).shared, 5);
});
test('other GPUs cannot expand the selected device budget', () => {
  const p = plan(); p.machine.gpu = {devices: [{freeBytes: 1000000}, {freeBytes: 1000000}]};
  assert.equal(fitBudgets(p).vram, 5);
});
test('context and sequence mismatch is refused before estimates', async () => {
  const p = plan(); p.request.parallel = 2; await assert.rejects(runFit(p), e => e.code === 'FIT_REQUIREMENTS');
});
test('native metadata access has its own refusal before scanning or installing', async () => {
  await assert.rejects(prepareNativeFit(plan(), ui()), e => e.code === 'CANCELLED');
});
test('too many header bytes are refused before network access', async () => {
  let calls = 0;
  await assert.rejects(stageFitHeaders({local: false, files: Array.from({length: 9}, (_, i) => ({name: `m${i}.gguf`, bytes: HEADER_LIMIT + 1}))}, root,
    {fetcher: async () => {calls++;}}), e => e.code === 'FIT_HEADER_LIMIT');
  assert.equal(calls, 0);
});
test('range-ignoring model host cannot start a full weight download', async () => {
  const m = {local: false, files: [{name: 'large.gguf', bytes: HEADER_LIMIT * 2, url: 'https://example.org/large.gguf'}]};
  await assert.rejects(stageFitHeaders(m, root, {fetcher: async () => new Response('x',
    {headers: {'content-length': String(HEADER_LIMIT * 2)}})}), e => e.code === 'RANGE_REQUIRED');
});
test('selected source size changes fail before metadata staging', async () => {
  const b = Buffer.alloc(24); b.write('GGUF'); b.writeUInt32LE(3, 4);
  const m = {local: false, files: [{name: 'size.gguf', bytes: 25, url: 'https://example.org/size.gguf'}]};
  await assert.rejects(stageFitHeaders(m, root, {fetcher: async () => new Response(b,
    {status: 206, headers: {'content-range': 'bytes 0-23/24', 'content-length': '24'}})}), e => e.code === 'MODEL_CHANGED');
});
test('native refusal prevents acquisition even with download permission', async () => {
  const events = [];
  await assert.rejects(executePlan(plan(), ui(), {downloadApproved: true}, {
    prepareNativeFit: async () => {events.push('fit'); throw new Error('no fit');},
    acquire: async () => {events.push('acquire');}, run: async () => {events.push('run');}
  }), /no fit/);
  assert.deepEqual(events, ['fit']);
});
test('fitting estimate does not grant download permission', async () => {
  const events = [];
  await executePlan(plan(), ui(), {}, {prepareNativeFit: async p => {events.push('fit'); return {plan: p};},
    acquire: async () => {events.push('acquire');}});
  assert.deepEqual(events, ['fit']);
});
test('fit precedes acquisition and its bound plan reaches the runner', async () => {
  const events = [], p = plan();
  const result = await executePlan(p, ui(), {downloadApproved: true}, {
    prepareNativeFit: async p => {events.push('fit'); return {plan: {...p, marker: 'bound'}};},
    acquire: async m => {events.push('acquire'); return {...m, local: true};},
    run: async p => {events.push('run'); return p;}
  });
  assert.deepEqual(events, ['fit', 'acquire', 'run']); assert.equal(result.marker, 'bound');
  assert.equal(result.request.contextPerSequence, 2048); assert.deepEqual(result.model.source, p.model.source);
});
test.after(async () => {
  if (originalHome === undefined) delete process.env.APERTURE_HOME; else process.env.APERTURE_HOME = originalHome;
  await fs.rm(root, {recursive: true, force: true});
});
