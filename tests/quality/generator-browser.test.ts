import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { browserQa } from '../../src/qa/browser.ts';
import { validVideoSpec } from '../fixtures/input.ts';
import { ACTIVE_GENERATOR_POLICY } from '../../src/quality/policy.ts';

test('current portrait QA uses the actual portrait viewport and detects a caption background', async () => {
  const base = path.resolve('.cache/generator-quality-003/tests');
  await mkdir(base, { recursive: true });
  const project = await mkdtemp(path.join(base, 'portrait '));
  const spec = { ...structuredClone(validVideoSpec), generatorPolicy: structuredClone(ACTIVE_GENERATOR_POLICY) };
  spec.output = { ...spec.output, width: 1080, height: 1920, targetDurationSec: 10 };
  spec.scenes = [{ ...spec.scenes[0]!, actualEndSec: 10 }];
  spec.assets = [{ ...spec.assets[0]!, path: 'logo.svg' }];
  spec.brand.fontFamilies = ['Microsoft YaHei', 'Segoe UI'];
  spec.brand.colors = ['#000000', '#FFFFFF', '#0000FF'];
  await writeFile(path.join(project, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="white"/></svg>');
  const html = (background: string) => `<!doctype html><style>*{box-sizing:border-box;margin:0}body{background:#000000;color:#FFFFFF;font-family:'Microsoft YaHei','Segoe UI'}.scene{position:absolute;inset:0}.logo{position:absolute;left:calc(100vw - 200px);top:160px;width:80px;height:50px}h1{position:absolute;left:100px;top:280px;font-size:84px}.caption{position:absolute;left:100px;top:1730px;width:850px;font-size:48px;line-height:66px;background:${background}}</style><section class="scene" id="${spec.scenes[0]!.id}"><img class="logo" src="logo.svg"><h1>真实标题 Title</h1><p class="caption">字幕 Caption</p></section>`;
  await writeFile(path.join(project, 'index.html'), html('#0000FF'));
  const first = await browserQa(project, spec);
  assert.equal(first.find(c => c.id.endsWith('.logo-safe-area'))?.status, 'PASS');
  assert.equal(first.find(c => c.id.endsWith('.caption-background'))?.status, 'FAIL');
  await writeFile(path.join(project, 'index.html'), html('transparent'));
  const second = await browserQa(project, spec);
  assert.equal(second.find(c => c.id.endsWith('.caption-background'))?.status, 'PASS');
  spec.brand.colors.push('#071827');
  await writeFile(path.join(project, 'index.html'), html('transparent') + '<style>.logo{box-shadow:0 4px 8px rgba(7,24,39,.533)}</style>');
  const permittedShadow = await browserQa(project, spec);
  assert.equal(permittedShadow.find(c => c.id.endsWith('.brand-palette'))?.status, 'PASS', 'Alpha must not round the declared RGB to another color');
  await writeFile(path.join(project, 'index.html'), html('transparent') + '<style>.logo{box-shadow:0 4px 8px rgba(200,24,39,.533)}</style>');
  const wrongShadow = await browserQa(project, spec);
  assert.equal(wrongShadow.find(c => c.id.endsWith('.brand-palette'))?.status, 'FAIL');
});

test('runtime motion QA rejects moving labels while the real subject stays still', async () => {
  const base = path.resolve('.cache/generator-quality-003/tests');
  await mkdir(base, { recursive: true });
  const project = await mkdtemp(path.join(base, '真实动作 '));
  const spec = { ...structuredClone(validVideoSpec), generatorPolicy: structuredClone(ACTIVE_GENERATOR_POLICY) };
  spec.output.targetDurationSec = 10;
  spec.scenes = [{ ...spec.scenes[0]!, actualStartSec: 0, actualEndSec: 10, heroFrameSec: 4, assetRefs: ['subject'],
    action: { intent: 'Show the actual result moving into place', primitive: 'object-handoff', subject: { assetId: 'subject' }, beforeState: 'Incoming', afterState: 'In place', startFrame: 0, endFrame: 60, holdFrames: 180 } }];
  spec.assets = [{ ...spec.assets[0]!, id: 'subject', path: 'subject.svg' }];
  spec.brand.fontFamilies = ['Microsoft YaHei', 'Segoe UI'];
  await writeFile(path.join(project, 'subject.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="white"/></svg>');
  const html = (target: string) => `<style>.scene{position:absolute;inset:0}img{position:absolute;left:200px;top:300px;width:800px;height:400px}h1{font-size:90px}</style><section class="scene" id="${spec.scenes[0]!.id}"><h1 id="label">Animated label</h1><img id="subject" data-asset-id="subject" src="subject.svg"></section><script>window.__timelines={main:{seek(t){document.getElementById('${target}').style.transform='translateX('+Math.min(t/2,1)*100+'px)'}}};</script>`;
  await writeFile(path.join(project, 'index.html'), html('label'));
  const bad = await browserQa(project, spec);
  assert.equal(bad.find(check => check.id.endsWith('.observed-state'))?.status, 'FAIL');
  await writeFile(path.join(project, 'index.html'), html('subject'));
  const good = await browserQa(project, spec);
  assert.equal(good.find(check => check.id.endsWith('.observed-state'))?.status, 'PASS');
  assert.equal(good.find(check => check.id.endsWith('.reverse-seek'))?.status, 'PASS');
  for (const hidden of ['#subject{opacity:0;visibility:hidden}', '.scene{opacity:0}', '#subject{left:-3000px}']) {
    await writeFile(path.join(project, 'index.html'), html('subject') + `<style>${hidden}</style>`);
    const invisible = await browserQa(project, spec);
    assert.equal(invisible.find(check => check.id.endsWith('.observed-state'))?.status, 'FAIL', hidden);
    assert.equal(invisible.find(check => check.id.endsWith('.real-subject'))?.status, 'FAIL', hidden);
  }
  spec.scenes[0]!.action = { ...spec.scenes[0]!.action!, primitive: 'reading-hold', endFrame: 1, holdFrames: 180 };
  const fade = '<script>const seekOriginal=window.__timelines.main.seek;window.__timelines.main.seek=t=>{seekOriginal(t);document.querySelector(".scene").style.opacity=String(Math.min(t/.3,1));};</script>';
  await writeFile(path.join(project, 'index.html'), html('label') + fade);
  const readable = await browserQa(project, spec);
  assert.equal(readable.find(check => check.id.endsWith('.observed-state'))?.status, 'PASS', 'A stable reading hold may have a scene entrance');
  await writeFile(path.join(project, 'index.html'), html('label') + fade + '<script>const holdOriginal=window.__timelines.main.seek;window.__timelines.main.seek=t=>{holdOriginal(t);if(t>1)document.querySelector(".scene").style.opacity="0";};</script>');
  const hiddenHold = await browserQa(project, spec);
  assert.equal(hiddenHold.find(check => check.id.endsWith('.observed-state'))?.status, 'FAIL', 'A subject hidden during the reading interval is not readable');
});
