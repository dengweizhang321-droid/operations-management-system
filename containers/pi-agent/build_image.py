"""Reproducible independent image build (Windows -> WSL tar stdin, no mounts)."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request


def checked(raw,integrity):
    actual='sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()
    if actual!=integrity:raise ValueError('runtime_integrity_mismatch')
    return raw


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--distribution',default='TERUISI-Pandas');parser.add_argument('--tag',required=True)
    parser.add_argument('--asset-directory',type=Path);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if not re.fullmatch(r'pi-[a-z0-9-]+:[a-z0-9.-]+',args.tag):raise ValueError('isolated_pi_tag_required')
    root=Path(__file__).resolve().parents[2]
    lock=json.loads((root/'containers/pi-agent/runtime-lock.json').read_text())
    assets={}
    for name in ['node','npm']:
        metadata=lock[name]
        asset=args.asset_directory/(f'{"node-linux-x64" if name=="node" else "npm"}-{metadata["version"]}-mirror.tgz') if args.asset_directory else None
        if asset and asset.is_file():raw=asset.read_bytes()
        else:
            with urllib.request.urlopen(metadata['mirror'],timeout=120) as response:raw=response.read(100*1024*1024)
        assets[name]=checked(raw,metadata['integrity'])
    with tempfile.TemporaryDirectory(prefix='pi-image-') as temp:
        context=Path(temp)
        # Every extracted entry is checked before extraction (no path traversal,
        # symlink or hardlink is accepted from an upstream package).
        for name,raw in assets.items():
            with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
                members=archive.getmembers()
                if any(m.issym() or m.islnk() or m.name.startswith('/') or '..' in m.name.split('/') for m in members):raise ValueError('unsafe_runtime_archive')
                target=context/'.pi-build'/name;target.mkdir(parents=True)
                for member in members:
                    if member.name=='package':continue
                    member.name=member.name.removeprefix('package/')
                    archive.extract(member,target,filter='data')
        for directory in ['containers/pi-agent','backend/pi_runner/bundled_skills']:
            shutil.copytree(root/directory,context/directory,ignore=shutil.ignore_patterns('__pycache__','node_modules'))
        tarpath=context/'context.tar'
        with tarfile.open(tarpath,'w:gz',format=tarfile.GNU_FORMAT) as archive:
            for directory in ['.pi-build','containers','backend']:archive.add(context/directory,arcname=directory)
        process=subprocess.run(['wsl','-d',args.distribution,'--exec','/usr/bin/docker','build','--pull=false',
            '--build-arg','PYTHON_BASE='+lock['baseImage'],'--file','containers/pi-agent/Dockerfile','--tag',args.tag,'-'],input=tarpath.read_bytes())
        if process.returncode:raise ValueError('image_build_failed')
    raw=subprocess.check_output(['wsl','-d',args.distribution,'--exec','/usr/bin/docker','image','inspect',args.tag,'--format','{{.Id}}'])
    result={'image':raw.decode().strip(),'tag':args.tag,'piVersion':lock['piVersion'],'runtimeLockSha256':hashlib.sha256((root/'containers/pi-agent/runtime-lock.json').read_bytes()).hexdigest(),
        'packageLockSha256':hashlib.sha256((root/'containers/pi-agent/package-lock.json').read_bytes()).hexdigest(),'nodeVersion':lock['node']['version'],'npmVersion':lock['npm']['version'],'baseImage':lock['baseImage']}
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result))


if __name__=='__main__':main()
