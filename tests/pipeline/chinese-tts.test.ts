import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { command, REPO } from '../../src/pipeline/tools.ts';

test('Chinese TTS sample timing and exclusive publication regression tests', async t => {
  const python = path.join(REPO,'.tools/tts-venv/Scripts/python.exe');
  if (!await access(python).then(()=>true,()=>false)) { t.skip('Repository-local Chinese TTS backend required'); return; }
  const result = await command(python,['-X','utf8',path.join(REPO,'scripts/test_synthesize_zh.py')]);
  assert.equal(result.exitCode,0,result.stderr);
  assert.match(result.stderr,/Ran 7 tests/);
});

test('installed Chinese backend generates real hash-bound WAV and preserves it on rerun', async t => {
  const python = path.join(REPO,'.tools/tts-venv/Scripts/python.exe');
  if (!await access(python).then(()=>true,()=>false)) { t.skip('Repository-local Chinese TTS backend required'); return; }
  const project = path.join(REPO,'projects',`tts-test-${randomUUID()}`);
  await mkdir(project);
  const projectId = path.basename(project);
  const text = '从真实任务出发，找到合适的人工智能工具。';
  try {
    await mkdir(path.join(project,'input'));
    await writeFile(path.join(project,'video-spec.json'),JSON.stringify({output:{targetDurationSec:5},scenes:[{id:'scene-01',actualStartSec:0,actualEndSec:5,voiceover:text}]}));
    await writeFile(path.join(project,'input/narration-script.json'),JSON.stringify({scenes:[{sceneId:'scene-01',captionSegments:[{text}]}]}));
    const args = ['-X','utf8',path.join(REPO,'scripts/synthesize-zh.py'),projectId];
    const first = await command(python,args,{timeoutMs:120000});
    assert.equal(first.exitCode,0,first.stderr);
    const audio = await readFile(path.join(project,'assets/narration.wav'));
    assert.equal(audio.toString('ascii',0,4),'RIFF');
    assert.equal(audio.toString('ascii',8,12),'WAVE');
    const sha = createHash('sha256').update(audio).digest('hex');
    const evidence = JSON.parse(await readFile(path.join(project,'reports/narration-cues.json'),'utf8'));
    const generation = JSON.parse(await readFile(path.join(project,'reports/tts-generation.json'),'utf8'));
    assert.equal(evidence.audioSha256,sha);
    assert.equal(generation.audioSha256,sha);
    assert.equal(generation.durationSec,5);
    assert.ok(generation.peak>0.05 && generation.peak<0.99);
    assert.equal(evidence.cues[0].text,text);
    assert.ok(evidence.cues[0].start>0 && evidence.cues[0].end<5);
    assert.ok(generation.segments[0].phonemeTimings.length>0);
    assert.equal(generation.asrStatus,'NOT_RUN');
    const second = await command(python,args,{timeoutMs:120000});
    assert.notEqual(second.exitCode,0);
    assert.match(second.stderr,/already exists/);
    assert.equal(createHash('sha256').update(await readFile(path.join(project,'assets/narration.wav'))).digest('hex'),sha);
  } finally {
    const resolved = path.resolve(project);
    assert.ok(resolved.startsWith(path.join(REPO,'projects')+path.sep) && path.basename(resolved).startsWith('tts-test-'));
    await rm(resolved,{recursive:true,force:true});
  }
});
