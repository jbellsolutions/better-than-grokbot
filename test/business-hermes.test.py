"""Exercise the actual bridge's locking, idempotency, file and credential boundaries without inference."""
import importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('bridge',pathlib.Path(__file__).parents[1]/'vm/business-hermes.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class BridgeTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.original=bridge.ROOT;bridge.ROOT=pathlib.Path(self.temp.name);bridge.ROOT.mkdir(exist_ok=True)
 def tearDown(self): bridge.ROOT=self.original;self.temp.cleanup()
 def test_four_screens_and_release(self):
  leases=[bridge.screen_slot() for _ in range(4)];self.assertEqual([slot for slot,_ in leases],[0,1,2,3]);self.assertEqual(bridge.screen_slot(),(None,None));leases[0][1].close();slot,handle=bridge.screen_slot();self.assertEqual(slot,0);handle.close()
  for _,handle in leases[1:]:handle.close()
 def test_idempotent_receipt_and_changed_input_rejected(self):
  request={'action':'submit','turn':'same','session':'thread','mode':'headless','input':'original','apiKey':'private'}
  fingerprint=bridge.hashlib.sha256(json.dumps({k:v for k,v in request.items() if k!='apiKey'},sort_keys=True).encode()).hexdigest();bridge.atomic(bridge.ROOT/'jobs/same/receipt.json',{'fingerprint':fingerprint});bridge.atomic(bridge.ROOT/'jobs/same/state.json',{'status':'done','answer':'saved'})
  self.assertEqual(bridge.command(request)['answer'],'saved');request['input']='changed'
  with self.assertRaises(ValueError):bridge.command(request)
 def test_lost_worker_fails_without_replay(self):
  bridge.atomic(bridge.ROOT/'jobs/lost/state.json',{'status':'running','pid':99999999});self.assertEqual(bridge.command({'action':'status','turn':'lost'})['status'],'failed')
 def test_identity_and_private_url_boundaries(self):
  for turn in ['../other','a;echo secret','']:
   with self.assertRaises(ValueError):bridge.command({'action':'status','turn':turn})
  for url in ['http://example.com','https://127.0.0.1','https://localhost','https://user:secret@example.com']:
   with self.assertRaises(ValueError):bridge.validate_url(url)
 def test_file_traversal_and_credential_paths_refused(self):
  for path in ['../../etc/passwd','.env','credentials.json','hermes/config/token.json']:
   with self.assertRaises(ValueError):bridge.files({'root':'artifacts','path':path})
if __name__=='__main__':unittest.main()
