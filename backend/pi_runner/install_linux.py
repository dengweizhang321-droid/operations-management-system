"""Prepare an isolated runner installation; never starts/enables services.

Only a fresh destination is accepted. The independent channel key is read from
stdin, never an argument, inherited business environment, stdout or config text.
"""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import stat
import sys
import re

from .protocol import encode


def source_digest():
    root=Path(__file__).parent
    digest=hashlib.sha256()
    for file in sorted(root.rglob('*'),key=lambda p:p.relative_to(root).as_posix()):
        if not file.is_file() or '__pycache__' in file.parts or file.name.startswith('test_'):continue
        digest.update(file.relative_to(root).as_posix().encode()+b'\0'+file.read_bytes())
    return digest.hexdigest()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--destination',required=True);parser.add_argument('--image',required=True)
    parser.add_argument('--approved-source-sha256',required=True);parser.add_argument('--namespace',required=True)
    parser.add_argument('--gateway-url',default='http://127.0.0.1:8112/api/ai/pi/gateway')
    args=parser.parse_args()
    if os.name!='posix' or os.getuid()==0:raise ValueError('unprivileged_linux_required')
    if args.approved_source_sha256!=source_digest():raise ValueError('source_digest_changed')
    root=Path(args.destination)
    expected=Path.home()/'.local/share/teruisi-pi-runner/releases'/args.approved_source_sha256
    if root!=expected or not re.fullmatch(r'sha256:[a-f0-9]{64}',args.image) or not re.fullmatch(r'pi-[a-z0-9-]{3,40}',args.namespace):raise ValueError('fixed_installation_binding_required')
    if not root.is_absolute() or root.exists() or root.is_symlink():raise ValueError('fresh_absolute_destination_required')
    if not root.parent.is_dir() or root.parent.is_symlink():raise ValueError('existing_real_parent_required')
    key=sys.stdin.buffer.read(129)
    if len(key)!=32:raise ValueError('independent_32_byte_key_required')
    os.umask(0o077)
    root.mkdir(mode=0o700)
    shutil.copytree(Path(__file__).parent,root/'backend'/'pi_runner',ignore=shutil.ignore_patterns('__pycache__','test_*.py'))
    state=root/'state';state.mkdir(mode=0o700)
    (root/'channel.key').write_bytes(key)
    config={'docker':'/usr/bin/docker','socket':f'/run/user/{os.getuid()}/docker.sock','image':args.image,
            'keyFile':str(root/'channel.key'),'stateDirectory':str(state),'gatewayUrl':args.gateway_url,'namespace':args.namespace}
    (root/'config.json').write_bytes(encode(config))
    unit='\n'.join(['[Unit]','Description=Independent PiAgent runner (explicit operator start only)',
        '[Service]','Type=simple',f'WorkingDirectory={root}/backend',f'ExecStart=/usr/bin/python3 -B -m pi_runner.server --config {root}/config.json',
        'UMask=0077','NoNewPrivileges=yes','Restart=no','KillMode=mixed','TimeoutStopSec=35',''])
    (root/'pi-runner.service').write_text(unit,encoding='utf-8')
    print(encode({'prepared':True,'sourceSha256':source_digest(),'image':args.image,'namespace':args.namespace,'channelKeySha256':hashlib.sha256(key).hexdigest(),'enabled':False,'started':False}).decode())


if __name__=='__main__':main()
