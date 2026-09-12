# SPDX-License-Identifier: Apache-2.0
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("audition_qwen3_zh", Path(__file__).with_name("audition-qwen3-zh.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QwenAuditionContractTests(unittest.TestCase):
    def test_two_named_instructions_are_the_hard_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("natural", "presenter", "third"):
                (root / f"{name}.txt").write_text(name, encoding="utf-8")
            parsed = module.parse_instructions(root, ["natural=natural.txt", "presenter=presenter.txt"])
            self.assertEqual([item["name"] for item in parsed], ["natural", "presenter"])
            with self.assertRaisesRegex(ValueError, "one or two"):
                module.parse_instructions(root, ["natural=natural.txt", "presenter=presenter.txt", "third=third.txt"])

    def test_approved_pronunciation_is_separate_from_display_copy(self):
        display = "支持 Skill 的 Codex；更多 AI 工具。"
        pronunciation = {"replacements": [
            {"display": "Skill", "spoken": "技能"},
            {"display": "Codex", "spoken": "扣代克斯"},
            {"display": "AI", "spoken": "人工智能"},
        ]}
        self.assertEqual(module.spoken_text(display, pronunciation), "支持 技能 的 扣代克斯；更多 人工智能 工具。")
        self.assertEqual(display, "支持 Skill 的 Codex；更多 AI 工具。")

    def test_instruction_and_generation_parameters_change_cache_identity(self):
        common = {"textSha256": "1" * 64, "spokenTextSha256": "2" * 64,
                  "pronunciationSha256": "3" * 64, "modelAggregateSha256": "4" * 64,
                  "packageLockSha256": "5" * 64, "revision": "f00cf133", "speaker": "Dylan",
                  "language": "Chinese", "device": "cpu", "dtype": "float32",
                  "generation": {"seed": 20260911, "temperature": 0.9}}
        first = module.audition_identity(common, "natural", "自然讲解")
        second = module.audition_identity(common, "presenter", "轻快讲解")
        self.assertNotEqual(module.cache_key(first), module.cache_key(second))
        changed = module.audition_identity({**common, "generation": {"seed": 7, "temperature": 0.9}}, "natural", "自然讲解")
        self.assertNotEqual(module.cache_key(first), module.cache_key(changed))

    def test_provider_evidence_never_claims_unavailable_alignment(self):
        evidence = module.provider_evidence(sample_count=48000, sample_rate=24000)
        self.assertEqual(evidence["durationSec"], 2)
        self.assertEqual(evidence["timingSource"], "NONE")
        self.assertIsNone(evidence["phonemeTimings"])
        self.assertIsNone(evidence["wordTimings"])

    def test_cache_rejects_a_receipt_without_bound_files(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "identity or review"):
                module.verify_cache(Path(directory), {"cacheKey": "key", "humanReview": "NOT_RUN", "files": []}, "key", {})

    def test_fixed_run_request_rejects_changed_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request = {"outputPath": "fixed", "plannedIdentities": [{"cacheKey": "one"}]}
            request_file = root / "request.json"
            request_file.write_text(json.dumps(request), encoding="utf-8")
            old_path, old_sha = module.RUN_REQUEST_PATH, module.RUN_REQUEST_SHA256
            try:
                module.RUN_REQUEST_PATH = "request.json"
                module.RUN_REQUEST_SHA256 = module.sha(request_file)
                module.validate_run_request(root, request)
                with self.assertRaisesRegex(ValueError, "fixed authorized"):
                    module.validate_run_request(root, {**request, "outputPath": "other"})
            finally:
                module.RUN_REQUEST_PATH, module.RUN_REQUEST_SHA256 = old_path, old_sha

    def test_approved_copy_binding_requires_the_exact_full_line_and_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            document = root / "copy.md"
            receipt_file = root / "receipt.json"
            display = "完整批准旁白。"
            document.write_text(f"# v2\n\n{display}\n", encoding="utf-8")
            receipt = {"decision": "APPROVED", "version": "v2", "copyPath": "copy.md",
                       "sha256": module.sha(document)}
            receipt_file.write_text(json.dumps(receipt), encoding="utf-8")
            config = {"approvedCopy": {"documentPath": "copy.md", "documentSha256": module.sha(document),
                      "receiptPath": "receipt.json", "receiptSha256": module.sha(receipt_file),
                      "decision": "APPROVED", "version": "v2"}}
            module.validate_copy_binding(root, config, display)
            with self.assertRaisesRegex(ValueError, "exact approved"):
                module.validate_copy_binding(root, config, "只取一部分。")

    def test_cache_binds_identity_file_set_and_provider_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity = {"speaker": "Dylan", "language": "Chinese", "instruct": "自然",
                        "textSha256": module.hashlib.sha256("全文".encode()).hexdigest(),
                        "spokenTextSha256": module.hashlib.sha256("全文".encode()).hexdigest()}
            (root / "raw.wav").write_bytes(b"wave")
            module.write_json(root / "provider.json", {"speaker": "Dylan", "language": "Chinese",
                "instruct": "自然", "text": "全文", "spokenText": "全文", "timingSource": "NONE",
                "phonemeTimings": None, "wordTimings": None})
            files = [{"path": name, "sha256": module.sha(root / name)} for name in ("raw.wav", "provider.json")]
            receipt = {"cacheKey": "key", "identity": identity, "technicalStatus": "PASS",
                       "humanReview": "NOT_RUN", "selected": False, "rawPath": "raw.wav",
                       "providerEvidencePath": "provider.json", "files": files}
            module.verify_cache(root, receipt, "key", identity)
            with self.assertRaisesRegex(ValueError, "identity or review"):
                module.verify_cache(root, {**receipt, "identity": {**identity, "speaker": "Other"}}, "key", identity)
            provider = json.loads((root / "provider.json").read_text(encoding="utf-8"))
            provider["instruct"] = "不同"
            module.write_json(root / "provider.changed.json", provider)
            (root / "provider.json").write_text(
                (root / "provider.changed.json").read_text(encoding="utf-8"), encoding="utf-8"
            )
            (root / "provider.changed.json").unlink()
            changed_receipt = {**receipt, "files": [
                {"path": name, "sha256": module.sha(root / name)} for name in ("raw.wav", "provider.json")
            ]}
            with self.assertRaisesRegex(ValueError, "provider evidence"):
                module.verify_cache(root, changed_receipt, "key", identity)


if __name__ == "__main__":
    unittest.main()
