import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import type { CheckResult, VideoSpec } from '../contracts.ts';
import { checkSafeArea } from './checks.ts';
import { environment } from '../pipeline/tools.ts';
import { atomicJson } from '../pipeline/stage-state.ts';

interface BrowserNarrationCue {
  sceneId: string;
  text: string;
  start: number;
  end: number;
}

interface NarrationCueResult {
  sceneId: string;
  lines: boolean;
  safeArea: boolean;
  overlap: boolean;
}

interface NarrationAudit {
  checks: CheckResult[];
  measurements: unknown;
  byScene: Map<string, NarrationCueResult[]>;
}

function mediaType(file: string): string {
  const types: Record<string, string> = {
    '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
    '.wav':'audio/wav', '.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.ogg':'audio/ogg',
    '.mp4':'video/mp4', '.webm':'video/webm',
  };
  return types[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

async function auditNarrationCaptions(page: Page, spec: VideoSpec): Promise<NarrationAudit | null> {
  if (spec.audio.narrationMode === 'none') return null;
  const narrationPath = spec.audio.narrationMode === 'external-audio'
    ? spec.assets.find(asset => asset.id === spec.audio.externalAudioAssetId)?.path ?? null
    : 'narration.wav';
  const audio = await page.evaluate(async expectedPath => {
    const expectedUrl = expectedPath ? new URL(expectedPath, document.baseURI).href : null;
    const element = [...document.querySelectorAll<HTMLAudioElement>('audio')]
      .find(item => expectedUrl !== null && new URL(item.getAttribute('src') ?? '', document.baseURI).href === expectedUrl);
    if (!element || !expectedUrl) return { found:false, expectedUrl, readyState:0, duration:null, mediaError:'matching audio element missing', rangeStatus:null, rangeBytes:null, contentRange:null };
    if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 5_000);
        const done = () => { clearTimeout(timeout); resolve(); };
        element.addEventListener('loadedmetadata', done, { once:true });
        element.addEventListener('error', done, { once:true });
        if (element.networkState === HTMLMediaElement.NETWORK_EMPTY) element.load();
      });
    }
    let rangeStatus: number | null = null;
    let rangeBytes: number | null = null;
    let contentRange: string | null = null;
    try {
      const response = await fetch(expectedUrl, { headers:{ Range:'bytes=0-1' } });
      rangeStatus = response.status;
      contentRange = response.headers.get('content-range');
      rangeBytes = (await response.arrayBuffer()).byteLength;
    } catch {
      // The failed request remains observable through the result and requestfailed listener.
    }
    return {
      found:true,
      expectedUrl,
      readyState:element.readyState,
      duration:Number.isFinite(element.duration) ? element.duration : null,
      mediaError:element.error ? `${element.error.code}:${element.error.message}` : null,
      rangeStatus,
      rangeBytes,
      contentRange,
    };
  }, narrationPath);
  const raw = await page.evaluate(() => (window as Window & { NARRATION_CUES?: unknown }).NARRATION_CUES ?? null);
  const rawCues = Array.isArray(raw) ? raw : [];
  const cues: BrowserNarrationCue[] = rawCues.filter((cue): cue is BrowserNarrationCue => Boolean(
    cue && typeof cue === 'object' &&
    typeof (cue as BrowserNarrationCue).sceneId === 'string' &&
    typeof (cue as BrowserNarrationCue).text === 'string' &&
    typeof (cue as BrowserNarrationCue).start === 'number' && Number.isFinite((cue as BrowserNarrationCue).start) &&
    typeof (cue as BrowserNarrationCue).end === 'number' && Number.isFinite((cue as BrowserNarrationCue).end),
  ));
  const sceneById = new Map(spec.scenes.map(scene => [scene.id, scene]));
  let previousEnd = 0;
  const timingPass = rawCues.length > 0 && cues.length === rawCues.length && cues.every(cue => {
    const scene = sceneById.get(cue.sceneId);
    const valid = Boolean(
      scene && scene.actualStartSec !== null && scene.actualEndSec !== null &&
      cue.start >= scene.actualStartSec! && cue.end <= scene.actualEndSec! &&
      cue.start >= previousEnd && cue.end > cue.start,
    );
    previousEnd = cue.end;
    return valid;
  });
  const domCues = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.narration-caption')].map(element => ({
    id: element.id,
    text: element.innerText,
    sceneId: element.closest<HTMLElement>('.scene')?.id ?? '',
    start: Number(element.dataset.captionStart),
    end: Number(element.dataset.captionEnd),
  })));
  const structurePass = rawCues.length > 0 && cues.length === rawCues.length && domCues.length === cues.length && cues.every((cue, index) => {
    const rendered = domCues[index];
    return rendered?.id === `narration-caption-${index}` && rendered.text === cue.text && rendered.sceneId === cue.sceneId && rendered.start === cue.start && rendered.end === cue.end;
  });
  const checks: CheckResult[] = [
    {
      id:'browser.narration.audio',
      status:audio.found && audio.readyState >= 1 && audio.duration !== null && audio.duration > 0 && audio.mediaError === null && audio.rangeStatus === 206 && audio.rangeBytes === 2 && /^bytes 0-1\/\d+$/.test(audio.contentRange ?? '')?'PASS':'FAIL',
      message:audio.found && audio.readyState >= 1 && audio.duration !== null && audio.duration > 0 && audio.mediaError === null && audio.rangeStatus === 206 && audio.rangeBytes === 2 && /^bytes 0-1\/\d+$/.test(audio.contentRange ?? '')
        ? 'Narration audio matches the declared asset, loads metadata, and serves a valid byte range'
        : `Narration audio evidence failed: ${JSON.stringify(audio)}`,
    },
    { id:'browser.narration.structure', status:structurePass?'PASS':'FAIL', message:'Every authored narration cue has one exact rendered caption node with matching ID, scene, text and timing data' },
    { id:'browser.narration.timing', status:timingPass?'PASS':'FAIL', message:'Narration cues are finite, positive, ordered, non-overlapping and inside their scenes' },
  ];
  const byScene = new Map<string, NarrationCueResult[]>();
  const cueMeasurements: unknown[] = [];
  const snapshot = async (time: number, sceneId: string) => page.evaluate(({ sampleTime, activeSceneId }) => {
    const win = window as Window & { __timelines?: Record<string, { seek(time: number): void }> };
    let seekError: string | null = null;
    try {
      if (!win.__timelines?.main) throw new Error('window.__timelines.main is missing');
      win.__timelines.main.seek(sampleTime);
    } catch (error) {
      seekError = error instanceof Error ? error.message : String(error);
    }
    for (const scene of document.querySelectorAll<HTMLElement>('.scene')) scene.style.display = scene.id === activeSceneId ? 'block' : 'none';
    const rect = (element: Element) => { const value = element.getBoundingClientRect(); return { x:value.x,y:value.y,width:value.width,height:value.height }; };
    const visible = (element: HTMLElement) => {
      if (element.getClientRects().length === 0) return false;
      let current: HTMLElement | null = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) return false;
        current = current.parentElement;
      }
      return true;
    };
    const rendered = [...document.querySelectorAll<HTMLElement>('.narration-caption')].map(element => {
      const box = rect(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      const textLineTops = [...range.getClientRects()]
        .filter(item => item.width > 0 && item.height > 0)
        .map(item => Math.round(item.top * 10) / 10);
      const lines = new Set(textLineTops).size;
      const media = element.closest('.scene')?.querySelectorAll<HTMLElement>('.media-crop') ?? [];
      const overlapsMedia = [...media].some(item => {
        const other = rect(item);
        return box.x < other.x+other.width && box.x+box.width>other.x && box.y<other.y+other.height && box.y+box.height>other.y;
      });
      return {
        id:element.id,
        text:element.innerText,
        visible:visible(element),
        box,
        lines,
        overlapsMedia,
      };
    });
    return { time:sampleTime, seekError, rendered, visibleIds:rendered.filter(item => item.visible).map(item => item.id) };
  }, { sampleTime:time, activeSceneId:sceneId });
  const expectedActiveIds = (time: number, sceneId: string) => cues.flatMap((cue, index) => cue.sceneId === sceneId && cue.start <= time && time < cue.end ? [`narration-caption-${index}`] : []);

  for (const [index, cue] of cues.entries()) {
    const id = `narration-caption-${index}`;
    const midpoint = (cue.start + cue.end) / 2;
    const forward = [
      await snapshot(cue.start, cue.sceneId),
      await snapshot(midpoint, cue.sceneId),
      await snapshot(cue.end, cue.sceneId),
    ];
    const reverse = [
      await snapshot(cue.end, cue.sceneId),
      await snapshot(midpoint, cue.sceneId),
      await snapshot(cue.start, cue.sceneId),
    ];
    const matchesExpected = (sample: Awaited<ReturnType<typeof snapshot>>) => !sample.seekError && sameStrings(sample.visibleIds, expectedActiveIds(sample.time, cue.sceneId));
    const middle = forward[1]!;
    const rendered = middle.rendered.find(item => item.id === id);
    const midpointPass = matchesExpected(middle) && middle.visibleIds.length === 1 && middle.visibleIds[0] === id && rendered?.text === cue.text;
    const boundariesPass = matchesExpected(forward[0]!) && matchesExpected(forward[2]!) && forward[0]!.visibleIds.length === 1 && forward[0]!.visibleIds[0] === id && !forward[2]!.visibleIds.includes(id);
    const reversePass = reverse.every(matchesExpected);
    const linesPass = midpointPass && Boolean(rendered && rendered.lines <= spec.captions.maxLines);
    const safeAreaPass = midpointPass && Boolean(rendered && checkSafeArea(rendered.box, spec.output, spec.captions.safeAreaPercent));
    const overlapPass = midpointPass && rendered?.overlapsMedia === false;
    checks.push(
      { id:`browser.narration.cue-${index}.midpoint`, status:midpointPass?'PASS':'FAIL', message:`Cue ${index} is the only visible narration caption at its midpoint and matches authored text` },
      { id:`browser.narration.cue-${index}.boundaries`, status:boundariesPass?'PASS':'FAIL', message:`Cue ${index} appears at its start and is absent at its end with no competing cue` },
      { id:`browser.narration.cue-${index}.reverse-seek`, status:reversePass?'PASS':'FAIL', message:`Cue ${index} visibility remains deterministic when seeking backward` },
      { id:`browser.narration.cue-${index}.lines`, status:linesPass?'PASS':'FAIL', message:`Cue ${index} uses at most ${spec.captions.maxLines} rendered lines` },
      { id:`browser.narration.cue-${index}.safe-area`, status:safeAreaPass?'PASS':'FAIL', message:`Cue ${index} is inside the configured caption safe area` },
      { id:`browser.narration.cue-${index}.ui-overlap`, status:overlapPass?'PASS':'FAIL', message:`Cue ${index} does not overlap an evidence image` },
    );
    const sceneResults = byScene.get(cue.sceneId) ?? [];
    sceneResults.push({ sceneId:cue.sceneId, lines:linesPass, safeArea:safeAreaPass, overlap:overlapPass });
    byScene.set(cue.sceneId, sceneResults);
    cueMeasurements.push({ index, cue, forward, reverse });
  }
  return { checks, measurements:{ audio, rawCues, domCues, cues:cueMeasurements }, byScene };
}

export async function browserQa(project: string, spec: VideoSpec): Promise<CheckResult[]> {
  const server = createServer(async (request, response) => {
    try {
      const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const file = path.resolve(project, `.${requested === '/' ? '/index.html' : requested}`);
      if (!file.startsWith(path.resolve(project) + path.sep)) { response.writeHead(404).end(); return; }
      const fileStat = await stat(file);
      if (!fileStat.isFile()) { response.writeHead(404).end(); return; }
      const bytes = await readFile(file);
      response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('Content-Type', mediaType(file));
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) {
          response.writeHead(416, { 'Content-Range':`bytes */${bytes.length}` }).end(); return;
        }
        const suffixLength = match[1] ? null : Number(match[2]);
        const start = suffixLength === null ? Number(match[1]) : Math.max(0, bytes.length - suffixLength);
        const requestedEnd = match[2] && match[1]
          ? Number(match[2])
          : suffixLength === null
            ? Math.min(start + 64 * 1024 - 1, bytes.length - 1)
            : bytes.length - 1;
        const end = Math.min(requestedEnd, bytes.length - 1);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= bytes.length || end < start) {
          response.writeHead(416, { 'Content-Range':`bytes */${bytes.length}` }).end(); return;
        }
        response.writeHead(206, {
          'Content-Length':end - start + 1,
          'Content-Range':`bytes ${start}-${end}/${bytes.length}`,
        });
        if (request.method === 'HEAD') response.end();
        else response.end(bytes.subarray(start, end + 1));
        return;
      }
      response.setHeader('Content-Length', bytes.length);
      if (request.method === 'HEAD') response.end();
      else response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start layout audit server');
  const env = await environment();
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  const checks: CheckResult[] = [];
  const measurements: unknown[] = [];
  try {
    browser = await puppeteer.launch({ executablePath: env.HYPERFRAMES_BROWSER_PATH, headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const failures: string[] = [];
    page.on('requestfailed', request => failures.push(`${request.method()} ${request.url()} range=${request.headers().range ?? 'none'} (${request.failure()?.errorText ?? 'unknown request failure'})`));
    page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
    page.on('pageerror', error => failures.push(String(error)));
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    const cdp = await page.createCDPSession();
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const fontProbeSelectors = await page.evaluate(families => families.map((family, index) => {
      const probe = document.createElement('span');
      probe.id = `epvs-font-probe-${index}`;
      probe.textContent = 'Brand ABC xyz 012 中文';
      Object.assign(probe.style, { position:'absolute',left:'-5000px',top:'0',fontSize:'28px',fontFamily:`"${family.replaceAll('"', '')}", sans-serif` });
      document.body.append(probe);
      return `#${probe.id}`;
    }), spec.brand.fontFamilies);
    await page.evaluate(() => document.fonts.ready);
    const { root } = await cdp.send('DOM.getDocument');
    const platformFonts = async (selector: string): Promise<string[]> => {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId:root.nodeId, selector });
      if (!nodeId) return [];
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      return fonts.filter(font => font.glyphCount > 0).map(font => font.familyName);
    };
    const normalizeFont = (font: string) => font.trim().toLowerCase();
    const declaredFonts = spec.brand.fontFamilies.map(normalizeFont);
    const fontAvailability = await Promise.all(fontProbeSelectors.map(async (selector, index) => {
      const usedFonts = await platformFonts(selector);
      return { declared:spec.brand.fontFamilies[index]!, usedFonts, available:usedFonts.some(font => normalizeFont(font) === declaredFonts[index]) };
    }));
    const narrationAudit = await auditNarrationCaptions(page, spec);
    if (narrationAudit) checks.push(...narrationAudit.checks);
    for (const scene of spec.scenes) {
      const measured = await page.evaluate(({ sceneId, time, logoPaths, palette }) => {
        // Static source-layout audit, complementary to the actual HyperFrames runtime checks.
        const win = window as Window & { __timelines?: Record<string, { seek(time: number): void }> };
        win.__timelines?.main?.seek(time);
        for (const item of document.querySelectorAll<HTMLElement>('.scene')) item.style.display = item.id === sceneId ? 'block' : 'none';
        const scope = document.getElementById(sceneId)!;
        const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
        const captions = [...scope.querySelectorAll<HTMLElement>('.caption')].map(el => ({ text: el.innerText, box:rect(el), lines:Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) }));
        const logoUrls = logoPaths.map(file => new URL(file, document.baseURI).href);
        const logos = [...scope.querySelectorAll<HTMLElement>('img,.logo,.end-logo,.source-logo,.end-wordmark,[data-asset-id]')].filter(el => el.matches('.logo,.end-logo,.source-logo,.end-wordmark') || el instanceof HTMLImageElement && logoUrls.includes(el.src)).map(el => ({ box:rect(el), element:el.className, src:el.getAttribute('src') }));
        const elements = [scope, ...scope.querySelectorAll<HTMLElement>('*')].filter(el => {
          const style = getComputedStyle(el), box = rect(el);
          return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        const hasOwnText = (el: Element) => [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        const text = elements.filter(hasOwnText).map((el,index) => {
          el.setAttribute('data-epvs-font-audit', `${sceneId}-${index}`);
          const role = el.matches('h1,h2,h3,[data-text-role="title"],.end-wordmark') ? 'title' : el.matches('[data-text-role="label"],.label,.asset-label,.eyebrow,.mode-label,.counter,.brand span') ? 'label' : 'body';
          return { text:el.innerText, box:rect(el), overflow:el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2, fontSize:parseFloat(getComputedStyle(el).fontSize), role, fontSelector:`[data-epvs-font-audit="${sceneId}-${index}"]` };
        });
        // Resolve authored CSS colors after cascade/variables. Asset pixels retain their own brand colors.
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently:true })!;
        const rgba = (color: string) => {
          ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1);
          return [...ctx.getImageData(0,0,1,1).data];
        };
        const registered = palette.map(color => rgba(color).slice(0,3).join(','));
        const paletteViolations: Array<{ element:string; property:string; color:string }> = [];
        for (const el of elements) {
          const style = getComputedStyle(el);
          const colors: Array<[string,string]> = [['backgroundColor',style.backgroundColor]];
          if (hasOwnText(el)) colors.push(['color',style.color]);
          for (const side of ['Top','Right','Bottom','Left']) {
            if (parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none') colors.push([`border${side}Color`,style.getPropertyValue(`border-${side.toLowerCase()}-color`)]);
          }
          for (const property of ['backgroundImage','boxShadow','textShadow'] as const) {
            for (const color of style[property].match(/rgba?\([^)]*\)/g) ?? []) colors.push([property,color]);
          }
          if (el instanceof SVGElement) for (const property of ['fill','stroke'] as const) if (style[property] !== 'none') colors.push([property,style[property]]);
          for (const [property,color] of colors) {
            const components = rgba(color);
            if (components[3]! > 0 && !registered.includes(components.slice(0,3).join(','))) paletteViolations.push({ element:el.id || el.className.toString() || el.tagName,property,color });
          }
        }
        const images = [...scope.querySelectorAll<HTMLImageElement>('img')].map(el => ({ src:el.getAttribute('src'), complete:el.complete && el.naturalWidth > 0, ratio:Math.max(el.width/el.naturalWidth,el.height/el.naturalHeight) }));
        const c = captions[0]?.box;
        const media = scope.querySelector('.media-crop');
        const m = media ? rect(media) : null;
        const overlaps = c && m ? c.x < m.x+m.width && c.x+c.width>m.x && c.y<m.y+m.height && c.y+c.height>m.y : false;
        return { captions,logos,text,images,overlaps,paletteViolations };
      }, { sceneId: scene.id, time: scene.heroFrameSec ?? (scene.actualStartSec ?? 0) + 2, logoPaths:spec.assets.filter(asset => asset.type === 'logo').map(asset => asset.path), palette:spec.brand.colors });
      const actualFonts = await Promise.all(measured.text.map(async item => ({ text:item.text, usedFonts:await platformFonts(item.fontSelector) })));
      measurements.push({ sceneId: scene.id, ...measured, actualFonts });
      const add = (id: string, passed: boolean, message: string) => checks.push({ id:`browser.${scene.id}.${id}`,status:passed?'PASS':'FAIL',message });
      const narratedScene = narrationAudit?.byScene.get(scene.id);
      add('caption-lines', !spec.captions.enabled || (narrationAudit ? Boolean(narratedScene?.length && narratedScene.every(result => result.lines)) : measured.captions.length > 0 && measured.captions.every(c=>c.lines<=spec.captions.maxLines)), 'Rendered caption line count <=2');
      add('caption-safe-area', narrationAudit ? Boolean(narratedScene?.length && narratedScene.every(result => result.safeArea)) : measured.captions.every(c => checkSafeArea(c.box,spec.output,spec.captions.safeAreaPercent)), 'Measured caption bounds in safe area');
      add('logo-safe-area', measured.logos.length>0 && measured.logos.every(l=>checkSafeArea(l.box,spec.output,spec.captions.safeAreaPercent)), 'Measured logo bounds in safe area');
      add('text-overflow', measured.text.every(t=>!t.overflow), 'All visible source text fits its box');
      add('minimum-type', measured.text.every(t=>t.fontSize >= (t.role==='title'?60:t.role==='label'?16:20)), 'Titles >=60px; explicitly classified labels >=16px; all other visible text >=20px');
      add('images', measured.images.every(i=>i.complete && i.ratio<=2), 'Images load and are not scaled above 2x');
      add('caption-ui-overlap', narrationAudit ? Boolean(narratedScene?.length && narratedScene.every(result => result.overlap)) : !measured.overlaps, 'Caption does not overlap evidence image');
      add('brand-palette', measured.paletteViolations.length === 0, 'Computed text, background, border, gradient and shadow colors use registered RGB values; opacity allowed; referenced asset pixels excluded');
      add('font', fontAvailability.every(font => font.available) && actualFonts.every(item => item.usedFonts.length > 0 && item.usedFonts.every(font => declaredFonts.includes(normalizeFont(font)))), 'Every declared font has real glyphs in its probe; actual visible text glyphs use only declared families (Chrome platform-font evidence)');
    }
    checks.push({ id:'browser.resources', status:failures.length?'FAIL':'PASS',message:failures.length ? `${failures.length} resource/runtime failures` : 'No missing resource or page error' });
    await atomicJson(path.join(project, 'reports/browser-layout.json'), { method:'source DOM at authored hero times; narrated captions at every cue midpoint/boundary and reverse seek; computed CSS and actual Chrome platform fonts; independent HyperFrames runtime lint/validate/inspect also required', fontAvailability, narration:narrationAudit?.measurements ?? null, measurements, checks, failures });
  } finally {
    try { await browser?.close(); }
    finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
  }
  return checks;
}
