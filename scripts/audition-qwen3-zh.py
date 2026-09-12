# SPDX-License-Identifier: Apache-2.0
"""Generate one or two bounded local Qwen3-TTS Dylan auditions with no voice cloning."""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path, PureWindowsPath
import re
import socket
import time

RUN_REQUEST_PATH = "reports/presenter-flow-upgrade-20260911/qwen3-tts/run-request-v2.json"
RUN_REQUEST_SHA256 = "5e53acad7cdf8c0c8cf4468dbc131c6496c4e519647b19cc2aa2ec5c20682619"


def sha(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def cache_key(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def local_path(root, relative, must_exist=True):
    root = Path(root).resolve(strict=True)
    if not isinstance(relative, str) or not relative or ":" in relative or "\0" in relative or PureWindowsPath(relative).is_absolute():
        raise ValueError("Only project-relative local paths are allowed")
    parts = relative.replace("\\", "/").split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("Unsafe local path")
    target = root.joinpath(*parts)
    if must_exist:
        target = target.resolve(strict=True)
    elif not target.resolve().is_relative_to(root):
        raise ValueError("Path leaves the project")
    if not target.resolve().is_relative_to(root) or target.is_symlink():
        raise ValueError("Path leaves the project or uses a link")
    return target


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def spoken_text(display, pronunciation):
    spoken = display.strip()
    replacements = pronunciation.get("replacements")
    if not isinstance(replacements, list):
        raise ValueError("Explicit pronunciation replacements are required")
    for item in replacements:
        if (not isinstance(item, dict) or not isinstance(item.get("display"), str) or not item["display"]
                or not isinstance(item.get("spoken"), str) or not item["spoken"]):
            raise ValueError("Invalid pronunciation replacement")
        spoken = spoken.replace(item["display"], item["spoken"])
    if not spoken:
        raise ValueError("Spoken text is empty")
    return spoken


def parse_instructions(root, values):
    if not isinstance(values, list) or not 1 <= len(values) <= 2:
        raise ValueError("Select one or two instruction variants")
    result = []
    for value in values:
        if not isinstance(value, str) or "=" not in value:
            raise ValueError("Instruction must use name=relative-path")
        name, relative = value.split("=", 1)
        if not re.fullmatch(r"[a-z0-9-]+", name) or any(item["name"] == name for item in result):
            raise ValueError("Instruction names must be unique lowercase slugs")
        text = local_path(root, relative).read_text(encoding="utf-8").strip()
        if not text:
            raise ValueError("Instruction text is empty")
        result.append({"name": name, "path": relative.replace("\\", "/"), "text": text,
                       "sha256": hashlib.sha256(text.encode()).hexdigest()})
    return result


def audition_identity(common, variant, instruct):
    return {"schemaVersion": "1.0", **common, "variant": variant,
            "instruct": instruct, "instructSha256": hashlib.sha256(instruct.encode()).hexdigest(),
            "providerTimingAvailable": False}


def provider_evidence(sample_count, sample_rate):
    if not isinstance(sample_count, int) or sample_count <= 0 or not isinstance(sample_rate, int) or sample_rate <= 0:
        raise ValueError("Invalid provider waveform")
    return {"sampleCount": sample_count, "sampleRate": sample_rate,
            "durationSec": sample_count / sample_rate, "timingSource": "NONE",
            "phonemeTimings": None, "wordTimings": None}


def validate_authorization(root, config, authorization_file):
    expected = config["authorization"]
    if sha(authorization_file) != expected["receiptSha256"]:
        raise ValueError("Local Qwen authorization receipt changed")
    value = json.loads(authorization_file.read_text(encoding="utf-8"))
    if (value.get("decision") != expected["decision"] or value.get("userAnswer") != expected["userAnswer"]
            or value.get("proposal") != expected["proposalPath"]
            or value.get("proposalSha256") != expected["proposalSha256"]
            or sha(local_path(root, expected["proposalPath"])) != expected["proposalSha256"]
            or config.get("speaker") != expected["requiredSpeaker"]
            or config.get("runtime", {}).get("device") != expected["requiredDevice"]
            or expected.get("maxAuditions") != 2):
        raise ValueError("Local Qwen authorization scope does not match fixed audition configuration")
    return value


def validate_copy_binding(root, config, display):
    expected = config["approvedCopy"]
    document = local_path(root, expected["documentPath"])
    receipt_file = local_path(root, expected["receiptPath"])
    if sha(document) != expected["documentSha256"] or sha(receipt_file) != expected["receiptSha256"]:
        raise ValueError("Approved v2 copy or receipt changed")
    receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
    if (receipt.get("decision") != expected["decision"] or receipt.get("version") != expected["version"]
            or receipt.get("copyPath") != expected["documentPath"]
            or receipt.get("sha256") != expected["documentSha256"]):
        raise ValueError("Approved v2 copy receipt is invalid")
    if sum(line.strip() == display for line in document.read_text(encoding="utf-8").splitlines()) != 1:
        raise ValueError("Audition text is not the exact approved v2 full narration line")
    return receipt


def verify_model_files(root, config):
    manifest_file = local_path(root, config["model"]["filesManifestPath"])
    if sha(manifest_file) != config["model"]["filesManifestSha256"]:
        raise ValueError("Qwen model file manifest changed")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("revision") != config["model"]["revision"] or manifest.get("aggregateSha256") != config["model"]["aggregateSha256"]:
        raise ValueError("Qwen model revision or aggregate identity changed")
    for item in manifest["files"]:
        file = local_path(root, item["path"])
        if file.stat().st_size != item["bytes"] or sha(file) != item["sha256"]:
            raise ValueError("Qwen model file changed: " + item["path"])


def prevent_network():
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    def blocked(*_args, **_kwargs):
        raise RuntimeError("Network is disabled during local Qwen audition")
    socket.create_connection = blocked
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked


def verify_cache(directory, receipt, expected_key, expected_identity):
    files = receipt.get("files")
    if (receipt.get("cacheKey") != expected_key or receipt.get("identity") != expected_identity
            or receipt.get("technicalStatus") != "PASS" or receipt.get("humanReview") != "NOT_RUN"
            or receipt.get("selected") is not False or not isinstance(files, list) or len(files) != 2
            or not isinstance(receipt.get("rawPath"), str) or not isinstance(receipt.get("providerEvidencePath"), str)
            or {item.get("path") for item in files} != {receipt["rawPath"], receipt["providerEvidencePath"]}):
        raise ValueError("Existing Qwen audition uses another identity or review state")
    for item in files:
        if sha(local_path(directory, item["path"])) != item["sha256"]:
            raise ValueError("Existing Qwen audition bytes changed")
    provider = json.loads(local_path(directory, receipt["providerEvidencePath"]).read_text(encoding="utf-8"))
    if (provider.get("speaker") != expected_identity["speaker"]
            or provider.get("language") != expected_identity["language"]
            or provider.get("instruct") != expected_identity["instruct"]
            or hashlib.sha256(provider.get("text", "").encode()).hexdigest() != expected_identity["textSha256"]
            or hashlib.sha256(provider.get("spokenText", "").encode()).hexdigest() != expected_identity["spokenTextSha256"]
            or provider.get("timingSource") != "NONE" or provider.get("phonemeTimings") is not None
            or provider.get("wordTimings") is not None):
        raise ValueError("Existing Qwen provider evidence differs from the authorized identity")
    return receipt


def validate_run_request(root, actual):
    request_file = local_path(root, RUN_REQUEST_PATH)
    if sha(request_file) != RUN_REQUEST_SHA256:
        raise ValueError("Fixed Qwen run request changed")
    if json.loads(request_file.read_text(encoding="utf-8")) != actual:
        raise ValueError("Qwen run does not match the fixed authorized two-variant request")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", required=True)
    parser.add_argument("--pronunciation", required=True)
    parser.add_argument("--instruction", action="append", required=True, dest="instructions")
    parser.add_argument("--output", required=True)
    parser.add_argument("--authorization", required=True)
    parser.add_argument("--copy-sha", required=True)
    parser.add_argument("--context-hash", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    config_file = local_path(root, ".tools/qwen3-tts-config.json")
    config = json.loads(config_file.read_text(encoding="utf-8"))
    text_file, pronunciation_file = local_path(root, args.text), local_path(root, args.pronunciation)
    authorization_file = local_path(root, args.authorization)
    for label, value in (("copy", args.copy_sha), ("context", args.context_hash)):
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ValueError(f"Invalid {label} SHA-256")
    if args.authorization.replace("\\", "/") != config["authorization"]["receiptPath"]:
        raise ValueError("Use the fixed local Qwen authorization receipt")
    authorization = validate_authorization(root, config, authorization_file)
    lock_file = local_path(root, config["packageLockPath"])
    if sha(lock_file) != config["packageLockSha256"]:
        raise ValueError("Qwen package lock changed")
    verify_model_files(root, config)
    display = text_file.read_text(encoding="utf-8").strip()
    copy_receipt = validate_copy_binding(root, config, display)
    if args.copy_sha != config["approvedCopy"]["documentSha256"]:
        raise ValueError("Requested copy SHA differs from approved v2")
    pronunciation = json.loads(pronunciation_file.read_text(encoding="utf-8"))
    spoken = spoken_text(display, pronunciation)
    instructions = parse_instructions(root, args.instructions)
    if args.output.replace("\\", "/") != config["authorization"]["outputPath"]:
        raise ValueError("Qwen authorization is fixed to one cumulative two-audition output directory")
    output = local_path(root, args.output, must_exist=False)
    generation = config["generation"]
    versions = {name: importlib.metadata.version(name) for name in ("qwen-tts", "torch", "torchaudio", "transformers", "accelerate", "soundfile")}
    common = {"provider": "qwen-tts", "modelId": config["model"]["repoId"],
              "revision": config["model"]["revision"], "modelAggregateSha256": config["model"]["aggregateSha256"],
              "packageLockSha256": config["packageLockSha256"], "speaker": config["speaker"],
              "language": config["language"], "device": config["runtime"]["device"],
              "dtype": config["runtime"]["dtype"], "attentionImplementation": config["runtime"]["attentionImplementation"],
              "textSha256": hashlib.sha256(display.encode()).hexdigest(), "textFileSha256": sha(text_file),
              "spokenTextSha256": hashlib.sha256(spoken.encode()).hexdigest(),
              "pronunciationSha256": sha(pronunciation_file), "copySha256": args.copy_sha,
              "contextHash": args.context_hash, "authorizationSha256": sha(authorization_file),
              "copyReceiptSha256": sha(local_path(root, config["approvedCopy"]["receiptPath"])),
              "configurationSha256": sha(config_file),
              "generation": generation, "versions": versions}
    pending, records = [], []
    planned_files = {"authorization-lock.json", "manifest.json"}
    planned_identities = []
    for item in instructions:
        identity = audition_identity(common, item["name"], item["text"])
        key = cache_key(identity)
        name = f"qwen3-dylan-{item['name']}-{key[:12]}"
        planned_identities.append({"variant": item["name"], "cacheKey": key, "identity": identity})
        receipt_file = output / f"{name}.json"
        planned_files.update({receipt_file.name, f"{name}-raw.wav", f"{name}-provider.json"})
        if receipt_file.exists():
            records.append(verify_cache(output, json.loads(receipt_file.read_text(encoding="utf-8")), key, identity))
        else:
            pending.append((item, identity, key, name, receipt_file))
    run_request = {"schemaVersion": "1.0", "authorizationSha256": sha(authorization_file),
                   "outputPath": config["authorization"]["outputPath"],
                   "maxAuditions": config["authorization"]["maxAuditions"],
                   "textPath": args.text.replace("\\", "/"), "textFileSha256": sha(text_file),
                   "pronunciationPath": args.pronunciation.replace("\\", "/"),
                   "pronunciationSha256": sha(pronunciation_file),
                   "instructions": [{"name": item["name"], "path": item["path"],
                                      "sha256": item["sha256"]} for item in instructions],
                   "copySha256": args.copy_sha, "contextHash": args.context_hash,
                   "speaker": config["speaker"], "language": config["language"],
                   "device": config["runtime"]["device"], "modelRevision": config["model"]["revision"],
                   "modelAggregateSha256": config["model"]["aggregateSha256"],
                   "packageLockSha256": config["packageLockSha256"],
                   "plannedIdentities": planned_identities}
    validate_run_request(root, run_request)
    output.mkdir(parents=True, exist_ok=True)
    lock = {"schemaVersion": "1.0", "authorizationSha256": sha(authorization_file),
            "authorizationDecision": authorization["decision"], "copySha256": args.copy_sha,
            "copyReceiptSha256": config["approvedCopy"]["receiptSha256"],
            "speaker": config["speaker"], "language": config["language"], "device": config["runtime"]["device"],
            "variants": [{"name": item["name"], "instructSha256": item["sha256"]} for item in instructions],
            "maxAuditions": config["authorization"]["maxAuditions"], "outputPath": config["authorization"]["outputPath"],
            "configurationSha256": sha(config_file), "scriptSha256": sha(Path(__file__)),
            "plannedIdentities": planned_identities}
    lock_file = output / "authorization-lock.json"
    if lock_file.exists():
        if json.loads(lock_file.read_text(encoding="utf-8")) != lock:
            raise ValueError("Qwen audition output is locked to another authorized two-variant set")
    else:
        if any(output.iterdir()):
            raise ValueError("Qwen audition output contains unbound files")
        write_json(lock_file, lock)
    unexpected = {file.name for file in output.iterdir() if file.is_file()} - planned_files
    if unexpected:
        raise ValueError("Qwen audition output contains unexpected files: " + ", ".join(sorted(unexpected)))
    for _, _, _, name, receipt_file in pending:
        if any((output / f"{name}{suffix}").exists() for suffix in ("-raw.wav", "-provider.json")):
            raise ValueError("Qwen audition has unreceipted output; preserve it and do not infer again")
    if (output / "manifest.json").exists() and pending:
        raise ValueError("Qwen audition manifest exists but an authorized receipt is missing")
    if pending:
        prevent_network()
        import numpy as np
        import psutil
        import soundfile as sf
        import torch
        from qwen_tts import Qwen3TTSModel
        load_started = time.perf_counter()
        model = Qwen3TTSModel.from_pretrained(str(local_path(root, config["model"]["path"])),
                    device_map="cpu", dtype=torch.float32, attn_implementation="eager", local_files_only=True)
        load_elapsed = time.perf_counter() - load_started
        if config["speaker"].lower() not in model.get_supported_speakers() or config["language"].lower() not in model.get_supported_languages():
            raise ValueError("Configured Qwen speaker or language is unavailable")
        for item, identity, key, name, receipt_file in pending:
            torch.manual_seed(generation["seed"])
            started = time.perf_counter()
            wavs, sample_rate = model.generate_custom_voice(
                text=spoken, speaker=config["speaker"], language=config["language"], instruct=item["text"],
                non_streaming_mode=True, do_sample=generation["doSample"], temperature=generation["temperature"],
                top_p=generation["topP"], top_k=generation["topK"], repetition_penalty=generation["repetitionPenalty"],
                subtalker_dosample=generation["subtalkerDoSample"], subtalker_temperature=generation["subtalkerTemperature"],
                subtalker_top_p=generation["subtalkerTopP"], subtalker_top_k=generation["subtalkerTopK"],
                max_new_tokens=generation["maxNewTokens"])
            elapsed = time.perf_counter() - started
            if len(wavs) != 1:
                raise ValueError("Qwen returned an unexpected waveform count")
            wav = np.asarray(wavs[0], dtype=np.float32)
            if wav.ndim != 1 or not len(wav) or not np.isfinite(wav).all() or float(np.max(np.abs(wav))) <= 0.001:
                raise ValueError("Qwen returned invalid or silent audio")
            raw_file = output / f"{name}-raw.wav"
            with raw_file.open("xb") as stream:
                sf.write(stream, wav, sample_rate, format="WAV", subtype="PCM_24")
            provider = provider_evidence(len(wav), sample_rate)
            provider_file = output / f"{name}-provider.json"
            write_json(provider_file, {"schemaVersion": "1.0", "text": display, "spokenText": spoken,
                                       "speaker": config["speaker"], "language": config["language"],
                                       "instruct": item["text"], **provider})
            info = sf.info(raw_file)
            memory = psutil.Process().memory_info()
            receipt = {"schemaVersion": "1.0", "cacheKey": key, "identity": identity,
                       "technicalStatus": "PASS", "humanReview": "NOT_RUN", "selected": False,
                       "rawPath": raw_file.name, "providerEvidencePath": provider_file.name,
                       "durationSec": info.duration, "sampleRate": info.samplerate, "channels": info.channels,
                       "subtype": info.subtype, "samplePeak": float(np.max(np.abs(wav))),
                       "sampleRms": float(np.sqrt(np.mean(np.square(wav)))), "modelLoadElapsedSec": load_elapsed,
                       "generationElapsedSec": elapsed, "realTimeFactor": elapsed / info.duration,
                       "rssBytesAfterGeneration": memory.rss,
                       "peakWorkingSetBytes": getattr(memory, "peak_wset", None),
                       "providerTimingAvailable": False, "timingSource": "NONE",
                       "externalApiCalls": 0, "generationCost": {"amount": 0, "currency": "CNY"},
                       "files": [{"path": file.name, "sha256": sha(file)} for file in (raw_file, provider_file)]}
            write_json(receipt_file, receipt)
            records.append(receipt)
            print(json.dumps({"variant": item["name"], "status": "GENERATED", "durationSec": info.duration,
                              "generationElapsedSec": elapsed, "realTimeFactor": elapsed / info.duration}, ensure_ascii=False), flush=True)
    manifest = {"schemaVersion": "1.0", "status": "TECHNICAL_PASS_HUMAN_REVIEW_NOT_RUN",
                "candidateCount": len(records), "speaker": config["speaker"], "language": config["language"],
                "textPath": args.text, "textSha256": sha(text_file), "copySha256": args.copy_sha,
                "contextHash": args.context_hash, "records": records, "voiceAcceptance": "NOT_RUN",
                "timingLimitation": "Provider returned waveform duration only; no phoneme or word timings are claimed.",
                "externalApiCalls": 0, "generationCostCny": 0}
    manifest_file = output / "manifest.json"
    if manifest_file.exists():
        existing = json.loads(manifest_file.read_text(encoding="utf-8"))
        if existing != manifest:
            raise ValueError("Existing Qwen audition manifest differs")
    else:
        write_json(manifest_file, manifest)
    print(json.dumps({"status": manifest["status"], "manifest": (output / "manifest.json").relative_to(root).as_posix()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
