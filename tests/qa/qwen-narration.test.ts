// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateQwenNarration, qwenCacheKey, whisperTokens, loadQwenEvidence, lexicalQwenText, type QwenEvidenceFiles } from '../../src/qa/qwen-narration.ts';
import { validateVoiceProfile, voiceProfileHash, pronunciationMapHash, qwenReferenceControls, type QwenVoiceProfile } from '../../src/quality/voice-profile.ts';
import { validateCurrentNarrationEvidence, validateNarrationCues } from '../../src/qa/narration.ts';
import { ACTIVE_GENERATOR_POLICY } from '../../src/quality/policy.ts';
import { digest, hashFiles } from '../../src/pipeline/stage-state.ts';
import { validVideoSpec } from '../fixtures/input.ts';

const h = (character: string) => character.repeat(64);
const profile: QwenVoiceProfile = { provider: 'qwen3-tts', modelId: 'Qwen3-TTS-12Hz-1.7B-Base', voiceId: 'enhe-magnetic-b-v1', locale: 'zh-CN',
  selectionPath: 'reports/selected-b.json', selectionSha256: h('a'), referenceAudioSha256: h('b') };

function fixture() {
  const spec = structuredClone(validVideoSpec);
  spec.generatorPolicy = structuredClone(ACTIVE_GENERATOR_POLICY);
  spec.audio.voiceProfile = profile; spec.audio.deliveryMode = 'presenter'; spec.audio.pronunciationMap = {};
  spec.scenes = [{ ...spec.scenes[0]!, id: 'first', voiceover: '你好。', actualStartSec: 0, actualEndSec: 1,
    voiceDirection: { purpose: '问候', attitude: '温暖', emphasis: ['你好'], pace: 'steady', pause: 'balanced', visualEvent: '片名出现' } }];
  const cue = { sceneId: 'first', text: '你好。', spokenText: '你好。', start: 0.1, end: 0.8,
    voiceDirection: spec.scenes[0]!.voiceDirection, effectiveProviderControls: qwenReferenceControls(profile, 'presenter') };
  const generator = { provider: 'qwen3-tts', backend: 'qwen3-tts', backendVersion: '0.1.1', model: profile.modelId, configuredModel: profile.modelId,
    voice: profile.voiceId, locale: 'zh-CN', profileHash: voiceProfileHash(profile), sourceMode: 'reference-synthesis',
    frontend: 'qwen3-tts', frontendVersion: '0.1.1', deliveryMode: 'presenter', directionMappingVersion: 'qwen3-reference-v1',
    settings: { referenceAudioSha256: profile.referenceAudioSha256, selectionSha256: profile.selectionSha256, instructApplied: false, speed: 1, pitchSemitones: 0 } };
  const evidence = { schemaVersion: '1.0', timingSource: 'whisper-cpp-asr', qualityRulesSha256: ACTIVE_GENERATOR_POLICY.rulesSha256,
    contextHash: ACTIVE_GENERATOR_POLICY.rulesSha256, audioSha256: h('c'), generator,
    timingEvidence: { path: 'reports/asr-alignment.json', sha256: h('d'), method: 'whisper-cpp-dtw-anchors-v1' }, cues: [cue] };
  const raw = { transcription: [{ offsets: { from: 0, to: 800 }, tokens: [{ text: '你', offsets: { from: 100, to: 400 }, t_dtw: 10 }, { text: '好', offsets: { from: 400, to: 800 }, t_dtw: 40 }] }] };
  const alignment = { schemaVersion: '1.0', status: 'PASS', timingSource: 'whisper-cpp-asr', lexicalMatch: 'MATCH_AFTER_WRITTEN_NORMALIZATION', audioDurationSec: 1, audioSha256: h('c'), copySha256: h('e'),
    selectionSha256: profile.selectionSha256, spokenTextSha256: digest('你好。'), model: { path: '.tools/asr.bin', sha256: h('f') },
    raw: { path: 'reports/asr-raw.json', sha256: h('1') }, command: { path: 'reports/asr-command.json', sha256: h('2') },
    tokens: whisperTokens(raw), cues: [{ sceneId: cue.sceneId, text: cue.text, spokenText: cue.spokenText, start: cue.start, end: cue.end, tokenStart: 0, tokenEnd: 1 }] };
  const modelFiles = [{ sourcePath: 'model.safetensors', path: '.tools/base/model.safetensors', sha256: h('4') }];
  const baseModel = { path: '.tools/base', repoId: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', revision: 'a'.repeat(40),
    sha256: digest(JSON.stringify(modelFiles.map(file => ({ path: file.sourcePath, sha256: file.sha256 })))) };
  const runtime = { config: { model: baseModel, modelManifest: { sha256: h('7') }, authorization: { sha256: h('5') },
    asr: { model: { ...alignment.model }, executable: { path: '.tools/whisper.exe', sha256: h('8') } },
    ffmpeg: { path: '.tools/ffmpeg.exe', sha256: h('9') }, packageLock: { path: '.tools/lock.txt', sha256: h('0') }, seed: 5, generation: { temperature: 0.9 } },
    modelManifest: { status: 'PASS', authorizationSha256: h('5'), metadataSha256: h('6'),
      models: [{ repoId: baseModel.repoId, revision: baseModel.revision, license: 'apache-2.0', fileCount: 1, files: modelFiles }], files: [{ repoId: 'ggerganov/whisper.cpp', ...alignment.model }] },
    authorization: { decision: 'APPROVED', noExternalUpload: true, metadataSha256: h('6') } };
  const files: QwenEvidenceFiles = { alignment, raw, command: { exitCode: 0, command: ['whisper-cli', '--model', '.tools/asr.bin'], audioSha256: h('c'), modelSha256: h('f'), rawSha256: h('1'), identity: { executableSha256: h('8') } },
    selection: { decision: 'APPROVED', selectedVoice: profile.voiceId, rawSha256: profile.referenceAudioSha256, userAnswer: 'Synthetic test approval fixture' }, runtime };
  const synthesisIdentity = { profileHash: voiceProfileHash(profile), selectionSha256: profile.selectionSha256, referenceAudioSha256: profile.referenceAudioSha256,
    scriptSha256: h('3'), copySha256: h('e'), spokenTextSha256: digest('你好。'), pronunciationMapSha256: pronunciationMapHash({}),
    contextHash: ACTIVE_GENERATOR_POLICY.rulesSha256, modelSha256: baseModel.sha256, asrModelSha256: h('f'), sourceMode: 'reference-synthesis',
    sourceAudioSha256: h('c'), seed: 5, settings: generator.settings, synthesisScriptVersion: 'qwen3-production-v1' };
  const generation = { status: 'PASS', timingSource: 'whisper-cpp-asr', durationSec: 1, audioSha256: h('c'), copySha256: h('e'), scriptSha256: h('3'), modelSha256: baseModel.sha256, asrModelSha256: h('f'),
    alignmentSha256: h('d'), generator, sourceMode: 'reference-synthesis', synthesisIdentity, cacheKey: qwenCacheKey(synthesisIdentity),
    crossTextVoiceIdentity: 'NOT_VERIFIED',
    sourceReceipt: { runnerSha256: h('9'), audioSha256: h('c'), sourceMode: 'reference-synthesis', inference: { inferenceCount: 1 },
      identity: structuredClone({ sourceMode: 'reference-synthesis', model: baseModel, seed: 5, generation: runtime.config.generation,
      packageLockSha256: h('0'), profile, text: '你好。', copySha256: h('e'), pronunciation: {} }) },
    runtimeEvidence: { config: { path: 'reports/qwen-runtime-config.json', sha256: h('8') },
      modelManifest: { path: 'reports/qwen-model-files.json', sha256: h('7') }, authorization: { path: 'reports/qwen-authorization.json', sha256: h('5') },
      synthesisRunner: { path: 'reports/qwen-synthesis-runner.py', sha256: h('9') } } };
  return { spec, evidence, files, generation };
}

test('Qwen profile binds the accepted reference without invented Kokoro controls', () => {
  assert.deepEqual(validateVoiceProfile(profile), profile);
  for (const invalid of [{ ...profile, speed: 1 }, { ...profile, voiceId: 'other' }, { ...profile, selectionPath: '../outside' }, { ...profile, selectionSha256: 'invalid' }]) {
    assert.throws(() => validateVoiceProfile(invalid), /Qwen voice profile/);
  }
});

test('Qwen genuine token alignment passes normal cue and current-evidence validation', () => {
  const f = fixture();
  assert.doesNotThrow(() => validateNarrationCues(f.evidence, f.spec, h('c'), 1));
  assert.doesNotThrow(() => validateCurrentNarrationEvidence(f.evidence, f.spec, { generation: f.generation, qwenFiles: f.files, expectedCopySha256: h('e'), expectedScriptSha256: h('3') }));
});

test('Qwen source receipt binds the final audio, source mode and actual inference count', () => {
  const modifications: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.generation.sourceReceipt.audioSha256 = h('9'); },
    f => { f.generation.sourceReceipt.sourceMode = 'reuse-approved-audio'; },
    f => { f.generation.sourceReceipt.identity.sourceMode = 'reuse-approved-audio'; },
    ...[0, 2, -1, 1.5].map(inferenceCount => (f: ReturnType<typeof fixture>) => { f.generation.sourceReceipt.inference.inferenceCount = inferenceCount; }),
    f => { Object.assign(f.generation.sourceReceipt, { inference: undefined }); },
  ];
  for (const change of modifications) {
    const f = fixture(); change(f);
    assert.throws(() => validateQwenNarration(f.evidence, f.spec, f.generation, f.files), /Qwen source receipt/);
  }
});

test('Qwen rejects claimed ASR, changed timestamps, audio, copy, words, model, selection and identity', () => {
  const modifications: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { f.files.command.exitCode = 1; },
    f => { f.files.raw.transcription[0]!.tokens[0]!.t_dtw = 12; },
    f => { f.evidence.cues[0]!.start = 0.12; },
    f => { f.files.alignment.audioSha256 = h('9'); },
    f => { f.files.alignment.copySha256 = h('9'); },
    f => { f.files.alignment.model.sha256 = h('9'); },
    f => { f.files.selection.selectedVoice = 'other' as typeof profile.voiceId; },
    f => { f.files.selection.rawSha256 = h('9'); },
    f => { f.files.raw.transcription[0]!.tokens[0]!.text = '他'; f.files.alignment.tokens = whisperTokens(f.files.raw); },
    f => { f.generation.synthesisIdentity.seed += 1; },
    f => { f.files.runtime.config.model.path = '.tools/other-model'; },
    f => { f.files.runtime.modelManifest.models[0].revision = 'b'.repeat(40); },
    f => { f.files.runtime.authorization.metadataSha256 = h('9'); },
    f => { f.generation.sourceReceipt.identity.seed = 55; },
    f => { f.generation.sourceReceipt.identity.generation.temperature = 0.8; },
  ];
  for (const change of modifications) {
    const f = fixture(); change(f);
    assert.throws(() => validateQwenNarration(f.evidence, f.spec, f.generation, f.files, h('e'), h('3')));
  }
  const f = fixture();
  assert.throws(() => validateQwenNarration(f.evidence, f.spec, f.generation, undefined), /actual ASR evidence/);
});

test('streamed model fingerprints retain the original byte-based cache algorithm', async () => {
  const base = path.resolve('.cache/generator-quality-003/tests'); await mkdir(base, { recursive: true });
  const folder = await mkdtemp(path.join(base, 'stream-hash ')), file = path.join(folder, 'fixture.bin');
  const bytes = Buffer.alloc(2 * 1024 * 1024, 37), extra = { purpose: 'compatibility fixture' };
  await writeFile(file, bytes);
  const expected = createHash('sha256').update(JSON.stringify(extra)).update(file).update(bytes).digest('hex');
  assert.equal(await hashFiles([file], extra), expected);
});

test('Qwen loader re-reads and hashes actual ASR model, raw output, command, selection and reference files', async () => {
  const base = path.resolve('.cache/generator-quality-003/tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'qwen 中文 ')), project = path.join(root, 'projects', 'fixture');
  await mkdir(path.join(project, 'reports'), { recursive: true }); await mkdir(path.join(root, '.tools'));
  const write = async (file: string, value: string) => { await writeFile(file, value); return digest(value); };
  const f = fixture(), localProfile = structuredClone(profile); f.spec.audio.voiceProfile = localProfile;
  const referenceSha256 = await write(path.join(root, 'reference.wav'), 'synthetic file hash fixture');
  localProfile.referenceAudioSha256 = referenceSha256;
  const selection = { ...f.files.selection, rawPath: 'reference.wav', rawSha256: referenceSha256 };
  localProfile.selectionPath = 'selection.json'; localProfile.selectionSha256 = await write(path.join(root, 'selection.json'), JSON.stringify(selection));
  f.files.alignment.model.sha256 = await write(path.join(root, '.tools/asr.bin'), 'synthetic ASR model hash fixture');
  f.files.alignment.raw.sha256 = await write(path.join(project, 'reports/asr-raw.json'), JSON.stringify(f.files.raw));
  const argumentsText = '-m\n.tools/asr.bin\n-f\n.tools/asr-input.wav\n-dtw\nsmall\n-nfa\n--prompt\n中文术语\n';
  Object.assign(f.files.command, { command: ['whisper-cli.exe', '@reports/asr-arguments.txt'], expandedArguments: argumentsText.trimEnd().split('\n'),
    argumentsFile: { path: 'reports/asr-arguments.txt', sha256: await write(path.join(project, 'reports/asr-arguments.txt'), argumentsText) } });
  const runtime = f.files.runtime;
  runtime.config.asr.executable.sha256 = await write(path.join(root, '.tools/whisper.exe'), 'synthetic ASR executable fixture');
  runtime.config.ffmpeg.sha256 = await write(path.join(root, '.tools/ffmpeg.exe'), 'synthetic conversion executable fixture');
  runtime.config.packageLock.sha256 = await write(path.join(root, '.tools/lock.txt'), 'synthetic dependency lock fixture');
  f.generation.sourceReceipt.identity.packageLockSha256 = runtime.config.packageLock.sha256;
  f.files.command.identity.executableSha256 = runtime.config.asr.executable.sha256;
  const inputSha256 = await write(path.join(root, '.tools/asr-input.wav'), 'synthetic converted audio fixture');
  Object.assign(f.files.command, { input: { path: '.tools/asr-input.wav', sha256: inputSha256 }, inputSha256,
    conversion: { exitCode: 0, inputAudioSha256: f.evidence.audioSha256, outputSha256: inputSha256, executableSha256: runtime.config.ffmpeg.sha256 } });
  f.files.alignment.command.sha256 = await write(path.join(project, 'reports/asr-command.json'), JSON.stringify(f.files.command));
  f.evidence.timingEvidence.sha256 = await write(path.join(project, 'reports/asr-alignment.json'), JSON.stringify(f.files.alignment));
  runtime.config.asr.model = { ...f.files.alignment.model };
  runtime.modelManifest.files[0].sha256 = f.files.alignment.model.sha256;
  await mkdir(path.join(root, '.tools/base'));
  runtime.modelManifest.models[0].files[0].sha256 = await write(path.join(root, '.tools/base/model.safetensors'), 'synthetic Base model hash fixture');
  runtime.config.model.sha256 = digest(JSON.stringify(runtime.modelManifest.models[0].files.map((file: { sourcePath: string; sha256: string }) => ({ path: file.sourcePath, sha256: file.sha256 }))));
  f.generation.modelSha256 = runtime.config.model.sha256;
  f.generation.sourceReceipt.identity.model = structuredClone(runtime.config.model);
  f.generation.runtimeEvidence.authorization.sha256 = await write(path.join(project, 'reports/qwen-authorization.json'), JSON.stringify(runtime.authorization));
  runtime.modelManifest.authorizationSha256 = f.generation.runtimeEvidence.authorization.sha256;
  runtime.config.authorization.sha256 = f.generation.runtimeEvidence.authorization.sha256;
  f.generation.runtimeEvidence.modelManifest.sha256 = await write(path.join(project, 'reports/qwen-model-files.json'), JSON.stringify(runtime.modelManifest));
  runtime.config.modelManifest.sha256 = f.generation.runtimeEvidence.modelManifest.sha256;
  f.generation.runtimeEvidence.config.sha256 = await write(path.join(project, 'reports/qwen-runtime-config.json'), JSON.stringify(runtime.config));
  f.generation.runtimeEvidence.synthesisRunner.sha256 = await write(path.join(project, 'reports/qwen-synthesis-runner.py'), '# Synthetic historical runner fixture');
  f.generation.sourceReceipt.runnerSha256 = f.generation.runtimeEvidence.synthesisRunner.sha256;
  await write(path.join(project, 'reports/tts-generation.json'), JSON.stringify(f.generation));
  assert.ok(await loadQwenEvidence(project, f.spec, f.evidence));
  for (const file of [path.join(root, '.tools/asr.bin'), path.join(root, 'selection.json'), path.join(root, 'reference.wav'),
    path.join(root, '.tools/base/model.safetensors'), path.join(project, 'reports/asr-raw.json'), path.join(project, 'reports/asr-command.json'),
    path.join(project, 'reports/asr-arguments.txt'), path.join(project, 'reports/qwen-runtime-config.json'), path.join(project, 'reports/qwen-model-files.json'), path.join(project, 'reports/qwen-authorization.json'),
    path.join(root, '.tools/whisper.exe'), path.join(root, '.tools/ffmpeg.exe'), path.join(root, '.tools/lock.txt'), path.join(root, '.tools/asr-input.wav'), path.join(project, 'reports/qwen-synthesis-runner.py')]) {
    const original = await readFile(file);
    await writeFile(file, 'tampered fixture');
    await assert.rejects(loadQwenEvidence(project, f.spec, f.evidence), /hash changed/);
    await writeFile(file, original);
  }
});

test('ASR retains zero-duration word offsets while requiring real DTW and positive subtitle groups', () => {
  const f = fixture();
  f.files.raw.transcription[0]!.tokens[0]!.offsets.to = 100;
  f.files.raw.transcription[0]!.tokens[1]!.t_dtw = 10;
  f.files.alignment.tokens = whisperTokens(f.files.raw);
  assert.equal(f.files.alignment.tokens[0]!.start, f.files.alignment.tokens[0]!.end);
  assert.doesNotThrow(() => validateQwenNarration(f.evidence, f.spec, f.generation, f.files, h('e'), h('3')));
  f.files.raw.transcription[0]!.tokens[0]!.t_dtw = -1;
  assert.throws(() => whisperTokens(f.files.raw), /actual DTW/);
});

test('subtitle timing follows valid DTW anchors even when unused classic offsets are reversed', () => {
  const raw = { transcription: [{ offsets: { from: 0, to: 1000 }, tokens: [
    { text: '需要', offsets: { from: 500, to: 300 }, t_dtw: 60 },
    { text: '更多', offsets: { from: 500, to: 400 }, t_dtw: 80 },
  ] }] };
  const original = structuredClone(raw);
  assert.deepEqual(whisperTokens(raw, 1), [{ text: '需要', start: .6, end: .8 }, { text: '更多', start: .8, end: 1 }]);
  assert.deepEqual(raw, original, 'original decoder evidence must remain intact');
  raw.transcription[0]!.tokens[1]!.t_dtw = 50;
  assert.throws(() => whisperTokens(raw, 1), /DTW/);
  raw.transcription[0]!.tokens[1]!.t_dtw = 110;
  assert.throws(() => whisperTokens(raw, 1), /inside the audio/);
});

test('only four established written variants normalize; semantic substitutions stay different', () => {
  assert.equal(lexicalQwenText('把想法變成現實，把效率變成價值。'), lexicalQwenText('把想法变成现实，把效率变成价值。'));
  assert.notEqual(lexicalQwenText('原稿'), lexicalQwenText('圆稿'));
  assert.notEqual(lexicalQwenText('恩禾官网'), lexicalQwenText('N核官网'));
  assert.notEqual(lexicalQwenText('两个项目啊'), lexicalQwenText('两个项目'));
});

test('only accepted B may preserve a documented question-final discourse token without changing approved subtitles', () => {
  const f = fixture(), text = '封面和分享图，怎么像两个项目？';
  f.generation.durationSec = 1.4; f.files.alignment.audioDurationSec = 1.4;
  f.spec.scenes[0]!.voiceover = text; f.spec.scenes[0]!.actualEndSec = 1.4;
  f.spec.scenes[0]!.voiceDirection!.emphasis = ['项目'];
  f.files.raw.transcription = [{ offsets: { from: 0, to: 1300 }, tokens:
    ['封', '面', '和', '分享', '图', '怎么', '像', '两', '个', '项', '目', '啊'].map((word, index) => ({ text: word,
      offsets: { from: (index + 1) * 100, to: (index + 2) * 100 }, t_dtw: (index + 1) * 10 })) }];
  f.files.alignment.tokens = whisperTokens(f.files.raw);
  Object.assign(f.evidence.cues[0]!, { text, spokenText: text, start: 0.1, end: 1.3 });
  Object.assign(f.files.alignment.cues[0], { text, spokenText: text, start: 0.1, end: 1.3, tokenStart: 0, tokenEnd: 11 });
  f.evidence.audioSha256 = profile.referenceAudioSha256;
  f.files.alignment.audioSha256 = profile.referenceAudioSha256; f.files.command.audioSha256 = profile.referenceAudioSha256;
  f.generation.audioSha256 = profile.referenceAudioSha256; f.generation.sourceMode = 'reuse-approved-audio';
  Object.assign(f.generation.sourceReceipt, { audioSha256: profile.referenceAudioSha256, sourceMode: 'reuse-approved-audio', inference: { inferenceCount: 0 } });
  f.generation.sourceReceipt.identity.sourceMode = 'reuse-approved-audio';
  Object.assign(f.evidence.generator, { sourceMode: 'reuse-approved-audio', model: 'Qwen3-TTS-12Hz-1.7B-VoiceDesign' });
  f.files.selection.identity = { modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', modelAggregateSha256: h('9'), spokenTextSha256: digest(text) };
  f.generation.modelSha256 = h('9'); f.files.alignment.spokenTextSha256 = digest(text);
  f.generation.sourceReceipt.identity.text = text;
  Object.assign(f.generation.synthesisIdentity, { sourceMode: 'reuse-approved-audio', sourceAudioSha256: profile.referenceAudioSha256,
    spokenTextSha256: digest(text), modelSha256: h('9') });
  f.generation.cacheKey = qwenCacheKey(f.generation.synthesisIdentity);
  Object.assign(f.files.alignment, { lexicalMatch: 'MATCH_WITH_DOCUMENTED_DISCOURSE_OMISSION',
    omittedDiscourseTokens: [{ tokenIndex: 11, text: '啊', reason: 'Synthetic fixture: accepted audio retains its question particle; approved display is unchanged.', reviewerType: 'model', humanReviewed: false }],
    omissionReview: { audioSha256: profile.referenceAudioSha256, rawSha256: f.files.alignment.raw.sha256, selectionSha256: profile.selectionSha256,
      reviewerType: 'model', humanReviewed: false, reason: 'Synthetic fixture; no claim of human transcript review.' } });
  assert.doesNotThrow(() => validateCurrentNarrationEvidence(f.evidence, f.spec, { generation: f.generation, qwenFiles: f.files, expectedCopySha256: h('e'), expectedScriptSha256: h('3') }));
  for (const mutate of [
    (candidate: typeof f) => { candidate.files.alignment.omissionReview.humanReviewed = true; },
    (candidate: typeof f) => { candidate.files.alignment.omissionReview.rawSha256 = h('0'); },
    (candidate: typeof f) => { candidate.files.alignment.omittedDiscourseTokens[0].tokenIndex = 10; },
    (candidate: typeof f) => { candidate.files.alignment.omittedDiscourseTokens[0].text = '项目'; },
    (candidate: typeof f) => { candidate.generation.sourceMode = 'reference-synthesis'; },
    (candidate: typeof f) => { candidate.generation.sourceReceipt.inference.inferenceCount = 1; },
    (candidate: typeof f) => { candidate.files.alignment.lexicalMatch = 'EXACT'; },
  ]) {
    const candidate = structuredClone(f); mutate(candidate);
    assert.throws(() => validateQwenNarration(candidate.evidence, candidate.spec, candidate.generation, candidate.files));
  }
});

test('Whisper terminal padding is capped only at the measured WAV end without changing raw DTW evidence', () => {
  const raw = { transcription: [{ offsets: { from: 0, to: 23000 }, tokens: [
    { text: '价', offsets: { from: 22500, to: 22580 }, t_dtw: 2250 },
    { text: '值', offsets: { from: 22580, to: 23000 }, t_dtw: 2258 },
  ] }] };
  const original = structuredClone(raw);
  assert.deepEqual(whisperTokens(raw, 22.72), [{ text: '价', start: 22.5, end: 22.58 }, { text: '值', start: 22.58, end: 22.72 }]);
  assert.deepEqual(raw, original);
  assert.throws(() => whisperTokens(raw, 22.55), /inside the audio/);
  const f = fixture(); f.files.alignment.audioDurationSec = 0.9;
  assert.throws(() => validateQwenNarration(f.evidence, f.spec, f.generation, f.files), /measured narration WAV duration/);
});
