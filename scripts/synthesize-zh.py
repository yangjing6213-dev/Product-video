"""Local Mandarin speech; caption boundaries come from actual PCM sample counts."""
import argparse
from dataclasses import asdict
from contextlib import contextmanager
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

try:
    from scripts.voice_direction import (PACE_FACTOR, VOICE_DIRECTION_MAPPING_VERSION,
                                         direction_identity_fields, resolve_voice_direction,
                                         validate_voice_direction)
except ModuleNotFoundError:  # Direct script execution puts scripts/, not the project root, on sys.path.
    from voice_direction import (PACE_FACTOR, VOICE_DIRECTION_MAPPING_VERSION,
                                 direction_identity_fields, resolve_voice_direction,
                                 validate_voice_direction)


def place_segments(lengths, rate, scene_start, scene_end):
    if (not lengths or any(not isinstance(n, int) or n <= 0 for n in lengths)
            or not isinstance(rate, int) or rate <= 0
            or not math.isfinite(scene_start) or not math.isfinite(scene_end)
            or scene_start < 0 or scene_end <= scene_start):
        raise ValueError("Invalid segment samples or scene interval")
    first, last = round(scene_start * rate), round(scene_end * rate)
    spare = last - first - sum(lengths)
    minimum = round(rate * (0.4 + 0.08 * (len(lengths) - 1)))
    if spare < minimum:
        raise ValueError("Measured speech does not fit the scene; shorten text or resynthesize")
    gap = spare // (len(lengths) + 1)
    if gap / rate > 1.5:
        raise ValueError("Speech leaves excessive silence; expand text or slow the voice")
    result = []
    cursor = first + gap
    for length in lengths:
        result.append((cursor, cursor + length))
        cursor += length + gap
    return result


def srt_time(seconds):
    millis = round(seconds * 1000)
    hours, remainder = divmod(millis, 3600000)
    minutes, remainder = divmod(remainder, 60000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def validate_phrase(text):
    if not isinstance(text, str) or not text.strip() or re.search(r"[A-Za-z]", text):
        raise ValueError("This Chinese frontend requires authored Chinese pronunciation, without Latin words")


def apply_pronunciation(text, pronunciation):
    spoken = text.strip()
    replacements = pronunciation.get("replacements")
    if not isinstance(replacements, list):
        raise ValueError("Explicit pronunciation replacements are required")
    for item in replacements:
        if (not isinstance(item, dict) or not isinstance(item.get("display"), str) or not item["display"]
                or not isinstance(item.get("spoken"), str) or not item["spoken"]):
            raise ValueError("Invalid pronunciation replacement")
        spoken = spoken.replace(item["display"], item["spoken"])
    validate_phrase(spoken)
    return spoken


def narration_units(scene, pronunciation, semantic_mode, script=None):
    if semantic_mode:
        return [apply_pronunciation(scene["voiceover"], pronunciation)]
    if script is None:
        raise ValueError("Legacy narration requires authored caption segments")
    texts = [item["text"] for item in script["captionSegments"]]
    for text in texts:
        validate_phrase(text)
    return texts


def adjust_speed_for_fit(speed, measured, available, attempt, semantic_mode):
    if semantic_mode:
        raise ValueError("Measured speech does not fit; revise narration or timeline")
    revised = round(speed * measured / available * 1.04, 3)
    if not 0.75 <= revised <= 1.3 or attempt == 3:
        raise ValueError("Measured speech does not fit the scene; revise narration text")
    return revised


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def semantic_evidence_fields(profile, profile_hash, context_hash):
    return {
        "generator": {
            "provider": profile["provider"], "locale": profile["locale"], "profileHash": profile_hash,
            "settings": {"speed": profile["speed"], "sentencePauseSec": profile["sentencePauseSec"],
                         "clausePauseSec": profile["clausePauseSec"], "trim": True,
                         "continuous": False, "isPhonemes": True},
        },
        "qualityRulesSha256": context_hash,
        "contextHash": context_hash,
    }


def local_input(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute() or ":" in relative:
        raise ValueError("TTS inputs must use project-relative local paths")
    candidate = (root / relative).resolve(strict=True)
    if not candidate.is_relative_to(root.resolve()) or candidate.is_symlink():
        raise ValueError("TTS input leaves the project")
    return candidate


def validate_voice_profile(value, available):
    if (not isinstance(value, dict) or value.get("provider") != "kokoro-onnx"
            or value.get("modelId") != "kokoro-v1.1-zh" or value.get("locale") != "zh-CN"
            or not isinstance(value.get("voiceId"), str) or not re.fullmatch(r"zm_\d{3}", value["voiceId"])
            or value["voiceId"] not in available or value["voiceId"] == "zm_011"):
        raise ValueError("Invalid or rejected current-task Mandarin male voice profile")
    for key, minimum, maximum in (("speed", 0.75, 1.3), ("sentencePauseSec", 0, 2), ("clausePauseSec", 0, 1)):
        number = value.get(key)
        if not isinstance(number, (int, float)) or isinstance(number, bool) or not math.isfinite(number) or not minimum <= number <= maximum:
            raise ValueError("Invalid current-task voice profile settings")
    return {key: value[key] for key in ("provider", "modelId", "voiceId", "locale", "speed", "sentencePauseSec", "clausePauseSec")}


def sha(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def publish_outputs(project, staging, relatives):
    """Publish complete staged files exclusively; rollback only this call's new files."""
    project, staging = project.resolve(), staging.resolve()
    targets = [(staging / item, (project / item).resolve()) for item in relatives]
    if any(not target.is_relative_to(project) or not source.resolve().is_relative_to(staging)
           for source, target in targets):
        raise ValueError("Output path must stay inside its project")
    published = []
    try:
        for source, target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            os.link(source, target)
            published.append((source, target))
    except Exception:
        for source, target in reversed(published):
            if target.exists() and target.samefile(source):
                target.unlink()
        raise


def require_copy_approval(root, project_id):
    """Use the same reviewed-copy gate as rendering, before loading or running TTS."""
    if not re.fullmatch(r"[a-z0-9-]+", project_id):
        raise ValueError("Invalid project ID")
    node = shutil.which("node")
    if not node:
        raise ValueError("Node is required to verify copy approval before speech generation")
    result = subprocess.run(
        [node, str(root / "src/quality/cli.ts"), "copy-check", "--project-root", str(root),
         "--project", project_id, "--legacy-spec"], cwd=root, capture_output=True,
        text=True, encoding="utf-8", shell=False,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if result.returncode:
        raise ValueError("Copy approval required before speech generation: " + result.stderr.strip())
    copy = json.loads(result.stdout)
    if copy.get("projectId") != project_id or not re.fullmatch(r"[0-9a-f]{64}", copy.get("copySha256", "")):
        raise ValueError("Copy check returned an invalid project identity or hash")
    return copy


def check_snapshot_bytes(project, snapshot):
    for relative, expected in [("video-spec.json", snapshot["specSha256"]),
                               ("input/narration-script.json", snapshot["scriptSha256"])]:
        if sha(project / relative) != expected:
            raise ValueError("Narration input changed after copy review: " + relative)


def snapshot_narration_inputs(root, project_id):
    """Consume the exact checked bytes, never a post-model-load reread of mutable inputs."""
    if not re.fullmatch(r"[a-z0-9-]+", project_id):
        raise ValueError("Invalid project ID")
    project = root / "projects" / project_id
    spec_bytes = (project / "video-spec.json").read_bytes()
    script_bytes = (project / "input/narration-script.json").read_bytes()
    spec, authored = json.loads(spec_bytes), json.loads(script_bytes)
    copy = require_copy_approval(root, project_id)
    narration = [scene["voiceover"] for scene in spec["scenes"] if scene["voiceover"].strip()]
    if (spec["projectId"] != copy["projectId"] or narration != copy["narration"]
            or spec["narrative"]["cta"] != copy["cta"]
            or "".join(narration).replace("\r", "").replace("\n", "")
            != "".join(copy["subtitles"]).replace("\r", "").replace("\n", "")):
        raise ValueError("Checked narration snapshot differs from approved copy")
    scene_ids = [scene["id"] for scene in spec["scenes"]]
    if (len(set(scene_ids)) != len(scene_ids) or len(authored["scenes"]) != len(scene_ids)
            or set(item["sceneId"] for item in authored["scenes"]) != set(scene_ids)):
        raise ValueError("Narration script must contain each reviewed scene exactly once")
    for scene in spec["scenes"]:
        script = next(item for item in authored["scenes"] if item["sceneId"] == scene["id"])
        if "".join(item["text"] for item in script["captionSegments"]) != scene["voiceover"]:
            raise ValueError("Caption phrases must exactly reconstruct reviewed voiceover")
    snapshot = {"projectId": project_id, "spec": spec, "authored": authored,
                "specSha256": hashlib.sha256(spec_bytes).hexdigest(),
                "scriptSha256": hashlib.sha256(script_bytes).hexdigest(), "copySha256": copy["copySha256"]}
    check_snapshot_bytes(project, snapshot)
    return snapshot


def publish_approved_outputs(root, project_id, snapshot, staging, relatives):
    project = root / "projects" / project_id
    try:
        check_snapshot_bytes(project, snapshot)
        current_copy = require_copy_approval(root, project_id)
        if current_copy["copySha256"] != snapshot["copySha256"]:
            raise ValueError("Copy approval changed during speech synthesis")
        check_snapshot_bytes(project, snapshot)
        publish_outputs(project, staging, relatives)
    except Exception as error:
        write_json(staging / "blocked-publication.json", {"status": "FAIL", "reason": str(error),
                   "copySha256": snapshot["copySha256"], "formalOutputsPublished": False,
                   "stagingPreserved": True})
        raise


@contextmanager
def preserved_staging(project):
    staging = Path(tempfile.mkdtemp(prefix=".tts-staging-", dir=project))
    try:
        yield staging
    except Exception:
        print(json.dumps({"status": "FAIL", "preservedStaging": str(staging)}, ensure_ascii=False), flush=True)
        raise
    else:
        resolved = staging.resolve()
        if resolved.parent != project.resolve() or not resolved.name.startswith(".tts-staging-"):
            raise ValueError("Unsafe TTS staging cleanup path")
        shutil.rmtree(resolved)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_ids", nargs="+")
    parser.add_argument("--semantic-scenes", action="store_true",
                        help="Generate each reviewed scene as one natural speech unit without speed fallback")
    parser.add_argument("--voice-profile", help="Project-relative current-task voice profile JSON")
    parser.add_argument("--pronunciation", help="Project-relative display-to-spoken replacement JSON")
    parser.add_argument("--context-hash", help="Lowercase SHA-256 of active quality rules, CTA and speech context")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if args.semantic_scenes:
        if not args.voice_profile or not args.pronunciation or not re.fullmatch(r"[0-9a-f]{64}", args.context_hash or ""):
            raise ValueError("Semantic scene synthesis requires voice profile, pronunciation map and context hash")
    elif args.voice_profile or args.pronunciation or args.context_hash:
        raise ValueError("Voice profile, pronunciation and context hash require --semantic-scenes")
    snapshots = [snapshot_narration_inputs(root, project_id) for project_id in args.project_ids]
    config = json.loads((root / ".tools/tts-config.json").read_text(encoding="utf-8"))
    for name in ("model", "voices"):
        file = (root / config[name]["path"]).resolve()
        if not file.is_relative_to(root / ".tools") or sha(file) != config[name]["sha256"]:
            raise ValueError(f"Unverified local {name} file")
    for name, version in config["packages"].items():
        if importlib.metadata.version(name) != version:
            raise ValueError(f"Package version mismatch: {name}")
    import numpy as np
    import onnxruntime as ort
    import soundfile as sf
    from kokoro_onnx import Kokoro
    from misaki.zh import ZHG2P
    ort.disable_telemetry_events()
    with np.load(root / config["voices"]["path"]) as available_voice_data:
        available_voices = set(available_voice_data.files)
    profile = None
    pronunciation = None
    pronunciation_sha = None
    profile_hash = None
    if args.semantic_scenes:
        profile_file = local_input(root, args.voice_profile)
        pronunciation_file = local_input(root, args.pronunciation)
        profile = validate_voice_profile(json.loads(profile_file.read_text(encoding="utf-8")), available_voices)
        pronunciation = json.loads(pronunciation_file.read_text(encoding="utf-8"))
        pronunciation_sha = sha(pronunciation_file)
        profile_hash = canonical_hash(profile)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(root / config["model"]["path"]), sess_options=options, providers=["CPUExecutionProvider"])
    model = Kokoro.from_session(session, str(root / config["voices"]["path"]))
    frontend = ZHG2P(version="1.1")
    voice = profile["voiceId"] if profile else config["synthesis"]["defaultVoice"]
    base_generator = {
        "backend": "kokoro-onnx", "backendVersion": importlib.metadata.version("kokoro-onnx"),
        "model": "kokoro-v1.1-zh", "frontend": "misaki",
        "frontendVersion": importlib.metadata.version("misaki"), "voice": voice,
    }
    for snapshot in snapshots:
        project_id = snapshot["projectId"]
        project = root / "projects" / project_id
        spec, authored = snapshot["spec"], snapshot["authored"]
        delivery_mode = spec.get("audio", {}).get("deliveryMode")
        voiced_scenes = [scene for scene in spec["scenes"] if scene["voiceover"].strip()]
        has_direction = any(scene.get("voiceDirection") is not None for scene in voiced_scenes)
        if (delivery_mode is None) != (not has_direction):
            raise ValueError("Delivery mode and every scene voice direction are required together")
        if delivery_mode is not None and (not profile or any(scene.get("voiceDirection") is None for scene in voiced_scenes)):
            raise ValueError("Current voice direction requires semantic synthesis and every scene direction")
        generator = dict(base_generator)
        if profile:
            semantic_fields = semantic_evidence_fields(profile, profile_hash, args.context_hash)
            generator.update(semantic_fields["generator"])
        if delivery_mode is not None:
            if delivery_mode not in PACE_FACTOR:
                raise ValueError("Invalid voice delivery mode")
            generator.update({"deliveryMode": delivery_mode, "directionMappingVersion": VOICE_DIRECTION_MAPPING_VERSION})
        audio_file = project / "assets/narration.wav"
        outputs = [audio_file, project / "transcript.json", project / "captions.srt",
                   project / "reports/narration-cues.json", project / "reports/tts-generation.json"]
        if any(file.exists() for file in outputs):
            raise FileExistsError("Narration output already exists; use a new project ID to preserve it")
        started = time.perf_counter()
        rate = config["synthesis"]["sampleRate"]
        assembled = np.zeros(round(spec["output"]["targetDurationSec"] * rate), dtype=np.float32)
        cues, segments, pending_segments = [], [], []
        for scene in spec["scenes"]:
            if not re.fullmatch(r"[a-z0-9-]+", scene["id"]):
                raise ValueError("Invalid scene ID")
            script = next(item for item in authored["scenes"] if item["sceneId"] == scene["id"])
            caption_texts = [item["text"] for item in script["captionSegments"]]
            if "".join(caption_texts) != scene["voiceover"]:
                raise ValueError("Caption phrases must exactly reconstruct authored voiceover")
            texts = narration_units(scene, pronunciation, args.semantic_scenes, script)
            cue_texts = [scene["voiceover"]] if args.semantic_scenes else caption_texts
            direction = validate_voice_direction(scene["voiceDirection"], scene["voiceover"]) if delivery_mode is not None else None
            controls = resolve_voice_direction(profile, delivery_mode, direction, scene["voiceover"]) if direction else None
            speed = float(controls["speed"] if controls else profile["speed"] if profile else config["synthesis"].get("speed", 1.0))
            for attempt in range(1 if args.semantic_scenes else 4):
                chunks = []
                for text in texts:
                    phonemes, _ = frontend(text)
                    settings = {"speed": speed, "is_phonemes": True}
                    if profile:
                        settings.update({"sentence_pause": controls["sentencePauseSec"] if controls else profile["sentencePauseSec"],
                                         "clause_pause": controls["clausePauseSec"] if controls else profile["clausePauseSec"],
                                         "trim": True, "continuous": False})
                    samples, actual_rate, timing = model.create_timed(phonemes, voice=voice, **settings)
                    if actual_rate != rate or not len(samples) or not np.isfinite(samples).all():
                        raise ValueError("TTS returned invalid audio")
                    chunks.append((samples, phonemes, timing))
                try:
                    positions = place_segments([len(chunk[0]) for chunk in chunks], rate, scene["actualStartSec"], scene["actualEndSec"])
                    break
                except ValueError as error:
                    available = scene["actualEndSec"] - scene["actualStartSec"] - 0.5 - 0.08 * (len(chunks) - 1)
                    if not math.isfinite(available) or available <= 0:
                        raise ValueError("Scene has no room for speech with required breathing gaps") from error
                    measured = sum(len(chunk[0]) / rate for chunk in chunks)
                    try:
                        speed = adjust_speed_for_fit(speed, measured, available, attempt, args.semantic_scenes)
                    except ValueError as fit_error:
                        raise ValueError(f"{project_id} {scene['id']}: {fit_error}") from error
            for index, (text, spoken, chunk, interval) in enumerate(zip(cue_texts, texts, chunks, positions)):
                samples, phonemes, timing = chunk
                start, end = interval
                if end > len(assembled):
                    raise ValueError("Speech extends beyond output duration")
                assembled[start:end] = samples
                relative = f"assets/narration-segments/{scene['id']}-{index + 1:02}.wav"
                segment_file = project / relative
                if segment_file.exists():
                    raise FileExistsError(str(segment_file))
                cue = {"sceneId": scene["id"], "text": text, "start": start / rate, "end": end / rate}
                if spoken != text:
                    cue["spokenText"] = spoken
                if direction:
                    cue.update({"voiceDirection": direction, "effectiveProviderControls": controls})
                cues.append(cue)
                pending_segments.append((segment_file, samples))
                segments.append({**cue, "file": relative, "samples": len(samples),
                                 "sampleRate": rate, "speed": speed, "phonemes": phonemes,
                                 "phonemeTimings": [asdict(item) for item in timing]})
            print(json.dumps({"projectId": project_id, "sceneId": scene["id"], "speed": speed,
                              "speechDurationSec": sum(len(chunk[0]) / rate for chunk in chunks)}, ensure_ascii=False), flush=True)
        peak = float(np.max(np.abs(assembled)))
        if not 0.001 < peak < 0.99:
            raise ValueError(f"Unsafe or silent generated signal peak: {peak}")
        with preserved_staging(project) as staging:
            for record, (segment_file, samples) in zip(segments, pending_segments):
                staged = staging / segment_file.relative_to(project)
                staged.parent.mkdir(parents=True, exist_ok=True)
                sf.write(staged, samples, rate, subtype="PCM_16")
                record["sha256"] = sha(staged)
            sf.write(staging / "assets/narration.wav", assembled, rate, subtype="PCM_16")
            audio_sha = sha(staging / "assets/narration.wav")
            write_json(staging / "reports/narration-cues.json", {"schemaVersion": "1.0", "timingSource": "tts-segment-duration",
                       "audioSha256": audio_sha, "generator": generator,
                       **({"qualityRulesSha256": semantic_fields["qualityRulesSha256"],
                           "contextHash": semantic_fields["contextHash"]} if profile else {}),
                       "cues": cues})
            transcript = [{key: cue[key] for key in ("text", "start", "end")} for cue in cues]
            write_json(staging / "transcript.json", transcript)
            with (staging / "captions.srt").open("x", encoding="utf-8", newline="\n") as stream:
                stream.write("\n\n".join(f"{index}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n{cue['text']}" for index, cue in enumerate(cues, 1)) + "\n")
            synthesis_identity = None
            if profile:
                synthesis_identity = {"schemaVersion": "1.0", "profileHash": profile_hash,
                    "spokenTextSha256": hashlib.sha256("".join(segment.get("spokenText", segment["text"])
                                                               for segment in segments).encode()).hexdigest(),
                    "pronunciationMapSha256": pronunciation_sha,
                    "orderedSegments": [segment.get("spokenText", segment["text"]) for segment in segments],
                    "segmentationVersion": "semantic-scene-direction-v1" if delivery_mode else "semantic-scene-v1", "modelSha256": config["model"]["sha256"],
                    "voicesSha256": config["voices"]["sha256"], "backendVersion": generator["backendVersion"],
                    "frontendVersion": generator["frontendVersion"], "frontendModelVersion": "1.1",
                    "synthesisScriptVersion": "3.0.0" if delivery_mode else "2.0.0", "contextHash": args.context_hash,
                    "scriptSha256": snapshot["scriptSha256"], "copySha256": snapshot["copySha256"]}
                if delivery_mode:
                    synthesis_identity.update(direction_identity_fields(
                        delivery_mode,
                        [segment["voiceDirection"] for segment in segments],
                        [segment["effectiveProviderControls"] for segment in segments]))
            write_json(staging / "reports/tts-generation.json", {"schemaVersion": "1.0", "status": "PASS", "generator": generator,
                       "modelSha256": config["model"]["sha256"], "voicesSha256": config["voices"]["sha256"],
                       "scriptSha256": snapshot["scriptSha256"], "specSha256": snapshot["specSha256"],
                       "copySha256": snapshot["copySha256"], "audioSha256": audio_sha,
                       "durationSec": len(assembled) / rate, "sampleRate": rate, "peak": peak,
                       "timingSource": "tts-segment-duration", "transcriptGranularity": "phrase", "asrStatus": "NOT_RUN",
                       "humanListeningReview": "NOT_RUN", "generationElapsedSec": time.perf_counter() - started,
                       **({"synthesisIdentity": synthesis_identity, "cacheKey": canonical_hash(synthesis_identity)} if synthesis_identity else {}),
                       "segments": segments})
            relatives = [file.relative_to(project) for file in outputs] + [file.relative_to(project) for file, _ in pending_segments]
            publish_approved_outputs(root, project_id, snapshot, staging, relatives)
        print(json.dumps({"projectId": project_id, "status": "PASS", "audioSha256": audio_sha, "cues": len(cues)}), flush=True)


if __name__ == "__main__":
    main()
