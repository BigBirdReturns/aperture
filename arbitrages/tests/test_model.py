import copy
import unittest
from arbitrages.model import Scenario, InputError, strict_loads, MAX_BYTES, rejection
from arbitrages.tests.helpers import example,tiny

class ModelTests(unittest.TestCase):
    def test_examples_parse(self):
        for n in ['pipeline','transfer-trap','committed','infeasible']:
            with self.subTest(n=n):self.assertTrue(Scenario.parse(example(n)).order)
    def test_input_is_copied(self):
        d=tiny();s=Scenario.parse(d);d['resources'][0]['usd_per_hour']=0
        self.assertEqual(s.resources['premium']['usd_per_hour'],3600)
    def test_unknown_key(self):
        d=tiny();d['deadine_s']=10
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_missing_key(self):
        d=tiny();del d['quality_contract']
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_nonfinite_and_boolean_numbers(self):
        for x in [float('nan'),float('inf'),-1,True,'1']:
            with self.subTest(x=x):
                d=tiny();d['deadline_s']=x
                with self.assertRaises(InputError):Scenario.parse(d)
    def test_cycle(self):
        d=tiny();b=copy.deepcopy(d['stages'][0]);b.update(id='b',deps=['a']);d['stages'][0]['deps']=['b'];d['stages'].append(b)
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_unknown_dependency(self):
        d=tiny();d['stages'][0]['deps']=['nope']
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_self_dependency(self):
        d=tiny();d['stages'][0]['deps']=['a']
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_duplicate_resource(self):
        d=tiny();d['resources'].append(copy.deepcopy(d['resources'][0]))
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_duplicate_stage(self):
        d=tiny();d['stages'].append(copy.deepcopy(d['stages'][0]))
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_duplicate_profile(self):
        d=tiny();d['stages'][0]['profiles'].append(copy.deepcopy(d['stages'][0]['profiles'][0]))
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_duplicate_json_key(self):
        with self.assertRaises(InputError):strict_loads('{"x":1,"x":2}')
    def test_json_nan(self):
        with self.assertRaises(InputError):strict_loads('{"x":NaN}')
    def test_json_size(self):
        with self.assertRaises(InputError):strict_loads(' '* (MAX_BYTES+1))
    def test_measured_requires_trace(self):
        d=tiny();d['stages'][0]['profiles'][0]['evidence']['kind']='measured'
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_directed_link_duplicates(self):
        d=tiny();d['links'].append(copy.deepcopy(d['links'][0]))
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_zero_bandwidth(self):
        d=tiny();d['links'][0]['bandwidth_gib_s']=0
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_committed_horizon(self):
        d=tiny();d.update(accounting='committed',horizon_s=10)
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_unpriced_nonzero(self):
        d=tiny();d['resources'][0]['price_kind']='unpriced'
        with self.assertRaises(InputError):Scenario.parse(d)
    def test_memory_not_pooled(self):
        d=tiny();p=d['stages'][0]['profiles'][1];p['memory_gib']['vram']=49
        sc=Scenario.parse(d);self.assertIn('vram',rejection(sc,p))
    def test_zero_duration_rejected(self):
        d=tiny();d['stages'][0]['profiles'][0]['duration_s']=0
        with self.assertRaises(InputError):Scenario.parse(d)

    def test_wrong_identifier_types(self):
        for field in ('baseline','profile','link'):
            with self.subTest(field=field):
                d=tiny()
                if field=='baseline': d['baseline_resource']=[]
                elif field=='profile': d['stages'][0]['profiles'][0]['resource']=[]
                else: d['links'][0]['from']=[]
                with self.assertRaises(InputError): Scenario.parse(d)
