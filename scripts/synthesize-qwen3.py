# SPDX-License-Identifier: Apache-2.0
"""Offline Qwen reference narration with preserved, measured Whisper alignment."""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import unicodedata


ROOT = Path(__file__).resolve().parents[1]
VERSION = 'qwen3-production-v1'
RUNNER_BYTES = Path(__file__).read_bytes()
RUNNER_SHA256 = hashlib.sha256(RUNNER_BYTES).hexdigest()


def normalized(text):
    # Orthographic variants only; never phonetic substitutions for recognition errors.
    text = text.translate(str.maketrans('變現實價', '变现实价'))
    return ''.join(c for c in unicodedata.normalize('NFKC', text).lower()
                   if c.isalnum())


def spoken(text, pronunciation):
    for display, replacement in pronunciation.items():
        text = text.replace(display, replacement)
    return text


def asr_prompt(scenes, pronunciation=None):
    """Hint only actual reviewed Latin terms; never replace recognized words."""
    text = spoken(' '.join(scene['voiceover'] for scene in scenes), pronunciation or {})
    terms = list(dict.fromkeys(re.findall(r'[A-Za-z][A-Za-z0-9]*(?: [A-Za-z][A-Za-z0-9]*)*', text)))
    # Display names such as Codex are not vocabulary hints when the approved map says 扣代克斯.
    compact = re.sub(r'\s+', '', text)
    glossary = ['产品说明', '文案', '旁白', '字幕', '音乐', '本地项目', '封面', '分享图', '原稿', '文章配图',
                '在支持技能的扣代克斯中使用', '恩禾', '人工智能']
    terms += [word for word in glossary if word in compact]
    vocabulary = '、'.join(term[:80] for term in terms[:12])[:240]
    return '以下是简体中文产品解说。' + ('专有词：' + vocabulary + '。' if vocabulary else '')


def raw_tokens(raw, audio_duration=None):
    tokens = []
    for segment in raw['transcription']:
        for item in segment['tokens']:
            text = item['text']
            if text.startswith('[_') or text.startswith('<|') or not normalized(text):
                continue
            anchor = item.get('t_dtw')
            if not isinstance(anchor, (int,float)) or anchor < 0:
                raise ValueError('Invalid ASR token timing: a real DTW anchor is required')
            start, end = anchor / 100, segment['offsets']['to'] / 1000
            if tokens and start < tokens[-1]['start']:
                raise ValueError('Invalid ASR token timing: non-monotonic DTW anchors')
            if tokens:
                tokens[-1]['end'] = start
            tokens.append({'text': text, 'start': start, 'end': end})
    if not tokens:
        raise ValueError('ASR text contains no timed speech tokens')
    tokens[-1]['end'] = raw['transcription'][-1]['offsets']['to'] / 1000
    if audio_duration is not None:
        tokens[-1]['end'] = min(tokens[-1]['end'], audio_duration)
        if audio_duration <= 0 or any(t['start'] > audio_duration or t['end'] > audio_duration for t in tokens):
            raise ValueError('ASR timing exceeds actual audio duration')
    if tokens[-1]['end'] < tokens[-1]['start']:
        raise ValueError('Invalid ASR token timing at final segment')
    return tokens


def align_cues(raw, scenes, pronunciation, omitted=(), audio_duration=None):
    """Map exact recognized words to approved display text using real token boundaries."""
    tokens = raw_tokens(raw, audio_duration)
    ignored = {item['tokenIndex'] for item in omitted}
    actual = ''.join(normalized(t['text']) for i, t in enumerate(tokens) if i not in ignored)
    expected = ''.join(normalized(spoken(s['voiceover'], pronunciation)) for s in scenes)
    if actual != expected:
        raise ValueError('ASR text differs from approved spoken text: ' + actual)
    token_ends, offset = {}, 0
    for index, token in enumerate(tokens):
        offset += 0 if index in ignored else len(normalized(token['text']))
        token_ends[offset] = index
    cues, offset, first_token = [], 0, 0
    for scene in scenes:
        text = scene['voiceover']
        if not text.strip():
            continue
        scene_length = len(normalized(spoken(text, pronunciation)))
        if offset + scene_length not in token_ends:
            raise ValueError('Approved scene boundary is not an ASR token boundary')
        begin, last_end = 0, offset
        for end in range(1, len(text) + 1):
            count = offset + len(normalized(spoken(text[:end], pronunciation)))
            if count <= last_end or count not in token_ends:
                continue
            # Do not detach punctuation from its phrase or split a Latin product term.
            if end < len(text) and (not text[end].isalnum() or (text[end-1].isascii() and text[end].isascii() and text[end-1].isalnum() and text[end].isalnum())):
                continue
            punctuation = text[end-1] in '，。！？；：,.!?;:'
            if not (end == len(text) or punctuation or end - begin >= 14):
                continue
            tail = re.split(r'[，。！？；：,.!?;:]', text[end:], maxsplit=1)[0]
            if not punctuation and 0 < len(normalized(tail)) <= 3:
                continue  # Keep a short clause ending such as “里。” with its actual preceding words.
            last_token = token_ends[count]
            fragment = text[begin:end]
            if normalized(spoken(fragment, pronunciation)) != ''.join(normalized(tokens[i]['text']) for i in range(first_token,last_token+1) if i not in ignored):
                continue
            if tokens[last_token]['end'] <= tokens[first_token]['start']:
                continue
            cues.append({'sceneId': scene['id'], 'text': fragment,
                         'spokenText': spoken(fragment, pronunciation),
                         'start': tokens[first_token]['start'], 'end': tokens[last_token]['end'],
                         'tokenStart': first_token, 'tokenEnd': last_token})
            first_token, last_end, begin = last_token + 1, count, end
        if begin != len(text):
            raise ValueError('Cannot preserve approved copy at real ASR token boundaries')
        offset += scene_length
    return cues, tokens


def accepted_discourse_omission(raw, scenes, pronunciation, reuse_accepted):
    """Preserve an accepted waveform's question particle without changing approved subtitles.

    This is an explicit recorded exception, not a claim of verbatim ASR agreement.
    New synthesis never uses it, and missing/content words can never be omitted.
    """
    if not reuse_accepted:
        return []
    display = ''.join(s['voiceover'] for s in scenes)
    question = re.search('[?？]', display)
    if not question:
        return []
    prefix = normalized(spoken(display[:question.end()], pronunciation))
    expected = normalized(spoken(display, pronunciation))
    tokens = raw_tokens(raw)
    offset = ''
    for index, token in enumerate(tokens):
        if normalized(token['text']) == '啊' and offset == prefix:
            without = ''.join(normalized(t['text']) for i,t in enumerate(tokens) if i != index)
            if without == expected:
                return [{'tokenIndex':index,'text':token['text'],
                         'reason':'Question particle in the exact user-accepted audio; approved subtitle wording preserved.',
                         'reviewerType':'model','humanReviewed':False}]
        offset += normalized(token['text'])
    return []


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def read_json(file):
    return json.loads(Path(file).read_text(encoding='utf-8'))


def local(relative):
    if not isinstance(relative, str) or not relative or ':' in relative or '\\' in relative or any(p in ('', '.', '..') for p in relative.split('/')):
        raise ValueError('Expected safe project-relative path')
    target = ROOT / relative
    resolved = target.resolve(strict=True)
    if not resolved.is_relative_to(ROOT) or target.is_symlink():
        raise ValueError('Path leaves local project')
    return resolved


def checked(binding):
    file = local(binding['path'])
    if sha(file) != binding['sha256']:
        raise ValueError('Bound file changed: ' + binding['path'])
    return file


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('x', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')


def load_common():
    spec = importlib.util.spec_from_file_location('enhe_synthesize_common', ROOT / 'scripts/synthesize-zh.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_config(profile):
    config = read_json(ROOT / '.tools/qwen3-production-config.json')
    receipt = read_json(checked({'path': profile['selectionPath'], 'sha256': profile['selectionSha256']}))
    pointer = read_json(ROOT / '.tools/selected-voice.json')
    if (receipt.get('decision') != 'APPROVED' or receipt.get('selectedVoice') != profile['voiceId']
            or pointer.get('approvalSha256') != profile['selectionSha256']
            or pointer.get('approvalPath') != profile['selectionPath']
            or pointer.get('selectedVoice') != profile['voiceId']
            or receipt.get('rawSha256') != profile['referenceAudioSha256']):
        raise ValueError('Selected voice approval differs from requested profile')
    reference = checked({'path': receipt['rawPath'], 'sha256': receipt['rawSha256']})
    checked({'path': receipt['listenPath'], 'sha256': receipt['listenSha256']})
    if config.get('referenceSelection'):
        if (config['referenceSelection'] != {'path': profile['selectionPath'], 'sha256': profile['selectionSha256']}
                or not receipt.get('referenceVoiceCloningAuthorized') or not receipt.get('productionIntegrationAuthorized')):
            raise ValueError('Current reference production requires its own user authorization')
    authorization = read_json(checked(config['authorization']))
    if authorization.get('decision') != 'APPROVED' or not authorization.get('noExternalUpload'):
        raise ValueError('Local reference synthesis authorization required')
    manifest = read_json(checked(config['modelManifest']))
    if (manifest.get('status') != 'PASS' or manifest.get('authorizationSha256') != config['authorization']['sha256']
            or manifest.get('metadataSha256') != authorization.get('metadataSha256')):
        raise ValueError('Model manifest is not bound to the installation authorization')
    metadata = read_json(checked({'path':manifest['metadataPath'],'sha256':manifest['metadataSha256']}))
    model = config['model']
    if model['repoId'] != 'Qwen/Qwen3-TTS-12Hz-1.7B-Base':
        raise ValueError('Only the approved Qwen Base model is supported')
    group = next(g for g in manifest['models'] if g['repoId'] == model['repoId'])
    upstream = next(g for g in metadata if g['repoId'] == model['repoId'])
    aggregate = hashlib.sha256(json.dumps([{'path':x['sourcePath'],'sha256':x['sha256']} for x in group['files']],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    if model['revision'] != group['revision'] or model['revision'] != upstream['revision'] or model['sha256'] != aggregate:
        raise ValueError('Configured model identity differs from the verified authorized model')
    if {x['sourcePath'] for x in group['files']} != {x['path'] for x in upstream['files']}:
        raise ValueError('Model manifest does not cover the authorized model files')
    for item in group['files']:
        if item['path'] != model['path'] + '/' + item['sourcePath']:
            raise ValueError('Configured model path differs from its verified files')
        expected = next(x for x in upstream['files'] if x['path'] == item['sourcePath'])
        if item['bytes'] != expected['bytes'] or expected.get('sha256') and item['sha256'] != expected['sha256']:
            raise ValueError('Model file differs from authorized upstream metadata')
    model_files = manifest['files']
    for item in model_files:
        file = checked(item)
        if file.stat().st_size != item['bytes']:
            raise ValueError('Model size changed')
    for item in (config['asr']['model'], config['asr']['executable'], config['ffmpeg'], config['packageLock']):
        checked(item)
    for name, expected in config['versions'].items():
        if importlib.metadata.version(name) != expected:
            raise ValueError('Runtime version changed: ' + name)
    reference_text = checked(config['referenceText']).read_text(encoding='utf-8').strip()
    pronunciation = read_json(checked(config['referencePronunciation']))
    reference_spoken = spoken(reference_text, {x['display']: x['spoken'] for x in pronunciation['replacements']})
    if hashlib.sha256(reference_spoken.encode()).hexdigest() != receipt['identity']['spokenTextSha256']:
        raise ValueError('Reference transcript does not match the approved reference audio')
    return config, receipt, reference, reference_text, reference_spoken


def run_command(command, folder, name, timeout=1800):
    started = time.perf_counter()
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding='utf-8',
                            errors='replace', timeout=timeout, shell=False,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    evidence = {'command': command, 'cwd':str(ROOT), 'exitCode': result.returncode,
                'elapsedSec': time.perf_counter()-started, 'stdout': result.stdout, 'stderr': result.stderr}
    write_json(folder / name, evidence)
    if result.returncode:
        raise ValueError('Local command failed; see ' + str(folder / name))
    return evidence


def validate_samples(samples):
    import numpy as np
    if samples.ndim != 1 or samples.size == 0 or not np.isfinite(samples).all() or abs(samples).max() >= 1:
        raise ValueError('Generated audio invalid or clipped')


def generate_reference(config, text, reference, reference_text, output):
    """The only inference entry: one whole passage, synthetic approved reference, CPU."""
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel
    from transformers import set_seed
    torch.set_num_threads(8)
    set_seed(config['seed'])
    started = time.perf_counter()
    model = Qwen3TTSModel.from_pretrained(str(local(config['model']['path'])), device_map='cpu',
                                        dtype=torch.float32, attn_implementation='eager', local_files_only=True)
    reference_samples, rate = sf.read(str(reference), dtype='float32')
    wavs, rate = model.generate_voice_clone(text=text, language='Chinese',
        ref_audio=(reference_samples, rate), ref_text=reference_text, x_vector_only_mode=False,
        non_streaming_mode=True, **config['generation'])
    samples = np.asarray(wavs[0], dtype=np.float32)
    validate_samples(samples)
    sf.write(str(output), samples, rate, subtype='PCM_24')
    return {'elapsedSec': time.perf_counter()-started, 'samples': len(samples), 'sampleRate': rate}


def prepare(project, snapshot, profile, pronunciation, config, reference, reference_display, reference_spoken):
    display = ''.join(s['voiceover'] for s in snapshot['spec']['scenes'])
    text = spoken(display, pronunciation)
    mode = 'reuse-approved-audio' if display == reference_display and text == reference_spoken else 'reference-synthesis'
    identity = {'profile': profile, 'text': text, 'copySha256': snapshot['copySha256'],
                'model': config['model'], 'seed': config['seed'], 'generation': config['generation'],
                'sourceMode': mode, 'pronunciation': pronunciation,
                'synthesisFunctionSha256': hashlib.sha256(inspect.getsource(generate_reference).encode()).hexdigest(),
                'packageLockSha256': config['packageLock']['sha256']}
    prepared = project / '.qwen-prepared' / canonical_hash(identity)
    prepared.mkdir(parents=True, exist_ok=True)
    wave, receipt_file = prepared / 'narration.wav', prepared / 'source.json'
    if receipt_file.exists():
        receipt = read_json(receipt_file)
        if receipt['identity'] != identity or sha(wave) != receipt['audioSha256']:
            raise ValueError('Prepared voice identity or waveform changed')
    else:
        if wave.exists() or (prepared/'attempt.json').exists():
            raise ValueError('Interrupted synthesis preserved; inspect preparation before authorizing a retry')
        with (prepared/'source-runner.py').open('xb') as f:
            f.write(RUNNER_BYTES)
        write_json(prepared/'attempt.json', {'identity': identity, 'runnerSha256': RUNNER_SHA256, 'startedAt': time.time()})
        if mode == 'reuse-approved-audio':
            shutil.copyfile(reference, wave)
            inference = {'inferenceCount': 0}
        else:
            inference = {**generate_reference(config, text, reference, reference_spoken, wave), 'inferenceCount': 1}
        receipt = {'identity': identity, 'audioSha256': sha(wave), 'sourceMode': mode,
                   'runnerSha256': RUNNER_SHA256, 'inference': inference}
        write_json(receipt_file, receipt)
    if sha(prepared/'source-runner.py') != receipt['runnerSha256']:
        raise ValueError('Prepared synthesis runner snapshot differs from its source receipt')
    if receipt['sourceMode'] != mode or receipt['inference']['inferenceCount'] != (0 if mode == 'reuse-approved-audio' else 1):
        raise ValueError('Prepared voice source mode or inference count changed')
    # Keep ASR independent of synthesis: an alignment repair never re-runs the voice model.
    asr_identity = {'audioSha256': sha(wave), 'modelSha256': config['asr']['model']['sha256'],
                    'executableSha256': config['asr']['executable']['sha256'],
                    'prompt': asr_prompt(snapshot['spec']['scenes'], pronunciation),
                    'options': ['-l','zh','-ojf','-dtw','small','-ml','1','-t','8','-ng','-nf','-nfa','--carry-initial-prompt']}
    asr = prepared / ('asr-' + canonical_hash(asr_identity))
    asr.mkdir(exist_ok=True)
    raw_file, command_file = asr/'asr-raw.json', asr/'asr-command.json'
    if command_file.exists():
        command = read_json(command_file)
        if command['identity'] != asr_identity or command['rawSha256'] != sha(raw_file) or command['exitCode'] != 0:
            raise ValueError('Prepared ASR cache changed')
    else:
        if raw_file.exists() or (asr/'whisper-execution.json').exists():
            raise ValueError('Interrupted ASR preserved; inspect preparation before retry')
        converted = asr/'asr-input.wav'
        conversion = run_command([str(checked(config['ffmpeg'])), '-nostdin','-v','error','-i',str(wave),
                                  '-ar','16000','-ac','1','-c:a','pcm_s16le','-n',str(converted)], asr, 'conversion-command.json')
        expanded = ['-m',checked(config['asr']['model']).relative_to(ROOT).as_posix(),
                    '-f',converted.relative_to(ROOT).as_posix(), '-of',(asr/'asr-raw').relative_to(ROOT).as_posix(),
                    *asr_identity['options'], '--prompt',asr_identity['prompt']]
        argument_file = asr/'asr-arguments.txt'
        with argument_file.open('x',encoding='utf-8',newline='\n') as f:
            f.write('\n'.join(expanded)+'\n')
        args = [str(checked(config['asr']['executable'])), '@'+argument_file.relative_to(ROOT).as_posix()]
        command = run_command(args, asr, 'whisper-execution.json')
        command.update({'identity':asr_identity, 'audioSha256':sha(wave), 'modelSha256':config['asr']['model']['sha256'],
                        'rawSha256':sha(raw_file), 'inputSha256':sha(converted), 'conversion':conversion,
                        'argumentsFile':{'path':'reports/asr-arguments.txt','sha256':sha(argument_file)},'expandedArguments':expanded})
        write_json(command_file, command)
    raw = read_json(raw_file)
    omitted = accepted_discourse_omission(raw,snapshot['spec']['scenes'],pronunciation,mode=='reuse-approved-audio')
    import soundfile as sf
    cues, tokens = align_cues(raw, snapshot['spec']['scenes'], pronunciation,omitted,sf.info(str(wave)).duration)
    return wave, receipt, asr, cues, tokens, omitted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project_id')
    parser.add_argument('--semantic-scenes', action='store_true')
    parser.add_argument('--voice-profile', required=True)
    parser.add_argument('--pronunciation', required=True)
    parser.add_argument('--context-hash', required=True)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    for key in ('HF_HOME', 'TRANSFORMERS_CACHE', 'TORCH_HOME', 'TEMP', 'TMP', 'TMPDIR'):
        folder=ROOT/'.cache/qwen3-production'/key.lower();folder.mkdir(parents=True,exist_ok=True);os.environ[key]=str(folder)
    os.environ.update({'HF_HUB_OFFLINE':'1', 'TRANSFORMERS_OFFLINE':'1', 'HF_HUB_DISABLE_TELEMETRY':'1'})
    common = load_common()
    snapshot = common.snapshot_narration_inputs(ROOT, args.project_id)
    project = ROOT/'projects'/args.project_id
    profile = read_json(local(args.voice_profile))
    pronunciation = {x['display']:x['spoken'] for x in read_json(local(args.pronunciation))['replacements']}
    config, receipt, reference, reference_display, reference_spoken = load_config(profile)
    config_sha = sha(ROOT/'.tools/qwen3-production-config.json')
    if snapshot['spec']['audio']['voiceProfile'] != profile or snapshot['spec']['audio'].get('pronunciationMap',{}) != pronunciation:
        raise ValueError('Requested voice or pronunciation differs from reviewed project')
    if snapshot['spec']['generatorPolicy']['rulesSha256'] != args.context_hash:
        raise ValueError('Quality policy mismatch')
    wave, source, asr, cues, tokens, omitted = prepare(project,snapshot,profile,pronunciation,config,reference,reference_display,reference_spoken)
    common.check_snapshot_bytes(project,snapshot)
    if sha(ROOT/'.tools/qwen3-production-config.json') != config_sha:
        raise ValueError('Production configuration changed while processing')
    load_config(profile)  # Re-read bound resources before accepting generated output.
    import soundfile as sf
    info=sf.info(str(wave))
    if args.prepare_only:
        print(json.dumps({'status':'PREPARED','source':str(wave),'durationSec':info.duration,'cues':cues,'inference':source['inference']},ensure_ascii=False),flush=True)
        return
    scenes={s['id']:s for s in snapshot['spec']['scenes']}
    for cue in cues:
        scene=scenes[cue['sceneId']]
        if cue['start'] < scene['actualStartSec'] or cue['end'] > scene['actualEndSec']:
            raise ValueError('Measured speech exceeds authored scene; use --prepare-only, adjust new unfrozen scene timing and resume')
    audio_sha=sha(wave)
    settings={'referenceAudioSha256':profile['referenceAudioSha256'],'selectionSha256':profile['selectionSha256'],
              'instructApplied':False,'speed':1,'pitchSemitones':0}
    spec=snapshot['spec']; mode=spec['audio'].get('deliveryMode','presenter')
    controls={'mappingVersion':'qwen3-reference-v1','deliveryMode':mode,'referenceAudioSha256':profile['referenceAudioSha256'],
              'metadataOnly':['purpose','attitude','emphasis','pace','pause','visualEvent'],'unsupported':['instruct','per-scene-prosody']}
    generator={'provider':'qwen3-tts','backend':'qwen3-tts','backendVersion':config['versions']['qwen-tts'],
        'model':receipt['identity']['modelId'].split('/')[-1] if source['sourceMode']=='reuse-approved-audio' else profile['modelId'],
        'configuredModel':profile['modelId'],'frontend':'qwen3-tts','frontendVersion':config['versions']['qwen-tts'],
        'voice':profile['voiceId'],'locale':'zh-CN','profileHash':canonical_hash(profile),'sourceMode':source['sourceMode'],
        'settings':settings,'deliveryMode':mode,'directionMappingVersion':'qwen3-reference-v1'}
    identity={'profileHash':canonical_hash(profile),'selectionSha256':profile['selectionSha256'],
        'referenceAudioSha256':profile['referenceAudioSha256'],'scriptSha256':snapshot['scriptSha256'],
        'copySha256':snapshot['copySha256'],'spokenTextSha256':hashlib.sha256(''.join(c['spokenText'] for c in cues).encode()).hexdigest(),
        'pronunciationMapSha256':sha(local(args.pronunciation)),'contextHash':args.context_hash,
        'modelSha256':receipt['identity']['modelAggregateSha256'] if source['sourceMode']=='reuse-approved-audio' else config['model']['sha256'],
        'asrModelSha256':config['asr']['model']['sha256'],
        'sourceMode':source['sourceMode'],'sourceAudioSha256':audio_sha,'seed':config['seed'],'settings':settings,
        'synthesisScriptVersion':VERSION}
    with common.preserved_staging(project) as staging:
        (staging/'assets').mkdir();(staging/'reports').mkdir()
        shutil.copyfile(wave,staging/'assets/narration.wav')
        for name in ('asr-raw.json','asr-arguments.txt'):
            shutil.copyfile(asr/name,staging/'reports'/name)
        command = read_json(asr/'asr-command.json')
        converted = asr/'asr-input.wav'
        if sha(converted) != command['inputSha256']:
            raise ValueError('Prepared ASR input changed')
        command['input'] = {'path':converted.relative_to(ROOT).as_posix(),'sha256':sha(converted)}
        command['conversion'].update({'inputAudioSha256':audio_sha,'outputSha256':sha(converted),
                                      'executableSha256':config['ffmpeg']['sha256']})
        command['preparationReceipt'] = {'path':(asr/'asr-command.json').relative_to(ROOT).as_posix(),
                                         'sha256':sha(asr/'asr-command.json')}
        write_json(staging/'reports/asr-command.json',command)
        runtime = {}
        for key,source_path,target in [('config',ROOT/'.tools/qwen3-production-config.json','reports/qwen-runtime-config.json'),
            ('modelManifest',local(config['modelManifest']['path']),'reports/qwen-model-files.json'),
            ('authorization',local(config['authorization']['path']),'reports/qwen-authorization.json'),
            ('synthesisRunner',wave.parent/'source-runner.py','reports/qwen-synthesis-runner.py')]:
            shutil.copyfile(source_path,staging/target)
            runtime[key] = {'path':target,'sha256':sha(staging/target)}
        alignment={'schemaVersion':'1.0','status':'PASS','timingSource':'whisper-cpp-asr','audioSha256':audio_sha,
            'audioDurationSec':info.duration,
            'copySha256':snapshot['copySha256'],'spokenTextSha256':identity['spokenTextSha256'],
            'selectionSha256':profile['selectionSha256'],'model':config['asr']['model'],
            'raw':{'path':'reports/asr-raw.json','sha256':sha(asr/'asr-raw.json')},
            'command':{'path':'reports/asr-command.json','sha256':sha(staging/'reports/asr-command.json')},'cues':cues,'tokens':tokens,
            'omittedDiscourseTokens':omitted,'verbatimASRMatch':not omitted,
            'lexicalMatch':'MATCH_WITH_DOCUMENTED_DISCOURSE_OMISSION' if omitted else 'MATCH_AFTER_WRITTEN_NORMALIZATION',
            'orthographicNormalization':'NFKC with simplified equivalents for 變現實價'}
        if omitted:
            alignment['omissionReview'] = {'audioSha256':audio_sha,'rawSha256':sha(asr/'asr-raw.json'),
                'selectionSha256':profile['selectionSha256'],'reviewerType':'model','humanReviewed':False,
                'reason':omitted[0]['reason']}
        write_json(staging/'reports/asr-alignment.json',alignment)
        alignment_sha=sha(staging/'reports/asr-alignment.json')
        evidence_cues=[{**c,'voiceDirection':scenes[c['sceneId']].get('voiceDirection'),'effectiveProviderControls':controls} for c in cues]
        evidence={'schemaVersion':'1.0','timingSource':'whisper-cpp-asr',
            'timingEvidence':{'path':'reports/asr-alignment.json','sha256':alignment_sha,'method':'whisper-cpp-dtw-anchors-v1'},
            'audioSha256':audio_sha,'generator':generator,'cues':evidence_cues,'contextHash':args.context_hash,
            'qualityRulesSha256':args.context_hash,'synthesisIdentity':identity,'cacheKey':canonical_hash(identity)}
        write_json(staging/'reports/narration-cues.json',evidence)
        write_json(staging/'reports/tts-generation.json',{'status':'PASS','audioSha256':audio_sha,
            'specSha256':snapshot['specSha256'],'scriptSha256':snapshot['scriptSha256'],'copySha256':snapshot['copySha256'],
            'sampleRate':info.samplerate,'durationSec':info.frames/info.samplerate,'timingSource':'whisper-cpp-asr',
            'generator':generator,'sourceMode':source['sourceMode'],'modelSha256':identity['modelSha256'],
            'asrModelSha256':identity['asrModelSha256'],'alignmentSha256':alignment_sha,
            'cacheKey':canonical_hash(identity),'synthesisIdentity':identity,'sourceReceipt':source,'runtimeEvidence':runtime,
            'crossTextVoiceIdentity':'NOT_VERIFIED'})
        write_json(staging/'transcript.json',[{k:c[k] for k in ('text','start','end')} for c in cues])
        (staging/'captions.srt').write_text(''.join(f"{i+1}\n{common.srt_time(c['start'])} --> {common.srt_time(c['end'])}\n{c['text']}\n\n" for i,c in enumerate(cues)),encoding='utf-8')
        files=['assets/narration.wav','transcript.json','captions.srt','reports/narration-cues.json','reports/tts-generation.json','reports/asr-alignment.json','reports/asr-raw.json','reports/asr-command.json','reports/asr-arguments.txt',*[v['path'] for v in runtime.values()]]
        common.publish_approved_outputs(ROOT,args.project_id,snapshot,staging,files)
    print(json.dumps({'status':'PASS','sourceMode':source['sourceMode'],'audioSha256':audio_sha,'durationSec':info.duration},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
