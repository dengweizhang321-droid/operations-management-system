"""Reproducible independent image build (Windows -> WSL tar stdin, no mounts)."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile


SOURCE_DIRS = ("containers/pi-agent", "backend/pi_runner/bundled_skills")
IGNORED = {"__pycache__", "node_modules"}
REQUIRED_LABELS = {"teruisi.pi.workspace": "2", "teruisi.pi.native-capabilities": "1", "teruisi.pi.local-restore": "1"}


def checked(raw,integrity):
    actual='sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()
    if actual!=integrity:raise ValueError('runtime_integrity_mismatch')
    return raw


def source_inputs(root):
    files = {}
    for directory in SOURCE_DIRS:
        folder = root / directory
        if not folder.is_dir() or folder.is_symlink():
            raise ValueError("invalid_pi_image_input_directory")
        for item in sorted(folder.rglob("*")):
            rel = item.relative_to(root)
            if any(part in IGNORED for part in rel.parts):
                continue
            if item.is_symlink() or not (item.is_dir() or item.is_file()):
                raise ValueError("invalid_pi_image_input")
            if item.is_file():
                files[rel.as_posix()] = item.read_bytes()
    return files


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--distribution',default='TERUISI-Pandas');parser.add_argument('--tag',required=True)
    parser.add_argument('--asset-directory',type=Path);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--uv-wheel',type=Path)
    parser.add_argument('--source-commit')
    parser.add_argument('--source-tree')
    args=parser.parse_args()
    if not re.fullmatch(r'pi-[a-z0-9-]+:[a-z0-9.-]+',args.tag):raise ValueError('isolated_pi_tag_required')
    if args.source_commit is not None or args.source_tree is not None:
        if not all(re.fullmatch(r'[a-f0-9]{40}', v or '') for v in (args.source_commit,args.source_tree)):
            raise ValueError('frozen_pi_image_source_required')
    root=Path(__file__).resolve().parents[2]
    files=source_inputs(root)
    lock=json.loads(files['containers/pi-agent/runtime-lock.json'])
    input_manifest={name:hashlib.sha256(data).hexdigest() for name,data in files.items()}
    inputs_sha256=hashlib.sha256(json.dumps(input_manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    assets={}
    for name in ['node','npm']:
        metadata=lock[name]
        asset=args.asset_directory/(f'{"node-linux-x64" if name=="node" else "npm"}-{metadata["version"]}-mirror.tgz') if args.asset_directory else None
        if asset and asset.is_file():raw=asset.read_bytes()
        else:
            with urllib.request.urlopen(metadata['mirror'],timeout=120) as response:raw=response.read(100*1024*1024)
        assets[name]=checked(raw,metadata['integrity'])
        if asset and not asset.exists():
            asset.parent.mkdir(parents=True,exist_ok=True)
            asset.write_bytes(raw)
    if args.uv_wheel:uv_raw=args.uv_wheel.read_bytes()
    else:
        with urllib.request.urlopen(lock['uv']['url'],timeout=120) as response:uv_raw=response.read(60*1024*1024)
    if len(uv_raw)!=lock['uv']['sizeBytes'] or hashlib.sha256(uv_raw).hexdigest()!=lock['uv']['sha256']:raise ValueError('uv_integrity_mismatch')
    with zipfile.ZipFile(io.BytesIO(uv_raw)) as archive:uv_binary=archive.read(lock['uv']['binaryPath'])
    if hashlib.sha256(uv_binary).hexdigest()!=lock['uv']['binarySha256']:raise ValueError('uv_binary_changed')
    with tempfile.TemporaryDirectory(prefix='pi-image-') as temp:
        context=Path(temp)
        (context/'.pi-build').mkdir()
        (context/'.pi-build'/'uv').write_bytes(uv_binary)
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
        for name,raw in files.items():
            target=context/name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(raw)
        tarpath=context/'context.tar'
        with tarfile.open(tarpath,'w:gz',format=tarfile.GNU_FORMAT) as archive:
            for directory in ['.pi-build','containers','backend']:archive.add(context/directory,arcname=directory)
        process=subprocess.run(['wsl','-d',args.distribution,'--exec','/usr/bin/docker','build','--pull=false',
            '--build-arg','PYTHON_BASE='+lock['baseImage'],'--file','containers/pi-agent/Dockerfile','--tag',args.tag,'-'],input=tarpath.read_bytes())
        if process.returncode:raise ValueError('image_build_failed')
    raw=subprocess.check_output(['wsl','-d',args.distribution,'--exec','/usr/bin/docker','image','inspect',args.tag],timeout=20)
    inspected=json.loads(raw)[0]
    labels=inspected['Config'].get('Labels') or {}
    if (not re.fullmatch(r'sha256:[a-f0-9]{64}',inspected.get('Id','')) or inspected.get('Os')!='linux'
            or any(labels.get(key)!=value for key,value in REQUIRED_LABELS.items())):
        raise ValueError('pi_image_contract_unverified')
    result={'version':'teruisi-pi-image-build-v1','sourceCommit':args.source_commit,'sourceTree':args.source_tree,
        'inputsSha256':inputs_sha256,'image':inspected['Id'],'tag':args.tag,'labels':REQUIRED_LABELS,
        'piVersion':lock['piVersion'],'runtimeLockSha256':input_manifest['containers/pi-agent/runtime-lock.json'],
        'packageLockSha256':input_manifest['containers/pi-agent/package-lock.json'],'nodeVersion':lock['node']['version'],
        'npmVersion':lock['npm']['version'],'uvVersion':lock['uv']['version'],'uvBinarySha256':lock['uv']['binarySha256'],'baseImage':lock['baseImage']}
    with args.output.open('x',encoding='utf-8') as output:
        output.write(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__=='__main__':main()
