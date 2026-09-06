import {scan} from './scan.mjs';
import {clean, gib, localPath, now, writeNew} from './common.mjs';
import {RECIPE_CATALOG, RTX6KPRO_SOURCE} from './recipe-catalog.mjs';
import {VERSION} from './version.mjs';

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const cmp = value => {
  const n = finite(value);
  return n === null ? null : n;
};
const nvidia = machine => (machine?.gpu?.devices || []).filter(device => /NVIDIA|GeForce|RTX|Tesla|Quadro|A\d{2,3}|H\d{2,3}|L\d{1,2}/i.test(device.name || ''));
const cohortKey = device => [clean(device.name || 'unknown').toLowerCase(), cmp(device.computeCapability) ?? 'unknown', finite(device.totalBytes) ?? 'unknown'].join('|');

function chooseDevices(machine, recipe) {
  const devices = nvidia(machine).sort((a, b) => (finite(b.totalBytes) || 0) - (finite(a.totalBytes) || 0));
  const count = recipe.hard.gpuCount || 1;
  if (!recipe.hard.homogeneous) return {devices: devices.slice(0, count), homogeneous: true, available: devices.length};
  const groups = new Map();
  for (const device of devices) {
    const key = cohortKey(device);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(device);
  }
  const cohorts = [...groups.values()].sort((a, b) => b.length - a.length || (finite(b[0]?.totalBytes) || 0) - (finite(a[0]?.totalBytes) || 0));
  const match = cohorts.find(group => group.length >= count);
  return {devices: (match || devices).slice(0, count), homogeneous: !!match, available: devices.length};
}

function deviceSummary(device) {
  return {
    name: clean(device.name || 'unknown'),
    totalBytes: finite(device.totalBytes),
    freeBytes: finite(device.freeBytes),
    computeCapability: cmp(device.computeCapability),
    pcieGeneration: finite(device.pcie?.generation),
    pcieWidth: finite(device.pcie?.width),
    driver: device.driver || null
  };
}

export function evaluateRecipe(machine, recipe) {
  const requiredCount = recipe.hard.gpuCount || 1;
  const selection = chooseDevices(machine, recipe);
  const selected = selection.devices;
  const blockers = [], unknowns = [], matches = [], cautions = [];

  if (selection.available < requiredCount) blockers.push(`Requires ${requiredCount} NVIDIA GPU${requiredCount === 1 ? '' : 's'}; ${selection.available} observed.`);
  if (recipe.hard.homogeneous && selection.available >= requiredCount && !selection.homogeneous)
    unknowns.push(`The reference recipe uses ${requiredCount} homogeneous GPUs; the observed NVIDIA devices do not form a matching ${requiredCount}-GPU cohort.`);

  if (selected.length >= requiredCount && recipe.hard.computeCapabilityMin != null) {
    const caps = selected.map(device => cmp(device.computeCapability));
    if (caps.some(value => value === null)) unknowns.push(`Compute capability ${recipe.hard.computeCapabilityMin}+ is required, but at least one selected GPU did not report compute capability.`);
    else if (caps.some(value => value < recipe.hard.computeCapabilityMin)) blockers.push(`Requires NVIDIA compute capability ${recipe.hard.computeCapabilityMin}+ for this numerical path; selected hardware reports ${caps.join(', ')}.`);
    else matches.push(`Compute capability meets the ${recipe.hard.computeCapabilityMin}+ numerical requirement.`);
  } else if (selected.length >= requiredCount && recipe.reference.computeCapability != null) {
    const caps = selected.map(device => cmp(device.computeCapability));
    if (caps.some(value => value === null)) unknowns.push(`The source reference is compute capability ${recipe.reference.computeCapability}; the selected GPU capability was not observed.`);
    else if (caps.some(value => value < recipe.reference.computeCapability)) unknowns.push(`The source reference is compute capability ${recipe.reference.computeCapability}; lower-capability execution is not established by this recipe.`);
    else matches.push(`Compute capability is at least the source reference (${recipe.reference.computeCapability}).`);
  }

  const physicalFloor = finite(recipe.hard.perGpuObservedWorkingSetBytes);
  if (selected.length >= requiredCount && physicalFloor !== null) {
    const totals = selected.map(device => finite(device.totalBytes));
    if (totals.some(value => value === null)) unknowns.push('At least one selected GPU has unknown physical memory capacity.');
    else if (Math.min(...totals) < physicalFloor) blockers.push(`The observed working set for this exact recipe is at least ${gib(physicalFloor)} per GPU; the smallest selected GPU has ${gib(Math.min(...totals))}.`);
    else matches.push(`Physical GPU memory meets the ${gib(physicalFloor)} observed working-set lower bound.`);
  }

  const referenceMemory = finite(recipe.reference.perGpuMemoryBytes);
  if (selected.length >= requiredCount && referenceMemory !== null && physicalFloor === null) {
    const totals = selected.map(device => finite(device.totalBytes));
    if (totals.some(value => value === null)) unknowns.push(`The source reference used ${gib(referenceMemory)} per GPU; local GPU capacity was not fully observed.`);
    else if (Math.min(...totals) < referenceMemory) unknowns.push(`The source reference used ${gib(referenceMemory)} per GPU. This source does not establish that the same recipe fits in ${gib(Math.min(...totals))}; Aperture must resolve the exact checkpoint and context before claiming a lower floor.`);
    else matches.push(`Per-GPU physical memory meets or exceeds the ${gib(referenceMemory)} source reference.`);
  }

  let availability = 'UNKNOWN';
  if (selected.length >= requiredCount) {
    const free = selected.map(device => finite(device.freeBytes));
    if (free.every(value => value !== null)) {
      const minFree = Math.min(...free);
      const currentNeed = physicalFloor ?? null;
      if (currentNeed !== null && minFree < currentNeed) availability = 'INSUFFICIENT_CURRENT_HEADROOM';
      else availability = 'OBSERVED_AVAILABLE_CAPACITY';
      if (currentNeed !== null && minFree < currentNeed) cautions.push(`Hardware capacity may qualify, but the smallest currently free GPU headroom is ${gib(minFree)} versus ${gib(currentNeed)} observed working set.`);
    }
  }

  if (recipe.reference.pcieGeneration != null || recipe.reference.pcieWidth != null) {
    const links = selected.map(device => device.pcie || {});
    if (links.every(link => finite(link.generation) !== null && finite(link.width) !== null)) {
      const below = links.some(link => finite(link.generation) < recipe.reference.pcieGeneration || finite(link.width) < recipe.reference.pcieWidth);
      if (below) cautions.push(`The source reference uses PCIe ${recipe.reference.pcieGeneration}.0 x${recipe.reference.pcieWidth}; the observed links are lower. This is a performance/topology difference, not automatically a fit rejection.`);
      else matches.push(`PCIe links meet or exceed the source reference of Gen${recipe.reference.pcieGeneration} x${recipe.reference.pcieWidth}.`);
    } else cautions.push('Per-GPU PCIe generation/width is not fully observed; topology equivalence to the source reference is unproven.');
  }

  let status;
  if (blockers.length) status = 'BLOCKED';
  else if (unknowns.length) status = 'UNKNOWN';
  else if (recipe.evidenceStatus === 'qualified') status = 'QUALIFIED';
  else status = 'CANDIDATE';

  const nextCanary = status === 'BLOCKED' ? 'No canary is admitted until the hard hardware mismatch changes.' :
    status === 'UNKNOWN' ? 'Resolve the exact checkpoint, requested context and runtime, then run Aperture fit assessment before any weight download or model load.' :
    'Resolve the exact checkpoint and context, preserve this recipe as a candidate, and run a bounded native load/performance canary before claiming this machine reproduces the source result.';

  return {
    id: recipe.id,
    title: recipe.title,
    status,
    evidenceStatus: recipe.evidenceStatus,
    model: recipe.model,
    runtime: recipe.runtime,
    requiredGpuCount: requiredCount,
    selectedDevices: selected.map(deviceSummary),
    availability,
    blockers,
    unknowns,
    matches,
    cautions,
    nextCanary,
    source: recipe.source,
    supportingSources: recipe.supportingSources || [],
    claimBoundary: 'Hardware/recipe compatibility only. A source reference is not silently converted into a minimum. No model quality, throughput, architecture support, or successful load is claimed until separately measured.'
  };
}

export function evaluateCatalog(machine, recipes = RECIPE_CATALOG) {
  const results = recipes.map(recipe => evaluateRecipe(machine, recipe));
  const counts = Object.fromEntries(['QUALIFIED', 'CANDIDATE', 'UNKNOWN', 'BLOCKED'].map(status => [status, results.filter(row => row.status === status).length]));
  return {
    schema: 'aperture-recipe-report/1',
    createdAt: now(),
    apertureVersion: VERSION,
    source: RTX6KPRO_SOURCE,
    hardware: {
      platform: machine.platform,
      architecture: machine.architecture,
      nvidia: nvidia(machine).map(deviceSummary)
    },
    counts,
    results,
    execution: 'NOT_RUN',
    permissions: {modelAccess: false, networkModelMetadata: false, download: false, install: false, run: false}
  };
}

export function formatRecipeReport(report) {
  const lines = [
    'APERTURE RECIPE LAB',
    `Source: ${report.source.id}@${report.source.commit.slice(0, 12)}`,
    `QUALIFIED ${report.counts.QUALIFIED} · CANDIDATE ${report.counts.CANDIDATE} · UNKNOWN ${report.counts.UNKNOWN} · BLOCKED ${report.counts.BLOCKED}`,
    ''
  ];
  for (const row of report.results) {
    lines.push(`[${row.status}] ${row.title}`);
    for (const text of row.blockers) lines.push(`  BLOCK: ${text}`);
    for (const text of row.unknowns) lines.push(`  UNKNOWN: ${text}`);
    for (const text of row.matches.slice(0, 2)) lines.push(`  MATCH: ${text}`);
    for (const text of row.cautions.slice(0, 2)) lines.push(`  CAUTION: ${text}`);
    lines.push(`  NEXT: ${row.nextCanary}`, '');
  }
  lines.push('No checkpoint was downloaded, no runtime was installed, and no inference or benchmark was run.');
  return lines.join('\n');
}

export async function recipeReport(ui, options = {}, deps = {}) {
  if (!options.scanApproved) {
    ui.say('Aperture can compare this machine with source-pinned inference recipes. The scan remains local and does not access model files, download weights, install runtimes, or run benchmarks.');
    if (!await ui.confirm('Read the local hardware inventory for recipe matching?')) return {status: 'SCAN_DECLINED'};
  }
  const machine = await (deps.scan || scan)();
  const report = evaluateCatalog(machine, deps.recipes || RECIPE_CATALOG);
  if (options.out) {
    const target = localPath(options.out);
    await writeNew(target, report);
    ui.say(`Recipe report saved to ${target}.`);
  } else (ui.write || ui.say)(formatRecipeReport(report) + '\n');
  return report;
}
