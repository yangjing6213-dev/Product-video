# SPDX-License-Identifier: Apache-2.0
"""Migration fault tests use temporary fixtures, never user assets."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


SCRIPT = Path(__file__).with_name("asset_library.py")
spec = importlib.util.spec_from_file_location("asset_library", SCRIPT) if SCRIPT.exists() else None
library = importlib.util.module_from_spec(spec) if spec else None
if spec:
    spec.loader.exec_module(library)


class AssetLibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.media_temp = tempfile.TemporaryDirectory(prefix="IP genuine media ")
        cls.addClassCleanup(cls.media_temp.cleanup)
        configuration = json.loads((SCRIPT.parent.parent / ".tools/environment.json").read_text(encoding="utf-8-sig"))
        cls.ffmpeg = Path(configuration["HYPERFRAMES_FFMPEG_PATH"])
        cls.ffprobe = Path(configuration["HYPERFRAMES_FFPROBE_PATH"])
        cls.valid_video = Path(cls.media_temp.name) / "fixture.mp4"
        subprocess.run([str(cls.ffmpeg), "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:r=30:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-n", str(cls.valid_video)], check=True, capture_output=True, timeout=30)

    def setUp(self):
        self.assertIsNotNone(library, "asset_library.py migration implementation is missing")
        self.temp = tempfile.TemporaryDirectory(prefix="IP 中文 空格 ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "项目 root"
        self.root.mkdir()
        (self.root / "package.json").write_text('{"name":"fixture"}', encoding="utf-8")
        self.source = self.base / "源 包"
        self.source.mkdir()
        self.originals = self.root / "assets/brand/enhe/ip/originals"
        self.catalog_path = self.root / "assets/brand/enhe/ip/catalog.json"

    def source_file(self, name="目录 空格/原件.txt", content=b"original bytes"):
        file = self.source / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(content)
        return file

    def migrate(self, **kwargs):
        return library.migrate(self.root, self.source, "test-run", **kwargs)

    def catalog(self):
        return json.loads(self.catalog_path.read_text(encoding="utf-8"))

    def proof(self):
        asset = self.catalog()["assets"][0]
        frozen = self.root / "projects/smoke/frozen/asset.bin"
        frozen.parent.mkdir(parents=True)
        frozen.write_bytes((self.root / asset["originalPath"]).read_bytes())
        entry = {"assetId": asset["assetId"], "sha256": asset["sha256"], "frozenPath": frozen.relative_to(self.root).as_posix()}
        manifest = self.root / "projects/smoke/frozen.json"
        manifest.write_text(json.dumps({"assets": [entry]}), encoding="utf-8")
        video = self.root / "projects/smoke/smoke.mp4"
        video.write_bytes(self.valid_video.read_bytes())
        proof = {"schemaVersion": "1.0", "kind": "IP_LIBRARY_RENDER_PROOF", "migrationRunId": "test-run",
                 "catalogSha256": hashlib.sha256(self.catalog_path.read_bytes()).hexdigest(),
                 "frozenManifestPath": manifest.relative_to(self.root).as_posix(),
                 "frozenManifestSha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
                 "videoPath": video.relative_to(self.root).as_posix(), "videoSha256": hashlib.sha256(video.read_bytes()).hexdigest(),
                 "media": {"decodeExitCode": 0, "width": 1920, "height": 1080, "durationSec": 4}, "assetReads": [entry]}
        path = self.root / "proof.json"
        path.write_text(json.dumps(proof), encoding="utf-8")
        return path

    def test_nested_unicode_empty_directory_and_every_file_are_preserved(self):
        source = self.source_file()
        self.source_file("opaque.xyz", bytes(range(100)))
        (self.source / "空目录").mkdir()
        result = self.migrate()
        self.assertEqual(result["state"], "IMPORTED_SOURCE_RETAINED")
        self.assertEqual(source.read_bytes(), b"original bytes")
        self.assertEqual((self.originals / "目录 空格/原件.txt").read_bytes(), b"original bytes")
        self.assertTrue((self.originals / "空目录").is_dir())
        self.assertEqual(len(self.catalog()["assets"]), 2)
        self.assertTrue(all(a["reviewStatus"] == "UNREVIEWED" for a in self.catalog()["assets"]))
        self.assertEqual(library.validate(self.root)["status"], "PASS")

    def test_dry_run_does_not_write_any_project_assets(self):
        self.source_file()
        result = self.migrate(dry_run=True)
        self.assertEqual(result["state"], "DRY_RUN")
        self.assertFalse((self.root / "assets").exists())

    def test_different_content_conflict_preserves_both_and_records_mapping(self):
        self.source_file("same.txt", b"incoming")
        self.originals.mkdir(parents=True)
        (self.originals / "same.txt").write_bytes(b"existing")
        result = self.migrate()
        self.assertEqual((self.originals / "same.txt").read_bytes(), b"existing")
        entry = result["files"][0]
        self.assertIn("import-test-run", entry["targetPath"])
        self.assertEqual((self.root / entry["targetPath"]).read_bytes(), b"incoming")

    def test_same_content_reuse_and_repeat_keep_asset_ids(self):
        self.source_file("same.txt", b"same")
        self.originals.mkdir(parents=True)
        (self.originals / "same.txt").write_bytes(b"same")
        self.migrate()
        before = self.catalog_path.read_bytes()
        self.migrate(resume=True)
        library.index_library(self.root)
        self.assertEqual(self.catalog_path.read_bytes(), before)
        self.assertEqual(len(list(self.originals.rglob("same.txt"))), 1)

    def test_duplicate_bytes_at_distinct_paths_keep_distinct_ids(self):
        self.source_file("one.txt", b"same")
        self.source_file("two.txt", b"same")
        self.migrate()
        self.assertEqual(len({a["assetId"] for a in self.catalog()["assets"]}), 2)

    def test_interrupted_copy_resumes_without_trusting_partial_file(self):
        self.source_file("one.txt", b"first")
        self.source_file("two.txt", b"second")
        real_copy = library.copy_verified
        count = 0
        def interrupt(source, destination, expected_hash, expected_bytes, **kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("simulated interruption")
            return real_copy(source, destination, expected_hash, expected_bytes, **kwargs)
        with patch.object(library, "copy_verified", side_effect=interrupt):
            result = self.migrate()
        self.assertEqual(result["status"], "PARTIAL")
        self.assertTrue((self.source / "one.txt").exists())
        self.migrate(resume=True)
        self.assertEqual((self.originals / "one.txt").read_bytes(), b"first")
        self.assertEqual((self.originals / "two.txt").read_bytes(), b"second")

    def test_source_change_during_copy_keeps_source_and_reports_failure(self):
        source = self.source_file("change.txt", b"before")
        real_copy = library.copy_verified
        def change(src, dest, sha, size, **kwargs):
            result = real_copy(src, dest, sha, size, **kwargs)
            source.write_bytes(b"changed by writer")
            return result
        with patch.object(library, "copy_verified", side_effect=change):
            result = self.migrate()
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual(source.read_bytes(), b"changed by writer")

    def test_index_does_not_silently_adopt_modified_original(self):
        self.source_file("image.bin")
        self.migrate()
        (self.originals / "image.bin").write_bytes(b"tamper")
        with self.assertRaises(library.AssetLibraryError):
            library.index_library(self.root)
        self.assertEqual(library.validate(self.root)["status"], "FAIL")

    def test_reindex_keeps_review_and_metadata(self):
        self.source_file()
        self.migrate()
        catalog = self.catalog()
        catalog["assets"][0]["reviewStatus"] = "EXCLUDED"
        catalog["assets"][0]["tags"] = ["manual-review"]
        self.catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
        library.index_library(self.root)
        self.assertEqual(self.catalog()["assets"][0]["reviewStatus"], "EXCLUDED")
        self.assertEqual(self.catalog()["assets"][0]["tags"], ["manual-review"])

    def test_missing_source_without_migration_is_not_success(self):
        self.source.rmdir()
        with self.assertRaises(library.AssetLibraryError):
            self.migrate(resume=True)

    def test_source_change_before_cleanup_preserves_new_bytes(self):
        source = self.source_file()
        self.migrate()
        proof = self.proof()
        source.write_bytes(b"newer user version")
        result = self.migrate(cleanup=True, resume=True, render_proof=proof)
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual(source.read_bytes(), b"newer user version")

    def test_cleanup_without_proof_or_with_corrupt_target_preserves_source(self):
        source = self.source_file()
        self.migrate()
        with self.assertRaises(library.AssetLibraryError):
            self.migrate(cleanup=True, resume=True)
        proof = self.proof()
        (self.originals / "目录 空格/原件.txt").write_bytes(b"corrupt")
        with self.assertRaises(library.AssetLibraryError):
            self.migrate(cleanup=True, resume=True, render_proof=proof)
        self.assertTrue(source.exists())

    @unittest.skipUnless(os.name == "nt", "Windows handle-based deletion")
    def test_cleanup_removes_only_unchanged_manifest_files_then_replays(self):
        self.source_file()
        (self.source / "empty").mkdir()
        self.migrate()
        proof = self.proof()
        result = self.migrate(cleanup=True, resume=True, render_proof=proof)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["sourceState"], "REMOVED_EMPTY")
        self.assertFalse(self.source.exists())
        repeat = self.migrate(resume=True)
        self.assertEqual(repeat["state"], "ALREADY_MIGRATED")

    @unittest.skipUnless(os.name == "nt", "Windows handle-based deletion")
    def test_unlisted_new_source_file_is_never_deleted(self):
        self.source_file()
        self.migrate()
        proof = self.proof()
        self.source_file("new-file.txt", b"new")
        result = self.migrate(cleanup=True, resume=True, render_proof=proof)
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual((self.source / "new-file.txt").read_bytes(), b"new")

    def test_path_traversal_absolute_path_and_reparse_are_rejected(self):
        for path in ["../outside", "C:/outside", "/outside", "a/../../outside", "a:stream"]:
            with self.assertRaises(library.AssetLibraryError):
                library.safe_path(self.root, path)
        target = self.base / "outside"
        target.mkdir()
        junction = self.source / "link"
        if os.name == "nt":
            import subprocess
            subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(target)], check=True, capture_output=True)
        else:
            junction.symlink_to(target, target_is_directory=True)
        self.addCleanup(lambda: os.rmdir(junction) if junction.exists() else None)
        with self.assertRaises(library.AssetLibraryError):
            self.migrate()

    def test_real_alpha_is_measured_instead_of_inferred_from_rgba(self):
        Image.new("RGBA", (2, 2), (200, 200, 200, 255)).save(self.source / "opaque.png")
        image = Image.new("RGBA", (2, 2), (255, 255, 255, 255))
        image.putpixel((0, 0), (255, 255, 255, 0))
        image.save(self.source / "transparent.png")
        self.migrate()
        by_name = {Path(a["originalPath"]).name: a for a in self.catalog()["assets"]}
        self.assertFalse(by_name["opaque.png"]["hasTransparency"])
        self.assertTrue(by_name["transparent.png"]["hasTransparency"])
        self.assertEqual((self.source / "transparent.png").read_bytes(), (self.originals / "transparent.png").read_bytes())

    def test_directory_conflicting_with_existing_file_uses_import_batch(self):
        self.source_file("folder/item.txt", b"incoming")
        self.originals.mkdir(parents=True)
        (self.originals / "folder").write_bytes(b"existing file")
        result = self.migrate()
        self.assertEqual(result["state"], "IMPORTED_SOURCE_RETAINED")
        self.assertEqual((self.originals / "folder").read_bytes(), b"existing file")
        self.assertEqual((self.originals / "import-test-run/folder/item.txt").read_bytes(), b"incoming")

    def test_interruption_does_not_put_unverified_temporary_files_in_originals(self):
        self.source_file("file.txt", b"complete")
        real_copy = library.shutil.copyfileobj
        count = 0
        def interrupt(src, dest, length):
            nonlocal count
            count += 1
            if count == 2:
                dest.write(b"UNVERIFIED")
                raise OSError("copy interrupted during promotion")
            return real_copy(src, dest, length)
        with patch.object(library.shutil, "copyfileobj", side_effect=interrupt):
            self.migrate()
        self.migrate(resume=True)
        self.assertEqual([p.name for p in self.originals.rglob("*") if p.is_file()], ["file.txt"])

    def test_catalog_validate_rejects_unindexed_original_files(self):
        self.source_file()
        self.migrate()
        (self.originals / "unindexed.dat").write_bytes(b"unreviewed")
        self.assertEqual(library.validate(self.root)["status"], "FAIL")

    def test_brand_catalog_entries_survive_reindex(self):
        self.source_file()
        self.migrate()
        author = self.root / "assets/brand/enhe/author/person.png"
        author.parent.mkdir(parents=True)
        Image.new("RGB", (2, 2)).save(author)
        catalog = self.catalog()
        asset = dict(catalog["assets"][0])
        asset.update(assetId="author-original", originalPath="assets/brand/enhe/author/person.png", sha256=hashlib.sha256(author.read_bytes()).hexdigest())
        catalog["assets"].append(asset)
        self.catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
        library.index_library(self.root)
        self.assertEqual(len(self.catalog()["assets"]), 2)
        self.assertIn("author-original", {a["assetId"] for a in self.catalog()["assets"]})

    def test_proof_rejects_empty_reads_wrong_hash_wrong_batch_and_traversal(self):
        source = self.source_file()
        self.migrate()
        proof_path = self.proof()
        original = json.loads(proof_path.read_text())
        for field, value in [("assetReads", []), ("catalogSha256", "0" * 64), ("migrationRunId", "different-run"), ("videoPath", "../outside.mp4")]:
            with self.subTest(field=field):
                proof_path.write_text(json.dumps({**original, field: value}), encoding="utf-8")
                with self.assertRaises(library.AssetLibraryError):
                    self.migrate(resume=True, cleanup=True, render_proof=proof_path)
                self.assertTrue(source.exists())

    @unittest.skipUnless(os.name == "nt", "Windows concurrent writer exclusion")
    def test_open_source_writer_prevents_deletion(self):
        import ctypes
        from ctypes import wintypes
        source = self.source_file()
        self.migrate()
        proof = self.proof()
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.CreateFileW(str(source), 0x40000000, 7, None, 3, 0, None)
        self.assertNotEqual(handle, wintypes.HANDLE(-1).value)
        try:
            result = self.migrate(resume=True, cleanup=True, render_proof=proof)
            self.assertEqual(result["status"], "PARTIAL")
            self.assertTrue(source.exists())
        finally:
            kernel.CloseHandle(handle)

    def test_suspected_credential_file_is_retained_for_review(self):
        source = self.source_file(".env", b"PRIVATE_SERVICE_KEY=fixture-only")
        with self.assertRaises(library.AssetLibraryError):
            self.migrate()
        self.assertTrue(source.exists())
        self.assertFalse(self.originals.exists())

    def test_cleanup_partial_is_nonzero_at_cli_boundary(self):
        import contextlib
        import io
        source = self.source_file()
        self.migrate()
        proof = self.proof()
        source.write_bytes(b"changed")
        with contextlib.redirect_stdout(io.StringIO()):
            status = library.main(["migrate", "--project-root", str(self.root), "--source", str(self.source), "--run-id", "test-run", "--resume", "--cleanup", "--render-proof", str(proof)])
        self.assertEqual(status, 1)

    @unittest.skipUnless(os.name == "nt", "Windows deletion boundary")
    def test_fake_ftyp_video_cannot_authorize_source_deletion(self):
        source = self.source_file()
        self.migrate()
        proof_path = self.proof()
        proof = json.loads(proof_path.read_text())
        video = self.root / proof["videoPath"]
        video.write_bytes(b"\x00\x00\x00\x18ftypisom" + bytes(180))
        proof["videoSha256"] = hashlib.sha256(video.read_bytes()).hexdigest()
        proof_path.write_text(json.dumps(proof), encoding="utf-8")
        decoder = subprocess.run([str(self.ffmpeg), "-v", "error", "-i", str(video), "-f", "null", "-"], capture_output=True, timeout=30)
        self.assertTrue(decoder.returncode != 0 or decoder.stderr.strip())
        with self.assertRaises(library.AssetLibraryError):
            self.migrate(resume=True, cleanup=True, render_proof=proof_path)
        self.assertTrue(source.exists())

    @unittest.skipUnless(os.name == "nt", "Windows target write exclusion")
    def test_target_cannot_change_between_last_hash_and_source_deletion(self):
        source = self.source_file("one.txt", b"one")
        self.source_file("two.txt", b"two")
        self.migrate()
        proof = self.proof()
        unselected = next(a for a in self.catalog()["assets"] if a["assetId"] != self.catalog()["assets"][0]["assetId"])
        target = self.root / unselected["originalPath"]
        original = target.read_bytes()
        real_delete = library.delete_unchanged_windows
        attempts = []
        def change_after_check(path, sha, size):
            if path.name == target.name:
                try:
                    target.write_bytes(b"CORRUPTED AFTER FINAL HASH")
                    attempts.append("WRITE_SUCCEEDED")
                except PermissionError:
                    attempts.append("WRITE_DENIED")
            return real_delete(path, sha, size)
        with patch.object(library, "delete_unchanged_windows", side_effect=change_after_check):
            result = self.migrate(resume=True, cleanup=True, render_proof=proof)
        self.assertEqual(attempts, ["WRITE_DENIED"])
        self.assertEqual(target.read_bytes(), original)
        self.assertEqual(result["status"], "PASS")

    @unittest.skipUnless(os.name == "nt", "Windows target writer exclusion")
    def test_open_target_writer_retains_corresponding_source(self):
        import ctypes
        from ctypes import wintypes
        source = self.source_file()
        self.migrate()
        proof = self.proof()
        target = self.root / self.catalog()["assets"][0]["originalPath"]
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.CreateFileW(str(target), 0x40000000, 7, None, 3, 0, None)
        self.assertNotEqual(handle, wintypes.HANDLE(-1).value)
        try:
            result = self.migrate(resume=True, cleanup=True, render_proof=proof)
            self.assertEqual(result["status"], "PARTIAL")
            self.assertTrue(source.exists())
        finally:
            kernel.CloseHandle(handle)

    def test_probeable_but_corrupt_video_cannot_authorize_deletion(self):
        source = self.source_file()
        self.migrate()
        proof_path = self.proof()
        proof = json.loads(proof_path.read_text())
        video = self.root / proof["videoPath"]
        data = bytearray(video.read_bytes())
        offset = 0
        while offset < len(data):
            size = int.from_bytes(data[offset:offset + 4], "big")
            if data[offset + 4:offset + 8] == b"mdat":
                data[offset + size - 256:offset + size] = b"\xff" * 256
                break
            self.assertGreater(size, 0)
            offset += size
        self.assertLess(offset, len(data), "fixture must contain encoded media")
        video.write_bytes(data)
        probe = subprocess.run([str(self.ffprobe), "-v", "error", "-show_streams", "-of", "json", str(video)], capture_output=True, timeout=30)
        decoder = subprocess.run([str(self.ffmpeg), "-v", "error", "-xerror", "-i", str(video), "-f", "null", "-"], capture_output=True, timeout=30)
        self.assertEqual(probe.returncode, 0)
        self.assertTrue(decoder.returncode != 0 or decoder.stderr.strip())
        proof["videoSha256"] = hashlib.sha256(data).hexdigest()
        proof_path.write_text(json.dumps(proof), encoding="utf-8")
        with self.assertRaisesRegex(library.AssetLibraryError, "ACTUAL_FFMPEG_DECODE_FAILED"):
            self.migrate(resume=True, cleanup=True, render_proof=proof_path)
        self.assertTrue(source.exists())

    def test_actual_movie_duration_must_match_receipt(self):
        source = self.source_file()
        self.migrate()
        proof_path = self.proof()
        proof = json.loads(proof_path.read_text())
        proof["media"]["durationSec"] = 3
        proof_path.write_text(json.dumps(proof), encoding="utf-8")
        with self.assertRaisesRegex(library.AssetLibraryError, "ACTUAL_MEDIA_SPEC_MISMATCH"):
            self.migrate(resume=True, cleanup=True, render_proof=proof_path)
        self.assertTrue(source.exists())

    def test_cli_tool_argument_rejects_script_instead_of_executing_it(self):
        source = self.source_file()
        self.migrate()
        proof_path = self.proof()
        with self.assertRaisesRegex(library.AssetLibraryError, "MEDIA_TOOL_NOT_EXECUTABLE"):
            self.migrate(resume=True, cleanup=True, render_proof=proof_path, ffmpeg=SCRIPT)
        self.assertTrue(source.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
