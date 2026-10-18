import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('cloud',ROOT/'scripts/deploy/cloud.py')
cloud=importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud)
class DeployTests(unittest.TestCase):
 def config(self):
  d=json.loads((ROOT/'deploy/config.example.json').read_text())
  d.update(project='helios-test-123',bucket='helios-test-123-files',public_maps_key='A'*39,web_model='gemini-test',engine_model='gemini-test')
  return d
 def test_config_and_manifest(self):
  c=cloud.validate_config(self.config());text=cloud.render(c)
  self.assertIn('containerPort: 8080',text);self.assertIn('value: \'8081\'',text)
  self.assertIn('helios-runtime@helios-test-123.iam.gserviceaccount.com',text)
  self.assertNotIn(c['public_maps_key'],text);self.assertNotIn('${',text)
 def test_reject_placeholders_and_injection(self):
  for key,value in [('project','REPLACE_ME'),('service','x\npublic: yes'),('web_model','x\"\n'),('bucket','bad/bucket')]:
   c=self.config();c[key]=value
   with self.assertRaises(ValueError):cloud.validate_config(c)
 def test_dry_run_never_invokes_subprocess(self):
  from unittest.mock import patch
  with patch.object(cloud.subprocess,'run',side_effect=AssertionError('executed')):
   runner=cloud.Commands(False);runner.run(['gcloud','fake']);self.assertEqual(runner.json(['gcloud','fake']),[])
 def test_smoke_never_forwards_tokens_on_redirect(self):
  spec=importlib.util.spec_from_file_location('smoke',ROOT/'scripts/deploy/smoke.py');smoke=importlib.util.module_from_spec(spec);spec.loader.exec_module(smoke)
  from urllib.request import Request
  self.assertIsNone(smoke.NoRedirect().redirect_request(Request('https://app.example',headers={'Authorization':'Bearer test'}),None,302,'redirect',{},'https://other.example'))
 def test_policy_validation(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'doc.json';p.write_text(json.dumps({'title':'Policy','pages':[{'page':1,'text':'Source text'}]}))
   cloud.policy_files(Path(d))
   p.write_text('{"private_key":"not a policy"}')
   with self.assertRaises(ValueError):cloud.policy_files(Path(d))
if __name__=='__main__':unittest.main()
