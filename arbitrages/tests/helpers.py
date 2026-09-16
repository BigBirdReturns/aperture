from pathlib import Path
import copy
import json
from arbitrages.model import digest

EXAMPLES = Path(__file__).resolve().parents[1]/'examples'
def example(name='pipeline'):
    return json.loads((EXAMPLES/(name+'.json')).read_text())
def tiny():
    d=example();d['name']='Hand-computable control';d['deadline_s']=100
    d['resources']=d['resources'][:2]
    for r in d['resources']:
        r.update(startup_s=0,minimum_lease_s=0,billing_quantum_s=1,usd_per_hour=3600 if r['id']=='premium' else 1800)
    d['links']=[l for l in d['links'] if l['from'] in ['premium','economy'] and l['to'] in ['premium','economy']]
    for l in d['links']:l.update(bandwidth_gib_s=1,latency_s=0,usd_per_gib=0)
    d['stages']=[{'id':'a','deps':[],'output_gib':0,'profiles':[
        {'id':r,'resource':r,'duration_s':10,'memory_gib':{'ram':1,'vram':1},'quality':1,
         'evidence':{'kind':'assumed','source':'hand-computable test'}} for r in ['premium','economy']]}]
    return d
def rehash(value):
    value['sha256']=digest({k:v for k,v in value.items() if k!='sha256'});return value
