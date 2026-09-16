import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from arbitrages.bench import benchmark,verify_benchmark,replay_local
from arbitrages.measure import measure,parse_manifest,capture
from arbitrages.model import InputError
from arbitrages.tests.helpers import tiny

class ExecutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name)
        cls.receipt=benchmark(cls.root/'cpu',3,1500)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def test_cpu_exact_outputs(self):
        self.assertTrue(self.receipt['all_outputs_match']);self.assertEqual(verify_benchmark(self.root/'cpu')['trials_verified'],18)
    def test_cpu_replay(self):
        r=replay_local(self.root/'cpu');self.assertTrue(r['all_outputs_match']);self.assertEqual(len(r['rows']),3)
    def test_raw_tamper_detected(self):
        p=self.root/'cpu'/'trials.jsonl';old=p.read_bytes()
        try:
            p.write_bytes(old+b' ')
            with self.assertRaises(InputError):verify_benchmark(self.root/'cpu')
        finally:p.write_bytes(old)
    def manifest(self,root,expected=None,code='import sys;sys.stdout.buffer.write(bytes([52,50,10]))'):
        (root/'scenario.json').write_text(json.dumps(tiny()))
        d={'schema':'arbitrages.measure.v1','scenario_file':'scenario.json','trials':3,'commands':[
            {'stage':'a','profile':'economy','argv':['$PYTHON','-S','-c',code],
             'expected_stdout_sha256':expected or hashlib.sha256(b'42\n').hexdigest(),'timeout_s':5}]}
        p=root/'manifest.json';p.write_text(json.dumps(d));return p
    def test_command_requires_consent(self):
        with self.assertRaises(InputError):measure('no-file-needed','unused')
    def test_real_command_profiling(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=self.manifest(root);r=measure(p,root/'out',True)
            self.assertTrue(r['all_contracts_pass']);self.assertEqual(r['summaries'][0]['passed'],3)
            profile=json.loads((root/'out'/'profiled-workload.json').read_text())['stages'][0]['profiles'][1]
            self.assertEqual(profile['evidence']['kind'],'measured')
            self.assertGreater(profile['duration_s'],0)
    def test_wrong_output_stops_promotion(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=self.manifest(root,code='print(43)')
            with self.assertRaises(InputError):measure(p,root/'out',True)
            self.assertTrue((root/'out'/'measurement.json').exists())
            self.assertFalse((root/'out'/'profiled-workload.json').exists())
    def test_existing_output_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=self.manifest(root);(root/'out').mkdir();(root/'out'/'sentinel').write_text('keep')
            with self.assertRaises(InputError):measure(p,root/'out',True)
            self.assertEqual((root/'out'/'sentinel').read_text(),'keep')
    def test_timeout_captured(self):
        import sys
        with tempfile.TemporaryDirectory() as d:
            r=capture([sys.executable,'-S','-c','import time;time.sleep(10)'],Path(d),.05)
            self.assertEqual(r['failure'],'timeout');self.assertLess(r['elapsed_s'],3)
    def test_launch_failure_is_recorded(self):
        with tempfile.TemporaryDirectory() as d:
            r=capture(['not-a-real-arbitrages-executable-57'],Path(d),1)
            self.assertEqual(r['failure'],'launch_error')
    def test_distinct_contracts_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=self.manifest(root);data=json.loads(p.read_text());c=copy.deepcopy(data['commands'][0]);c.update(profile='premium',expected_stdout_sha256='0'*64);data['commands'].append(c);p.write_text(json.dumps(data))
            with self.assertRaises(InputError):parse_manifest(p)

    def test_benchmark_refuses_overwrite(self):
        with self.assertRaises(InputError):benchmark(self.root/'cpu',3,1500)
    def test_missing_summary_is_rejected_even_if_rehashed(self):
        from arbitrages.model import digest
        p=self.root/'cpu'/'benchmark.json';old=p.read_bytes()
        try:
            r=json.loads(old);r['summaries'].pop();r['sha256']=digest({k:v for k,v in r.items() if k!='sha256'});p.write_text(json.dumps(r))
            with self.assertRaises(InputError):verify_benchmark(self.root/'cpu')
        finally:p.write_bytes(old)
