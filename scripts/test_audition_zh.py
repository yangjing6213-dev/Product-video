# SPDX-License-Identifier: Apache-2.0
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("audition_zh", Path(__file__).with_name("audition-zh.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AuditionContractTests(unittest.TestCase):
    def test_cache_key_binds_every_speech_input(self):
        inputs = {"textSha256": "text", "pronunciationSha256": "map", "provider": "kokoro-onnx",
                  "modelSha256": "model", "voicesSha256": "voices", "voiceId": "zm_009",
                  "settings": {"speed": 1.0}, "versions": {"script": "1", "frontend": "0.9.4"}}
        first = module.cache_key(inputs)
        self.assertEqual(first, module.cache_key(dict(reversed(list(inputs.items())))))
        for key in inputs:
            changed = copy.deepcopy(inputs)
            changed[key] = "different"
            self.assertNotEqual(first, module.cache_key(changed), key)

    def test_no_fourth_duplicate_or_non_chinese_male_voice(self):
        available = {"zm_009", "zm_011", "zm_029", "zf_001", "am_michael"}
        module.validate_voices(["zm_009", "zm_011", "zm_029"], available)
        for voices in [[], ["zm_009"] * 2, ["zf_001"], ["am_michael"], ["zm_999"], ["zm_009", "zm_011", "zm_029", "zm_030"]]:
            with self.assertRaises(ValueError):
                module.validate_voices(voices, available)

    def test_current_task_can_reject_a_historical_voice_without_changing_legacy_validation(self):
        available = {"zm_009", "zm_011", "zm_029"}
        module.validate_voices(["zm_011"], available)
        with self.assertRaisesRegex(ValueError, "rejected"):
            module.validate_voices(["zm_011"], available, rejected={"zm_011"})

    def test_quality_context_participates_in_new_audition_cache_identity(self):
        args = {"text_sha": "1" * 64, "spoken_text_sha": "2" * 64, "pronunciation_sha": "3" * 64,
                "voice": "zm_029", "model_sha": "4" * 64, "voices_sha": "5" * 64,
                "versions": {"auditionScript": "2.0.0"}, "context_hash": "6" * 64,
                "locale": "zh-CN", "settings": {"speed": 1.0}, "mix": {"version": "2"}}
        base = module.audition_identity(**args)
        changed = module.audition_identity(**{**args, "context_hash": "7" * 64})
        self.assertNotEqual(module.cache_key(base), module.cache_key(changed))

    def test_delivery_mode_and_direction_participate_in_raw_audition_cache_identity(self):
        direction = {"purpose": "展示结果", "attitude": "认可", "emphasis": ["效果"],
                     "pace": "brisk", "pause": "balanced", "visualEvent": "结果出现"}
        controls = module.resolve_voice_direction({"speed": 1, "sentencePauseSec": 0.3, "clausePauseSec": 0.12},
                                                  "presenter", direction, "你看，效果出来了。")
        common = {"text_sha": "1" * 64, "spoken_text_sha": "2" * 64, "pronunciation_sha": "3" * 64,
                  "voice": "zm_029", "model_sha": "4" * 64, "voices_sha": "5" * 64,
                  "versions": {"auditionScript": "3.0.0"}, "context_hash": "6" * 64,
                  "locale": "zh-CN", "settings": {"speed": 1.0}, "mix": {"version": "2"}}
        natural = module.audition_identity(**common, delivery_mode="natural", ordered_directions=[direction],
                                           ordered_effective_controls=[controls])
        presenter = module.audition_identity(**common, delivery_mode="presenter", ordered_directions=[direction],
                                             ordered_effective_controls=[controls])
        self.assertNotEqual(module.synthesis_key(natural), module.synthesis_key(presenter))
        self.assertEqual(presenter["directionMappingVersion"], "kokoro-zh-direction-v1")

    def test_segmented_audition_directions_reconstruct_approved_text_and_keep_notes_out_of_spoken_text(self):
        display = "封面怎么不同？进入恩禾官网搜索。"
        pronunciation = {"replacements": []}
        profile = {"speed": 1, "sentencePauseSec": 0.3, "clausePauseSec": 0.12}
        document = {"schemaVersion": "1.0", "segments": [
            {"text": "封面怎么不同？", "voiceDirection": {"purpose": "提出问题", "attitude": "好奇", "emphasis": ["不同"],
                                                       "pace": "brisk", "pause": "connected", "visualEvent": "对比出现"}},
            {"text": "进入恩禾官网搜索。", "voiceDirection": {"purpose": "引导行动", "attitude": "友好", "emphasis": ["恩禾官网"],
                                                           "pace": "steady", "pause": "balanced", "visualEvent": "官网出现"}},
        ]}
        segments = module.prepare_audition_segments(display, pronunciation, profile, "presenter", document)
        self.assertEqual("".join(item["displayText"] for item in segments), display)
        self.assertEqual("".join(item["spokenText"] for item in segments), display)
        self.assertNotIn("好奇", "".join(item["spokenText"] for item in segments))
        self.assertEqual([item["effectiveProviderControls"]["speed"] for item in segments], [1.08, 0.98])
        with self.assertRaisesRegex(ValueError, "reconstruct"):
            module.prepare_audition_segments(display + "遗漏。", pronunciation, profile, "presenter", document)

    def test_short_approved_motion_copy_uses_an_explicit_character_window(self):
        with self.assertRaisesRegex(ValueError, "character"):
            module.validate_character_count(32, 60, 100)
        module.validate_character_count(32, 20, 60)
        with self.assertRaises(ValueError):
            module.validate_character_count(32, 60, 20)

    def test_motion_draft_uses_its_explicit_duration_window(self):
        self.assertFalse(module.duration_in_window(7.5, 15, 25))
        self.assertTrue(module.duration_in_window(7.5, 1, 12))
        with self.assertRaises(ValueError):
            module.duration_in_window(7.5, 12, 1)

    def test_pronunciation_is_explicit_and_does_not_allow_latin_frontend_loss(self):
        self.assertEqual(module.spoken_text("ENHE，把想法变成故事。", {"replacements": [{"display": "ENHE", "spoken": "恩禾"}]}), "恩禾，把想法变成故事。")
        with self.assertRaises(ValueError):
            module.spoken_text("ENHE test", {"replacements": []})

    def test_cache_hit_checks_audio_bytes_and_does_not_infer_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "raw.wav").write_bytes(b"raw")
            (root / "listen.wav").write_bytes(b"listen")
            record = {"cacheKey": "key", "files": [{"path": "raw.wav", "sha256": module.sha(root / "raw.wav")},
                                                        {"path": "listen.wav", "sha256": module.sha(root / "listen.wav")}],
                      "humanReview": "NOT_RUN", "humanScore": None}
            self.assertEqual(module.verify_cache(root, record, "key")["humanReview"], "NOT_RUN")
            with self.assertRaises(ValueError):
                module.verify_cache(root, record, "changed-key")
            (root / "raw.wav").write_bytes(b"drift")
            with self.assertRaises(ValueError):
                module.verify_cache(root, record, "key")

    def test_safe_paths_and_exclusive_publication_preserve_old_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in ["../outside", "C:/outside", "/outside", "https://example.com/file"]:
                with self.assertRaises(ValueError):
                    module.local_path(root, relative)
            target = root / "kept.json"
            module.write_json(target, {"original": True})
            with self.assertRaises(FileExistsError):
                module.write_json(target, {"overwrite": True})
            self.assertEqual(json.loads(target.read_text()), {"original": True})

    def test_mix_revision_can_reuse_verified_raw_without_speech_regeneration(self):
        first = {"voiceId": "zm_009", "modelSha256": "model", "settings": {"speed": 1.0}, "mix": {"version": "1"}}
        revised = copy.deepcopy(first)
        revised["mix"] = {"version": "2"}
        self.assertEqual(module.synthesis_key(first), module.synthesis_key(revised))
        self.assertNotEqual(module.cache_key(first), module.cache_key(revised))
        revised["settings"]["speed"] = 1.1
        self.assertNotEqual(module.synthesis_key(first), module.synthesis_key(revised))

    def test_raw_reuse_copies_verified_waveform_and_rejects_source_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output, drift_output = root / "old", root / "new", root / "changed"
            for item in (source, output, drift_output):
                item.mkdir()
            identity = {"voiceId": "zm_009", "modelSha256": "model", "settings": {"speed": 1.0}, "mix": {"version": "1"}}
            files = []
            for name, content in (("audition-zm_009-old-raw.wav", b"original wave"), ("audition-zm_009-old-timing.json", b"[]")):
                (source / name).write_bytes(content)
                files.append({"path": name, "sha256": module.sha(source / name)})
            receipt = {"identity": identity, "cacheKey": module.cache_key(identity), "files": files, "durationSec": 16}
            module.write_json(source / "audition-zm_009-old-raw.json", receipt)
            revised = {**identity, "mix": {"version": "2"}}
            result = module.reuse_raw(source, output, revised, "audition-new")
            self.assertEqual(result["synthesisCalls"], 0)
            self.assertEqual((output / "audition-new-raw.wav").read_bytes(), b"original wave")
            self.assertEqual((source / files[0]["path"]).read_bytes(), b"original wave")
            (source / files[0]["path"]).write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "changed"):
                module.reuse_raw(source, drift_output, revised, "audition-new")
            self.assertEqual(list(drift_output.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
