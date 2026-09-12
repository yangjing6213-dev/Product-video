# SPDX-License-Identifier: Apache-2.0
import importlib.util
from pathlib import Path
import unittest


class QwenAlignmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).with_name('synthesize-qwen3.py')
        spec = importlib.util.spec_from_file_location('qwen_production', path)
        cls.runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.runner)

    def raw(self, text):
        return {'transcription': [{'offsets':{'from':200,'to':200+len(text)*130},'tokens': [
            {'text': c, 't_dtw':20+i*13,'offsets': {'from': 200 + i * 130, 'to': 330 + i * 130}}
            for i, c in enumerate(text)]}]}

    def test_real_token_boundaries_and_display_pronunciation(self):
        scenes = [{'id': 'one', 'voiceover': '用 AI。'}, {'id': 'two', 'voiceover': '开始吧。'}]
        cues, tokens = self.runner.align_cues(self.raw('用人工智能开始吧'), scenes, {'AI': '人工智能'})
        self.assertEqual(''.join(c['text'] for c in cues), '用 AI。开始吧。')
        self.assertEqual(cues[0]['start'], .2)
        self.assertEqual(cues[0]['end'], .85)
        self.assertEqual(cues[1]['start'], .85)
        self.assertEqual(cues[-1]['end'], tokens[-1]['end'])
        self.assertEqual(cues[0]['spokenText'], '用 人工智能。')

    def test_missing_or_different_spoken_words_fail(self):
        for actual in ['开始', '结束吧', '开始吧开始吧']:
            with self.subTest(actual=actual), self.assertRaisesRegex(ValueError, 'ASR text'):
                self.runner.align_cues(self.raw(actual), [{'id': 'one', 'voiceover': '开始吧。'}], {})

    def test_asr_vocabulary_comes_from_current_reviewed_script(self):
        scenes = [{'voiceover': '用 ENHE Product Video，配上 AI。ENHE Product Video。'}]
        prompt = self.runner.asr_prompt(scenes)
        self.assertIn('ENHE Product Video', prompt)
        self.assertEqual(prompt.count('ENHE Product Video'), 1)
        self.assertNotIn('封面', prompt)
        other = self.runner.asr_prompt([{'voiceover': '打开 NOVA Desk。'}])
        self.assertIn('NOVA Desk', other)
        self.assertNotIn('ENHE', other)
        mapped = self.runner.asr_prompt([{'voiceover':'旁白需要在支持 Skill 的 Codex 中使用，进入恩禾官网。'}], {'Skill':'技能','Codex':'扣代克斯'})
        self.assertIn('旁白', mapped)
        self.assertIn('恩禾', mapped)
        self.assertIn('在支持技能的扣代克斯中使用', mapped)
        self.assertNotIn('Codex', mapped)
        self.assertLess(len(self.runner.asr_prompt([{'voiceover': 'word ' * 1000}])), 320)
        # Hints never authorize replacement of a wrong recognized product name.
        with self.assertRaisesRegex(ValueError, 'ASR text'):
            self.runner.align_cues(self.raw('EMHE'), [{'id':'one','voiceover':'ENHE'}], {})

    def test_final_dtw_anchor_uses_complete_raw_end(self):
        raw = {'transcription': [
            {'offsets':{'from':0,'to':300},'tokens':[{'text':'开始','t_dtw':20}]},
            {'offsets':{'from':300,'to':600},'tokens':[{'text':'吧','t_dtw':65}]},
            {'offsets':{'from':600,'to':900},'tokens':[{'text':'。','t_dtw':80}]}]}
        cues, tokens = self.runner.align_cues(raw,[{'id':'one','voiceover':'开始吧。'}],{})
        self.assertEqual(tokens[-1]['end'],.9)
        self.assertEqual(cues[-1]['end'],.9)
        cues,tokens = self.runner.align_cues(raw,[{'id':'one','voiceover':'开始吧。'}],{},audio_duration=.8)
        self.assertEqual(tokens[-1]['end'],.8)
        with self.assertRaisesRegex(ValueError,'audio duration'):
            self.runner.align_cues(raw,[{'id':'one','voiceover':'开始吧。'}],{},audio_duration=.6)

    def test_invalid_token_boundaries_fail(self):
        raw = self.raw('开始吧')
        raw['transcription'][0]['tokens'][1]['offsets'] = {'from': 99, 'to': 110}
        raw['transcription'][0]['tokens'][1]['t_dtw'] = 9
        with self.assertRaisesRegex(ValueError, 'token timing'):
            self.runner.align_cues(raw, [{'id': 'one', 'voiceover': '开始吧。'}], {})

    def test_scene_boundary_must_be_a_real_token_boundary(self):
        raw = {'transcription': [{'offsets':{'from':100,'to':500},'tokens': [{'text': '开始吧','t_dtw':10,'offsets': {'from': 100, 'to': 500}}]}]}
        with self.assertRaisesRegex(ValueError, 'scene boundary'):
            self.runner.align_cues(raw, [{'id': 'one', 'voiceover': '开始'}, {'id': 'two', 'voiceover': '吧。'}], {})

    def test_long_caption_uses_token_boundaries_without_dropping_copy(self):
        text = '让每一个普通人都能轻松驾驭人工智能把想法变成现实把效率变成价值'
        cues, tokens = self.runner.align_cues(self.raw(text), [{'id': 'one', 'voiceover': text}], {})
        self.assertGreater(len(cues), 1)
        self.assertEqual(''.join(c['text'] for c in cues), text)
        for cue in cues:
            self.assertEqual(cue['start'], tokens[cue['tokenStart']]['start'])
            self.assertEqual(cue['end'], tokens[cue['tokenEnd']]['end'])

    def test_short_clause_tail_stays_with_caption_without_changing_real_timing(self):
        text = '把这些步骤留在同一个本地项目里。'
        cues, tokens = self.runner.align_cues(self.raw(text[:-1]), [{'id':'one','voiceover':text}], {})
        self.assertEqual([cue['text'] for cue in cues], [text])
        self.assertEqual(cues[0]['start'], tokens[0]['start'])
        self.assertEqual(cues[0]['end'], tokens[-1]['end'])

    def test_only_previously_accepted_question_particle_can_be_documented(self):
        scenes=[{'id':'one','voiceover':'开始吧？把想法变成现实。'}]
        raw=self.raw('开始吧啊把想法變成現實')
        self.assertEqual(self.runner.accepted_discourse_omission(raw,scenes,{},False),[])
        omitted=self.runner.accepted_discourse_omission(raw,scenes,{},True)
        self.assertEqual(omitted[0]['text'],'啊')
        cues,tokens=self.runner.align_cues(raw,scenes,{},omitted)
        self.assertEqual(''.join(c['text'] for c in cues),scenes[0]['voiceover'])
        self.assertEqual(tokens[omitted[0]['tokenIndex']]['text'],'啊')
        with self.assertRaises(ValueError):
            self.runner.align_cues(raw,scenes,{})

    def test_clipping_and_nonfinite_audio_rejected(self):
        import numpy as np
        for bad in [np.array([1.]),np.array([-1.]),np.array([float('nan')]),np.array([])]:
            with self.subTest(samples=bad),self.assertRaises(ValueError):
                self.runner.validate_samples(bad)
        self.runner.validate_samples(np.array([-.99,0,.99]))


if __name__ == '__main__':
    unittest.main()
