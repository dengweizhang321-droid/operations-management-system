"""Real CurrentUser DPAPI; the transport boundary is independently injected."""
import base64
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .protocol import encode
from .wsl_control import control


@unittest.skipUnless(os.name=='nt','Windows CurrentUser DPAPI only')
class WindowsKeyBindingTests(unittest.TestCase):
    def test_dpapi_wrapper_and_channel_hash_are_distinct_and_verified(self):
        from pandas_runner.key_file import dpapi
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);key=os.urandom(32);key_file=root/'key.dpapi.json';config_file=root/'config.json'
            key_file.write_bytes(encode({'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()}))
            config={'version':1,'enabled':True,'runnerSourceSha256':'a'*64,'runnerImage':'sha256:'+'b'*64,
                'keyFileSha256':hashlib.sha256(key_file.read_bytes()).hexdigest(),'channelKeySha256':hashlib.sha256(key).hexdigest()}
            self.assertNotEqual(config['keyFileSha256'],config['channelKeySha256'])
            config_file.write_bytes(encode(config))
            def transport(url,actual_key,value,**kwargs):
                self.assertEqual(actual_key,key);self.assertEqual(kwargs['path'],'/v1/status')
                return {'image':config['runnerImage'],'sourceSha256':config['runnerSourceSha256'],'namespace':'pi-agent-v1','closing':False}
            with patch('pi_runner.wsl_control.command',side_effect=transport) as mocked:
                self.assertEqual(control('probe',config_file,key_file)['image'],config['runnerImage']);self.assertEqual(mocked.call_count,1)
                config['channelKeySha256']='c'*64;config_file.write_bytes(encode(config))
                with self.assertRaisesRegex(ValueError,'runner_channel_key_changed'):control('probe',config_file,key_file)
                self.assertEqual(mocked.call_count,1)
                config['channelKeySha256']=hashlib.sha256(key).hexdigest();config['keyFileSha256']='d'*64;config_file.write_bytes(encode(config))
                with self.assertRaisesRegex(ValueError,'runner_key_file_changed'):control('probe',config_file,key_file)
                self.assertEqual(mocked.call_count,1)


if __name__=='__main__':unittest.main()
