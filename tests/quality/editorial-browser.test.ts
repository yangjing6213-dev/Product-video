// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { browserQa } from '../../src/qa/browser.ts';
import { validVideoSpec } from '../fixtures/input.ts';

test('browser QA catches text fitting its own box but clipped by a rounded card ancestor', async t => {
  const base=path.resolve('.cache/editorial-browser-tests');
  await mkdir(base,{recursive:true});
  const project=await mkdtemp(path.join(base,'clipping-'));
  t.after(async()=>{assert.equal(path.dirname(project),base);assert.match(path.basename(project),/^clipping-/);await rm(project,{recursive:true});});
  await mkdir(path.join(project,'reports'),{recursive:true});
  const spec=structuredClone(validVideoSpec);
  delete spec.generatorPolicy;
  spec.brand.fontFamilies=['Arial'];
  spec.audio.narrationMode='none';
  spec.captions.enabled=false;
  spec.scenes=spec.scenes.slice(0,1);
  const scene=spec.scenes[0]!;
  scene.actualStartSec=0;scene.actualEndSec=8;scene.heroFrameSec=2;
  const fixture=(height:number)=>`<!DOCTYPE html><html><body style="margin:0"><div class="scene" id="${scene.id}" style="position:relative;width:1920px;height:1080px"><div style="position:absolute;left:100px;top:100px;width:600px;height:${height}px;overflow:hidden;border-radius:20px"><p style="position:absolute;top:70px;left:20px;margin:0;font:42px/1.5 Arial">Complete contact line</p></div></div><script>window.__timelines={main:{seek(){}}}</script></body></html>`;
  await writeFile(path.join(project,'index.html'),fixture(100));
  const clipped=await browserQa(project,spec);
  assert.equal(clipped.find(c=>c.id===`browser.${scene.id}.text-overflow`)?.status,'PASS');
  assert.equal(clipped.find(c=>c.id===`browser.${scene.id}.text-ancestor-clipping`)?.status,'FAIL');
  await writeFile(path.join(project,'index.html'),fixture(180));
  const fitting=await browserQa(project,spec);
  assert.equal(fitting.find(c=>c.id===`browser.${scene.id}.text-ancestor-clipping`)?.status,'PASS');
});
