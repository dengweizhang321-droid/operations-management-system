"""Explicit private native installation binding; never a readiness bypass."""
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import stat


def read_profile():
    file = os.environ.get('TERUISI_NATIVE_ISOLATION_FILE')
    digest = os.environ.get('TERUISI_NATIVE_ISOLATION_SHA256')
    if not file and not digest:
        if re.search(r'[/\\]native-control-[^/\\]+[/\\]', __file__, re.I):
            raise ValueError('private_installation_requires_isolation_binding')
        return None
    if not file or not re.fullmatch('[a-f0-9]{64}', digest or ''):
        raise ValueError('incomplete_native_isolation_binding')
    path = Path(file)
    if not path.is_absolute():
        raise ValueError('absolute_isolation_binding_required')
    for item in [path, *path.parents]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('linked_isolation_binding')
    if path.stat().st_size > 4096:
        raise ValueError('isolation_binding_too_large')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError('isolation_binding_changed')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate_isolation_key')
            result[key] = value
        return result
    profile = json.loads(raw, object_pairs_hook=pairs)
    if (not isinstance(profile, dict) or set(profile) != {'version', 'id', 'root', 'sourceRoot', 'wslDistribution'}
            or type(profile['version']) is not int or profile['version'] != 1
            or not isinstance(profile['id'], str) or not re.fullmatch('[a-z0-9-]{8,64}', profile['id'])
            or profile['wslDistribution'] != 'Codex-AI-Batch2-20261108'
            or profile['root'] != 'D:\\codex-isolated\\native-control-' + profile['id']
            or not re.fullmatch(r'D:\\\.codex\\worktrees\\[a-z0-9]+\\[^\\]+', profile['sourceRoot'])):
        raise ValueError('invalid_native_isolation_profile')
    linux_root = '/home/teruisi-pandas/.local/share/native-control-' + profile['id']
    expected = str(PureWindowsPath(profile['root']) / 'isolation.json') if os.name == 'nt' else linux_root + '/isolation.json'
    if os.path.normcase(str(path)) != os.path.normcase(expected):
        raise ValueError('isolation_binding_location_changed')
    return {**profile, 'sha256': digest, 'linuxRoot': linux_root,
            'piUnit': 'codex-native-' + profile['id'] + '-pi.service',
            'pandasUnit': 'codex-native-' + profile['id'] + '-pandas.service',
            'namespace': 'pi-native-' + profile['id']}


PROFILE = read_profile()


def native_port(port):
    if port not in {5432, 8121, 8123, 8112, 8001, 8011, 8021, 8051, 8061}:
        raise ValueError('unknown_native_port')
    return port + 20000 if PROFILE else port
