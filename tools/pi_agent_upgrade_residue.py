"""Evidence-first cleanup for Pi Runner upgrade-plan directories that were never
dispatched on either side.

This tool does not weaken, bypass or replace the existing guards:
  Windows: tools/pi_agent_upgrade_runtime.py:171 `pi_upgrade_preparation_fragment_retained`
  Linux:   backend/pi_runner/runtime_upgrade.py:80 `upgrade_preparation_exists`
Both gates stay exactly as written. This tool only removes a directory pair that
both gates would otherwise keep rejecting forever because neither side ever
progressed past the first write of its own attempt.

"Never dispatched" is judged independently on each side and both sides must
agree before anything is removed:
  Windows candidate directory `config/pi-agent-upgrades/<sha>/`:
    - `preparing.json` exists (the only file `prepare` writes before calling
      into Linux), and
    - `prepared.json`, `intent.json` and `result.json` all do NOT exist, and
    - no `*.new` fragment exists for any file in the directory (a fragment
      means a write may still be in flight; this tool never guesses).
  Linux mirror directory `<releaseParent>/<sha>/` (observed read-only over the
  existing wsl.exe transport, following tools/pi_agent_upgrade_status.py's
  pattern):
    - EITHER the directory does not exist at all (Linux `prepare` never ran
      for this sha), OR it exists but `source-upgrade-intent.json` is absent
      (Linux `prepare` built a release and plan, but Linux `apply`/`check`/
      `reconcile` never started) -- and in the latter case no `*.new`
      fragment exists for any file there either.

A directory whose sha equals the currently active `runnerSourceSha256` in
`config/pi-agent.json` is never a candidate, independent of the above.

Before removing anything, a timestamped evidence manifest (every file path
and its sha256, both sides) is written to an evidence directory (default
`docs/运维/部署与启动/pi-upgrade-residue-evidence/`, overridable with
`--evidence-directory`); nothing under this tool's control is ever written
into D:/teruisi-runtime or WSL.

`--dry-run` (default) only reports candidates and writes no evidence file and
removes nothing. `--execute` writes the evidence manifest first, then removes
the Windows directory tree and the Linux directory tree (if the Linux side
exists) for each confirmed, independently-agreeing candidate.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_file(path):
    """Read one plain file, refusing symlinks/junctions/hardlinks/oversize."""
    for part in (path, *path.parents):
        if part.is_symlink() or getattr(part, 'is_junction', lambda: False)():
            raise ValueError('pi_upgrade_residue_path_link')
    info = path.stat()
    if not info.st_mode & 0o170000 == 0o100000 or info.st_nlink != 1 or info.st_size > 1024 * 1024:
        raise ValueError('pi_upgrade_residue_file_identity')
    return path.read_bytes()


def has_fragment(directory):
    """True if any `<name>.new` fragment exists directly under directory."""
    if not directory.is_dir():
        return False
    for entry in directory.iterdir():
        if entry.name.endswith('.new'):
            return True
    return False


def windows_candidate(folder):
    """Classify one `config/pi-agent-upgrades/<sha>/` directory.

    Returns a dict describing the directory when (and only when) it matches
    the narrow "preparing.json only" never-dispatched shape; otherwise None.
    """
    if not folder.is_dir() or folder.is_symlink() or getattr(folder, 'is_junction', lambda: False)():
        return None
    preparing = folder / 'preparing.json'
    prepared = folder / 'prepared.json'
    intent = folder / 'intent.json'
    result = folder / 'result.json'
    if not preparing.is_file():
        return None
    if prepared.exists() or intent.exists() or result.exists():
        return None
    if has_fragment(folder):
        return None
    names = [entry.name for entry in folder.iterdir()]
    # The narrow eligible shape is exactly one entry: preparing.json. Any other
    # name (another file, a subdirectory, a link) means this is not the
    # never-dispatched shape; classify as not-eligible rather than raising, so
    # one unusual directory never aborts a scan of its siblings.
    if names != ['preparing.json']:
        return None
    files = {'preparing.json': sha(read_file(preparing))}
    return {'path': str(folder), 'sha256ByFile': files}


LINUX_OBSERVE = r'''
import hashlib,json,os,re,stat,sys
from pathlib import Path
def sha(raw):return hashlib.sha256(raw).hexdigest()
def require(ok,reason):
 if not ok:raise ValueError(reason)
def read_one(path,limit=1048576):
 for part in (path,*path.parents):require(not part.is_symlink(),'linux_residue_path_link')
 info=path.stat()
 require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size<=limit,'linux_residue_file_identity')
 with path.open('rb') as f:raw=f.read(limit+1)
 require(len(raw)<=limit,'linux_residue_file_bound')
 return raw
def observe(v):
 require(os.getuid()==1000,'linux_residue_fixed_owner_required')
 base=Path(v['releaseParent']);require(re.fullmatch('[a-f0-9]{64}',v['sha']) is not None,'linux_residue_sha_required')
 folder=base/v['sha']
 if not folder.is_dir() or folder.is_symlink():
  return {'exists':False,'neverDispatched':True,'files':{}}
 intent=folder/'source-upgrade-intent.json'
 if intent.exists() or intent.is_symlink():
  return {'exists':True,'neverDispatched':False,'files':{}}
 files={}
 for entry in sorted(folder.iterdir(),key=lambda p:p.name):
  if entry.name.endswith('.new'):
   return {'exists':True,'neverDispatched':False,'files':{}}
  if entry.is_file() and not entry.is_symlink():
   files[entry.name]=sha(read_one(entry))
  else:
   return {'exists':True,'neverDispatched':False,'files':{}}
 return {'exists':True,'neverDispatched':True,'files':files}
try:
 print(json.dumps(observe(json.load(sys.stdin)),sort_keys=True,separators=(',',':')))
except Exception as e:
 print(json.dumps({'exists':None,'neverDispatched':False,'files':{},'reason':str(e) if isinstance(e,ValueError) else 'linux_residue_observation_unknown'},sort_keys=True,separators=(',',':')))
 raise SystemExit(1)
'''

LINUX_REMOVE = r'''
import json,os,re,shutil,sys
from pathlib import Path
def require(ok,reason):
 if not ok:raise ValueError(reason)
def observe_clean(folder):
 intent=folder/'source-upgrade-intent.json'
 require(not intent.exists() and not intent.is_symlink(),'linux_residue_dispatched')
 for entry in folder.iterdir():
  require(not entry.name.endswith('.new'),'linux_residue_fragment_present')
  require(entry.is_file() and not entry.is_symlink(),'linux_residue_unexpected_entry')
def remove(v):
 require(os.getuid()==1000,'linux_residue_fixed_owner_required')
 base=Path(v['releaseParent']);require(re.fullmatch('[a-f0-9]{64}',v['sha']) is not None,'linux_residue_sha_required')
 folder=base/v['sha']
 if not folder.is_dir() or folder.is_symlink():
  return {'removed':False,'alreadyAbsent':True}
 observe_clean(folder)
 shutil.rmtree(folder)
 return {'removed':True,'alreadyAbsent':False}
try:
 print(json.dumps(remove(json.load(sys.stdin)),sort_keys=True,separators=(',',':')))
except Exception as e:
 print(json.dumps({'removed':False,'alreadyAbsent':False,'reason':str(e) if isinstance(e,ValueError) else 'linux_residue_removal_unknown'},sort_keys=True,separators=(',',':')))
 raise SystemExit(1)
'''


def invoke_linux(script, value, distribution='TERUISI-Pandas', runner=subprocess.run):
    wsl = Path(os.environ['SystemRoot']) / 'System32/wsl.exe'
    env = {key: item for key, item in os.environ.items()
           if key.upper() in {'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE'}}
    command = [str(wsl), '-d', distribution, '-u', 'teruisi-pandas', '--exec', '/usr/bin/python3', '-B', '-c', script]
    result = runner(command, input=json.dumps(value).encode(), capture_output=True, timeout=60, env=env)
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if result.returncode != 0 or len(lines) != 1:
        raise ValueError('pi_upgrade_residue_linux_transport_unknown')
    record = json.loads(lines[0])
    if type(record) is not dict:
        raise ValueError('pi_upgrade_residue_linux_response_invalid')
    return record


def linux_observe(release_parent, sha256, distribution='TERUISI-Pandas', runner=subprocess.run):
    return invoke_linux(LINUX_OBSERVE, {'releaseParent': release_parent, 'sha': sha256}, distribution, runner)


def linux_remove(release_parent, sha256, distribution='TERUISI-Pandas', runner=subprocess.run):
    return invoke_linux(LINUX_REMOVE, {'releaseParent': release_parent, 'sha': sha256}, distribution, runner)


def active_source_sha256(runtime):
    config = json.loads((runtime / 'config/pi-agent.json').read_bytes())
    value = config.get('runnerSourceSha256')
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('pi_upgrade_residue_active_source_invalid')
    return value


FIXED_RELEASE_PARENT = '/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'


def scan(runtime, distribution='TERUISI-Pandas', linux_observer=linux_observe):
    """Read-only: returns the list of directories eligible for removal and,
    separately, every rejected directory with its reason (for diagnostics)."""
    active = active_source_sha256(runtime)
    upgrades = runtime / 'config/pi-agent-upgrades'
    eligible, rejected = [], []
    if not upgrades.is_dir():
        return eligible, rejected
    for folder in sorted(upgrades.iterdir(), key=lambda p: p.name):
        if not re.fullmatch(r'[a-f0-9]{64}', folder.name):
            rejected.append({'sha256': folder.name, 'reason': 'pi_upgrade_residue_unknown_entry'})
            continue
        if folder.name == active:
            rejected.append({'sha256': folder.name, 'reason': 'pi_upgrade_residue_is_active_source'})
            continue
        windows = windows_candidate(folder)
        if windows is None:
            rejected.append({'sha256': folder.name, 'reason': 'pi_upgrade_residue_windows_side_not_eligible'})
            continue
        try:
            linux_state = linux_observer(FIXED_RELEASE_PARENT, folder.name, distribution)
        except Exception as error:
            rejected.append({'sha256': folder.name, 'reason': str(error) if isinstance(error, ValueError) else 'pi_upgrade_residue_linux_observation_failed'})
            continue
        if linux_state.get('neverDispatched') is not True:
            rejected.append({'sha256': folder.name, 'reason': 'pi_upgrade_residue_linux_side_not_eligible'})
            continue
        eligible.append({'sha256': folder.name, 'windows': windows, 'linux': linux_state})
    return eligible, rejected


def write_evidence(evidence_directory, eligible, rejected, runtime):
    evidence_directory.mkdir(parents=True, exist_ok=True)
    operation_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    record = {
        'version': 'teruisi-pi-upgrade-residue-evidence-v1',
        'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'runtime': str(runtime),
        'releaseParent': FIXED_RELEASE_PARENT,
        'eligible': eligible,
        'rejected': rejected,
    }
    path = evidence_directory / ('pi-upgrade-residue-' + operation_id + '.json')
    if path.exists():
        raise ValueError('pi_upgrade_residue_evidence_exists')
    path.write_text(json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8')
    return path


def execute_removal(runtime, eligible, distribution='TERUISI-Pandas', linux_remover=linux_remove):
    """Removes each eligible directory pair. Re-verifies the Windows side is
    still exactly the classified shape immediately before removing it (the
    scan above is read-only and could be stale by the time --execute runs)."""
    results = []
    for item in eligible:
        folder = Path(item['windows']['path'])
        recheck = windows_candidate(folder)
        if recheck is None or recheck['sha256ByFile'] != item['windows']['sha256ByFile']:
            results.append({'sha256': item['sha256'], 'removed': False, 'reason': 'pi_upgrade_residue_windows_side_changed'})
            continue
        try:
            linux_result = linux_remover(FIXED_RELEASE_PARENT, item['sha256'], distribution)
        except Exception as error:
            results.append({'sha256': item['sha256'], 'removed': False, 'reason': str(error) if isinstance(error, ValueError) else 'pi_upgrade_residue_linux_removal_failed'})
            continue
        if linux_result.get('removed') is not True and linux_result.get('alreadyAbsent') is not True:
            results.append({'sha256': item['sha256'], 'removed': False, 'reason': linux_result.get('reason', 'pi_upgrade_residue_linux_removal_unknown')})
            continue
        # Windows side only removed after the Linux side is confirmed gone (or
        # was already gone); a failure here still leaves evidence durable.
        import shutil
        shutil.rmtree(folder)
        results.append({'sha256': item['sha256'], 'removed': True, 'linux': linux_result})
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--evidence-directory', default=None)
    parser.add_argument('--execute', action='store_true', help='Without this flag, only reports candidates; removes nothing.')
    parser.add_argument('--distribution', default='TERUISI-Pandas')
    args = parser.parse_args(argv)
    runtime = Path(args.runtime).absolute()
    if os.name != 'nt' or runtime != Path(r'D:\teruisi-runtime\django-sales'):
        raise ValueError('native_pi_upgrade_residue_required')
    root = Path(__file__).resolve().parents[1]
    evidence_directory = Path(args.evidence_directory) if args.evidence_directory else root / 'docs/运维/部署与启动/pi-upgrade-residue-evidence'
    eligible, rejected = scan(runtime, args.distribution)
    output = {'eligible': eligible, 'rejected': rejected, 'executed': False}
    if args.execute and eligible:
        evidence_path = write_evidence(evidence_directory, eligible, rejected, runtime)
        output['evidencePath'] = str(evidence_path)
        output['results'] = execute_removal(runtime, eligible, args.distribution)
        output['executed'] = True
    print(json.dumps(output, indent=2, sort_keys=True, ensure_ascii=False))


if __name__ == '__main__':
    main()
