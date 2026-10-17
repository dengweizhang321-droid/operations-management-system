import copy
import hashlib
import tempfile
from pathlib import Path
import unittest

from .protocol import decode,encode,signature,validate_command,validate_manifest,workspace_key
from .server import Ledger
from .skills import build
from .wsl_control import verify_stop_readiness


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.job=dict(operationId='operation-1',ownerId='test@example.invalid',conversationId='conversation-1',epoch=1,generation=1,seq=1,command='create',payload={})
        self.root=Path(__file__).parent/'bundled_skills'/'1.0.0'

    def test_email_is_hash_identity_not_path(self):
        self.assertIs(validate_command(self.job),self.job)
        self.assertEqual(len(workspace_key(self.job)),64)
        for key in ['ownerId','conversationId','epoch','generation']:
            other=copy.deepcopy(self.job);other[key]=2 if type(other[key]) is int else other[key]+'x'
            self.assertNotEqual(workspace_key(other),workspace_key(self.job))
        other={**self.job,'operationId':'next','seq':2}
        self.assertEqual(workspace_key(other),workspace_key(self.job))

    def test_strict_json_and_lf(self):
        text='中文\u2028next\u2029line'
        raw=encode({'message':text})+b'\n'
        self.assertEqual(raw.count(b'\n'),1)
        self.assertEqual(decode(raw)['message'],text)
        for raw in [b'{"x":1,"x":2}',b'{"x":NaN}']:
            with self.assertRaises(ValueError):decode(raw)

    def test_fences_are_typed(self):
        for key in ['epoch','generation','seq']:
            for invalid in [True,0,-1,'1',None]:
                with self.subTest(key=key,invalid=invalid),self.assertRaises(ValueError):validate_command({**self.job,key:invalid})

    def test_mac_binds_direction_path_nonce_and_body(self):
        raw=encode(self.job);key=b's'*32
        mac=signature(key,'1792225963','a'*32,raw)
        for kwargs in [{'direction':'response'},{'path':'/v1/other'}]:self.assertNotEqual(mac,signature(key,'1792225963','a'*32,raw,**kwargs))
        self.assertNotEqual(mac,signature(key,'1792225963','b'*32,raw))
        self.assertNotEqual(mac,signature(key,'1792225963','a'*32,raw+b' '))

    def test_unknown_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as temp:
            ledger=Ledger(Path(temp)/'ledger.db')
            self.assertIsNone(ledger.reserve(self.job))
            ledger.db.close()
            ledger=Ledger(Path(temp)/'ledger.db')
            with self.assertRaisesRegex(ValueError,'operation_unknown'):ledger.reserve(self.job)
            ledger.db.close()

    def test_same_id_with_changed_payload_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            ledger=Ledger(Path(temp)/'ledger.db');ledger.reserve(self.job)
            ledger.finish(self.job,{'accepted':True})
            self.assertEqual(ledger.reserve(self.job),{'accepted':True})
            with self.assertRaisesRegex(ValueError,'operation_payload_changed'):ledger.reserve({**self.job,'payload':{'changed':True}})
            ledger.db.close()

    def test_all_nonterminal_session_phases_freeze_on_restart(self):
        phases=['creating','updating','freezing','dispatching','accepted','running','settling']
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'ledger.db';ledger=Ledger(path)
            with ledger.db:
                for phase in phases:ledger.db.execute('INSERT INTO sessions (workspace,identity,container,volume,status,seq) VALUES (?,?,?,?,?,?)',(phase,encode(self.job),'container-'+phase,'volume-'+phase,phase,1))
            ledger.db.close();ledger=Ledger(path)
            self.assertEqual(ledger.db.execute("SELECT count(*) FROM sessions WHERE status='unknown'").fetchone()[0],len(phases))
            ledger.db.close()

    def test_command_cache_strips_cap_private_reasoning_and_file_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            ledger=Ledger(Path(temp)/'ledger.db');ledger.reserve(self.job)
            result={'status':'accepted','pendingGatewayRequests':[{'capability':'CAP-SHOULD-NOT-PERSIST'}],
                'events':[{'type':'message_end','message':{'role':'assistant','content':[{'type':'thinking','thinking':'THINK-SHOULD-NOT-PERSIST','thinkingSignature':'secret'}, {'type':'text','text':'完整中文公开结果\u2028下一行'}],'providerFrame':{'private':'FRAME-SHOULD-NOT-PERSIST'}}}],
                'files':[{'fileName':'report.xlsx','sha256':'a'*64,'base64':'FILE-BYTES-SHOULD-NOT-PERSIST'}]}
            ledger.finish(self.job,result);cached=ledger.reserve(self.job);raw=encode(cached)
            for marker in [b'CAP-SHOULD',b'THINK-SHOULD',b'FRAME-SHOULD',b'FILE-BYTES-SHOULD']:self.assertNotIn(marker,raw)
            self.assertIn('完整中文公开结果\u2028下一行',raw.decode());self.assertEqual(cached['pendingGatewayRequests'],[])
            ledger.db.close()

    def test_existing_audit_rows_are_scrubbed_without_losing_public_output(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'ledger.db';ledger=Ledger(path);ledger.reserve(self.job)
            with ledger.db:
                raw=encode({'pendingGatewayRequests':[{'capability':'OLD-CAP-MARKER'}],'events':[{'type':'message_end','message':{'content':[{'type':'thinking','thinking':'OLD-THINK-MARKER'},{'type':'text','text':'public retained'}]}}]})
                ledger.db.execute("UPDATE commands SET status='complete',result=?",(raw,))
                ledger.db.execute("DELETE FROM metadata WHERE key='audit_redaction'")
            ledger.db.close();ledger=Ledger(path)
            raw=encode(ledger.reserve(self.job));self.assertNotIn(b'OLD-CAP-MARKER',raw);self.assertNotIn(b'OLD-THINK-MARKER',raw);self.assertIn(b'public retained',raw)
            ledger.db.execute('PRAGMA wal_checkpoint(TRUNCATE)');ledger.db.close()
            for file in Path(temp).glob('ledger.db*'):
                self.assertNotIn(b'OLD-CAP-MARKER',file.read_bytes());self.assertNotIn(b'OLD-THINK-MARKER',file.read_bytes())

    def test_stop_uses_live_unknown_safety_without_erasing_outcome(self):
        safe={'activeCount':0,'unresolvedCount':1,'unsafeUnknownCount':0,'unknownStoppedVerifiedCount':1}
        self.assertEqual(verify_stop_readiness(safe)['unresolvedCount'],1)
        for changed in [{'unsafeUnknownCount':1},{'activeCount':1},{'unknownStoppedVerifiedCount':0},{'unsafeUnknownCount':False}]:
            with self.subTest(changed=changed),self.assertRaises(ValueError):verify_stop_readiness({**safe,**changed})

    def test_published_manifest_matches_bytes(self):
        actual=build(self.root)
        self.assertEqual(actual,decode((self.root/'manifest.json').read_bytes()))
        self.assertEqual(len(actual['skills']),3)
        newer=build(self.root.parent/'1.1.0')
        self.assertEqual(newer['version'],'1.1.0')
        self.assertNotEqual(actual['skills'][0]['sha256'],newer['skills'][0]['sha256'])

    def test_resource_rejects_absolute_traversal_case_collision_missing(self):
        manifest=build(self.root)
        for bad in ['/etc/passwd','../outside','scripts/../script.py','C:/secret','AGENTS.md']:
            value=copy.deepcopy(manifest);value['skills'][0]['resources'][0]['path']=bad
            with self.subTest(path=bad),self.assertRaises(ValueError):validate_manifest(value)
        value=copy.deepcopy(manifest);resource=copy.deepcopy(value['skills'][0]['resources'][0]);resource['path']=resource['path'].lower();value['skills'][0]['resources'].append(resource)
        value['skills'][0]['sha256']=hashlib.sha256(encode(value['skills'][0]['resources'])).hexdigest()
        with self.assertRaises(ValueError):validate_manifest(value)
        value=copy.deepcopy(manifest);value['skills'][0]['resources']=[r for r in value['skills'][0]['resources'] if r['path']!='SKILL.md']
        with self.assertRaises(ValueError):validate_manifest(value)


if __name__=='__main__':unittest.main()
