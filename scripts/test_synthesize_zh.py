import importlib.util
from pathlib import Path
import unittest
import tempfile

spec = importlib.util.spec_from_file_location("synthesize_zh", Path(__file__).with_name("synthesize-zh.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MeasuredTimingTests(unittest.TestCase):
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
