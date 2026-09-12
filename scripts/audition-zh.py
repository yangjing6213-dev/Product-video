# SPDX-License-Identifier: Apache-2.0
"""Generate at most three local Mandarin male auditions; never infer human acceptance."""
import argparse
from dataclasses import asdict
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path, PureWindowsPath
import re
import shutil
import socket
import subprocess
import sys
import time

try:
    from scripts.voice_direction import (PACE_FACTOR, VOICE_DIRECTION_MAPPING_VERSION,
                                         resolve_voice_direction, validate_voice_direction)
except ModuleNotFoundError:  # Direct script execution puts scripts/, not the project root, on sys.path.
    from voice_direction import (PACE_FACTOR, VOICE_DIRECTION_MAPPING_VERSION,
                                 resolve_voice_direction, validate_voice_direction)

VERSION = "1.0.0"
QUALITY_VERSION = "2.0.0"
DIRECTION_VERSION = "3.0.0"
SETTINGS = {"speed": 1.0, "sentence_pause": 0.3, "clause_pause": 0.12,
            "trim": True, "continuous": False, "is_phonemes": True}


def sha(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def cache_key(inputs):
    return hashlib.sha256(json.dumps(inputs, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def synthesis_key(inputs):
    return cache_key({key: value for key, value in inputs.items() if key != "mix"})


def local_path(root, relative):
    root = Path(root).resolve(strict=True)
    if not isinstance(relative, str) or not relative or ":" in relative or "\0" in relative or PureWindowsPath(relative).is_absolute():
        raise ValueError("Only project-relative local paths are allowed")
    parts = relative.replace("\\", "/").split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("Unsafe local path")
    target = root
    for part in parts:
        target = target / part
        if target.is_symlink() or target.is_junction():
            raise ValueError("Links and junctions are not allowed")
    if not target.resolve().is_relative_to(root):
        raise ValueError("Path leaves the project")
    return target


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def validate_voices(voices, available, rejected=None):
    rejected = set(rejected or ())
    if not 1 <= len(voices) <= 3 or len(set(voices)) != len(voices) or any(not re.fullmatch(r"zm_\d{3}", voice) or voice not in available for voice in voices):
        raise ValueError("Select one to three distinct available Mandarin male voice IDs")
    denied = rejected.intersection(voices)
    if denied:
        raise ValueError("Selected voice was rejected for this task: " + ", ".join(sorted(denied)))


def validate_character_count(count, minimum, maximum):
    if not all(isinstance(value, int) and not isinstance(value, bool) for value in (count, minimum, maximum)) or minimum < 1 or maximum < minimum or not minimum <= count <= maximum:
        raise ValueError(f"Audition character count must be within {minimum}–{maximum}")


def duration_in_window(duration, minimum, maximum):
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
               for value in (duration, minimum, maximum)) or minimum < 0 or maximum < minimum:
        raise ValueError("Invalid audition duration window")
    return minimum <= duration <= maximum


def audition_identity(*, text_sha, spoken_text_sha, pronunciation_sha, voice, model_sha,
                      voices_sha, versions, context_hash=None, locale=None, settings=None, mix=None,
                      delivery_mode=None, ordered_directions=None, ordered_effective_controls=None):
    identity = {"textSha256": text_sha, "spokenTextSha256": spoken_text_sha,
                "pronunciationSha256": pronunciation_sha, "provider": "kokoro-onnx",
                "modelId": "kokoro-v1.1-zh", "modelSha256": model_sha,
                "voicesSha256": voices_sha, "voiceId": voice,
                "settings": settings or SETTINGS, "versions": versions, "mix": mix or {}}
    if context_hash is not None:
        if not re.fullmatch(r"[0-9a-f]{64}", context_hash):
            raise ValueError("A lowercase SHA-256 quality context hash is required")
        if locale != "zh-CN":
            raise ValueError("The local Mandarin audition locale must be zh-CN")
        identity.update({"locale": locale, "contextHash": context_hash,
                         "segmentationVersion": "semantic-segment-direction-v1" if delivery_mode else "whole-passage-v1"})
    has_direction = any(value is not None for value in (delivery_mode, ordered_directions, ordered_effective_controls))
    if has_direction:
        if (delivery_mode not in PACE_FACTOR or not isinstance(ordered_directions, list)
                or not ordered_directions or not isinstance(ordered_effective_controls, list)
                or len(ordered_directions) != len(ordered_effective_controls)):
            raise ValueError("Delivery mode and ordered direction controls are required together")
        identity.update({"deliveryMode": delivery_mode, "orderedDirections": ordered_directions,
                         "orderedEffectiveControls": ordered_effective_controls,
                         "directionMappingVersion": VOICE_DIRECTION_MAPPING_VERSION})
    return identity


def spoken_text(display, pronunciation):
    text = display.strip()
    replacements = pronunciation.get("replacements")
    if not isinstance(replacements, list):
        raise ValueError("Explicit pronunciation replacements are required")
    for item in replacements:
        if not isinstance(item.get("display"), str) or not item["display"] or not isinstance(item.get("spoken"), str) or not item["spoken"]:
            raise ValueError("Invalid pronunciation replacement")
        text = text.replace(item["display"], item["spoken"])
    if not text or re.search(r"[A-Za-z]", text):
        raise ValueError("Chinese frontend needs explicit Chinese spoken text without Latin words")
    return text


def prepare_audition_segments(display, pronunciation, profile, delivery_mode, document):
    if (not isinstance(document, dict) or document.get("schemaVersion") != "1.0"
            or not isinstance(document.get("segments"), list) or not document["segments"]):
        raise ValueError("Voice direction document must contain semantic segments")
    if any(not isinstance(item, dict) or not isinstance(item.get("text"), str) or not item["text"]
           for item in document["segments"]):
        raise ValueError("Every audition direction segment needs exact display text")
    if "".join(item["text"] for item in document["segments"]) != display:
        raise ValueError("Voice direction segments must exactly reconstruct approved display text")
    result = []
    for item in document["segments"]:
        direction = validate_voice_direction(item.get("voiceDirection"), item["text"])
        result.append({"displayText": item["text"],
                       "spokenText": spoken_text(item["text"], pronunciation),
                       "voiceDirection": direction,
                       "effectiveProviderControls": resolve_voice_direction(
                           profile, delivery_mode, direction, item["text"])})
    return result


def verify_cache(directory, record, expected_key):
    if record.get("cacheKey") != expected_key or not record.get("files"):
        raise ValueError("Existing audition uses another cache identity")
    for item in record["files"]:
        if sha(local_path(directory, item["path"])) != item["sha256"]:
            raise ValueError("Audition cache bytes changed; preserve them and use a new output directory")
    return record


def reuse_raw(source_directory, output, identity, name):
    for receipt in sorted(source_directory.glob(f"audition-{identity['voiceId']}-*-raw.json")):
        previous = json.loads(receipt.read_text(encoding="utf-8"))
        source_identity = previous["identity"]
        label_migration = False
        if synthesis_key(source_identity) != synthesis_key(identity):
            corrected = {**source_identity, "segmentationVersion": identity.get("segmentationVersion")}
            label_migration = (source_identity.get("segmentationVersion") == "whole-passage-v1"
                               and identity.get("segmentationVersion") == "semantic-segment-direction-v1"
                               and synthesis_key(corrected) == synthesis_key(identity))
        if synthesis_key(source_identity) != synthesis_key(identity) and not label_migration:
            continue
        verify_cache(source_directory, previous, cache_key(previous["identity"]))
        source_timing_entry = next((item for item in previous["files"] if item["path"].endswith("-timing.json")), None)
        if source_timing_entry is None:
            raise ValueError("Raw cache lacks provider timing evidence")
        source_timing = json.loads(local_path(source_directory, source_timing_entry["path"]).read_text(encoding="utf-8"))
        if label_migration:
            source_segments = source_timing.get("segments") if isinstance(source_timing, dict) else None
            if (not isinstance(source_segments, list)
                    or [item.get("voiceDirection") for item in source_segments] != identity["orderedDirections"]
                    or [item.get("effectiveProviderControls") for item in source_segments] != identity["orderedEffectiveControls"]):
                raise ValueError("Legacy audition label cannot be corrected without exact segmented timing evidence")
        copied = []
        suffixes = ("-raw.wav", "-timing.json") + (("-cues.json",) if identity.get("deliveryMode") else ())
        for suffix in suffixes:
            entries = [item for item in previous["files"] if item["path"].endswith(suffix)]
            if len(entries) != 1:
                raise ValueError("Raw cache must contain exact audio and provider timing files")
            source = local_path(source_directory, entries[0]["path"])
            target = local_path(output, name + suffix)
            with source.open("rb") as reader, target.open("xb") as writer:
                shutil.copyfileobj(reader, writer)
            if sha(target) != entries[0]["sha256"]:
                raise ValueError("Raw cache copy hash differs")
            copied.append({"path": target.name, "sha256": sha(target)})
        timing_entry = next(item for item in copied if item["path"].endswith("-timing.json"))
        timing = json.loads(local_path(output, timing_entry["path"]).read_text(encoding="utf-8"))
        source_calls = len(timing.get("segments", [])) if isinstance(timing, dict) else 1
        source_calls = source_calls or 1
        return {**previous, "cacheKey": cache_key(identity), "identity": identity, "files": copied,
                "synthesisCalls": 0, "rawReuse": {"sourceReceiptSha256": sha(receipt),
                                                   "originalCacheKey": previous["cacheKey"],
                                                   "sourceSynthesisCalls": source_calls,
                                                   "identityCorrection": "segmentation-label-only" if label_migration else None}}
    raise ValueError("No matching verified raw audio; reuse mode does not synthesize again")


def prevent_network():
    for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY"):
        os.environ[key] = "1"

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("Network connections are disabled for this local audition process")
    socket.create_connection = unavailable
    socket.socket.connect = unavailable
    socket.socket.connect_ex = unavailable


def ffmpeg_run(command, evidence):
    result = subprocess.run([str(item) for item in command], capture_output=True, text=True, encoding="utf-8", errors="replace",
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0, timeout=180)
    write_json(evidence, {"command": [str(item) for item in command], "exitCode": result.returncode,
                          "stdout": result.stdout, "stderr": result.stderr})
    if result.returncode:
        raise RuntimeError(f"FFmpeg failed; inspect {evidence.name}")
    return result.stderr


def loudness_json(log):
    matches = re.findall(r'\{\s*"input_i"[\s\S]*?\}', log)
    if not matches:
        raise ValueError("FFmpeg did not return measured loudness")
    result = json.loads(matches[-1])
    if not all(math.isfinite(float(result[key])) for key in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")):
        raise ValueError("Audio loudness is not finite")
    return result


def normalize(ffmpeg, raw, listen, prefix):
    common = [ffmpeg, "-hide_banner", "-nostdin", "-n", "-i", raw]
    pan = "pan=stereo|c0=c0|c1=c0"
    target = "loudnorm=I=-16:TP=-1.5:LRA=11"
    measured = loudness_json(ffmpeg_run(common + ["-af", f"{pan},{target}:print_format=json", "-f", "null", "-"], prefix.with_name(prefix.name + "-measure-source.json")))
    filters = f"{pan},{target}:measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:offset={measured['target_offset']}:linear=true:print_format=json"
    ffmpeg_run(common + ["-af", filters, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", listen], prefix.with_name(prefix.name + "-normalize.json"))
    final = loudness_json(ffmpeg_run([ffmpeg, "-hide_banner", "-nostdin", "-i", listen, "-af", f"{target}:print_format=json", "-f", "null", "-"], prefix.with_name(prefix.name + "-measure-delivery.json")))
    short_log = ffmpeg_run([ffmpeg, "-hide_banner", "-nostdin", "-i", listen, "-af", "ebur128=peak=true", "-f", "null", "-"], prefix.with_name(prefix.name + "-short-term.json"))
    short_values = [float(value) for value in re.findall(r"\bS:\s*(-?\d+(?:\.\d+)?)", short_log)]
    return {"integratedLufs": float(final["input_i"]), "truePeakDbtp": float(final["input_tp"]),
            "loudnessRangeLu": float(final["input_lra"]), "maxShortTermLufs": max(short_values) if short_values else None,
            "status": "PASS" if -17 <= float(final["input_i"]) <= -15 and float(final["input_tp"]) <= -1 else "FAIL"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", required=True)
    parser.add_argument("--pronunciation", required=True)
    parser.add_argument("--output", default="reports/quality-r2/voice-auditions")
    parser.add_argument("--voices", nargs="+", default=["zm_009", "zm_011", "zm_029"])
    parser.add_argument("--reject-voices", nargs="*", default=[])
    parser.add_argument("--task-id", default="EPVS-V2-QUALITY-002")
    parser.add_argument("--revision", default="R2")
    parser.add_argument("--context-hash")
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--sentence-pause", type=float, default=0.3)
    parser.add_argument("--clause-pause", type=float, default=0.12)
    parser.add_argument("--delivery-mode", choices=["natural", "presenter"])
    parser.add_argument("--voice-direction", help="Project-relative semantic-segment voice direction JSON")
    parser.add_argument("--min-chinese-characters", type=int, default=60)
    parser.add_argument("--max-chinese-characters", type=int, default=100)
    parser.add_argument("--min-duration", type=float, default=15)
    parser.add_argument("--max-duration", type=float, default=25)
    parser.add_argument("--reuse-raw-from", help="Project-relative prior audition directory; never resynthesize in this mode")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output = local_path(root, args.output)
    output.mkdir(parents=True, exist_ok=True)
    text_file, map_file = local_path(root, args.text), local_path(root, args.pronunciation)
    display_text = text_file.read_text(encoding="utf-8").strip()
    pronunciation = json.loads(map_file.read_text(encoding="utf-8"))
    text = spoken_text(display_text, pronunciation)
    chinese_count = len(re.findall(r"[\u4e00-\u9fff]", text))
    validate_character_count(chinese_count, args.min_chinese_characters, args.max_chinese_characters)
    config_file = local_path(root, ".tools/tts-config.json")
    config_hash = sha(config_file)
    config = json.loads(config_file.read_text(encoding="utf-8"))
    model_file, voices_file = [local_path(root, config[key]["path"]) for key in ("model", "voices")]
    for name, file in (("model", model_file), ("voices", voices_file)):
        if not file.is_relative_to(root / ".tools") or sha(file) != config[name]["sha256"]:
            raise ValueError(f"Unverified local {name}")
    for name, version in config["packages"].items():
        if importlib.metadata.version(name) != version:
            raise ValueError(f"Package version mismatch: {name}")
    if not 0.75 <= args.speed <= 1.3 or not 0 <= args.sentence_pause <= 2 or not 0 <= args.clause_pause <= 1:
        raise ValueError("Invalid explicit audition speed or pause settings")
    if (args.delivery_mode is None) != (args.voice_direction is None):
        raise ValueError("Delivery mode and voice direction are required together")
    audition_segments = None
    if args.delivery_mode:
        direction_file = local_path(root, args.voice_direction)
        audition_segments = prepare_audition_segments(
            display_text, pronunciation,
            {"speed": args.speed, "sentencePauseSec": args.sentence_pause, "clausePauseSec": args.clause_pause},
            args.delivery_mode, json.loads(direction_file.read_text(encoding="utf-8")))
    settings = {**SETTINGS, "speed": args.speed, "sentence_pause": args.sentence_pause,
                "clause_pause": args.clause_pause}
    ordered_directions = [item["voiceDirection"] for item in audition_segments] if audition_segments else None
    ordered_effective_controls = [item["effectiveProviderControls"] for item in audition_segments] if audition_segments else None
    versions = {name: importlib.metadata.version(name) for name in ("kokoro-onnx", "misaki", "numpy", "onnxruntime", "soundfile")}
    versions.update({"auditionScript": DIRECTION_VERSION if audition_segments else QUALITY_VERSION if args.context_hash else VERSION,
                     "python": sys.version.split()[0]})
    prevent_network()
    import numpy as np
    import soundfile as sf
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    from misaki.zh import ZHG2P
    ort.disable_telemetry_events()
    with np.load(voices_file) as available:
        validate_voices(args.voices, available.files, args.reject_voices)
    ffmpeg = local_path(root, ".tools/ffmpeg-6.1.1.exe")
    if not ffmpeg.is_file():
        raise FileNotFoundError("Existing local FFmpeg is required; nothing will be downloaded")
    session, model, frontend = None, None, None
    records = []
    for voice in args.voices:
        identity = audition_identity(text_sha=sha(text_file), spoken_text_sha=hashlib.sha256(text.encode()).hexdigest(),
                    pronunciation_sha=sha(map_file), voice=voice, model_sha=config["model"]["sha256"],
                    voices_sha=config["voices"]["sha256"], versions=versions, context_hash=args.context_hash,
                    locale=args.locale, settings=settings,
                    delivery_mode=args.delivery_mode, ordered_directions=ordered_directions,
                    ordered_effective_controls=ordered_effective_controls,
                    mix={"version": "2", "integratedLufs": -16, "limiterTruePeakDbtp": -1.5,
                         "maximumTruePeakDbtp": -1, "sampleRate": 48000, "channels": 2,
                         "ffmpegSha256": sha(ffmpeg)})
        key = cache_key(identity)
        name = f"audition-{voice}-{key[:12]}"
        record_file = local_path(output, f"{name}.json")
        if record_file.exists():
            record = verify_cache(output, json.loads(record_file.read_text(encoding="utf-8")), key)
            records.append(record)
            print(json.dumps({"voiceId": voice, "cache": "HIT_VERIFIED", "cacheKey": key, "synthesisCalls": 0}), flush=True)
            continue
        raw_file = local_path(output, f"{name}-raw.wav")
        raw_receipt = local_path(output, f"{name}-raw.json")
        if raw_receipt.exists():
            raw_data = verify_cache(output, json.loads(raw_receipt.read_text(encoding="utf-8")), key)
        elif args.reuse_raw_from:
            raw_data = reuse_raw(local_path(root, args.reuse_raw_from), output, identity, name)
            write_json(raw_receipt, raw_data)
            print(json.dumps({"voiceId": voice, "cache": "RAW_REUSED_VERIFIED", "durationSec": raw_data["durationSec"], "synthesisCalls": 0}), flush=True)
        else:
            if raw_file.exists():
                raise FileExistsError("Unreceipted raw audio already exists; preserve it and choose a new output directory")
            if model is None:
                options = ort.SessionOptions()
                options.intra_op_num_threads = 4
                session = ort.InferenceSession(str(model_file), sess_options=options, providers=["CPUExecutionProvider"])
                model = Kokoro.from_session(session, str(voices_file))
                frontend = ZHG2P(version="1.1")
            started = time.perf_counter()
            synthesis_segments = audition_segments or [{"displayText": display_text, "spokenText": text}]
            chunks, timing_rows, provider_segments = [], [], []
            sample_rate = None
            sample_offset = 0
            for segment in synthesis_segments:
                phonemes, _ = frontend(segment["spokenText"])
                controls = segment.get("effectiveProviderControls")
                segment_settings = {**settings}
                if controls:
                    segment_settings.update({"speed": controls["speed"],
                                             "sentence_pause": controls["sentencePauseSec"],
                                             "clause_pause": controls["clausePauseSec"]})
                chunk, actual_rate, timing = model.create_timed(phonemes, voice=voice, **segment_settings)
                if sample_rate is None:
                    sample_rate = actual_rate
                elif sample_rate != actual_rate:
                    raise ValueError("Local synthesis sample rate changed between semantic segments")
                start = sample_offset / sample_rate
                chunks.append(chunk)
                sample_offset += len(chunk)
                end = sample_offset / sample_rate
                for item in timing:
                    row = asdict(item)
                    row["start"] += start
                    row["end"] += start
                    timing_rows.append(row)
                provider_segments.append({**segment, "phonemes": phonemes, "start": start, "end": end,
                                          "sampleCount": len(chunk), "providerSettings": segment_settings})
            samples = np.concatenate(chunks)
            if sample_rate != config["synthesis"]["sampleRate"] or not len(samples) or not np.isfinite(samples).all() or float(np.max(np.abs(samples))) <= 0.001:
                raise ValueError("Local synthesis returned invalid or silent audio")
            with raw_file.open("xb") as stream:
                sf.write(stream, samples, sample_rate, format="WAV", subtype="FLOAT")
            timing_file = local_path(output, f"{name}-timing.json")
            write_json(timing_file, {"schemaVersion": "1.0", "text": text,
                                    "phonemes": "".join(item["phonemes"] for item in provider_segments),
                                    "timingSource": "provider-phoneme-output" if timing_rows else "NONE",
                                    "timings": timing_rows, "segments": provider_segments,
                                    "sampleCount": len(samples), "sampleRate": sample_rate})
            raw_files = [raw_file, timing_file]
            if audition_segments:
                cues_file = local_path(output, f"{name}-cues.json")
                write_json(cues_file, {"schemaVersion": "1.0", "timingSource": "semantic-segment-duration",
                                      "deliveryMode": args.delivery_mode,
                                      "directionMappingVersion": VOICE_DIRECTION_MAPPING_VERSION,
                                      "cues": [{key: item[key] for key in ("displayText", "spokenText", "voiceDirection",
                                                                             "effectiveProviderControls", "start", "end")}
                                               for item in provider_segments]})
                raw_files.append(cues_file)
            synthesis_calls = len(synthesis_segments)
            raw_data = {"cacheKey": key, "identity": identity, "synthesisCalls": synthesis_calls,
                        "synthesisElapsedSec": time.perf_counter() - started,
                        "durationSec": len(samples) / sample_rate, "sampleRate": sample_rate, "samples": len(samples),
                        "samplePeak": float(np.max(np.abs(samples))), "timingAvailable": bool(timing_rows),
                        "files": [{"path": file.name, "sha256": sha(file)} for file in raw_files]}
            write_json(raw_receipt, raw_data)
            print(json.dumps({"voiceId": voice, "cache": "GENERATED", "durationSec": raw_data["durationSec"],
                              "synthesisCalls": synthesis_calls}), flush=True)
        listen_file = local_path(output, f"{name}-listen.wav")
        loudness = normalize(ffmpeg, raw_file, listen_file, output / name)
        info = sf.info(listen_file)
        duration_pass = duration_in_window(raw_data["durationSec"], args.min_duration, args.max_duration)
        technical_pass = duration_pass and loudness["status"] == "PASS" and info.channels == 2 and info.samplerate == 48000 and abs(info.duration - raw_data["durationSec"]) <= 0.02
        evidence_files = [file for file in output.glob(f"{name}-*") if file.is_file()]
        record = {"schemaVersion": "1.0", "cacheKey": key, "identity": identity, "voiceId": voice,
                  "technicalStatus": "PASS" if technical_pass else "PARTIAL", "durationStatus": "PASS" if duration_pass else "PARTIAL",
                  "durationSec": raw_data["durationSec"], "synthesisCalls": raw_data["synthesisCalls"],
                  "synthesisElapsedSec": raw_data["synthesisElapsedSec"],
                  **({"rawReuse": raw_data["rawReuse"]} if "rawReuse" in raw_data else {}),
                  "rawPath": raw_file.name, "listenPath": listen_file.name, "deliveredSampleRate": info.samplerate,
                  "deliveredChannels": info.channels, "deliveredDurationSec": info.duration, "loudness": loudness,
                  "humanReview": "NOT_RUN", "humanScore": None, "voiceProfileApproval": "NOT_RUN", "selected": False,
                  "externalApiCalls": 0, "generationCost": {"amount": 0, "currency": "CNY", "basis": "existing local CPU model; no paid service"},
                  "files": [{"path": file.name, "sha256": sha(file)} for file in sorted(evidence_files)]}
        write_json(record_file, record)
        records.append(record)
    if sha(config_file) != config_hash:
        raise ValueError("Existing TTS configuration changed during audition")
    manifest = {"schemaVersion": "1.0", "taskId": args.task_id, "revision": args.revision, "milestone": "M1",
                "technicalStatus": "PASS" if all(row["technicalStatus"] == "PASS" for row in records) else "PARTIAL",
                "voiceReview": "NOT_RUN", "humanScore": None, "userAcceptance": "NOT_RUN", "selectedVoiceId": None,
                "textPath": text_file.relative_to(root).as_posix(), "textSha256": sha(text_file),
                "pronunciationMapPath": map_file.relative_to(root).as_posix(), "pronunciationMapSha256": sha(map_file),
                "chineseCharacterCount": chinese_count, "sampleCount": len(records), "records": records,
                "networkPolicy": "process-local socket connections disabled, HF offline flags, ONNX telemetry disabled",
                "externalApiCalls": 0, "generationCostCny": 0, "existingTtsConfigSha256": config_hash,
                "limitations": ["No human listening acceptance exists; age, warmth, Mandarin quality and naturalness remain unaccepted.",
                                "Voice IDs are actual zm_ entries in the existing Chinese model; no voice cloning or pitch shifting.",
                                "Timing file contains provider phoneme data only when available, never fabricated character alignment."]}
    manifest_file = local_path(output, "manifest.json")
    if manifest_file.exists():
        if json.loads(manifest_file.read_text(encoding="utf-8")) != manifest:
            raise FileExistsError("A different manifest already exists; choose a new output directory")
    else:
        write_json(manifest_file, manifest)
    print(json.dumps({"technicalStatus": manifest["technicalStatus"], "voiceReview": "NOT_RUN", "sampleCount": len(records),
                      "manifest": manifest_file.relative_to(root).as_posix(), "costCny": 0}), flush=True)


if __name__ == "__main__":
    main()
