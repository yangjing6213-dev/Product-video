import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { CheckResult } from './contracts.ts';
import { initialize, inputFor, projectPath, specFor } from './pipeline/project.ts';
import { captureProject, preflight, renderProject, runProject, STAGE_CONTRACT_VERSIONS } from './pipeline/run.ts';
import { compositionQa, writeQa } from './pipeline/qa.ts';
import { requireCreative } from './pipeline/gates.ts';
import { hashFiles, runStage } from './pipeline/stage-state.ts';
import { filesUnder, redact } from './pipeline/tools.ts';

async function cachedPreflight(project: string, resume: boolean): Promise<string[]> {
  const input = await inputFor(project);
  const sources = [
    path.join(project, 'input/product-input.json'),
    ...input.assets.map((asset) => path.join(project, asset.path)).filter(existsSync),
  ];
  const fingerprint = await hashFiles(sources, { version: '1.0' });
  return (await runStage(
    project,
    'preflight',
    fingerprint,
    resume,
    async () => ({ outputs: await preflight(project) }),
    STAGE_CONTRACT_VERSIONS.preflight,
  )).result.outputs;
}

async function cachedCapture(project: string, resume: boolean, suppliedOnly: boolean): Promise<string[]> {
  await cachedPreflight(project, resume);
  const input = await inputFor(project);
  const suppliedAssets = input.assets
    .filter((asset) => !asset.id.startsWith('capture-'))
    .map((asset) => path.join(project, asset.path))
    .filter(existsSync);
  const fingerprint = await hashFiles(suppliedAssets, {
    url: input.product.url,
    suppliedOnly,
    assets: input.assets.filter((asset) => !asset.id.startsWith('capture-')),
  });
  return (await runStage(project, 'capture', fingerprint, resume, async () => ({
    outputs: await captureProject(project, suppliedOnly),
  }), STAGE_CONTRACT_VERSIONS.capture)).result.outputs;
}

async function cachedQa(project: string, resume: boolean): Promise<CheckResult[]> {
  const spec = await specFor(project);
  const creative = await requireCreative(project);
  const warningReview = path.join(project, 'reports/lint-warning-review.json');
  const fingerprint = await hashFiles([
    path.join(project, 'index.html'),
    ...creative,
    ...await filesUnder(path.join(project, 'assets')),
    ...await filesUnder(path.join(project, 'compositions')),
    ...(spec.audio.narrationMode !== 'none'
      ? ['transcript.json', 'reports/voice-report.json', 'reports/narration-cues.json']
          .map((file) => path.join(project, file))
          .filter(existsSync)
      : []),
    ...(existsSync(warningReview) ? [warningReview] : []),
  ]);
  const execute = async () => {
    const checks = await compositionQa(project, spec);
    return {
      checks,
      outputs: [
        path.join(project, 'reports/browser-layout.json'),
        ...['lint', 'validate', 'inspect'].map((label) => path.join(project, `reports/commands/hyperframes-${label}.json`)),
      ],
    };
  };
  let stage = await runStage(project, 'qa', fingerprint, resume, execute, STAGE_CONTRACT_VERSIONS.qa);
  if (!Array.isArray(stage.result.checks)) {
    stage = await runStage(project, 'qa', fingerprint, false, execute, STAGE_CONTRACT_VERSIONS.qa);
  }
  const checks = stage.result.checks as CheckResult[];
  if (stage.cached) await writeQa(project, spec, checks);
  return checks;
}

export async function main(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    input: { type: 'string' }, project: { type: 'string' }, quality: { type: 'string', default: 'draft' }, resume: { type: 'boolean', default: false }, json: { type: 'boolean', default: true }, 'supplied-only': { type: 'boolean', default: false },
  } });
  const action = positionals[0];
  if (!action || action === 'help') { console.log('video init --input FILE | capture|verify-input|qa|render|run --project ID [--resume] [--supplied-only]'); return; }
  if (action === 'init') {
    if (!values.input) throw new Error('--input is required');
    console.log(JSON.stringify({ status: 'PASS', project: await initialize(values.input) })); return;
  }
  if (!values.project) throw new Error('--project is required');
  const project = projectPath(values.project);
  let result: unknown;
  switch (action) {
    case 'verify-input': result = await cachedPreflight(project, values.resume); break;
    case 'capture': result = await cachedCapture(project, values.resume, values['supplied-only']); break;
    case 'qa': result = await cachedQa(project, values.resume); break;
    case 'render':
      if (!['draft', 'high'].includes(values.quality)) throw new Error('--quality must be draft or high');
      result = await renderProject(project, values.quality as 'draft' | 'high', values.resume); break;
    case 'run': result = await runProject(project, values.resume, values['supplied-only']); break;
    default: throw new Error(`Unknown command: ${action}`);
  }
  console.log(JSON.stringify({ status: 'PASS', projectId: values.project, result }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ status: 'FAIL', error: redact(error instanceof Error ? error.message : String(error)) })); process.exitCode = 1; });
}
