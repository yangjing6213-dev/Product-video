import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import type { CheckResult, VideoSpec } from '../contracts.ts';
import { validateQaReport } from '../contracts.ts';
import { checkAssets, checkSpec } from '../qa/checks.ts';
import { browserQa } from '../qa/browser.ts';
import { warningChecks, type CliFinding, type WarningReview } from '../qa/warnings.ts';
import { atomicJson, exists } from './stage-state.ts';
import { digest } from './stage-state.ts';
import { ensureSuccess, filesUnder, hyperframes, recordCommand } from './tools.ts';
import { checkNarrationComposition, validateCurrentNarrationEvidence, validateNarrationCues, validatePhraseTranscript, validateTranscriptTiming } from '../qa/narration.ts';
import { assertApprovedTranscript } from '../quality/copy.ts';
import { checkGeneratorSpec } from '../quality/policy.ts';
import { isActiveGeneratorPolicy } from '../quality/policy.ts';
import { assertGeneratorSnapshot } from './generator.ts';
import { loadQwenEvidence } from '../qa/qwen-narration.ts';
import { narrationEvidenceContext } from './voice-reuse.ts';

export async function writeQa(project: string, spec: VideoSpec, checks: CheckResult[], warnings: string[] = []): Promise<string> {
  warnings = [...new Set([...warnings, ...checks.filter(c => c.id.includes('.warning.') || c.id.endsWith('.deprecation')).map(c => c.message)])];
  const report = { schemaVersion: '1.0', projectId: spec.projectId, generatedAt: new Date().toISOString(), status: checks.some(c => c.status === 'FAIL') ? 'FAIL' : 'PASS', checks, warnings, artifacts: { spec: 'video-spec.json' } };
  validateQaReport(report);
  const file = path.join(project, 'reports/qa-report.json');
  await atomicJson(file, report);
  await writeFile(path.join(project, 'reports/qa-report.md'), `# ${spec.projectId} QA\n\nStatus: ${report.status}\n\n${checks.map(c => `- ${c.id}: ${c.status} — ${c.message}`).join('\n')}\n\n${warnings.map(w => `- Warning: ${w}`).join('\n')}\n`);
  return file;
}
export async function sourceChecks(project: string, spec: VideoSpec): Promise<CheckResult[]> {
  const expectedPolicy = spec.generatorPolicy && !isActiveGeneratorPolicy(spec.generatorPolicy)
    ? await assertGeneratorSnapshot(project)
    : undefined;
  const checks = [...checkSpec(spec), ...await checkAssets({ ...spec }, project), ...checkGeneratorSpec(spec, expectedPolicy)];
  const html = (await filesUnder(project)).filter(f => (f === path.join(project, 'index.html') || f.startsWith(path.join(project, 'compositions') + path.sep)) && f.endsWith('.html'));
  const sources = await Promise.all(html.map(file => readFile(file, 'utf8')));
  const combined = sources.join('\n');
  checks.push({ id: 'composition-exists', status: await exists(path.join(project, 'index.html')) ? 'PASS' : 'FAIL', message: 'Root index.html required' });
  checks.push({ id: 'deterministic', status: /Math\.random\s*\(|Date\.now\s*\(|repeat\s*:\s*-1|setInterval\s*\(/.test(combined) ? 'FAIL' : 'PASS', message: 'No randomness, wall-clock or infinite animation' });
  checks.push({ id: 'no-private-paths', status: /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|file:\/\/|(?:api[_-]?key|token|cookie)\s*[:=]\s*['"][^'"]+/i.test(combined) ? 'FAIL' : 'PASS', message: 'Composition contains no local absolute path or credential assignments' });
  const design = await readFile(path.join(project, 'DESIGN.md'), 'utf8');
  const known = spec.brand.colors.map(c => c.toLowerCase());
  const used = [...combined.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0].toLowerCase());
  checks.push({ id: 'brand-palette-declarations', status: known.every(c => design.toLowerCase().includes(c)) && used.every(c => known.includes(c)) ? 'PASS' : 'FAIL', message: 'Spec palette is recorded in DESIGN.md and six-digit source colors match it; computed CSS palette is independently checked by browser.*.brand-palette' });
  if (spec.audio.narrationMode !== 'none') {
    try {
      const audioAsset = spec.audio.narrationMode === 'external-audio'
        ? spec.assets.find(asset => asset.id === spec.audio.externalAudioAssetId)?.path
        : 'narration.wav';
      if (!audioAsset) throw new Error('Narration audio asset is not declared');
      const audioFile = path.join(project, audioAsset);
      const transcriptFile = path.join(project, 'transcript.json');
      const voiceReportFile = path.join(project, 'reports/voice-report.json');
      const [audioBytes, transcriptBytes, voiceReportBytes] = await Promise.all([
        readFile(audioFile),
        readFile(transcriptFile),
        readFile(voiceReportFile),
      ]);
      const report = JSON.parse(voiceReportBytes.toString('utf8')) as Record<string, unknown>;
      const durationSec = Number(report.durationSec);
      if (report.status !== 'PASS' || !Number.isFinite(durationSec) || durationSec <= 0 || report.audioSha256 !== digest(audioBytes) || report.transcriptSha256 !== digest(transcriptBytes)) {
        throw new Error('Voice report does not bind the current narration audio and transcript');
      }
      const transcript = validateTranscriptTiming(JSON.parse(transcriptBytes.toString('utf8')) as unknown, durationSec);
      const approvedCopy = await assertApprovedTranscript(path.resolve(project, '../..'), project, spec, transcript);
      const cueFile = path.join(project, 'reports/narration-cues.json');
      const cueBytes = await exists(cueFile) ? await readFile(cueFile) : null;
      const cues = cueBytes
        ? validateNarrationCues(JSON.parse(cueBytes.toString('utf8')) as unknown, spec, digest(audioBytes), durationSec)
        : null;
      if (isActiveGeneratorPolicy(spec.generatorPolicy) && !cues) throw new Error('Current narration requires bound provider or ASR cue evidence; a transcript alone does not prove ASR ran');
      if (cues) {
        const cueEvidence = JSON.parse(cueBytes!.toString('utf8')) as unknown;
        validatePhraseTranscript(transcript, cues);
        const timingBytes = cues.timingEvidence ? await readFile(path.join(project, cues.timingEvidence.path)) : null;
        if (cues.timingEvidence && digest(timingBytes!) !== cues.timingEvidence.sha256) throw new Error('Provider timing evidence hash changed');
        const generationFile = path.join(project, 'reports/tts-generation.json');
        const qwenFiles = await loadQwenEvidence(project, spec, cueEvidence);
        const context = await narrationEvidenceContext(project, spec, approvedCopy.copySha256);
        validateCurrentNarrationEvidence(cueEvidence, context.spec, {
          generation: await exists(generationFile) ? JSON.parse(await readFile(generationFile, 'utf8')) as unknown : undefined,
          providerTiming: timingBytes ? JSON.parse(timingBytes.toString('utf8')) as unknown : undefined,
          expectedCopySha256: context.copySha256,
          expectedScriptSha256: context.scriptSha256,
          qwenFiles,
        });
        if (qwenFiles && (report.asrTextMatch !== qwenFiles.alignment.lexicalMatch
            || !isDeepStrictEqual(report.asrOmittedDiscourseTokens, qwenFiles.alignment.omittedDiscourseTokens ?? []))) {
          throw new Error('Voice report must retain the documented ASR text difference review');
        }
        if (
          report.cuesSha256 !== digest(cueBytes!) ||
          report.timingSource !== cues.timingSource ||
          report.transcriptGranularity !== 'phrase' ||
          report.transcriptSource !== (cues.timingSource === 'whisper-cpp-asr' ? 'whisper-cpp-phrase-alignment' : cues.timingSource === 'provider-phoneme-timing' ? 'provider-phoneme-sentence-alignment' : 'measured-tts-segments') ||
          report.asrStatus !== (cues.timingSource === 'whisper-cpp-asr' ? 'PASS' : 'NOT_RUN')
        ) throw new Error('Voice report does not bind or truthfully describe measured phrase cues');
      } else if (
        report.timingSource !== 'whisper-cpp-asr' ||
        report.transcriptGranularity !== 'word' ||
        report.transcriptSource !== 'whisper-cpp-asr' ||
        report.asrStatus !== 'PASS'
      ) {
        throw new Error('Voice report does not identify its word-level ASR evidence');
      }
      checks.push({ id: 'narration.evidence', status: 'PASS', message: report.asrTextMatch
        ? `Audio and actual ASR phrase boundaries are hash-bound; text comparison: ${report.asrTextMatch}. Any model-reviewed discourse omission remains explicit and is not a human transcript approval.`
        : cues ? 'Audio, phrase cues and normalized phrase transcript are hash-bound and valid' : 'Audio and ASR transcript are hash-bound and valid' });
      checks.push(...checkNarrationComposition(combined, spec, cues, durationSec, transcript));
    } catch (error) {
      checks.push({ id: 'narration.evidence', status: 'FAIL', message: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const scene of spec.scenes) {
    checks.push({ id: `composition-${scene.id}`, status: await exists(path.join(project, scene.compositionFile)) ? 'PASS' : 'FAIL', message: `Scene composition exists: ${scene.compositionFile}` });
  }
  return checks;
}
export async function compositionQa(project: string, spec: VideoSpec): Promise<CheckResult[]> {
  const checks = await sourceChecks(project, spec);
  await writeQa(project, spec, checks);
  if (checks.some(c => c.status === 'FAIL')) throw new Error('Source/input QA failed; see reports/qa-report.json');
  checks.push(...await browserQa(project, spec));
  await writeQa(project, spec, checks);
  if (checks.some(c => c.status === 'FAIL')) throw new Error('Browser layout QA failed; see reports/browser-layout.json');
  for (const [label, args] of [
    ['lint', ['lint', project, '--json']],
    ['validate', ['validate', project]],
    ['inspect', ['inspect', project, '--json', '--samples', '15', '--strict']],
  ] as const) {
    const result = await hyperframes([...args]);
    await recordCommand(project, `hyperframes-${label}`, result);
    checks.push({ id: `hyperframes-${label}`, status: result.exitCode === 0 ? 'PASS' : 'FAIL', message: `Actual CLI exit ${result.exitCode}; reports/commands/hyperframes-${label}.json` });
    const aliasNotice = `'hyperframes ${label}' is deprecated and will be removed in a future release. Use 'hyperframes check' instead.`;
    if (result.stderr.includes(aliasNotice)) {
      checks.push({ id: `hyperframes-${label}.deprecation`, status: 'PASS', message: `${aliasNotice} Reviewed: this pinned 0.8.33 alias still executes the requested check; exit status and runtime findings are evaluated separately. Migrate the command when upgrading the pinned dependency.` });
    }
    if (label !== 'validate' && result.exitCode === 0) {
      const parsed = JSON.parse(result.stdout) as { findings?: CliFinding[]; issues?: CliFinding[]; warningCount?: number; truncated?: boolean };
      const findings = (parsed.findings ?? parsed.issues ?? []).map(f => ({ ...f, ...(f.file ? { file: path.relative(project, path.resolve(project, f.file)).replaceAll('\\', '/') } : {}) }));
      const reviewFile = path.join(project, 'reports/lint-warning-review.json');
      const reviews = label === 'lint' && await exists(reviewFile) ? JSON.parse(await readFile(reviewFile, 'utf8')).reviews as WarningReview[] : [];
      checks.push(...warningChecks(label, findings, reviews));
      if (parsed.truncated || (parsed.warningCount ?? 0) > findings.filter(f => f.severity === 'warning').length) {
        checks.push({ id: `hyperframes-${label}.warning.incomplete`, status: 'FAIL', message: 'CLI did not provide every warning for individual review' });
      }
    }
    await writeQa(project, spec, checks);
    ensureSuccess(result, `HyperFrames ${label}`);
    if (checks.some(c => c.status === 'FAIL')) throw new Error(`Unreviewed HyperFrames ${label} findings`);
    // CLI warnings need individual review, even when the CLI exits successfully.
    if (label === 'validate' && /(?:contrast warnings|⚠)/i.test(result.stdout + result.stderr)) {
      checks.push({ id: 'validate-warnings', status: 'FAIL', message: 'Runtime warnings require repair or a specific reviewed justification' });
      await writeQa(project, spec, checks); throw new Error('Unreviewed HyperFrames validate warnings');
    }
  }
  return checks;
}
