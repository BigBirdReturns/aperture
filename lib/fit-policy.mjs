import {ApertureError, gib} from './common.mjs';

function bytes(value, label) {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.ceil(value)))
    throw new ApertureError('FIT_UNAVAILABLE', `Incomplete native memory estimate: ${label}.`);
  return Math.ceil(value);
}
export const VRAM_ESTIMATE_GUARD_CAP_BYTES = 256 * 1024 ** 2;
export function estimateGuardBytes(budget) {
  const value = bytes(budget, 'GPU budget');
  return Math.min(VRAM_ESTIMATE_GUARD_CAP_BYTES, Math.floor(value * 0.05));
}
export function fitBudgets(plan) {
  const cpu = plan.method.backend === 'cpu';
  const shared = plan.method.sharedMemoryBudgetBytes ??
    (plan.method.backend === 'metal' ? plan.method.ramBudgetBytes : null);
  const observedVram = cpu ? 0 : bytes(plan.method.gpuBudgetBytes ?? shared, 'GPU budget');
  const observedShared = shared == null ? null : bytes(shared, 'shared-memory budget');
  const estimateGuard = cpu ? 0 : estimateGuardBytes(observedVram);
  return {
    ram: bytes(plan.method.ramBudgetBytes, 'RAM budget'),
    vram: Math.max(0, observedVram - estimateGuard),
    shared: observedShared == null ? null : Math.max(0, observedShared - estimateGuard),
    observedVram, observedShared, estimateGuardBytes: estimateGuard
  };
}
export function compareRequirements(model, context, budgets) {
  const ram = bytes(model.cpuRam, 'model RAM') + bytes(context.cpuRam, 'context RAM');
  const vram = bytes(model.gpuVram, 'model GPU memory') + bytes(context.gpuVram, 'context GPU memory');
  bytes(ram, 'total RAM'); bytes(vram, 'total GPU memory');
  const shortfall = {ram: Math.max(0, ram - budgets.ram), vram: Math.max(0, vram - budgets.vram),
    shared: budgets.shared == null ? 0 : Math.max(0, ram + vram - budgets.shared)};
  return {ram, vram, model, context, shortfall,
    fits: Object.values(shortfall).every(n => n === 0)};
}
export async function assessFit(insights, plan, nativeOptions) {
  if (plan.request.parallel !== nativeOptions.context.sequences || plan.request.contextPerSequence !== nativeOptions.context.contextSize)
    throw new ApertureError('FIT_REQUIREMENTS', 'Native estimate must preserve the requested context and sequence count.');
  const totalLayers = insights.totalLayers;
  if (!Number.isSafeInteger(totalLayers) || totalLayers < 1 || totalLayers > 512)
    throw new ApertureError('FIT_UNAVAILABLE', 'The native layer count is missing or exceeds the bounded assessment limit.');
  const fixed = Number.isInteger(plan.method.gpuLayers) ? plan.method.gpuLayers : null;
  if (fixed != null && (fixed < 0 || fixed > totalLayers))
    throw new ApertureError('GPU_LAYERS', `Requested ${fixed} GPU layers; this model has ${totalLayers}.`);
  const counts = plan.method.backend === 'cpu' ? [0] : fixed != null ? [fixed] :
    Array.from({length: totalLayers + 1}, (_, i) => totalLayers - i);
  const budgets = fitBudgets(plan), candidates = [];
  for (const gpuLayers of counts) {
    const model = await insights.estimateModelResourceRequirementsV2({gpuLayers, useMmap: nativeOptions.model.useMmap});
    const context = await insights.estimateContextResourceRequirementsV2({
      contextSize: nativeOptions.context.contextSize, modelGpuLayers: gpuLayers,
      sequences: nativeOptions.context.sequences, batchSize: nativeOptions.context.batchSize,
      flashAttention: nativeOptions.context.flashAttention ?? 'auto',
      useMmap: nativeOptions.model.useMmap
    });
    const candidate = {gpuLayers, ...compareRequirements(model, context, budgets)};
    candidates.push(candidate);
    if (candidate.fits) break;
  }
  const selected = candidates.find(c => c.fits) ?? null;
  const nearest = selected ?? [...candidates].sort((a, b) =>
    Math.max(a.shortfall.ram / Math.max(1, budgets.ram), a.shortfall.vram / Math.max(1, budgets.vram), a.shortfall.shared / Math.max(1, budgets.shared ?? 1)) -
    Math.max(b.shortfall.ram / Math.max(1, budgets.ram), b.shortfall.vram / Math.max(1, budgets.vram), b.shortfall.shared / Math.max(1, budgets.shared ?? 1)))[0];
  return {status: selected ? 'FITS_ESTIMATE' : 'DOES_NOT_FIT_ESTIMATE', budgets, selected, nearest,
    context: nativeOptions.context.contextSize, sequences: nativeOptions.context.sequences,
    batchSize: nativeOptions.context.batchSize, totalLayers,
    tensorPayloadBytes: bytes(insights.modelSize, 'tensor payload'), candidates,
    basis: 'Pinned runtime V2 resource estimates, which may use its estimation fallback. A five-percent GPU estimate guard, capped at 256 MiB, is retained before layer selection. Not a load, execution or performance result.',
    selection: 'Highest estimated fitting GPU layer count after the estimate guard, not a speed optimum; explicit layer counts are preserved.'};
}
export function explainFit(fit, phase) {
  const c = fit.selected ?? fit.nearest;
  if (!c) throw new ApertureError('FIT_UNAVAILABLE', 'The native assessment returned no configuration.');
  return [`Native fit ${phase}: ${fit.status}; context ${fit.context}; sequences ${fit.sequences}.`,
    `Tensor payload: ${gib(fit.tensorPayloadBytes)}. Assessed ${fit.candidates.length} layer configuration(s).`,
    `Estimated ${c.gpuLayers} GPU layers; RAM ${gib(c.ram)} / budget ${gib(fit.budgets.ram)}; GPU ${gib(c.vram)} / fit budget ${gib(fit.budgets.vram)}.`,
    ...(fit.budgets.estimateGuardBytes ? [`GPU estimate guard: ${gib(fit.budgets.estimateGuardBytes)} retained inside the observed ${gib(fit.budgets.observedVram)} budget.`] : []),
    ...(fit.budgets.shared == null ? [] : [`RAM and graphics share ${gib(fit.budgets.shared)} after the same guard; they are not additive capacity.`]),
    ...(c.gpuLayers === 0 ? ['Zero GPU layers means CPU model execution, even when a GPU backend is initialized.'] : []),
    ...(fit.selected ? ['This is an estimate. Available resources and native memory checks are repeated before actual loading.'] :
      [`For the displayed configuration, additional budget required: RAM ${gib(c.shortfall.ram)}, GPU ${gib(c.shortfall.vram)}${c.shortfall.shared ? ', shared memory '+gib(c.shortfall.shared) : ''}.`,
       'No fitting configuration was estimated under current budgets. The chosen model, context and device were preserved; no checkpoint acquisition or model load was started.']),
    'Native estimates do not establish architecture compatibility or throughput.'].join('\n');
}
export function requireFit(fit) {
  if (fit.status !== 'FITS_ESTIMATE' || !fit.selected?.fits)
    throw new ApertureError('MODEL_DOES_NOT_FIT', 'The native estimates do not fit the current reserved budgets. Free resources and retry; the selected model and context were not changed.');
}
