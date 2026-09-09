import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSpec } from '../src/contracts.ts';
import { validateNarrationCues, validatePhraseTranscript, validateTranscriptTiming } from '../src/qa/narration.ts';
import { atomicJson, digest } from '../src/pipeline/stage-state.ts';
import { command, environment, ensureSuccess, recordCommand, REPO } from '../src/pipeline/tools.ts';

const EVIDENCE_FILES = [
  'video-spec.json',
  'assets/narration.wav',
  'transcript.json',
  'captions.srt',
  'reports/narration-cues.json',
  'reports/tts-generation.json',
  'renders/final.mp4',
];

function pcm(bytes) {
  if (bytes.toString('ascii',0,4)!=='RIFF' || bytes.toString('ascii',8,12)!=='WAVE') throw new Error('Expected PCM WAV');
  let format, data;
  for (let offset=12;offset+8<=bytes.length;) {
    const id=bytes.toString('ascii',offset,offset+4), length=bytes.readUInt32LE(offset+4), start=offset+8;
    if(id==='fmt ') format={kind:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),rate:bytes.readUInt32LE(start+4),bits:bytes.readUInt16LE(start+14)};
    if(id==='data') data=bytes.subarray(start,start+length);
    offset=start+length+(length%2);
  }
  if(!data || format?.kind!==1 || format.channels!==1 || format.rate!==24000 || format.bits!==16) throw new Error('Expected 24kHz mono PCM16 WAV');
  return Float32Array.from({length:data.length/2},(_,index)=>data.readInt16LE(index*2)/32768);
}

function correlation(reference, decoded, lag, stride=8) {
  let dot=0, a=0, b=0;
  const limit=Math.min(reference.length,decoded.length-Math.max(0,lag));
  for(let i=Math.max(0,-lag);i<limit;i+=stride) {
    const x=reference[i],y=decoded[i+lag];dot+=x*y;a+=x*x;b+=y*y;
  }
  return dot/Math.sqrt(a*b);
}

export function comparePcm(reference, decoded, sampleRate=24000) {
  let best={lag:0,correlation:-1};
  for(let lag=-512;lag<=512;lag+=8) {const value=correlation(reference,decoded,lag);if(value>best.correlation)best={lag,correlation:value};}
  const coarse=best.lag;
  for(let lag=coarse-7;lag<=coarse+7;lag++) {const value=correlation(reference,decoded,lag);if(value>best.correlation)best={lag,correlation:value};}
  const first=Math.max(0,-best.lag), limit=Math.min(reference.length,decoded.length-Math.max(0,best.lag));
  let sourcePower=0,decodedPower=0,errorPower=0;
  for(let index=first;index<limit;index++) {
    const source=reference[index], rendered=decoded[index+best.lag];
    sourcePower+=source*source;decodedPower+=rendered*rendered;errorPower+=(source-rendered)**2;
  }
  const samples=Math.max(0,limit-first);
  const sourceRms=samples ? Math.sqrt(sourcePower/samples) : 0;
  const decodedRms=samples ? Math.sqrt(decodedPower/samples) : 0;
  const rmsGainRatio=sourceRms>0 ? decodedRms/sourceRms : Number.POSITIVE_INFINITY;
  const normalizedRmse=sourcePower>0 ? Math.sqrt(errorPower/sourcePower) : Number.POSITIVE_INFINITY;
  const clippingFraction=decoded.length ? decoded.reduce((count,value)=>count+(Math.abs(value)>=0.999),0)/decoded.length : 1;
  const aligned=best.correlation>=0.95 && Math.abs(best.lag/sampleRate)<=0.025 &&
    Math.abs(decoded.length-reference.length)/sampleRate<=0.05 && clippingFraction<0.001 &&
    rmsGainRatio>=0.8 && rmsGainRatio<=1.2;
  return {aligned,decodedAudioCorrelation:best.correlation,decodedLagSamples:best.lag,
    decodedLagSec:best.lag/sampleRate,sourceRms,decodedRms,rmsGainRatio,normalizedRmse,clippingFraction};
}

function seconds(value) {
  const match=/^(\d+):(\d+):(\d+),(\d{3})$/.exec(value);
  if(!match) throw new Error('Malformed SRT time');
  return Number(match[1])*3600+Number(match[2])*60+Number(match[3])+Number(match[4])/1000;
}

async function availableFileHashes(project) {
  const hashes={};
  for(const relative of EVIDENCE_FILES) {
    try { hashes[relative]=digest(await readFile(path.join(project,relative))); } catch {}
  }
  return hashes;
}

function errorMessage(error) { return error instanceof Error ? error.message : String(error); }

export async function verifyProject(id,{repo=REPO}={}) {
  if(!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid project ID');
  const project=path.join(repo,'projects',id);
  const report=path.join(project,'reports/narration-artifact-check.json');
  await atomicJson(report,{schemaVersion:'1.0',projectId:id,status:'PARTIAL',generatedAt:new Date().toISOString(),
    fileSha256:await availableFileHashes(project),error:'Verification is in progress; prior PASS evidence is no longer current.'});
  const read=relative=>readFile(path.join(project,relative));
  let temporary=null,result;
  try {
    const spec=validateSpec(JSON.parse(await read('video-spec.json')));
    const audio=await read('assets/narration.wav'), reference=pcm(audio);
    const cueBytes=await read('reports/narration-cues.json');
    const evidence=validateNarrationCues(JSON.parse(cueBytes),spec,digest(audio),reference.length/24000);
    const transcriptBytes=await read('transcript.json');
    validatePhraseTranscript(validateTranscriptTiming(JSON.parse(transcriptBytes),reference.length/24000),evidence);
    const srt=await read('captions.srt');
    const blocks=srt.toString('utf8').trim().split(/\r?\n\r?\n/);
    if(blocks.length!==evidence.cues.length) throw new Error('SRT cue count mismatch');
    blocks.forEach((block,index)=>{
      const [number,times,...text]=block.split(/\r?\n/), cue=evidence.cues[index];
      if(!times) throw new Error(`Malformed SRT cue ${index}`);
      const [start,end]=times.split(' --> ');
      if(!start || !end || Number(number)!==index+1 || text.join('\n')!==cue.text || Math.abs(seconds(start)-cue.start)>0.00051 || Math.abs(seconds(end)-cue.end)>0.00051) throw new Error(`SRT cue ${index} differs from measured speech`);
    });
    const env=await environment();
    const cache=path.join(repo,'.cache/audio-verification');await mkdir(cache,{recursive:true});
    temporary=await mkdtemp(path.join(cache,'decode-'));
    const decodedFile=path.join(temporary,'audio.wav');
    const decode=await command(env.HYPERFRAMES_FFMPEG_PATH,['-hide_banner','-v','error','-i',path.join(project,'renders/final.mp4'),'-vn','-ac','1','-ar','24000','-c:a','pcm_s16le','-n',decodedFile],{env,timeoutMs:120000});
    await recordCommand(project,'narration-audio-compare',decode);ensureSuccess(decode,'Final narration decode');
    const decoded=pcm(await readFile(decodedFile));
    const comparison=comparePcm(reference,decoded);
    result={schemaVersion:'1.0',projectId:id,status:comparison.aligned?'PASS':'FAIL',generatedAt:new Date().toISOString(),
      audioSha256:digest(audio),cuesSha256:digest(cueBytes),transcriptSha256:digest(transcriptBytes),captionsSha256:digest(srt),finalVideoSha256:digest(await read('renders/final.mp4')),
      cueCount:evidence.cues.length,srtTimingToleranceSec:0.00051,srtMatchesMeasuredCues:true,
      sourceDurationSec:reference.length/24000,decodedDurationSec:decoded.length/24000,sampleRate:24000,
      ...comparison,rmsGainRatioRange:[0.8,1.2],
      method:'Decode final AAC to PCM; compare measured narration waveform with normalized cross-correlation over +/-21.4ms and require decoded/reference RMS gain ratio 0.8-1.2; check SRT text and timing against audio-hash-bound cues.',
      transcriptGranularity:'phrase',asrStatus:'NOT_RUN',humanListeningReview:'NOT_RUN'};
  } catch(error) {
    result={schemaVersion:'1.0',projectId:id,status:'FAIL',generatedAt:new Date().toISOString(),error:errorMessage(error)};
  } finally {
    if(temporary) {
      const cache=path.join(repo,'.cache/audio-verification');
      if(!path.resolve(temporary).startsWith(path.resolve(cache)+path.sep)) {
        result={schemaVersion:'1.0',projectId:id,status:'FAIL',generatedAt:new Date().toISOString(),error:'Unexpected verification temp path'};
      } else {
        try { await rm(temporary,{recursive:true,force:true}); } catch(error) {
          result={schemaVersion:'1.0',projectId:id,status:'FAIL',generatedAt:new Date().toISOString(),error:`Verification cleanup failed: ${errorMessage(error)}`};
        }
      }
    }
  }
  result.fileSha256=await availableFileHashes(project);
  await atomicJson(report,result);
  return result;
}

export async function main(ids=process.argv.slice(2)) {
  for(const id of ids) {
    const result=await verifyProject(id);
    console.log(JSON.stringify(result));
    if(result.status!=='PASS') process.exitCode=1;
  }
}

const invoked=process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if(invoked===import.meta.url) await main();
