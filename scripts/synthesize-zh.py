"""Local Mandarin speech; caption boundaries come from actual PCM sample counts."""
import argparse
from dataclasses import asdict
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time


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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_ids", nargs="+")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
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
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(root / config["model"]["path"]), sess_options=options, providers=["CPUExecutionProvider"])
    model = Kokoro.from_session(session, str(root / config["voices"]["path"]))
    frontend = ZHG2P(version="1.1")
    voice = config["synthesis"]["defaultVoice"]
    generator = {
        "backend": "kokoro-onnx", "backendVersion": importlib.metadata.version("kokoro-onnx"),
        "model": "kokoro-v1.1-zh", "frontend": "misaki",
        "frontendVersion": importlib.metadata.version("misaki"), "voice": voice,
    }
    for project_id in args.project_ids:
        if not re.fullmatch(r"[a-z0-9-]+", project_id):
            raise ValueError("Invalid project ID")
        project = root / "projects" / project_id
        spec = json.loads((project / "video-spec.json").read_text(encoding="utf-8"))
        authored = json.loads((project / "input/narration-script.json").read_text(encoding="utf-8"))
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
            texts = [item["text"] for item in script["captionSegments"]]
            if "".join(texts) != scene["voiceover"]:
                raise ValueError("Caption phrases must exactly reconstruct authored voiceover")
            for text in texts:
                validate_phrase(text)
            speed = float(config["synthesis"].get("speed", 1.0))
            for attempt in range(4):
                chunks = []
                for text in texts:
                    phonemes, _ = frontend(text)
                    samples, actual_rate, timing = model.create_timed(phonemes, voice=voice, speed=speed, is_phonemes=True)
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
                    speed = round(speed * measured / available * 1.04, 3)
                    if not 0.75 <= speed <= 1.3 or attempt == 3:
                        raise ValueError(f"{project_id} {scene['id']}: {error}; revise narration text") from error
            for index, (text, chunk, interval) in enumerate(zip(texts, chunks, positions)):
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
        with tempfile.TemporaryDirectory(prefix=".tts-staging-", dir=project) as directory:
            staging = Path(directory)
            for record, (segment_file, samples) in zip(segments, pending_segments):
                staged = staging / segment_file.relative_to(project)
                staged.parent.mkdir(parents=True, exist_ok=True)
                sf.write(staged, samples, rate, subtype="PCM_16")
                record["sha256"] = sha(staged)
            sf.write(staging / "assets/narration.wav", assembled, rate, subtype="PCM_16")
            audio_sha = sha(staging / "assets/narration.wav")
            write_json(staging / "reports/narration-cues.json", {"schemaVersion": "1.0", "timingSource": "tts-segment-duration",
                       "audioSha256": audio_sha, "generator": generator, "cues": cues})
            transcript = [{key: cue[key] for key in ("text", "start", "end")} for cue in cues]
            write_json(staging / "transcript.json", transcript)
            with (staging / "captions.srt").open("x", encoding="utf-8", newline="\n") as stream:
                stream.write("\n\n".join(f"{index}\n{srt_time(cue['start'])} --> {srt_time(cue['end'])}\n{cue['text']}" for index, cue in enumerate(cues, 1)) + "\n")
            write_json(staging / "reports/tts-generation.json", {"schemaVersion": "1.0", "status": "PASS", "generator": generator,
                       "modelSha256": config["model"]["sha256"], "voicesSha256": config["voices"]["sha256"],
                       "scriptSha256": sha(project / "input/narration-script.json"), "audioSha256": audio_sha,
                       "durationSec": len(assembled) / rate, "sampleRate": rate, "peak": peak,
                       "timingSource": "tts-segment-duration", "transcriptGranularity": "phrase", "asrStatus": "NOT_RUN",
                       "humanListeningReview": "NOT_RUN", "generationElapsedSec": time.perf_counter() - started, "segments": segments})
            relatives = [file.relative_to(project) for file in outputs] + [file.relative_to(project) for file, _ in pending_segments]
            publish_outputs(project, staging, relatives)
        print(json.dumps({"projectId": project_id, "status": "PASS", "audioSha256": audio_sha, "cues": len(cues)}), flush=True)


if __name__ == "__main__":
    main()
