"""Install an outside-verified exact bundle without network or install scripts."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
import uuid
import zipfile


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'), sort_keys=True).encode('utf-8')


def directory(path):
    for parent in reversed([path, *path.parents]):
        if parent.exists() and not stat.S_ISDIR(parent.lstat().st_mode):
            raise ValueError('dependency_unsafe_directory')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)


def archive_check(data, wheel):
    if wheel:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = [(item.filename, item.file_size, (item.external_attr >> 16) & 0o170000) for item in archive.infolist()]
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            entries = [(item.name, item.size, stat.S_IFREG if item.isfile() else stat.S_IFDIR if item.isdir() else stat.S_IFLNK) for item in archive.getmembers()]
    if len(entries) > 20000 or sum(item[1] for item in entries) > 64 * 1024 * 1024:
        raise ValueError('dependency_archive_limit')
    for name, _, kind in entries:
        if name.startswith('/') or '\\' in name or '..' in name.split('/') or kind not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError('dependency_unsafe_archive')


def main():
    raw = sys.stdin.buffer.read(12 * 1024 * 1024 + 1)
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError('dependency_bundle_limit')
    request = json.loads(raw)
    bundle = request['bundle']
    if (not isinstance(bundle, dict) or set(bundle) != {'schemaVersion', 'kind', 'ecosystem', 'packages', 'lockDigest'}
            or bundle['schemaVersion'] != 1 or bundle['kind'] != 'dependency_bundle' or bundle['ecosystem'] not in {'pip', 'uv', 'npm'}
            or not isinstance(bundle['packages'], list) or not 1 <= len(bundle['packages']) <= 100):
        raise ValueError('invalid_dependency_bundle')
    metadata = [{key: value for key, value in item.items() if key not in {'contentBase64', 'fetchedAt'}} for item in bundle['packages']]
    if hashlib.sha256(canonical(metadata)).hexdigest() != bundle['lockDigest']:
        raise ValueError('dependency_lock_changed')
    root = Path('/workspace/dependencies')
    directory(root)
    target = root / ('install-' + uuid.uuid4().hex)
    target.mkdir(mode=0o700)
    files, total, seen = [], 0, set()
    for package in bundle['packages']:
        if (set(package) != {'name', 'version', 'filename', 'sha256', 'sourceUrl', 'fetchedAt', 'contentBase64', 'dependencies'}
                or not isinstance(package['filename'], str) or not re.fullmatch(r'[A-Za-z0-9_.+-]{1,200}', package['filename'])
                or package['filename'] in seen or not re.fullmatch(r'[a-f0-9]{64}', package['sha256'])
                or not isinstance(package['sourceUrl'], str) or not package['sourceUrl'].startswith('https://')):
            raise ValueError('invalid_dependency_artifact')
        seen.add(package['filename'])
        data = base64.b64decode(package['contentBase64'], validate=True)
        total += len(data)
        if total > 8 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != package['sha256']:
            raise ValueError('dependency_hash_changed')
        wheel = bundle['ecosystem'] in {'pip', 'uv'}
        if not package['filename'].endswith('.whl' if wheel else '.tgz'):
            raise ValueError('dependency_binary_required')
        archive_check(data, wheel)
        artifact = target / package['filename']
        with artifact.open('xb') as handle:
            handle.write(data)
        files.append(str(artifact))
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/workspace/home', 'LANG': 'C.UTF-8', 'TMPDIR': '/tmp',
           'PIP_CONFIG_FILE': '/dev/null', 'PIP_DISABLE_PIP_VERSION_CHECK': '1', 'PYTHONUTF8': '1',
           'npm_config_cache': '/workspace/dependencies/npm-cache', 'npm_config_userconfig': str(target/'npm-userconfig'),
           'npm_config_globalconfig': str(target/'npm-globalconfig'), 'npm_config_update_notifier': 'false'}
    env.update({'UV_PYTHON_DOWNLOADS':'never','UV_NO_PROGRESS':'1','UV_CACHE_DIR':'/workspace/dependencies/uv-cache'})
    (target/'npm-userconfig').touch(exist_ok=False)
    (target/'npm-globalconfig').touch(exist_ok=False)
    if bundle['ecosystem'] in {'pip', 'uv'}:
        venv = Path('/workspace/venv')
        directory(venv)
        if not (venv / 'bin/python').exists():
            process = subprocess.run(['/usr/local/bin/python3', '-I', '-m', 'venv', str(venv)], env=env, capture_output=True, timeout=60)
            if process.returncode:
                raise ValueError('dependency_venv_failed')
        if bundle['ecosystem']=='uv':
            args=['/usr/local/bin/uv','pip','install','--python',str(venv/'bin/python'),'--no-index','--no-deps','--offline','--no-build',*files]
            installer='uv'
        else:
            args = [str(venv / 'bin/python'), '-I', '-m', 'pip', 'install', '--no-index', '--no-deps', '--no-input', '--disable-pip-version-check', *files]
            installer = 'pip'
    else:
        args = ['/usr/local/bin/node', '/opt/npm/bin/npm-cli.js', 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', '/workspace/work', *files]
        installer = 'npm'
    process = subprocess.run(args, cwd='/workspace/work', env=env, capture_output=True, timeout=240)
    # Never turn a partial/failed install into an automatic second attempt.
    if process.returncode:
        raise ValueError('dependency_install_failed')
    receipt = {'schemaVersion': 1, 'ecosystem': bundle['ecosystem'], 'installer': installer, 'lockDigest': bundle['lockDigest'],
               'packages': [{key: value for key, value in item.items() if key != 'contentBase64'} for item in bundle['packages']],
               'network': 'none', 'installScripts': False}
    (target / 'receipt.json').write_bytes(canonical(receipt))
    return receipt


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except Exception as error:
        code = str(error)
        if not re.fullmatch(r'[a-z_]{1,64}', code):
            code = 'dependency_install_unknown'
        print(json.dumps({'error': code}))
