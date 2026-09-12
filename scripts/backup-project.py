# SPDX-License-Identifier: Apache-2.0
"""Private local project backup, including ignored assets, media, tools and Git."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import uuid
import zipfile


REBUILDABLE = {"node_modules", ".cache", ".hyperframes"}
KNOWN_DEPENDENCY_LINKS = {
    ".local-audit/github-oss-release/public-candidate/node_modules",
    ".local-audit/github-oss-release/remediation/candidate-baseline/node_modules",
}


class BackupError(ValueError):
    pass


def logical_path(path):
    """Keep stored/displayed paths normal while accepting extended-path input."""
    text = os.fspath(path)
    if os.name == "nt":
        if text.startswith("\\\\?\\UNC\\"):
            text = "\\\\" + text[8:]
        elif text.startswith("\\\\?\\"):
            text = text[4:]
        if text.startswith("\\\\.\\"):
            raise BackupError("Windows device paths are not project paths")
    return Path(os.path.abspath(text))


def fs_path(path):
    """Use Windows extended paths only at the filesystem boundary, without OS changes."""
    text = str(logical_path(path))
    if os.name == "nt":
        text = "\\\\?\\UNC\\" + text[2:] if text.startswith("\\\\") else "\\\\?\\" + text
    return Path(text)


def is_link(path):
    info = fs_path(path).lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 1024)


def checked_path(path):
    path = logical_path(path)
    for component in reversed([path, *path.parents]):
        if os.path.lexists(fs_path(component)) and is_link(component):
            raise BackupError(f"Reparse path is not followed: {component}")
    return path


def fingerprint(path):
    info = fs_path(path).stat()
    return (info.st_size, info.st_mtime_ns, info.st_ino)


def known_dependency_link(path, root, relative):
    relative_key = relative.casefold() if os.name == "nt" else relative
    name_key = path.name.casefold() if os.name == "nt" else path.name
    if relative_key not in KNOWN_DEPENDENCY_LINKS or name_key != "node_modules":
        return False
    expected = root / "node_modules"
    try:
        checked_path(expected)
        if not fs_path(expected).is_dir():
            return False
        resolved = logical_path(fs_path(path).resolve(strict=True))
        return os.path.normcase(str(resolved)) == os.path.normcase(str(expected))
    except (BackupError, OSError):
        return False


def inventory(root, excluded_links=None):
    root = logical_path(root)
    if excluded_links is None:
        excluded_links = []
    files, empty, excluded, unbacked = {}, [], [], []
    def walk(directory):
        entries = sorted(fs_path(directory).iterdir(), key=lambda item: item.name)
        if not entries and directory != root:
            empty.append(directory.relative_to(root).as_posix())
        for entry in entries:
            path = directory / entry.name
            relative = path.relative_to(root).as_posix()
            relative_key = relative.casefold() if os.name == "nt" else relative
            name_key = path.name.casefold() if os.name == "nt" else path.name
            try:
                if is_link(path):
                    if known_dependency_link(path, root, relative):
                        excluded_links.append({"path": relative, "target": "node_modules", "reason": "REBUILDABLE_LINK_TO_PROJECT_NODE_MODULES"})
                    else:
                        unbacked.append({"path": relative, "reason": "REPARSE_OR_SYMLINK_NOT_FOLLOWED"})
                elif fs_path(path).is_dir():
                    if relative_key == ".local-backup" or name_key in REBUILDABLE:
                        excluded.append(relative)
                    else:
                        walk(path)
                elif fs_path(path).is_file():
                    files[relative] = fingerprint(path)
                else:
                    unbacked.append({"path": relative, "reason": "SPECIAL_FILE_NOT_COPIED"})
            except OSError as error:
                unbacked.append({"path": relative, "reason": type(error).__name__})
    walk(root)
    return files, empty, excluded, unbacked


def write_file_entry(archive, path, relative):
    checked_path(path)
    before = fingerprint(path)
    sha = hashlib.sha256()
    size = 0
    info = zipfile.ZipInfo.from_file(fs_path(path), arcname="project/" + relative)
    info.compress_type = zipfile.ZIP_DEFLATED
    with fs_path(path).open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
        while chunk := source.read(1024 * 1024):
            target.write(chunk)
            sha.update(chunk)
            size += len(chunk)
    if before != fingerprint(path) or before[0] != size:
        raise BackupError("Source changed while reading: " + relative)
    return {"path": relative, "bytes": size, "sha256": sha.hexdigest()}


def verify_archive(path, manifest):
    with zipfile.ZipFile(fs_path(path), "r") as archive:
        if json.loads(archive.read("backup-manifest.json")) != manifest:
            raise BackupError("Backup manifest round-trip mismatch")
        expected_names = {"backup-manifest.json", *("project/" + item["path"] for item in manifest["files"]),
                          *("project/" + relative + "/" for relative in manifest["emptyDirectories"])}
        names = archive.namelist()
        if set(names) != expected_names or len(names) != len(expected_names):
            raise BackupError("Archive contains missing, extra or duplicate entries")
        for entry in manifest["files"]:
            sha = hashlib.sha256()
            size = 0
            with archive.open("project/" + entry["path"]) as stream:
                while chunk := stream.read(1024 * 1024):
                    sha.update(chunk)
                    size += len(chunk)
            if sha.hexdigest() != entry["sha256"] or size != entry["bytes"]:
                raise BackupError("Archive entry failed verification: " + entry["path"])


def backup_project(project, output=None):
    root = checked_path(project)
    if not fs_path(root).is_dir() or not fs_path(root / "package.json").is_file():
        raise BackupError("Project root with package.json is required")
    backup_root = checked_path(root / ".local-backup")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = checked_path(output or backup_root / ("project-" + stamp + "-" + uuid.uuid4().hex[:8] + ".zip"))
    if not output.is_relative_to(backup_root) or output.suffix.lower() != ".zip":
        raise BackupError("Backup output must be a new .zip under PROJECT_ROOT/.local-backup")
    receipt = output.with_suffix(".report.json")
    if fs_path(output).exists() or fs_path(receipt).exists():
        raise BackupError("Existing backup or report will not be overwritten")
    fs_path(output.parent).mkdir(parents=True, exist_ok=True)
    excluded_links = []
    before, empty, excluded, unbacked = inventory(root, excluded_links)
    staging = output.with_name(output.name + ".partial-" + uuid.uuid4().hex)
    manifest = {"schemaVersion": "1.0", "kind": "PRIVATE_LOCAL_PROJECT_BACKUP", "projectName": root.name,
                "createdAt": datetime.now(timezone.utc).isoformat(), "toolsIncluded": True, "gitIncluded": True,
                "publicationAuthorized": False, "excludedDirectories": excluded, "excludedLinks": excluded_links, "unbackedPaths": unbacked,
                "emptyDirectories": empty, "files": []}
    with zipfile.ZipFile(fs_path(staging), "x", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
        for relative, initial in before.items():
            path = checked_path(root / relative)
            if fingerprint(path) != initial:
                raise BackupError("Source changed before copying: " + relative)
            manifest["files"].append(write_file_entry(archive, path, relative))
        for relative in empty:
            archive.writestr("project/" + relative + "/", b"")
        archive.writestr("backup-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    verify_archive(staging, manifest)
    after_excluded_links = []
    after, after_empty, _, after_unbacked = inventory(root, after_excluded_links)
    changed = sorted(relative for relative in set(before) | set(after) if before.get(relative) != after.get(relative))
    changed.extend("directory:" + relative for relative in set(empty) ^ set(after_empty))
    if after_unbacked != unbacked:
        changed.append("link-or-special-file-set")
    if after_excluded_links != excluded_links:
        changed.append("excluded-dependency-link-set")
    # Atomic publication without replacing any previous archive.
    checked_path(output)
    os.link(fs_path(staging), fs_path(output))
    fs_path(staging).unlink()
    sha = hashlib.sha256()
    with fs_path(output).open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            sha.update(chunk)
    result = {"schemaVersion": "1.0", "status": "PARTIAL" if unbacked or changed else "PASS",
              "archivePath": str(output), "archiveSha256": sha.hexdigest(), "archiveBytes": fs_path(output).stat().st_size,
              "sourceFileCount": len(before), "verifiedFileCount": len(manifest["files"]),
              "sourceBytes": sum(entry["bytes"] for entry in manifest["files"]),
              "emptyDirectoryCount": len(empty), "toolsIncluded": True, "gitIncluded": True,
              "excludedDirectories": excluded, "excludedLinks": excluded_links, "unbackedPaths": unbacked, "changedDuringBackup": changed,
              "receiptPath": str(receipt), "publicDistributionAllowed": False}
    with fs_path(receipt).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create and fully hash-verify a private project backup including ignored brand assets, videos, .tools and Git. No source files are modified.")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="New ZIP under PROJECT_ROOT/.local-backup; existing files are preserved.")
    args = parser.parse_args(argv)
    try:
        result = backup_project(args.project_root, args.output)
    except (BackupError, OSError, zipfile.BadZipFile) as error:
        error_text = str(error).replace("\\\\?\\UNC\\", "\\\\").replace("\\\\?\\", "") if os.name == "nt" else str(error)
        result = {"status": "FAIL", "error": error_text, "sourceFilesModified": False,
                  "partialArchivePolicy": "Preserved in .local-backup for inspection; never treated as a successful backup."}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
