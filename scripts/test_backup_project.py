# SPDX-License-Identifier: Apache-2.0
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SCRIPT = Path(__file__).with_name("backup-project.py")
spec = importlib.util.spec_from_file_location("backup_project", SCRIPT) if SCRIPT.exists() else None
backup = importlib.util.module_from_spec(spec) if spec else None
if spec:
    spec.loader.exec_module(backup)


class ProjectBackupTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(backup, "full project backup implementation is missing")
        self.temp = tempfile.TemporaryDirectory(prefix="完整备份 中文 空格 ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "项目"
        self.root.mkdir()
        self.put("package.json", b'{"private":true}')
        self.output = self.root / ".local-backup/fixture.zip"

    def put(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def junction(self, link, target):
        link.parent.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, check=True)
        else:
            link.symlink_to(target, target_is_directory=True)
        self.addCleanup(lambda: os.rmdir(link) if link.exists() else None)

    def test_ignored_brand_originals_video_plans_tools_and_git_are_backed_up(self):
        expected = {
            ".gitignore": b"assets/\nprojects/\n.tools/\n",
            "assets/brand/enhe/ip/originals/原图.png": b"original image bytes",
            "assets/brand/enhe/ip/prepared/v1.png": b"prepared",
            "assets/brand/enhe/ip/catalog.json": b'{"assets":[]}',
            "assets/brand/enhe/ASSET-RIGHTS.md": b"local production only",
            "projects/old video/renders/final.mp4": b"preserved video bytes",
            "projects/old video/frozen-brand-assets.json": b"frozen",
            "docs/exec-plans/active/task.md": b"active plan",
            ".tools/model.bin": b"model",
            ".git/config": b"local git configuration",
        }
        for relative, content in expected.items():
            self.put(relative, content)
        result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["verifiedFileCount"], len(expected) + 1)
        with zipfile.ZipFile(self.output) as archive:
            manifest = json.loads(archive.read("backup-manifest.json"))
            records = {entry["path"]: entry for entry in manifest["files"]}
            for relative, content in expected.items():
                self.assertEqual(archive.read("project/" + relative), content)
                self.assertEqual(records[relative]["sha256"], hashlib.sha256(content).hexdigest())

    def test_rebuildable_caches_and_prior_backup_are_excluded_explicitly(self):
        self.put("node_modules/dependency/index.js", b"reinstallable")
        self.put(".cache/preview.dat", b"rebuildable")
        self.put("projects/job/.hyperframes/cache.dat", b"rebuildable")
        self.put(".local-backup/older.zip", b"older backup")
        result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(set(result["excludedDirectories"]), {"node_modules", ".cache", "projects/job/.hyperframes", ".local-backup"})
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(set(archive.namelist()), {"project/package.json", "backup-manifest.json"})

    def test_existing_backup_is_never_overwritten(self):
        self.put(".local-backup/fixture.zip", b"existing backup")
        with self.assertRaises(backup.BackupError):
            backup.backup_project(self.root, self.output)
        self.assertEqual(self.output.read_bytes(), b"existing backup")

    @unittest.skipUnless(os.name == "nt", "Windows path case-insensitive behavior")
    def test_existing_uppercase_backup_directory_is_excluded(self):
        self.put(".LOCAL-BACKUP/old.zip", b"old private backup")
        result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PASS")
        self.assertIn(".LOCAL-BACKUP", result["excludedDirectories"])
        with zipfile.ZipFile(self.output) as archive:
            self.assertEqual(set(archive.namelist()), {"project/package.json", "backup-manifest.json"})

    def test_junction_is_not_followed_and_cannot_be_called_complete(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        (outside / "private.txt").write_bytes(b"do not traverse")
        link = self.root / "linked-assets"
        self.junction(link, outside)
        result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual(result["unbackedPaths"], [{"path": "linked-assets", "reason": "REPARSE_OR_SYMLINK_NOT_FOLLOWED"}])
        with zipfile.ZipFile(self.output) as archive:
            self.assertFalse(any("private.txt" in entry for entry in archive.namelist()))

    @unittest.skipUnless(os.name == "nt", "Windows extended-path behavior")
    def test_real_project_and_files_above_260_characters_are_backed_up(self):
        fixture_root = self.root
        self.assertTrue(fixture_root.is_relative_to(Path(self.temp.name)))
        self.addCleanup(lambda: shutil.rmtree("\\\\?\\" + str(fixture_root)))
        project = fixture_root.joinpath(*(["中文 空格 " + "long-path-" * 4] * 5))
        self.assertGreater(len(str(project)), 260)
        extended_project = Path("\\\\?\\" + str(project))
        extended_project.mkdir(parents=True)
        (extended_project / "package.json").write_bytes(b'{"private":true}')
        relative = "assets/brand/enhe/ip/originals/超长路径 原图.png"
        original = extended_project / relative
        original.parent.mkdir(parents=True)
        original.write_bytes(b"long-path original bytes")
        output = project / ".local-backup/fixture.zip"
        try:
            result = backup.backup_project(project, output)
        except (backup.BackupError, OSError) as error:
            self.fail("Long-path project must back up successfully: " + str(error))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["verifiedFileCount"], 2)
        self.assertEqual(result["unbackedPaths"], [])
        self.assertEqual(result["archivePath"], str(output))
        self.assertNotIn("\\\\?\\", result["receiptPath"])
        with zipfile.ZipFile("\\\\?\\" + str(output)) as archive:
            self.assertEqual(archive.read("project/" + relative), b"long-path original bytes")
            manifest = json.loads(archive.read("backup-manifest.json"))
            self.assertIn(relative, {entry["path"] for entry in manifest["files"]})
            self.assertNotIn("\\\\?\\", json.dumps(manifest))

    def test_known_dependency_links_to_regular_root_node_modules_are_explicit_exclusions(self):
        self.put("node_modules/dependency/index.js", b"reinstallable")
        links = [".local-audit/github-oss-release/public-candidate/node_modules", ".local-audit/github-oss-release/remediation/candidate-baseline/node_modules"]
        for relative in links:
            self.junction(self.root / relative, self.root / "node_modules")
        result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["unbackedPaths"], [])
        expected = [{"path": relative, "target": "node_modules", "reason": "REBUILDABLE_LINK_TO_PROJECT_NODE_MODULES"} for relative in links]
        self.assertEqual(result["excludedLinks"], expected)
        with zipfile.ZipFile(self.output) as archive:
            manifest = json.loads(archive.read("backup-manifest.json"))
            self.assertEqual(manifest["excludedLinks"], expected)
            self.assertFalse(any("dependency/index.js" in name for name in archive.namelist()))

    def test_node_modules_link_to_any_other_directory_remains_partial(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        (outside / "private.txt").write_bytes(b"not a known dependency target")
        self.put("node_modules/dependency/index.js", b"reinstallable")
        relative = ".local-audit/github-oss-release/public-candidate/node_modules"
        self.junction(self.root / relative, outside)
        result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual(result["unbackedPaths"][0]["path"], relative)

    def test_unknown_link_location_to_root_dependencies_remains_partial(self):
        self.put("node_modules/dependency/index.js", b"reinstallable")
        self.junction(self.root / "unknown/node_modules", self.root / "node_modules")
        result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual(result["unbackedPaths"][0]["path"], "unknown/node_modules")
        self.assertEqual(result["excludedLinks"], [])

    def test_dependency_link_target_must_be_regular_not_another_junction(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        (outside / "private.txt").write_bytes(b"outside dependency bytes")
        self.junction(self.root / "node_modules", outside)
        relative = ".local-audit/github-oss-release/public-candidate/node_modules"
        self.junction(self.root / relative, self.root / "node_modules")
        result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual({item["path"] for item in result["unbackedPaths"]}, {"node_modules", relative})

    def test_source_change_is_reported_without_deleting_or_replacing_source(self):
        file = self.put("source.txt", b"before")
        real_write = backup.write_file_entry
        def change_after_copy(archive, path, relative):
            result = real_write(archive, path, relative)
            if relative == "source.txt":
                file.write_bytes(b"after user edit")
            return result
        with patch.object(backup, "write_file_entry", side_effect=change_after_copy):
            result = backup.backup_project(self.root, self.output)
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual(file.read_bytes(), b"after user edit")


if __name__ == "__main__":
    unittest.main(verbosity=2)
