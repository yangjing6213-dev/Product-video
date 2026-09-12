import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, access, copyFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserQa } from '../../src/qa/browser.ts';
import { environment } from '../../src/pipeline/tools.ts';
import { ACTIVE_GENERATOR_POLICY } from '../../src/quality/policy.ts';
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

test('real browser strictly audits a whole author poster ending without legacy overlays', async t => {
  const env = await environment();
  if (!env.HYPERFRAMES_BROWSER_PATH || !await access(env.HYPERFRAMES_BROWSER_PATH).then(() => true, () => false)) {
    t.skip('Local Chrome is required for the author poster regression suite'); return;
  }
  const project = await mkdtemp(path.join(tmpdir(), 'epvs-browser-author-poster-'));
  const spec = structuredClone(validVideoSpec);
  const scene = spec.scenes[0]!;
  spec.projectId = 'author-poster-browser-fixture';
  spec.generatorPolicy = structuredClone(ACTIVE_GENERATOR_POLICY);
  spec.brand = { ...spec.brand, colors:['#000000', '#FFFFFF', '#0000FF'], fontFamilies:['Microsoft YaHei', 'Segoe UI'] };
  spec.authorContacts = { name:'Fixture Author', items:[
    { label:'GitHub', value:'fixture' }, { label:'X / Twitter', value:'@fixture' },
    { label:'网站', value:'fixture.test' }, { label:'微信', value:'Fixture' },
    { label:'邮箱', value:'fixture@example.test' },
  ] };
  spec.audio = { narrationMode:'none', voice:'', externalAudioAssetId:null, musicAssetId:null };
  spec.captions = { enabled:false, maxLines:2, safeAreaPercent:6, style:'transparent' };
  spec.assets = [{ id:'author-poster', type:'image', path:'assets/author-poster.svg', sourceUrl:'owned-test-fixture', license:'owned', required:true, fallbackAssetId:null, width:1500, height:1000 }];
  Object.assign(scene, {
    id:'ending', authorPosterAssetId:'author-poster', recipe:'feature.v1', goal:'Read the whole author poster',
    plannedDurationSec:8, actualStartSec:0, actualEndSec:8, voiceover:'', caption:'',
    onScreenText:['Text is reviewed in the supplied poster image'], assetRefs:['author-poster'], compositionFile:'index.html',
    motionDirection:'stable', heroFrameSec:4, transition:{ type:'crossfade', durationSec:.35 },
    action:{ intent:'Read the supplied author poster', primitive:'reading-hold', subject:{ assetId:'author-poster' }, beforeState:'Readable', afterState:'Still readable', startFrame:0, endFrame:1, holdFrames:239 },
  });
  spec.scenes = [scene];

  const render = async (options: {
    foregroundFit?: 'contain' | 'cover'; foregroundDataId?: string; backgroundSrc?: string;
    foregroundInset?: string; backgroundFit?: 'cover' | 'contain'; backgroundFilter?: string; overlay?: string; globalOverlay?: string; priorCta?: 'valid' | 'missing';
  } = {}) => {
    const width = spec.output.width, height = spec.output.height;
    const foregroundFit = options.foregroundFit ?? 'contain';
    const foregroundDataId = options.foregroundDataId ?? 'author-poster';
    const backgroundSrc = options.backgroundSrc ?? 'assets/author-poster.svg';
    const foregroundInset = options.foregroundInset ?? '0';
    const backgroundFit = options.backgroundFit ?? 'cover';
    const backgroundFilter = options.backgroundFilter ?? 'blur(32px) brightness(.55)';
    const priorScene = spec.scenes.find(item => !item.authorPosterAssetId);
    const prior = priorScene ? `<div id="${priorScene.id}" class="scene"><img class="logo" data-asset-id="brand-logo" src="assets/logo.svg" alt="Brand"><h2>Product evidence</h2>${options.priorCta === 'missing' ? '' : `<p class="primary-cta">${ACTIVE_GENERATOR_POLICY.marketing.screenAction}</p><p class="display-domain">${ACTIVE_GENERATOR_POLICY.marketing.displayDomain}</p>`}</div>` : '';
    await writeFile(path.join(project, 'index.html'), `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}body{background:#000000}
      .scene{position:absolute;inset:0;overflow:hidden;opacity:1;background:#000000}
      .logo{position:absolute;left:150px;top:130px;width:80px;height:50px}h2{position:absolute;left:150px;top:240px;font-size:80px}.primary-cta{position:absolute;left:150px;top:410px;font-size:52px}.display-domain{position:absolute;left:150px;top:500px;font-size:42px}
      .author-poster-image,.author-poster-background{position:absolute;inset:0;width:100%;height:100%;object-position:center}
      .author-poster-background{object-fit:${backgroundFit};filter:${backgroundFilter};transform:scale(1.06)}
      .author-poster-image{object-fit:${foregroundFit};inset:${foregroundInset}}
    </style>${prior}<section class="clip scene-clip"><div id="ending" class="scene author-poster-scene" data-author-poster-asset-id="author-poster" data-scene-goal="Read the whole author poster">
      <img id="ending-poster-background" class="clip author-poster-background" data-background-asset-id="author-poster" src="${backgroundSrc}" alt="" aria-hidden="true">
      <img id="ending-poster" class="clip author-poster-image" data-asset-id="${foregroundDataId}" src="assets/author-poster.svg" alt="作者完整海报">
      ${options.overlay ?? ''}
    </div></section>${options.globalOverlay ?? ''}<script>window.__timelines={main:{seek(){}}}</script>`);
    return browserQa(project, spec);
  };
  const check = (checks: Awaited<ReturnType<typeof render>>, suffix: string) => checks.find(item => item.id === `browser.ending.${suffix}`)?.status;
  const posterChecks = ['poster-asset-binding', 'poster-images-loaded', 'poster-geometry', 'poster-full-image', 'poster-background', 'poster-no-overlays', 'poster-reading-hold'];
  try {
    await mkdir(path.join(project, 'assets'));
    await writeFile(path.join(project, 'assets/author-poster.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000" viewBox="0 0 1500 1000"><rect width="1500" height="1000" fill="#fff"/><text x="100" y="500" font-size="80">Whole author poster</text></svg>');

    await t.test('landscape and portrait poster scenes pass only the scoped whole-poster contract', async () => {
      for (const [width, height] of [[1920, 1080], [1080, 1920]] as const) {
        spec.output = { ...spec.output, width, height, targetDurationSec:8 };
        const checks = await render();
        assert.deepEqual(checks.filter(item => item.status === 'FAIL'), [], JSON.stringify(checks.filter(item => item.status === 'FAIL')));
        for (const id of posterChecks) assert.equal(check(checks, id), 'PASS', `${width}x${height} ${id}`);
        for (const legacy of ['primary-cta', 'author-contacts', 'contact-reading-time']) assert.equal(check(checks, legacy), undefined, legacy);
      }
    });

    await t.test('cropping the supplied foreground or adding old ending DOM fails', async () => {
      spec.output = { ...spec.output, width:1920, height:1080, targetDurationSec:8 };
      const checks = await render({ foregroundFit:'cover', overlay:'<div class="contact-block">Legacy contact overlay</div>' });
      assert.equal(check(checks, 'poster-full-image'), 'FAIL');
      assert.equal(check(checks, 'poster-no-overlays'), 'FAIL');
    });

    await t.test('a visible global caption without scene metadata still fails the poster overlay check', async () => {
      const checks = await render({ globalOverlay:'<p class="caption" style="position:absolute;left:100px;top:100px;font-size:42px;color:#fff">Unexpected caption</p>' });
      assert.equal(check(checks, 'poster-no-overlays'), 'FAIL');
    });

    await t.test('wrong binding, unloaded background and inset foreground fail independently', async () => {
      const checks = await render({ foregroundDataId:'other-poster', backgroundSrc:'assets/missing.svg', foregroundInset:'10px' });
      assert.equal(check(checks, 'poster-asset-binding'), 'FAIL');
      assert.equal(check(checks, 'poster-images-loaded'), 'FAIL');
      assert.equal(check(checks, 'poster-geometry'), 'FAIL');
    });

    await t.test('unblurred contain background and a moving action cannot pass as a reading poster', async () => {
      scene.action = { ...scene.action!, primitive:'state-change' };
      const checks = await render({ backgroundFit:'contain', backgroundFilter:'none' });
      assert.equal(check(checks, 'poster-background'), 'FAIL');
      assert.equal(check(checks, 'poster-reading-hold'), 'FAIL');
      scene.action = { ...scene.action, primitive:'reading-hold' };
    });

    await t.test('a whole author poster shorter than six seconds fails its reading hold', async () => {
      Object.assign(scene, { plannedDurationSec:5, actualStartSec:0, actualEndSec:5, heroFrameSec:2.5,
        action:{ ...scene.action!, endFrame:1, holdFrames:149 } });
      spec.output = { ...spec.output, width:1920, height:1080, targetDurationSec:5 };
      assert.equal(check(await render(), 'poster-reading-hold'), 'FAIL');
      Object.assign(scene, { plannedDurationSec:8, actualStartSec:0, actualEndSec:8, heroFrameSec:4,
        action:{ ...scene.action!, endFrame:1, holdFrames:239 } });
      spec.output = { ...spec.output, targetDurationSec:8 };
    });

    await t.test('a multi-scene film keeps the approved CTA on its last non-poster scene', async () => {
      const productScene = structuredClone(validVideoSpec.scenes[0]!);
      Object.assign(productScene, {
        id:'product', plannedDurationSec:8, actualStartSec:0, actualEndSec:8, voiceover:'', caption:'', assetRefs:['brand-logo'], heroFrameSec:4,
        action:{ intent:'Read product evidence', primitive:'reading-hold', subject:{ assetId:'brand-logo' }, beforeState:'Readable', afterState:'Still readable', startFrame:0, endFrame:1, holdFrames:239 },
      });
      Object.assign(scene, { actualStartSec:8, actualEndSec:16, heroFrameSec:12 });
      spec.output = { ...spec.output, width:1920, height:1080, targetDurationSec:16 };
      spec.assets = [
        { id:'brand-logo', type:'logo', path:'assets/logo.svg', sourceUrl:'owned-test-fixture', license:'owned', required:true, fallbackAssetId:null },
        { id:'author-poster', type:'image', path:'assets/author-poster.svg', sourceUrl:'owned-test-fixture', license:'owned', required:true, fallbackAssetId:null, width:1500, height:1000 },
      ];
      spec.scenes = [productScene, scene];
      await writeFile(path.join(project, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="50"><rect width="80" height="50" fill="#fff"/></svg>');
      const valid = await render({ priorCta:'valid' });
      assert.equal(valid.find(item => item.id === 'browser.product.primary-cta')?.status, 'PASS');
      assert.equal(valid.find(item => item.id === 'browser.product.author-contacts'), undefined);
      const missing = await render({ priorCta:'missing' });
      assert.equal(missing.find(item => item.id === 'browser.product.primary-cta')?.status, 'FAIL');
    });
  } finally { await rm(project, { recursive:true, force:true }); }
});
