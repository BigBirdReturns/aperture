import copy
import itertools
import random
import unittest
from arbitrages.model import Scenario,InputError
from arbitrages.planner import optimize,billed_seconds
from arbitrages.audit import audit_report
from arbitrages.tests.helpers import tiny,example

class PlannerTests(unittest.TestCase):
    def plan(self,d,beam=128):
        r=optimize(Scenario.parse(d),beam);self.assertTrue(audit_report(r)['ok']);return r
    def test_hand_computable_cost(self):
        r=self.plan(tiny());self.assertEqual(r['best']['cost']['total_usd'],5)
        self.assertEqual(r['baselines']['baseline_held']['cost']['total_usd'],10)
    def test_strongest_baseline(self):
        r=self.plan(example());self.assertEqual(r['comparison']['basis'],'best_single_resource')
        self.assertAlmostEqual(r['comparison']['cost_ratio'],1.3047285464098075)
        self.assertGreater(r['baselines']['baseline_held']['cost']['total_usd']/r['best']['cost']['total_usd'],3)
    def test_transfer_cost_destroys_gain(self):
        r=self.plan(example('transfer-trap'));self.assertEqual(r['comparison']['cost_ratio'],1)
        self.assertEqual(r['best']['transfers'],[])
    def test_committed_no_cash_saving(self):
        r=self.plan(example('committed'));self.assertEqual(r['comparison']['savings_fraction'],0)
        self.assertAlmostEqual(r['best']['cost']['total_usd'],224.64)
    def test_impossible_deadline(self):
        r=self.plan(example('infeasible'));self.assertIsNone(r['best']);self.assertEqual(r['comparison'],{})
    def test_oom_refusal(self):
        d=tiny()
        for p in d['stages'][0]['profiles']:p['memory_gib']['vram']=1000
        r=self.plan(d);self.assertIsNone(r['best']);self.assertEqual(len(r['rejected_profiles']),2)
    def test_quality_gate(self):
        d=tiny();d['stages'][0]['profiles'][1]['quality']=.9
        r=self.plan(d);self.assertEqual(r['best']['tasks'][0]['resource'],'premium')
    def test_missing_link(self):
        d=tiny();d['links']=[];d['stages'][0]['profiles']=d['stages'][0]['profiles'][:1];d['stages'][0]['output_gib']=1
        s=copy.deepcopy(d['stages'][0]);s.update(id='b',deps=['a']);s['profiles'][0]['resource']='economy';d['stages'].append(s)
        self.assertIsNone(self.plan(d)['best'])
    def test_zero_data_needs_no_link(self):
        d=tiny();d['links']=[];d['stages'][0]['profiles']=d['stages'][0]['profiles'][:1]
        s=copy.deepcopy(d['stages'][0]);s.update(id='b',deps=['a']);s['profiles'][0]['resource']='economy';d['stages'].append(s)
        self.assertIsNotNone(self.plan(d)['best'])
    def test_billing_quantum_and_floor(self):
        r=tiny()['resources'][0];r.update(billing_quantum_s=60,minimum_lease_s=90)
        self.assertEqual(billed_seconds(1,r),120);self.assertEqual(billed_seconds(121,r),180)
    def test_startup_included(self):
        d=tiny();d['resources'][1]['startup_s']=11
        r=self.plan(d);self.assertEqual(r['best']['tasks'][0]['resource'],'premium')
    def test_no_ratio_with_unpriced(self):
        d=tiny()
        for r in d['resources']:r.update(usd_per_hour=0,price_kind='unpriced')
        self.assertEqual(self.plan(d)['comparison'],{})
    def test_invalid_beam(self):
        for width in [0,1025,True,1.1]:
            with self.subTest(width=width):
                with self.assertRaises(InputError):optimize(Scenario.parse(tiny()),width)
    def test_baseline_survives_narrow_beam(self):
        r=self.plan(example(),1)
        self.assertLessEqual(r['best']['cost']['total_usd'],r['baselines']['baseline_elastic']['cost']['total_usd'])
    def test_deterministic(self):
        self.assertEqual(self.plan(example())['sha256'],self.plan(example())['sha256'])
    def test_colocation(self):
        d=example()
        for s in d['stages']:s['colocate']='same-model'
        r=self.plan(d);self.assertEqual(len({t['resource'] for t in r['best']['tasks']}),1)
    def test_restart_when_idle_is_expensive(self):
        d=tiny();d['deadline_s']=2000;d['resources'][0]['startup_s']=1
        a=d['stages'][0];a['profiles']=a['profiles'][:1]
        b=copy.deepcopy(a);b.update(id='b',deps=['a']);b['profiles'][0].update(resource='economy',duration_s=1000)
        c=copy.deepcopy(a);c.update(id='c',deps=['b']);d['stages']=[a,b,c]
        r=self.plan(d);self.assertEqual(len(r['best']['leases']['premium']),2)
        self.assertLess(r['best']['cost']['total_usd'],r['baselines']['mixed_held']['cost']['total_usd'])
    def test_keep_warm_when_minimum_bill_dominates(self):
        d=tiny();d['deadline_s']=1000;d['resources'][0]['minimum_lease_s']=1000
        a=d['stages'][0];a['profiles']=a['profiles'][:1]
        b=copy.deepcopy(a);b.update(id='b',deps=['a']);b['profiles'][0].update(resource='economy',duration_s=100)
        c=copy.deepcopy(a);c.update(id='c',deps=['b']);d['stages']=[a,b,c]
        r=self.plan(d);self.assertEqual(len(r['best']['leases']['premium']),1)
    def test_parallel_independent_stages(self):
        d=tiny();a=d['stages'][0];a['profiles']=a['profiles'][:1]
        b=copy.deepcopy(a);b.update(id='b');b['profiles'][0]['resource']='economy';d['stages'].append(b)
        r=self.plan(d);self.assertEqual(r['best']['makespan_s'],10)
    def test_bruteforce_simple_chain_oracle(self):
        # Independent enumeration: no data, startup or billing rounding; all
        # stage durations are integral. This subproblem has an exact oracle.
        rng=random.Random(41)
        for case in range(40):
            d=tiny();d['deadline_s']=rng.randrange(10,50);original=d['stages'][0];stages=[]
            for i in range(4):
                s=copy.deepcopy(original);s.update(id=f's{i}',deps=[f's{i-1}'] if i else [])
                for p in s['profiles']:p['duration_s']=rng.randrange(1,16)
                stages.append(s)
            d['stages']=stages;expected=[]
            for assignment in itertools.product([0,1],repeat=4):
                dur=sum(stages[i]['profiles'][choice]['duration_s'] for i,choice in enumerate(assignment))
                cost=sum(stages[i]['profiles'][choice]['duration_s']*(1 if choice==0 else .5) for i,choice in enumerate(assignment))
                if dur<=d['deadline_s']:expected.append(cost)
            r=self.plan(d,1024)
            with self.subTest(case=case):
                if expected:self.assertAlmostEqual(r['best']['cost']['total_usd'],min(expected))
                else:self.assertIsNone(r['best'])
