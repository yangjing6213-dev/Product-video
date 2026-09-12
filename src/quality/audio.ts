// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { resolveProjectAsset } from '../assets/library.ts';
import { digest } from '../pipeline/stage-state.ts';
import { environment } from '../pipeline/tools.ts';
import { validateAudioMix, type ResolvedCreativePlan } from './plan.ts';

type AudioPlan = Pick<ResolvedCreativePlan, 'narration' | 'audioMix' | 'frameRate' | 'durationFrames'>;

/** Supported contract: one static audio[src] narration or declared premix, or no media for silent work.
 * Scripted media, nested sources, video soundtracks and Web Audio are not supported.
 * This audits the parsed DOM and frame seeks; it is not a proof of arbitrary JS.
 */
export async function inspectCompositionAudio(root: string, project: string, plan: AudioPlan) {
  const projectRelative = path.relative(root, project).replaceAll('\\', '/');
  const index = await resolveProjectAsset(root, `${projectRelative}/index.html`);
  const indexSha256 = digest(await readFile(index));
  const voice = plan.narration.voicePath ? await resolveProjectAsset(root, plan.narration.voicePath) : null;
  if (voice && digest(await readFile(voice)) !== plan.narration.voiceHash) throw new Error('Frozen voice hash differs before audio binding');
  const mixedFiles: Array<{ file: string; hash: string; label: string }> = [];
  if (plan.audioMix) {
    validateAudioMix(plan.audioMix, plan.narration.voiceHash, plan.durationFrames / plan.frameRate);
    for (const [relative, hash, label] of [[plan.audioMix.music.path, plan.audioMix.music.sha256, 'music'],
      [plan.audioMix.music.licensePath, plan.audioMix.music.licenseSha256, 'music license'],
      [plan.audioMix.mixPath, plan.audioMix.mixSha256, 'audio mix']]) {
      mixedFiles.push({ file: await resolveProjectAsset(root, relative!), hash: hash!, label: label! });
    }
  }
  const verifyMixedFiles = async () => {
    for (const item of mixedFiles) if (digest(await readFile(item.file)) !== item.hash) throw new Error(`Frozen ${item.label} hash differs during audio binding`);
  };
  await verifyMixedFiles();
  const playback = plan.audioMix ? await resolveProjectAsset(root, plan.audioMix.mixPath) : voice;
  const expectedUrl = playback ? pathToFileURL(playback).href : null;
  const env = await environment();
  const browser = await puppeteer.launch({ executablePath: env.HYPERFRAMES_BROWSER_PATH, headless: true,
    args: ['--disable-background-networking', '--disable-default-apps', '--no-first-run'] });
  const violations: string[] = [];
  let sampledFrames = 0;
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = request.url();
      if (url.startsWith('data:') && request.resourceType() !== 'media') { void request.continue(); return; }
      let allowed = false;
      try {
        const relative = path.relative(project, fileURLToPath(url));
        allowed = !relative.startsWith('..') && !path.isAbsolute(relative);
      } catch { /* Only project-local file requests are supported. */ }
      if (!allowed || (request.resourceType() === 'media' && url !== expectedUrl)) {
        violations.push('Unsupported media/resource request in audio binding');
        void request.abort();
      } else void request.continue();
    });
    const inspect = async () => {
      const media = await page.evaluate(() => ({
        audio: [...document.querySelectorAll('audio')].map(element => ({
          src: element.src, currentSrc: element.currentSrc, direct: element.getAttribute('src'),
          sourceChildren: element.querySelectorAll('source').length,
          start: element.getAttribute('data-start'), duration: element.getAttribute('data-duration'),
          gain: element.getAttribute('data-volume'), rate: element.playbackRate, muted: element.muted, volume: element.volume,
        })),
        unsupported: document.querySelectorAll('source,video,iframe,object,embed').length,
        violations: (window as Window & { __EPVS_AUDIO_AUDIT?: { violations: string[] } }).__EPVS_AUDIO_AUDIT?.violations ?? [],
      }));
      if (violations.length || media.violations.length || media.unsupported || media.audio.length !== (expectedUrl ? 1 : 0) || media.audio.some(audio =>
        !audio.direct || audio.sourceChildren || audio.src !== expectedUrl || (audio.currentSrc && audio.currentSrc !== expectedUrl) ||
        (plan.audioMix && (audio.start !== '0' || Number(audio.duration) !== plan.audioMix.durationSec ||
          (audio.gain !== null && Number(audio.gain) !== 1) || audio.rate !== 1 || audio.muted || audio.volume !== 1)))) {
        throw new Error(`Audio binding failed: source must be the single static frozen voice or declared full-length mix; ${[...violations, ...media.violations].join('; ')}`);
      }
    };
    // Inspect the browser's HTML parser result before author scripts can conceal it.
    await page.setJavaScriptEnabled(false);
    await page.goto(pathToFileURL(index).href, { waitUntil: 'load' });
    await inspect();
    await page.setJavaScriptEnabled(true);
    await page.evaluateOnNewDocument(() => {
      const audit = { violations: [] as string[] };
      Object.defineProperty(window, '__EPVS_AUDIO_AUDIT', { value: audit });
      const mark = () => audit.violations.push('Unsupported scripted media');
      const create = Document.prototype.createElement;
      Document.prototype.createElement = function (...args: Parameters<Document['createElement']>) {
        if (/^(audio|video|source)$/i.test(args[0])) mark();
        return create.apply(this, args);
      };
      const attribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (/^(AUDIO|VIDEO|SOURCE)$/.test(this.tagName) && /^(src|srcset)$/i.test(name)) mark();
        return attribute.call(this, name, value);
      };
      for (const property of ['src', 'srcObject']) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, property);
        if (descriptor?.set) Object.defineProperty(HTMLMediaElement.prototype, property, { ...descriptor,
          set(value) { mark(); descriptor.set!.call(this, value); },
        });
      }
      const win = window as unknown as Record<string, unknown>;
      for (const name of ['Audio', 'AudioContext', 'webkitAudioContext']) {
        const constructor = win[name];
        if (typeof constructor === 'function') win[name] = new Proxy(constructor, {
          construct(target, args) { mark(); return Reflect.construct(target, args); },
          apply(target, receiver, args) { mark(); return Reflect.apply(target, receiver, args); },
        });
      }
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(records => {
          for (const record of records) {
            if (record.type === 'attributes' && record.target instanceof Element && /^(AUDIO|VIDEO|SOURCE)$/.test(record.target.tagName)) mark();
            if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
              node instanceof Element && (node.matches('audio,video,source') || node.querySelector('audio,video,source')))) mark();
          }
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset'] });
      }, { once: true });
    });
    await page.reload({ waitUntil: 'load' });
    await inspect();
    // Exercise the same finite frame-time range used by the renderer, including
    // callbacks. Media sources are static under this contract at every seek.
    for (let frame = 0; frame <= plan.durationFrames; frame++) {
      await page.evaluate(async time => {
        const timeline = (window as Window & { __timelines?: { main?: { seek(time: number, suppressEvents?: boolean): void } } }).__timelines?.main;
        timeline?.seek(time, false);
        await Promise.resolve();
      }, frame / plan.frameRate);
      await inspect();
      sampledFrames++;
    }
    if (digest(await readFile(index)) !== indexSha256 || (voice && digest(await readFile(voice)) !== plan.narration.voiceHash)) throw new Error('Audio binding inputs changed during inspection');
    await verifyMixedFiles();
    return { status: 'PASS' as const, contract: plan.audioMix ? 'static-single-premix-v1' : 'static-single-narration-v1', audioCount: expectedUrl ? 1 : 0,
      ...(plan.audioMix ? { mixPath: plan.audioMix.mixPath, mixSha256: plan.audioMix.mixSha256 } : {}),
      voicePath: plan.narration.voicePath ?? null, voiceSha256: plan.narration.voiceHash ?? null, indexSha256, sampledFrames };
  } finally { await browser.close(); }
}
