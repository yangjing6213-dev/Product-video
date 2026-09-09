import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, access, copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserQa } from '../../src/qa/browser.ts';
import { environment } from '../../src/pipeline/tools.ts';
import { validVideoSpec } from '../fixtures/input.ts';

test('real browser rejects layout and brand counterexamples', async t => {
  const env = await environment();
  if (!env.HYPERFRAMES_BROWSER_PATH || !await access(env.HYPERFRAMES_BROWSER_PATH).then(() => true, () => false)) {
    t.skip('Local Chrome is required for the real DOM/font regression suite'); return;
  }
  const project = await mkdtemp(path.join(tmpdir(), 'epvs-browser-'));
  const spec = structuredClone(validVideoSpec);
  spec.scenes = [spec.scenes[0]!];
  spec.brand.colors = ['#000000', '#FFFFFF', '#0000FF'];
  spec.brand.fontFamilies = ['Microsoft YaHei', 'Segoe UI'];
  spec.assets = [{ ...spec.assets[0]!, path: 'logo.svg' }];
  const base = `*{box-sizing:border-box;margin:0}body{background:#000000;color:#FFFFFF;font-family:'Microsoft YaHei','Segoe UI',sans-serif}.scene{position:absolute;inset:0}.logo{position:absolute;left:150px;top:90px;width:80px;height:50px}h1{position:absolute;left:150px;top:200px;font-size:60px}p{font-size:24px;position:absolute;left:150px;top:350px}.caption{top:900px;line-height:32px}.label{position:absolute;left:150px;top:800px;font-size:16px}`;
  const run = async (css = '', extra = '', caption = '<p class="caption">字幕 Caption</p>') => {
    await writeFile(path.join(project, 'index.html'), `<!doctype html><style>${base}${css}</style><section class="scene" id="${spec.scenes[0]!.id}"><img class="logo" src="logo.svg"><h1>真实标题 Title</h1><p>正文 Body</p><span class="label" data-text-role="label">标签 Label</span>${caption}${extra}</section>`);
    return browserQa(project, spec);
  };
  const status = (checks: Awaited<ReturnType<typeof run>>, suffix: string) => checks.find(c => c.id.endsWith(`.${suffix}`))?.status;
  try {
    await writeFile(path.join(project, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="white"/></svg>');
    await t.test('valid body, 16px labels, declared fonts and palette pass', async () => {
      const checks = await run();
      assert.deepEqual(checks.filter(c => c.status === 'FAIL'), []);
    });
    await t.test('disabled captions do not require a rendered caption in a narration-free project', async () => {
      spec.captions.enabled = false;
      const checks = await run('', '', '');
      assert.equal(status(checks, 'caption-lines'), 'PASS');
      spec.captions.enabled = true;
    });
    await t.test('18px body fails even when labels are allowed at 16px', async () => {
      assert.equal(status(await run('p{font-size:18px}'), 'minimum-type'), 'FAIL');
    });
    await t.test('all logo asset uses must be safe, regardless of class', async () => {
      for (const className of ['end-logo', 'source-logo', 'arbitrary-class']) {
        const checks = await run(`.${className}{position:absolute;left:0;top:500px;width:80px;height:50px}`, `<img class="${className}" src="logo.svg">`);
        assert.equal(status(checks, 'logo-safe-area'), 'FAIL', className);
      }
    });
    await t.test('computed palette catches rgb, hsl, variables and alpha hex', async () => {
      for (const value of ['rgb(255,0,0)', 'hsl(0 100% 50%)', 'var(--unregistered)', '#FF000080']) {
        const checks = await run(`:root{--unregistered:#FF0000}p{color:${value}}`);
        assert.equal(status(checks, 'brand-palette'), 'FAIL', value);
      }
    });
    await t.test('a missing declared font cannot pass through browser fallback', async () => {
      spec.brand.fontFamilies = ['Microsoft YaHei', 'EPVS Definitely Missing Font 9012'];
      assert.equal(status(await run(), 'font'), 'FAIL');
      spec.brand.fontFamilies = ['Microsoft YaHei', 'Segoe UI'];
    });
    await t.test('actual off-brand font fails even when declared fonts exist', async () => {
      assert.equal(status(await run('p{font-family:"Courier New",monospace}'), 'font'), 'FAIL');
    });
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('real browser audits every narrated caption cue through forward and reverse GSAP seeks', async t => {
  const env = await environment();
  if (!env.HYPERFRAMES_BROWSER_PATH || !await access(env.HYPERFRAMES_BROWSER_PATH).then(() => true, () => false)) {
    t.skip('Local Chrome is required for the narrated caption regression suite'); return;
  }
  const project = await mkdtemp(path.join(tmpdir(), 'epvs-browser-narration-'));
  const spec = structuredClone(validVideoSpec);
  spec.scenes = [spec.scenes[0]!];
  spec.scenes[0]!.voiceover = '第一句。第二句。';
  spec.audio.narrationMode = 'external-audio';
  spec.audio.externalAudioAssetId = 'narration';
  spec.brand.colors = ['#000000', '#FFFFFF', '#0000FF'];
  spec.brand.fontFamilies = ['Microsoft YaHei', 'Segoe UI'];
  spec.assets = [
    { ...spec.assets[0]!, path: 'logo.svg' },
    { id:'narration', type:'audio', path:'assets/narration.wav', sourceUrl:'', license:'owned', required:true, fallbackAssetId:null },
  ];
  const validCues = [
    { sceneId: spec.scenes[0]!.id, text: '第一句。', start: 0.3, end: 2.2 },
    { sceneId: spec.scenes[0]!.id, text: '第二句。', start: 2.4, end: 4.8 },
  ];
  const silentWav = () => {
    const sampleRate = 48_000;
    const samples = sampleRate;
    const dataBytes = samples * 2;
    const wav = Buffer.alloc(44 + dataBytes);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + dataBytes, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(dataBytes, 40);
    return wav;
  };
  const render = async (
    cues = validCues,
    options: { omitIndex?: number; wrongTextIndex?: number } = {},
  ) => {
    const captionNodes = cues.map((cue, index) => options.omitIndex === index ? '' : `<p class="caption narration-caption" id="narration-caption-${index}" data-caption-start="${cue.start}" data-caption-end="${cue.end}">${options.wrongTextIndex === index ? '错误字幕。' : cue.text}</p>`).join('');
    await writeFile(path.join(project, 'index.html'), `<!doctype html>
      <style>
        *{box-sizing:border-box;margin:0}body{background:#000000;color:#FFFFFF;font-family:'Microsoft YaHei','Segoe UI',sans-serif}
        .scene{position:absolute;inset:0}.logo{position:absolute;left:150px;top:90px;width:80px;height:50px}
        h1{position:absolute;left:150px;top:200px;font-size:60px}.caption-stack{position:absolute;left:300px;top:880px;width:1100px;height:90px}
        .caption{position:absolute;inset:0;font-size:28px;line-height:36px;opacity:0}.media-crop{position:absolute;left:150px;top:350px;width:800px;height:400px}
      </style>
      <script src="gsap.min.js"></script>
      <section class="scene" id="${spec.scenes[0]!.id}"><img class="logo" src="logo.svg"><h1>真实标题</h1><div class="media-crop"></div><div class="caption-stack">${captionNodes}</div></section>
      <audio id="narration" src="assets/narration.wav" preload="metadata"></audio>
      <script>
        var NARRATION_CUES = ${JSON.stringify(cues)};
        const timeline = gsap.timeline({paused:true});
        NARRATION_CUES.forEach((cue,index) => {
          const caption = document.getElementById('narration-caption-' + index);
          if (!caption) return;
          timeline.set(caption,{opacity:1},cue.start).set(caption,{opacity:0},cue.end);
        });
        window.__timelines = {main:timeline};
      </script>`);
    return browserQa(project, spec);
  };
  const check = (checks: Awaited<ReturnType<typeof render>>, id: string) => checks.find(item => item.id === id)?.status;
  try {
    await writeFile(path.join(project, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="white"/></svg>');
    await mkdir(path.join(project, 'assets'));
    await writeFile(path.join(project, 'assets/narration.wav'), silentWav());
    await copyFile(path.join(process.cwd(), 'node_modules/gsap/dist/gsap.min.js'), path.join(project, 'gsap.min.js'));

    await t.test('valid cues pass midpoint, boundaries, layout and reverse seeks', async () => {
      const checks = await render();
      const audioCheck = checks.find(item => item.id === 'browser.narration.audio');
      assert.equal(audioCheck?.status, 'PASS', JSON.stringify(audioCheck));
      assert.equal(check(checks, 'browser.resources'), 'PASS');
      assert.equal(check(checks, 'browser.narration.structure'), 'PASS');
      assert.equal(check(checks, 'browser.narration.timing'), 'PASS');
      for (const index of [0, 1]) {
        for (const suffix of ['midpoint', 'boundaries', 'reverse-seek', 'lines', 'safe-area']) {
          assert.equal(check(checks, `browser.narration.cue-${index}.${suffix}`), 'PASS', `${index}.${suffix}`);
        }
      }
    });

    await t.test('a missing rendered cue fails structure and its midpoint audit', async () => {
      const checks = await render(validCues, { omitIndex: 1 });
      assert.equal(check(checks, 'browser.narration.structure'), 'FAIL');
      assert.equal(check(checks, 'browser.narration.cue-1.midpoint'), 'FAIL');
    });

    await t.test('overlapping authored cue times fail timing and visibility', async () => {
      const overlapping = structuredClone(validCues);
      overlapping[1]!.start = 2;
      const checks = await render(overlapping);
      assert.equal(check(checks, 'browser.narration.timing'), 'FAIL');
      assert.equal(check(checks, 'browser.narration.cue-0.midpoint'), 'PASS');
      assert.equal(check(checks, 'browser.narration.cue-1.boundaries'), 'FAIL');
    });

    await t.test('rendered text drift fails structure and midpoint audit', async () => {
      const checks = await render(validCues, { wrongTextIndex: 0 });
      assert.equal(check(checks, 'browser.narration.structure'), 'FAIL');
      assert.equal(check(checks, 'browser.narration.cue-0.midpoint'), 'FAIL');
    });
  } finally { await rm(project, { recursive: true, force: true }); }
});
