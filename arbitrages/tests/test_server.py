import http.client
from http.server import HTTPServer
import json
import threading
import unittest
from arbitrages.model import Scenario
from arbitrages.planner import optimize
from arbitrages.server import handler_class
from arbitrages.report import render
from arbitrages.tests.helpers import tiny

class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=HTTPServer(('127.0.0.1',0),handler_class(Scenario.parse(tiny())))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def req(self,method,path,body=None,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=10)
        try:
            conn.request(method,path,body,headers or {});r=conn.getresponse();return r.status,r.read(),dict(r.getheaders())
        finally:conn.close()
    def test_page(self):
        code,body,headers=self.req('GET','/');self.assertEqual(code,200);self.assertIn(b'Price the schedule',body);self.assertEqual(headers['X-Frame-Options'],'DENY')
    def test_valid_plan(self):
        code,body,_=self.req('POST','/api/plan',json.dumps(tiny()),{'Content-Type':'application/json'})
        self.assertEqual(code,200);self.assertEqual(json.loads(body)['best']['cost']['total_usd'],5)
    def test_host_rebinding_blocked(self):self.assertEqual(self.req('GET','/',headers={'Host':'attacker.example'})[0],403)
    def test_cross_origin_blocked(self):self.assertEqual(self.req('POST','/api/plan','{}',{'Content-Type':'application/json','Origin':'https://attacker.example'})[0],403)
    def test_content_type_blocked(self):self.assertEqual(self.req('POST','/api/plan','{}',{'Content-Type':'text/plain'})[0],415)
    def test_unknown_route(self):self.assertEqual(self.req('GET','/../../etc/passwd')[0],404)
    def test_malformed_json(self):self.assertEqual(self.req('POST','/api/plan','{bad',{'Content-Type':'application/json'})[0],400)
    def test_health(self):self.assertEqual(json.loads(self.req('GET','/health')[1])['mode'],'local-data-only')
    def test_script_injection_is_escaped(self):
        d=tiny();d['name']='</script><script>alert(1)</script>'
        html=render(optimize(Scenario.parse(d)))
        self.assertNotIn(d['name'],html);self.assertIn('\\u003c/script\\u003e',html)
    def test_no_inner_html_interpretation(self):
        html=render(optimize(Scenario.parse(tiny())))
        self.assertNotIn('innerHTML',html);self.assertNotIn('eval(',html)

    def test_oversized_length_rejected_before_body(self):
        self.assertEqual(self.req('POST','/api/plan',headers={'Content-Type':'application/json','Content-Length':'524289'})[0],413)
    def test_invalid_length_rejected(self):
        self.assertEqual(self.req('POST','/api/plan',headers={'Content-Type':'application/json','Content-Length':'not-a-number'})[0],400)
