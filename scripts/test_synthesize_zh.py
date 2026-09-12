import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
from types import SimpleNamespace
import json
import hashlib

spec = importlib.util.spec_from_file_location("synthesize_zh", Path(__file__).with_name("synthesize-zh.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MeasuredTimingTests(unittest.TestCase):
    def test_copy_gate_uses_shared_cli_and_preserves_chinese_space_path_arguments(self):
        root = Path(__file__).resolve().parent.parent
        with patch.object(module.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=json.dumps({"projectId": "copy-fixture", "copySha256": "a" * 64}), stderr="")) as run:
            module.require_copy_approval(root, "copy-fixture")
        command = run.call_args.args[0]
        self.assertEqual(command[1], str(root / "src/quality/cli.ts"))
        self.assertIn("copy-check", command)
        self.assertIn("--legacy-spec", command)
        self.assertEqual(command[command.index("--project-root") + 1], str(root))
        self.assertFalse(run.call_args.kwargs.get("shell", False))

    def test_missing_copy_approval_blocks_before_any_tts_work(self):
        with patch.object(module.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="", stderr="Copy approval required")):
            with self.assertRaisesRegex(ValueError, "Copy approval required"):
                module.require_copy_approval(Path(__file__).resolve().parent.parent, "unapproved")

    def make_approved_input(self, root):
        project = root / "projects" / "race-fixture"
        (project / "input").mkdir(parents=True)
        spec = {"projectId": "race-fixture", "product": {"name": "Test", "url": ""},
                "audio": {"narrationMode": "hyperframes"}, "narrative": {"cta": "查看项目"},
                "output": {"targetDurationSec": 5}, "scenes": [{"id": "scene-01", "voiceover": "已认可的句子。", "onScreenText": ["已认可标题"]}]}
        authored = {"scenes": [{"sceneId": "scene-01", "captionSegments": [{"text": "已认可的句子。"}]}]}
        (project / "video-spec.json").write_text(json.dumps(spec), encoding="utf-8")
        (project / "input/narration-script.json").write_text(json.dumps(authored), encoding="utf-8")
        copy = {"projectId": "race-fixture", "copySha256": "a" * 64, "narration": ["已认可的句子。"],
                "onScreenText": ["已认可标题"], "subtitles": ["已认可的句子。"], "cta": "查看项目"}
        return project, spec, authored, copy

    def test_synthesis_uses_checked_snapshot_and_changed_inputs_cannot_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, spec, authored, copy = self.make_approved_input(root)
            with patch.object(module, "require_copy_approval", return_value=copy):
                snapshot = module.snapshot_narration_inputs(root, "race-fixture")
                spec["scenes"][0]["voiceover"] = "未经认可的替换句。"
                authored["scenes"][0]["captionSegments"][0]["text"] = "未经认可的替换句。"
                (project / "video-spec.json").write_text(json.dumps(spec), encoding="utf-8")
                (project / "input/narration-script.json").write_text(json.dumps(authored), encoding="utf-8")
                self.assertEqual(snapshot["spec"]["scenes"][0]["voiceover"], "已认可的句子。")
                self.assertEqual(snapshot["authored"]["scenes"][0]["captionSegments"][0]["text"], "已认可的句子。")
                staging = project / ".tts-staging-fixture"
                (staging / "assets").mkdir(parents=True)
                (staging / "assets/narration.wav").write_bytes(b"only a fixture")
                with self.assertRaisesRegex(ValueError, "changed"):
                    module.publish_approved_outputs(root, "race-fixture", snapshot, staging, [Path("assets/narration.wav")])
                self.assertFalse((project / "assets/narration.wav").exists())
                self.assertTrue((staging / "assets/narration.wav").exists())

    def test_input_change_while_approval_is_checked_is_rejected_before_model_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, spec, authored, copy = self.make_approved_input(root)
            def change_and_approve(*_):
                (project / "input/narration-script.json").write_text(json.dumps({"scenes": []}), encoding="utf-8")
                return copy
            with patch.object(module, "require_copy_approval", side_effect=change_and_approve):
                with self.assertRaisesRegex(ValueError, "changed"):
                    module.snapshot_narration_inputs(root, "race-fixture")

    def test_snapshot_accepts_node_validated_current_copy_with_policy_screen_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _, _, _, copy = self.make_approved_input(root)
            copy["onScreenText"].extend(["恩禾 ENHE AI", "访问恩禾官网，了解产品与使用方式。"])
            with patch.object(module, "require_copy_approval", return_value=copy):
                snapshot = module.snapshot_narration_inputs(root, "race-fixture")
            self.assertEqual(snapshot["copySha256"], "a" * 64)

    def test_rejected_copy_after_synthesis_preserves_staging_without_formal_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, _, _, copy = self.make_approved_input(root)
            with patch.object(module, "require_copy_approval", return_value=copy):
                snapshot = module.snapshot_narration_inputs(root, "race-fixture")
            staging = project / ".tts-staging-fixture"
            (staging / "assets").mkdir(parents=True)
            (staging / "assets/narration.wav").write_bytes(b"only a fixture")
            with patch.object(module, "require_copy_approval", side_effect=ValueError("Copy approval REJECTED")):
                with self.assertRaisesRegex(ValueError, "REJECTED"):
                    module.publish_approved_outputs(root, "race-fixture", snapshot, staging, [Path("assets/narration.wav")])
            self.assertFalse((project / "assets/narration.wav").exists())
            self.assertTrue((staging / "assets/narration.wav").exists())

    def test_consistent_snapshot_publishes_exclusively_and_uses_original_script_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, _, _, copy = self.make_approved_input(root)
            with patch.object(module, "require_copy_approval", return_value=copy):
                snapshot = module.snapshot_narration_inputs(root, "race-fixture")
                self.assertEqual(snapshot["scriptSha256"], hashlib.sha256((project / "input/narration-script.json").read_bytes()).hexdigest())
                staging = project / ".tts-staging-fixture"
                (staging / "assets").mkdir(parents=True)
                (staging / "assets/narration.wav").write_bytes(b"only a fixture")
                module.publish_approved_outputs(root, "race-fixture", snapshot, staging, [Path("assets/narration.wav")])
            self.assertEqual((project / "assets/narration.wav").read_bytes(), b"only a fixture")

    def test_positions_use_samples_and_stay_inside_scene(self):
        positions = module.place_segments([24000, 48000], 24000, 5, 10)
        self.assertEqual([end - start for start, end in positions], [24000, 48000])
        self.assertGreaterEqual(positions[0][0], 120000)
        self.assertLessEqual(positions[-1][1], 240000)
        self.assertLess(positions[0][1], positions[1][0])

    def test_overrun_is_rejected_instead_of_truncating_audio(self):
        with self.assertRaisesRegex(ValueError, "fit"):
            module.place_segments([120000], 24000, 0, 5)

    def test_invalid_samples_are_rejected(self):
        for lengths in [[0], [-1], [float("nan")], []]:
            with self.assertRaises(ValueError):
                module.place_segments(lengths, 24000, 0, 5)

    def test_srt_rounding_carries_to_next_minute(self):
        self.assertEqual(module.srt_time(59.9996), "00:01:00,000")

    def test_frontend_cannot_silently_drop_english(self):
        with self.assertRaisesRegex(ValueError, "Chinese"):
            module.validate_phrase("Visit GitHub")
        module.validate_phrase("访问官网，查看项目代码。")

    def test_new_mode_speaks_one_semantic_scene_with_pronunciation_replacements(self):
        scene = {"voiceover": "更多 AI 工具，到 ENHE 官网看看。"}
        pronunciation = {"replacements": [{"display": "AI", "spoken": "人工智能"},
                                             {"display": "ENHE", "spoken": "恩禾"}]}
        self.assertEqual(module.narration_units(scene, pronunciation, semantic_mode=True),
                         ["更多 人工智能 工具，到 恩禾 官网看看。"])

    def test_new_mode_never_changes_speed_to_fit_a_fixed_scene(self):
        with self.assertRaisesRegex(ValueError, "revise narration or timeline"):
            module.adjust_speed_for_fit(1.0, measured=6, available=5, attempt=0, semantic_mode=True)
        self.assertGreater(module.adjust_speed_for_fit(1.0, measured=6, available=5, attempt=0, semantic_mode=False), 1.0)

    def test_semantic_evidence_binds_provider_profile_and_rules_context(self):
        profile = {"provider": "kokoro-onnx", "modelId": "kokoro-v1.1-zh", "voiceId": "zm_029", "locale": "zh-CN",
                   "speed": 1, "sentencePauseSec": 0.3, "clausePauseSec": 0.12}
        fields = module.semantic_evidence_fields(profile, "a" * 64, "b" * 64)
        self.assertEqual(fields["generator"], {"provider": "kokoro-onnx", "locale": "zh-CN", "profileHash": "a" * 64,
                                                "settings": {"speed": 1, "sentencePauseSec": 0.3, "clausePauseSec": 0.12,
                                                             "trim": True, "continuous": False, "isPhonemes": True}})
        self.assertEqual(fields["qualityRulesSha256"], "b" * 64)
        self.assertEqual(fields["contextHash"], "b" * 64)

    def test_voice_direction_maps_only_real_provider_controls_and_changes_identity(self):
        profile = {"provider": "kokoro-onnx", "modelId": "kokoro-v1.1-zh", "voiceId": "zm_029", "locale": "zh-CN",
                   "speed": 1, "sentencePauseSec": 0.3, "clausePauseSec": 0.12}
        direction = {"purpose": "提出问题", "attitude": "好奇", "emphasis": ["真的学会"],
                     "pace": "brisk", "pause": "deliberate", "visualEvent": "问题出现"}
        resolved = module.resolve_voice_direction(profile, "presenter", direction, "真的学会了吗？")
        self.assertEqual(resolved["speed"], 1.08)
        self.assertEqual(resolved["sentencePauseSec"], 0.42)
        self.assertEqual(resolved["clausePauseSec"], 0.168)
        self.assertNotIn("emotion", resolved)
        self.assertEqual(resolved["unsupported"], ["emotion", "pitch", "energy", "word-level-emphasis"])
        first = module.direction_identity_fields("presenter", [direction], [resolved])
        changed = module.direction_identity_fields("presenter", [{**direction, "attitude": "认真"}], [resolved])
        self.assertNotEqual(module.canonical_hash(first), module.canonical_hash(changed))

    def test_voice_direction_rejects_missing_emphasis_and_out_of_range_effective_speed(self):
        profile = {"speed": 1.3, "sentencePauseSec": 0.3, "clausePauseSec": 0.12}
        direction = {"purpose": "提出问题", "attitude": "好奇", "emphasis": ["不存在"],
                     "pace": "brisk", "pause": "balanced", "visualEvent": "问题出现"}
        with self.assertRaisesRegex(ValueError, "emphasis"):
            module.resolve_voice_direction(profile, "presenter", direction, "真的学会了吗？")
        with self.assertRaisesRegex(ValueError, "range"):
            module.resolve_voice_direction(profile, "presenter", {**direction, "emphasis": ["真的学会"]}, "真的学会了吗？")

    def test_publish_failure_rolls_back_own_files_and_preserves_existing_data(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            staging = project / "stage"
            staging.mkdir()
            (staging / "one").write_bytes(b"new-one")
            (staging / "two").write_bytes(b"new-two")
            (project / "two").write_bytes(b"user-data")
            with self.assertRaises(FileExistsError):
                module.publish_outputs(project, staging, [Path("one"), Path("two")])
            self.assertFalse((project / "one").exists())
            self.assertEqual((project / "two").read_bytes(), b"user-data")

    def test_publish_rejects_paths_outside_project(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            with self.assertRaises(ValueError):
                module.publish_outputs(project, project, [Path("../outside")])


if __name__ == "__main__":
    unittest.main()
