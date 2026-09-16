import copy
import unittest
from arbitrages.model import Scenario
from arbitrages.planner import optimize
from arbitrages.audit import audit_report,audit_plan,AuditError
from arbitrages.tests.helpers import example,rehash

class AuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sc=Scenario.parse(example());cls.report=optimize(cls.sc)
    def plan(self):return copy.deepcopy(self.report['best'])
    def rejected(self,p):
        rehash(p)
        with self.assertRaises(AuditError):audit_plan(self.sc,p)
    def test_clean_report(self):self.assertTrue(audit_report(self.report)['ok'])
    def test_simple_tamper(self):
        r=copy.deepcopy(self.report);r['status']='HACKED'
        with self.assertRaises(AuditError):audit_report(r)
    def test_rehashed_cost_tamper(self):
        p=self.plan();p['cost']['total_usd']=0;self.rejected(p)
    def test_rehashed_billing_tamper(self):
        p=self.plan();p['cost']['rows'][0]['billed_s']+=1;self.rejected(p)
    def test_rehashed_duration_tamper(self):
        p=self.plan();p['tasks'][0]['end_s']-=.1;self.rejected(p)
    def test_missing_task(self):
        p=self.plan();p['tasks'].pop();self.rejected(p)
    def test_missing_transfer(self):
        p=self.plan();self.assertTrue(p['transfers']);p['transfers'].pop();self.rejected(p)
    def test_transfer_size_tamper(self):
        p=self.plan();p['transfers'][0]['gib']*=.5;self.rejected(p)
    def test_lease_tamper(self):
        p=self.plan();key=next(iter(p['leases']));p['leases'][key][0]['start_s']+=.1;self.rejected(p)
    def test_quality_tamper(self):
        p=self.plan();p['tasks'][0]['quality']=.7;self.rejected(p)
    def test_drop_cold_start(self):
        p=self.plan();p['tasks'][0]['boot_s']=0;self.rejected(p)
    def test_scenario_binding(self):
        p=self.plan();p['scenario_sha256']='a'*64;self.rejected(p)
    def test_fake_gpu_verification(self):
        r=copy.deepcopy(self.report);r['evidence']['gpu_execution_verified']=True;rehash(r)
        with self.assertRaises(AuditError):audit_report(r)
    def test_fake_savings(self):
        r=copy.deepcopy(self.report);r['comparison']['cost_ratio']=162;rehash(r)
        with self.assertRaises(AuditError):audit_report(r)
