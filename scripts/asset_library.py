# SPDX-License-Identifier: Apache-2.0
"""Project-local asset import. No network calls; originals are never transformed."""
import argparse
from contextlib import contextmanager
import ctypes
import hashlib
import json
import mimetypes
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid


LIBRARY = "assets/brand/enhe/ip"
ORIGINALS = LIBRARY + "/originals"
CATALOG = LIBRARY + "/catalog.json"
REPORTS = "reports/asset-library"
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class AssetLibraryError(ValueError):
    """A failed boundary or integrity check; the source must be retained."""


def reject_links(path):
    """Reject every existing reparse component, including Windows junctions."""
    path = Path(os.path.abspath(path))
    for part in reversed([path, *path.parents]):
        try:
            item = part.lstat()
        except FileNotFoundError:
            continue
        if part.is_symlink() or getattr(item, "st_file_attributes", 0) & 1024:
            raise AssetLibraryError(f"LINK_REJECTED: {part}")
    return path


def safe_path(root, relative):
    if not isinstance(relative, str) or not relative or "\x00" in relative:
        raise AssetLibraryError("INVALID_RELATIVE_PATH")
    normalized = relative.replace("\\", "/")
    parts = normalized.split("/")
    if any(p in ("", ".", "..") or ":" in p or p.endswith((".", " ")) for p in parts):
        raise AssetLibraryError(f"UNSAFE_RELATIVE_PATH: {relative}")
    # Windows device aliases and alternate streams must not resolve as files.
    if any(re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", p) for p in parts):
        raise AssetLibraryError("DEVICE_PATH_REJECTED")
    root = reject_links(root)
    result = reject_links(root.joinpath(*parts))
    if not result.is_relative_to(root):
        raise AssetLibraryError("PATH_OUTSIDE_PROJECT")
    return result


def project_root(value):
    root = reject_links(value)
    if not root.is_dir() or not safe_path(root, "package.json").is_file():
        raise AssetLibraryError("PROJECT_ROOT_REQUIRES_PACKAGE_JSON")
    return root


def digest(path):
    path = reject_links(path)
    result = hashlib.sha256()
    size = 0
    before = path.stat()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            result.update(block)
            size += len(block)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise AssetLibraryError(f"FILE_CHANGED_DURING_READ: {path}")
    return result.hexdigest(), size


def require_hash(path, expected_hash, expected_bytes=None):
    if not isinstance(expected_hash, str) or not HASH_PATTERN.fullmatch(expected_hash):
        raise AssetLibraryError("INVALID_SHA256")
    actual, size = digest(path)
    if actual != expected_hash or (expected_bytes is not None and size != expected_bytes):
        raise AssetLibraryError(f"HASH_MISMATCH: {path}")
    return size


def read_json(path):
    reject_links(path)
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise AssetLibraryError(f"INVALID_JSON: {path}: {type(error).__name__}") from error


def write_json(path, value):
    reject_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".partial-" + uuid.uuid4().hex)
    with temp.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    reject_links(path)
    os.replace(temp, path)


def enumerate_source(source):
    source = reject_links(source)
    if not source.is_dir():
        raise AssetLibraryError("SOURCE_NOT_FOUND")
    files, directories = [], []
    def walk(directory):
        for entry in sorted(directory.iterdir(), key=lambda p: p.name):
            reject_links(entry)
            relative = entry.relative_to(source).as_posix()
            safe_path(source, relative)
            if entry.is_dir():
                directories.append(relative)
                walk(entry)
            elif entry.is_file():
                if re.fullmatch(r"(?i)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials\.json|.*\.(?:pem|p12|pfx))", entry.name):
                    raise AssetLibraryError(f"SUSPECTED_CREDENTIAL_FILE_RETAINED: {relative}")
                sha, size = digest(entry)
                files.append({"sourceRelativePath": relative, "bytes": size, "sha256": sha})
            else:
                raise AssetLibraryError(f"UNSUPPORTED_SPECIAL_FILE: {relative}")
    walk(source)
    return files, directories


def copy_verified(source, destination, expected_hash, expected_bytes, *, temporary_directory=None):
    """Exclusive copy + re-read, with atomic no-overwrite promotion."""
    reject_links(source)
    reject_links(destination)
    if destination.exists():
        require_hash(destination, expected_hash, expected_bytes)
        return "REUSED"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_directory = reject_links(temporary_directory or destination.parent)
    temp_directory.mkdir(parents=True, exist_ok=True)
    temp = temp_directory / (destination.name + ".partial-" + uuid.uuid4().hex)
    with source.open("rb") as input_stream, temp.open("xb") as output_stream:
        shutil.copyfileobj(input_stream, output_stream, 1024 * 1024)
        output_stream.flush()
        os.fsync(output_stream.fileno())
    require_hash(temp, expected_hash, expected_bytes)
    require_hash(source, expected_hash, expected_bytes)
    reject_links(destination)
    # link() fails if the destination exists on every supported platform. The
    # temporary name is removed; no file or link depends on the external source.
    try:
        os.link(temp, destination)
    except FileExistsError:
        require_hash(destination, expected_hash, expected_bytes)
    temp.unlink()
    require_hash(destination, expected_hash, expected_bytes)
    return "COPIED"


def target_for(root, relative, run_id, sha=None):
    normal = ORIGINALS + "/" + relative
    target = safe_path(root, normal)
    parent_blocked = any(p.exists() and not p.is_dir() for p in target.parents if p.is_relative_to(root))
    conflict = target.exists() and ((sha is None and not target.is_dir()) or
                                    (sha is not None and (not target.is_file() or digest(target)[0] != sha)))
    if conflict or parent_blocked:
        candidate = ORIGINALS + "/import-" + run_id + "/" + relative
        alternate = safe_path(root, candidate)
        if alternate.exists() and (sha is None and not alternate.is_dir() or
                                   sha is not None and (not alternate.is_file() or digest(alternate)[0] != sha)):
            raise AssetLibraryError(f"IMPORT_BATCH_CONFLICT: {candidate}")
        return candidate
    return normal


def check_record(root, report, source, run_id):
    if (report.get("schemaVersion") != "1.0" or report.get("runId") != run_id or
            report.get("sourceRoot") != str(source) or report.get("originalsPath") != ORIGINALS):
        raise AssetLibraryError("MIGRATION_RECORD_IDENTITY_MISMATCH")
    if not report.get("files"):
        raise AssetLibraryError("EMPTY_MIGRATION_RECORD")
    sources, targets = set(), set()
    for entry in report["files"]:
        safe_path(source, entry["sourceRelativePath"])
        target = safe_path(root, entry["targetPath"])
        if not target.is_relative_to(safe_path(root, ORIGINALS)) or entry["targetPath"] in targets or entry["sourceRelativePath"] in sources:
            raise AssetLibraryError("MIGRATION_PATH_MAPPING_INVALID")
        if not isinstance(entry.get("bytes"), int) or entry["bytes"] < 0 or not HASH_PATTERN.fullmatch(entry.get("sha256", "")):
            raise AssetLibraryError("MIGRATION_ENTRY_INVALID")
        targets.add(entry["targetPath"])
        sources.add(entry["sourceRelativePath"])
    for directory in report["directories"]:
        safe_path(source, directory["sourceRelativePath"])
        target = safe_path(root, directory["targetPath"])
        if not target.is_relative_to(safe_path(root, ORIGINALS)):
            raise AssetLibraryError("MIGRATION_DIRECTORY_MAPPING_INVALID")


def verify_import(root, report):
    for entry in report["files"]:
        require_hash(safe_path(root, entry["targetPath"]), entry["sha256"], entry["bytes"])
    for directory in report["directories"]:
        if not safe_path(root, directory["targetPath"]).is_dir():
            raise AssetLibraryError("MISSING_IMPORTED_DIRECTORY")


def inspect_media(path):
    metadata = {"mediaType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                "width": None, "height": None, "hasTransparency": None, "layering": "unknown"}
    try:
        from PIL import Image
        with Image.open(path) as image:
            image.load()
            transparency = False
            if "A" in image.getbands() or "transparency" in image.info:
                transparency = image.convert("RGBA").getchannel("A").getextrema()[0] < 255
            metadata.update(width=image.width, height=image.height, hasTransparency=transparency,
                            layering="unknown" if getattr(image, "n_frames", 1) > 1 else "flat")
    except (ImportError, OSError, ValueError):
        pass  # Unsupported ancillary files remain present and traceable.
    return metadata


def index_library(root):
    root = project_root(root)
    originals = safe_path(root, ORIGINALS)
    if not originals.is_dir():
        raise AssetLibraryError("ORIGINALS_NOT_FOUND")
    catalog_path = safe_path(root, CATALOG)
    previous = read_json(catalog_path) if catalog_path.exists() else {"assets": []}
    old_by_path = {entry["originalPath"]: entry for entry in previous["assets"]}
    provenance = {}
    report_root = safe_path(root, REPORTS)
    if report_root.exists():
        for directory in sorted(report_root.iterdir()):
            reject_links(directory)
            report_path = directory / "migration.json"
            if directory.is_dir() and report_path.is_file():
                report = read_json(report_path)
                for entry in report.get("files", []):
                    if entry.get("status") in ("VERIFIED", "SOURCE_REMOVED"):
                        provenance.setdefault(entry["targetPath"], {"kind": "user-supplied", "runId": report["runId"], "sourceRelativePath": entry["sourceRelativePath"]})
    files, _ = enumerate_source(originals)
    assets, current_paths = [], set()
    for file in files:
        original_path = ORIGINALS + "/" + file["sourceRelativePath"]
        current_paths.add(original_path)
        old = old_by_path.get(original_path)
        if old:
            if old["sha256"] != file["sha256"]:
                raise AssetLibraryError(f"ORIGINAL_CONTENT_DRIFT: {original_path}")
            assets.append(old)
        else:
            assets.append({"assetId": "enhe-ip-" + hashlib.sha256(original_path.encode("utf-8")).hexdigest()[:24],
                           "contentVersion": file["sha256"], "sha256": file["sha256"], "originalPath": original_path,
                           "preparedPath": None, "preparedHash": None, "previewPath": None,
                           **inspect_media(safe_path(root, original_path)), "role": "unknown", "tags": [], "expression": None,
                           "pose": None, "embeddedText": [], "recommendedUses": [], "restrictedUses": ["public-redistribution-not-authorized"],
                           "reviewStatus": "UNREVIEWED", "rightsNote": "User-authorized local ENHE video production only; brand assets are excluded from the Apache-2.0 software license. Existing unregistered assets require provenance review.",
                           "provenance": provenance.get(original_path, {"kind": "user-supplied", "runId": None, "sourceRelativePath": file["sourceRelativePath"]})})
    for original_path, old in old_by_path.items():
        if original_path not in current_paths:
            # Logo / author assets can share the catalog without being moved.
            require_hash(safe_path(root, original_path), old["sha256"])
            assets.append(old)
    assets.sort(key=lambda item: item["assetId"])
    version = hashlib.sha256(json.dumps(assets, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    result = {"schemaVersion": "1.0", "libraryVersion": version, "assets": assets}
    validate_catalog(root, result)
    write_json(catalog_path, result)
    return result


def validate_catalog(root, catalog):
    if catalog.get("schemaVersion") != "1.0" or not catalog.get("assets"):
        raise AssetLibraryError("EMPTY_OR_INVALID_CATALOG")
    ids, paths = set(), set()
    for asset in catalog["assets"]:
        if not asset.get("assetId") or asset["assetId"] in ids or asset["originalPath"] in paths:
            raise AssetLibraryError("DUPLICATE_ASSET_ID_OR_PATH")
        ids.add(asset["assetId"])
        paths.add(asset["originalPath"])
        require_hash(safe_path(root, asset["originalPath"]), asset["sha256"])
        if asset.get("reviewStatus") not in ("UNREVIEWED", "APPROVED", "EXCLUDED"):
            raise AssetLibraryError("INVALID_REVIEW_STATUS")
        if bool(asset.get("preparedPath")) != bool(asset.get("preparedHash")):
            raise AssetLibraryError("PREPARED_PATH_HASH_REQUIRED_TOGETHER")
        if asset.get("preparedPath"):
            require_hash(safe_path(root, asset["preparedPath"]), asset["preparedHash"])
        if asset.get("previewPath") and not safe_path(root, asset["previewPath"]).is_file():
            raise AssetLibraryError("PREVIEW_MISSING")
    originals = safe_path(root, ORIGINALS)
    if originals.is_dir():
        original_files, _ = enumerate_source(originals)
        if any(ORIGINALS + "/" + entry["sourceRelativePath"] not in paths for entry in original_files):
            raise AssetLibraryError("UNINDEXED_ORIGINAL_FILE")


def validate(root):
    root = project_root(root)
    try:
        catalog = read_json(safe_path(root, CATALOG))
        validate_catalog(root, catalog)
        return {"status": "PASS", "assetCount": len(catalog["assets"]), "catalogSha256": digest(safe_path(root, CATALOG))[0]}
    except (AssetLibraryError, OSError, KeyError, TypeError) as error:
        return {"status": "FAIL", "error": str(error)}


def trusted_media_tool(requested, name):
    """Executable paths come only from CLI or the existing local tool config."""
    if requested is None:
        configuration = read_json(safe_path(Path(__file__).resolve().parent.parent, ".tools/environment.json"))
        requested = configuration.get("HYPERFRAMES_" + name.upper() + "_PATH")
    if not requested or not Path(requested).is_absolute():
        raise AssetLibraryError("EXPLICIT_TRUSTED_MEDIA_TOOL_REQUIRED: " + name)
    tool = reject_links(requested)
    if not tool.is_file() or (os.name == "nt" and tool.suffix.lower() != ".exe"):
        raise AssetLibraryError("MEDIA_TOOL_NOT_EXECUTABLE: " + name)
    with tool.open("rb") as stream:
        magic = stream.read(4)
    if os.name == "nt" and magic[:2] != b"MZ":
        raise AssetLibraryError("MEDIA_TOOL_NOT_NATIVE_EXECUTABLE: " + name)
    if os.name != "nt" and not os.access(tool, os.X_OK):
        raise AssetLibraryError("MEDIA_TOOL_NOT_EXECUTABLE: " + name)
    sha, _ = digest(tool)
    version = media_command([str(tool), "-version"], timeout=10)
    first_line = version.stdout.splitlines()[0] if version.stdout else ""
    if version.returncode != 0 or not first_line.startswith(name + " version "):
        raise AssetLibraryError("MEDIA_TOOL_IDENTITY_INVALID: " + name)
    return {"path": str(tool), "sha256": sha, "version": first_line}


def media_command(arguments, timeout=45):
    try:
        return subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", shell=False, timeout=timeout,
                              creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise AssetLibraryError("MEDIA_TOOL_EXECUTION_FAILED: " + type(error).__name__) from error


def verify_actual_media(video, expected_hash, declared, ffmpeg=None, ffprobe=None):
    decoder = trusted_media_tool(ffmpeg, "ffmpeg")
    probe = trusted_media_tool(ffprobe, "ffprobe")
    probe_command = [probe["path"], "-v", "error", "-protocol_whitelist", "file,pipe", "-f", "mov", "-show_streams", "-show_format", "-of", "json", str(video)]
    decode_command = [decoder["path"], "-v", "error", "-nostdin", "-xerror", "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-f", "mov", "-i", str(video), "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-"]
    # The exact movie stays immutable while the external tools read it.
    with windows_read_handle(video) as (_, _, actual_hash, _):
        if actual_hash != expected_hash:
            raise AssetLibraryError("RENDER_VIDEO_CHANGED_BEFORE_DECODE")
        result = media_command(probe_command)
        if result.returncode != 0 or result.stderr.strip():
            raise AssetLibraryError("ACTUAL_FFPROBE_FAILED: " + str(result.returncode))
        try:
            info = json.loads(result.stdout)
            stream = next(item for item in info["streams"] if item.get("codec_type") == "video")
            duration = float(info["format"]["duration"])
            numerator, denominator = stream["avg_frame_rate"].split("/")
            fps = float(numerator) / float(denominator)
            declared_duration = float(declared["durationSec"])
        except (ValueError, KeyError, TypeError, StopIteration, ZeroDivisionError) as error:
            raise AssetLibraryError("ACTUAL_MEDIA_METADATA_INVALID") from error
        if (stream.get("width") != declared["width"] or stream.get("height") != declared["height"] or
                not math.isfinite(duration) or not 3 <= duration <= 5 or not math.isfinite(declared_duration) or
                abs(duration - declared_duration) > 0.05 or not math.isfinite(fps) or abs(fps - 30) > 0.001):
            raise AssetLibraryError("ACTUAL_MEDIA_SPEC_MISMATCH")
        decoded = media_command(decode_command)
        # Some FFmpeg builds log decoder-thread errors but return zero even with
        # -xerror. At -v error any stderr is a failed decode, not a warning.
        if decoded.returncode != 0 or decoded.stderr.strip():
            raise AssetLibraryError("ACTUAL_FFMPEG_DECODE_FAILED: " + str(decoded.returncode))
    require_hash(video, expected_hash)
    require_hash(Path(decoder["path"]), decoder["sha256"])
    require_hash(Path(probe["path"]), probe["sha256"])
    return {"ffmpeg": decoder, "ffprobe": probe, "probeCommand": probe_command, "decodeCommand": decode_command,
            "probeExitCode": result.returncode, "decodeExitCode": decoded.returncode, "videoSha256": expected_hash,
            "measured": {"width": stream["width"], "height": stream["height"], "durationSec": duration, "fps": fps}}


def verify_render_proof(root, report, proof_path, *, ffmpeg=None, ffprobe=None):
    if proof_path is None:
        raise AssetLibraryError("RENDER_PROOF_REQUIRED_FOR_CLEANUP")
    proof_path = Path(proof_path)
    if proof_path.is_absolute():
        try:
            proof_path = proof_path.relative_to(root)
        except ValueError as error:
            raise AssetLibraryError("RENDER_PROOF_OUTSIDE_PROJECT") from error
    proof_file = safe_path(root, proof_path.as_posix())
    proof = read_json(proof_file)
    if proof.get("schemaVersion") != "1.0" or proof.get("kind") != "IP_LIBRARY_RENDER_PROOF" or proof.get("migrationRunId") != report["runId"]:
        raise AssetLibraryError("RENDER_PROOF_IDENTITY_INVALID")
    require_hash(safe_path(root, CATALOG), proof.get("catalogSha256"))
    frozen_file = safe_path(root, proof["frozenManifestPath"])
    require_hash(frozen_file, proof.get("frozenManifestSha256"))
    frozen = read_json(frozen_file)
    video = safe_path(root, proof["videoPath"])
    size = require_hash(video, proof.get("videoSha256"))
    with video.open("rb") as stream:
        header = stream.read(12)
    media = proof.get("media", {})
    if size < 128 or header[4:8] != b"ftyp" or media.get("decodeExitCode") != 0 or media.get("width") != 1920 or media.get("height") != 1080 or not 3 <= media.get("durationSec", 0) <= 5:
        raise AssetLibraryError("RENDER_PROOF_MEDIA_INVALID")
    assets = {a["assetId"]: a for a in read_json(safe_path(root, CATALOG))["assets"]}
    imported = {f["targetPath"]: f["sha256"] for f in report["files"]}
    frozen_assets = {a["assetId"]: a for a in frozen.get("assets", [])}
    batch_match = False
    for read in proof.get("assetReads", []):
        asset = assets.get(read.get("assetId"))
        frozen_asset = frozen_assets.get(read.get("assetId"))
        if not asset or not frozen_asset or read.get("sha256") not in (asset["sha256"], asset.get("preparedHash")):
            raise AssetLibraryError("RENDER_PROOF_ASSET_INVALID")
        if frozen_asset.get("sha256") != read["sha256"] or frozen_asset.get("frozenPath") != read["frozenPath"]:
            raise AssetLibraryError("FROZEN_MANIFEST_READ_MISMATCH")
        require_hash(safe_path(root, read["frozenPath"]), read["sha256"])
        batch_match |= imported.get(asset["originalPath"]) == asset["sha256"]
    if not batch_match:
        raise AssetLibraryError("RENDER_PROOF_REQUIRES_IMPORTED_ASSET_READ")
    actual_media = verify_actual_media(video, proof["videoSha256"], media, ffmpeg=ffmpeg, ffprobe=ffprobe)
    return {"path": proof_file.relative_to(root).as_posix(), "sha256": digest(proof_file)[0], "videoSha256": proof["videoSha256"], "mediaVerification": actual_media}


@contextmanager
def windows_read_handle(path, *, delete_access=False):
    """Hold a byte-verified file without sharing write or delete access."""
    if os.name != "nt":
        raise AssetLibraryError("SAFE_SOURCE_CLEANUP_REQUIRES_WINDOWS_HANDLE")
    from ctypes import wintypes
    path = reject_links(path)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
    kernel.ReadFile.restype = wintypes.BOOL
    kernel.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetFileInformationByHandle.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    # GENERIC_READ [| DELETE], FILE_SHARE_READ, OPEN_EXISTING, OPEN_REPARSE_POINT.
    handle = kernel.CreateFileW(str(path), 0x80000000 | (0x00010000 if delete_access else 0), 1, None, 3, 0x00200000, None)
    if handle == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        reject_links(path)
        result = hashlib.sha256()
        buffer = ctypes.create_string_buffer(1024 * 1024)
        count = wintypes.DWORD()
        size = 0
        while True:
            if not kernel.ReadFile(handle, buffer, len(buffer), ctypes.byref(count), None):
                raise ctypes.WinError(ctypes.get_last_error())
            if not count.value:
                break
            size += count.value
            result.update(buffer.raw[:count.value])
        yield kernel, handle, result.hexdigest(), size
    finally:
        kernel.CloseHandle(handle)


def delete_unchanged_windows(path, expected_hash, expected_bytes):
    """Hash and mark deletion on one handle, excluding concurrent writers."""
    from ctypes import wintypes
    with windows_read_handle(path, delete_access=True) as (kernel, handle, actual_hash, size):
        if size != expected_bytes or actual_hash != expected_hash:
            raise AssetLibraryError(f"SOURCE_CHANGED_RETAINED: {path}")
        disposition = wintypes.BOOL(True)
        if not kernel.SetFileInformationByHandle(handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)):
            raise ctypes.WinError(ctypes.get_last_error())


def cleanup_source(root, source, report, report_path, render_proof, *, ffmpeg=None, ffprobe=None):
    verify_import(root, report)
    validation = validate(root)
    if validation["status"] != "PASS":
        raise AssetLibraryError("CATALOG_VALIDATION_REQUIRED: " + validation.get("error", ""))
    report["renderProof"] = verify_render_proof(root, report, render_proof, ffmpeg=ffmpeg, ffprobe=ffprobe)
    # Prove the current source traversal is still link-free before any deletion.
    enumerate_source(source)
    for entry in report["files"]:
        file = safe_path(source, entry["sourceRelativePath"])
        if not file.exists():
            if entry.get("status") != "SOURCE_REMOVED":
                entry["cleanupError"] = "SOURCE_ALREADY_ABSENT"
            continue
        try:
            # Hold *every* migrated original, including files not selected by the
            # smoke movie, from final hash until the source delete handle closes.
            with windows_read_handle(safe_path(root, entry["targetPath"])) as (_, _, target_hash, target_size):
                if target_hash != entry["sha256"] or target_size != entry["bytes"]:
                    raise AssetLibraryError("TARGET_CHANGED_RETAIN_SOURCE")
                delete_unchanged_windows(file, entry["sha256"], entry["bytes"])
            entry["status"] = "SOURCE_REMOVED"
            entry.pop("cleanupError", None)
        except (OSError, AssetLibraryError) as error:
            entry["cleanupError"] = str(error)
        write_json(report_path, report)
    for directory in sorted(report["directories"], key=lambda d: d["sourceRelativePath"].count("/"), reverse=True):
        path = safe_path(source, directory["sourceRelativePath"])
        if path.is_dir():
            try:
                path.rmdir()  # Empty only. New files are never recursively removed.
            except OSError:
                pass
    try:
        reject_links(source).rmdir()
    except OSError:
        pass
    report["sourceState"] = "SOURCE_RETAINED" if source.exists() else "REMOVED_EMPTY"
    report["state"] = "IMPORTED_SOURCE_RETAINED" if source.exists() else "MIGRATED"
    report["status"] = "PARTIAL" if source.exists() else "PASS"
    write_json(report_path, report)
    return report


def migrate(root, source, run_id, *, dry_run=False, resume=False, cleanup=False, render_proof=None, ffmpeg=None, ffprobe=None):
    root = project_root(root)
    source = reject_links(source)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", run_id) or ".." in run_id:
        raise AssetLibraryError("UNSAFE_RUN_ID")
    if source == root or source.is_relative_to(root) or root.is_relative_to(source):
        raise AssetLibraryError("SOURCE_PROJECT_OVERLAP")
    report_path = safe_path(root, REPORTS + "/" + run_id + "/migration.json")
    if report_path.exists():
        report = read_json(report_path)
        check_record(root, report, source, run_id)
        if not source.exists():
            verify_import(root, report)
            if validate(root)["status"] != "PASS":
                raise AssetLibraryError("MISSING_SOURCE_AND_INVALID_LIBRARY")
            report.update(status="PASS", state="ALREADY_MIGRATED", sourceState="ALREADY_MIGRATED")
            if not dry_run:
                write_json(report_path, report)
            return report
        if not resume and not cleanup:
            raise AssetLibraryError("RUN_EXISTS_USE_RESUME")
    else:
        if cleanup:
            raise AssetLibraryError("CLEANUP_REQUIRES_EXISTING_MIGRATION")
        files, directories = enumerate_source(source)
        if not files:
            raise AssetLibraryError("EMPTY_SOURCE_NOT_MIGRATED")
        if shutil.disk_usage(root).free < sum(f["bytes"] for f in files) * 3 + 1024 * 1024:
            raise AssetLibraryError("INSUFFICIENT_PROJECT_DISK_SPACE")
        for file in files:
            file.update(targetPath=target_for(root, file["sourceRelativePath"], run_id, file["sha256"]), status="PLANNED")
        report = {"schemaVersion": "1.0", "runId": run_id, "sourceRoot": str(source), "originalsPath": ORIGINALS,
                  "files": files, "directories": [{"sourceRelativePath": d, "targetPath": target_for(root, d, run_id)} for d in directories],
                  "sourceFileCount": len(files), "sourceBytes": sum(f["bytes"] for f in files), "status": "PARTIAL", "state": "PLANNED", "sourceState": "SOURCE_RETAINED"}
    if dry_run:
        return {**report, "state": "DRY_RUN", "status": "PASS"}
    if cleanup:
        return cleanup_source(root, source, report, report_path, render_proof, ffmpeg=ffmpeg, ffprobe=ffprobe)
    write_json(report_path, report)
    safe_path(root, ORIGINALS).mkdir(parents=True, exist_ok=True)
    failed = False
    for directory in report["directories"]:
        safe_path(root, directory["targetPath"]).mkdir(parents=True, exist_ok=True)
    for entry in report["files"]:
        try:
            src = safe_path(source, entry["sourceRelativePath"])
            require_hash(src, entry["sha256"], entry["bytes"])
            stage = safe_path(root, LIBRARY + "/.staging/" + run_id + "/" + entry["sourceRelativePath"])
            copy_verified(src, stage, entry["sha256"], entry["bytes"])
            require_hash(src, entry["sha256"], entry["bytes"])
            copy_verified(stage, safe_path(root, entry["targetPath"]), entry["sha256"], entry["bytes"],
                          temporary_directory=safe_path(root, LIBRARY + "/.staging/" + run_id + "/.promotion"))
            require_hash(src, entry["sha256"], entry["bytes"])
            entry.update(status="VERIFIED")
            entry.pop("error", None)
        except (OSError, AssetLibraryError) as error:
            failed = True
            entry.update(status="SOURCE_RETAINED", error=str(error))
        write_json(report_path, report)
    if not failed:
        verify_import(root, report)
        index_library(root)
    report.update(status="PARTIAL", state="IMPORT_INCOMPLETE" if failed else "IMPORTED_SOURCE_RETAINED", sourceState="SOURCE_RETAINED")
    report["verifiedFileCount"] = sum(e["status"] in ("VERIFIED", "SOURCE_REMOVED") for e in report["files"])
    write_json(report_path, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Project IP library: verified byte-preserving migration, indexing and validation. No network access.")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("migrate", "index", "validate"):
        child = commands.add_parser(command)
        child.add_argument("--project-root", required=True, type=Path)
        if command == "migrate":
            child.add_argument("--source", required=True, type=Path, help="One-time import source; never a runtime fallback.")
            child.add_argument("--run-id", required=True)
            child.add_argument("--dry-run", action="store_true")
            child.add_argument("--resume", action="store_true")
            child.add_argument("--cleanup", action="store_true", help="Delete only unchanged verified source files after matching real render evidence.")
            child.add_argument("--render-proof", type=Path)
            child.add_argument("--ffmpeg", type=Path, help="Trusted native FFmpeg executable; defaults to the existing project tool configuration.")
            child.add_argument("--ffprobe", type=Path, help="Trusted native FFprobe executable; never loaded from a render receipt.")
    args = parser.parse_args(argv)
    try:
        if args.command == "migrate":
            result = migrate(args.project_root, args.source, args.run_id, dry_run=args.dry_run, resume=args.resume, cleanup=args.cleanup, render_proof=args.render_proof, ffmpeg=args.ffmpeg, ffprobe=args.ffprobe)
        elif args.command == "index":
            catalog = index_library(args.project_root)
            result = {"status": "PASS", "assetCount": len(catalog["assets"]), "libraryVersion": catalog["libraryVersion"]}
        else:
            result = validate(args.project_root)
    except (OSError, AssetLibraryError, KeyError, TypeError) as error:
        result = {"status": "FAIL", "error": str(error)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    imported_without_cleanup = args.command == "migrate" and not args.cleanup and result.get("state") == "IMPORTED_SOURCE_RETAINED"
    return 0 if result.get("status") == "PASS" or imported_without_cleanup else 1


if __name__ == "__main__":
    sys.exit(main())
