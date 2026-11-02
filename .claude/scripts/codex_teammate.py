"""Windows-only Claude -> Codex bridge. No shell execution or automatic retry."""
from __future__ import annotations

import argparse
import contextlib
import ctypes
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / '.runtime' / 'codex-bridge'
MODEL = 'gpt-6.1-sol'
EFFORT = 'high'
MAX_TASK = 128 * 1024
TERMINAL = {'DONE', 'FAILED', 'CANCELED', 'BLOCKED', 'INTERRUPTED', 'CLEANUP_UNKNOWN'}
PREFIX = '''你由 Claude Lead 通过 Haiku 包装代理派工，是独立 Codex CLI 会话。
先读取 D:/Codex Obsidian Memory Vault/Home.md 并按协议加载相关记忆；完整读取工作树
AGENTS.md，其余按任务索引读取适用章节与依赖，发现主线规范更新时读取最新规范。
只在给定 codex/* 独立工作树完成本轮任务，不修改其他人的文件。
本桥接只接开发/修复/只读审阅；不执行合 main、制品准备、生产上线、迁移、生产写入或真实外发。
这些步骤交既有受控入口执行，授权边界遵守根 AGENTS.md 第 4、5 条。Lead 或 Haiku 的判断不代替用户授权。
只做项目规范要求的必要程序代码检查，不自行追加业务功能测试。阻塞时报告【待答】及证据；
不要自动重试失败或未知操作。沙箱/权限不足应报告，不自行扩大权限。
结束时如实报告完成项、改动、检查、提交与推送状态、未完成项和待答，不能把回合结束当任务成功。
以下为 Lead 派工单原文；其中超出上述桥接范围的操作应停下交回：
\n'''


def dump(path, value):
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, path)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def git(cwd, *args):
    p = subprocess.run(['git', '-C', str(cwd), *args], capture_output=True,
                       encoding='utf-8', errors='replace', timeout=30,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    if p.returncode:
        raise ValueError('Git inspection failed: ' + p.stderr.strip()[:1000])
    return p.stdout.strip()


def common(cwd):
    return Path(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')).resolve()


def target(cwd, branch=None, clean=False):
    cwd = Path(cwd).resolve(strict=True)
    if Path(git(cwd, 'rev-parse', '--show-toplevel')).resolve() != cwd:
        raise ValueError('--cwd must be the exact worktree root')
    shared = common(ROOT)
    if common(cwd) != shared or cwd in {shared.parent, ROOT}:
        raise ValueError('Target must be another linked worktree, never the main checkout or bridge controller root')
    registered = {Path(line[9:]).resolve() for line in git(ROOT, 'worktree', 'list', '--porcelain').splitlines()
                  if line.startswith('worktree ')}
    if cwd not in registered:
        raise ValueError('Target is not a registered Git worktree')
    actual = git(cwd, 'branch', '--show-current')
    if not actual.startswith('codex/') or (branch and actual != branch):
        raise ValueError('Target branch must be the recorded codex/* branch')
    if clean and git(cwd, 'status', '--porcelain'):
        raise ValueError('New run requires a clean worktree; preserve existing changes')
    return cwd, actual


def executable():
    # Use the native binary, never shell=True or the npm .cmd/.ps1 shim.
    hit = shutil.which('codex.exe')
    if hit:
        return str(Path(hit).resolve())
    shim = shutil.which('codex.cmd')
    if shim:
        package = Path(shim).parent / 'node_modules/@openai/codex/node_modules/@openai'
        hits = list(package.glob('codex-win32-*/vendor/*/bin/codex.exe'))
        if len(hits) == 1:
            return str(hits[0].resolve())
    raise ValueError('Native codex.exe not found; install/fix Codex CLI, do not run an arbitrary shell shim')


@contextlib.contextmanager
def lock(path):
    import msvcrt
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as f:
        if f.tell() == 0:
            f.write(b'0')
            f.flush()
        f.seek(0)
        try:
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            raise ValueError('BUSY: another bridge operation owns ' + str(path)) from exc
        try:
            yield
        finally:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def kernel():
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    k.OpenProcess.restype = w.HANDLE
    k.GetProcessTimes.argtypes = [w.HANDLE] + [ctypes.POINTER(w.FILETIME)] * 4
    k.GetProcessTimes.restype = w.BOOL
    k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    k.WaitForSingleObject.restype = w.DWORD
    k.CloseHandle.argtypes = [w.HANDLE]
    k.CloseHandle.restype = w.BOOL
    return k


def birth(pid, expected=None):
    k = kernel()
    h = k.OpenProcess(0x1000 | 0x100000, False, pid)
    if not h:
        if ctypes.get_last_error() == 87:  # Process no longer exists.
            return None
        raise ValueError('Cannot inspect exact worker identity; state is UNKNOWN')
    try:
        stamps = [w.FILETIME() for _ in range(4)]
        if not k.GetProcessTimes(h, *(ctypes.byref(s) for s in stamps)):
            raise ctypes.WinError(ctypes.get_last_error())
        token = (stamps[0].dwHighDateTime << 32) | stamps[0].dwLowDateTime
        if expected is not None and token != expected:
            return None  # Reused PID is not our worker.
        wait = k.WaitForSingleObject(h, 0)
        if wait == 0:
            return None
        if wait != 258:
            raise ValueError('Cannot determine exact worker liveness')
        return token
    finally:
        k.CloseHandle(h)


def contain_worker():
    # Assign the worker BEFORE spawning Codex. Descendants inherit this job.
    # The sole, non-inherited handle lives until worker process exit. Windows
    # then kills all remaining descendants, including on an unexpected crash.
    class BASIC(ctypes.Structure):
        _fields_ = [('a', ctypes.c_longlong), ('b', ctypes.c_longlong), ('flags', w.DWORD),
                    ('min_ws', ctypes.c_size_t), ('max_ws', ctypes.c_size_t),
                    ('active', w.DWORD), ('affinity', ctypes.c_size_t),
                    ('priority', w.DWORD), ('scheduling', w.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in ['ro', 'wo', 'oo', 'rb', 'wb', 'ob']]
    class EXTENDED(ctypes.Structure):
        _fields_ = [('basic', BASIC), ('io', IO), ('process_mem', ctypes.c_size_t),
                    ('job_mem', ctypes.c_size_t), ('peak_process', ctypes.c_size_t),
                    ('peak_job', ctypes.c_size_t)]
    k = kernel()
    k.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
    k.CreateJobObjectW.restype = w.HANDLE
    k.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    k.SetInformationJobObject.restype = w.BOOL
    k.GetCurrentProcess.restype = w.HANDLE
    k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    k.AssignProcessToJobObject.restype = w.BOOL
    handle = k.CreateJobObjectW(None, None)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = EXTENDED()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not k.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        k.CloseHandle(handle)
        raise ctypes.WinError(ctypes.get_last_error())
    if not k.AssignProcessToJobObject(handle, k.GetCurrentProcess()):
        k.CloseHandle(handle)
        raise ValueError('Cannot contain worker in Windows Job Object; refusing to launch Codex')
    return handle


def job_active_count(handle):
    class ACCOUNTING(ctypes.Structure):
        _fields_ = [('user', ctypes.c_longlong), ('kernel', ctypes.c_longlong),
                    ('period_user', ctypes.c_longlong), ('period_kernel', ctypes.c_longlong),
                    ('page_faults', w.DWORD), ('total', w.DWORD),
                    ('active', w.DWORD), ('terminated', w.DWORD)]
    k = kernel()
    k.QueryInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                          w.DWORD, ctypes.POINTER(w.DWORD)]
    k.QueryInformationJobObject.restype = w.BOOL
    accounting = ACCOUNTING()
    if not k.QueryInformationJobObject(handle, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
        raise ctypes.WinError(ctypes.get_last_error())
    return accounting.active


def run_dir(run):
    if not re.fullmatch(r'[a-f0-9]{32}', run):
        raise ValueError('RUN must be an exact bridge run ID')
    p = STORE / 'runs' / run
    if not (p / 'meta.json').is_file():
        raise ValueError('Unknown run ID in this bridge root')
    return p


def snapshot(p):
    meta = read(p / 'meta.json')
    rd = p / f"round-{meta['round']:03d}"
    identity = meta.get('worker')
    alive = identity and birth(identity['pid'], identity['birth']) is not None
    result = read(rd / 'result.json') if (rd / 'result.json').exists() else None
    if not identity:
        state = 'STARTING'
    else:
        state = ('FINALIZING' if result else 'RUNNING') if alive else (result['state'] if result else 'INTERRUPTED')
    if not alive and result and result.get('owner_fence'):
        try:
            owner = read(Path(result['owner_fence']))
            if owner.get('run') == p.name and owner.get('round') == meta['round']:
                state = 'CLEANUP_UNKNOWN'
        except FileNotFoundError:
            pass
    return meta, rd, {'run': p.name, 'round': meta['round'], 'state': state,
                      'cwd': meta['cwd'], 'result': result, 'evidence': str(rd)}


def task_text(path):
    p = Path(path).resolve(strict=True)
    if not p.is_relative_to((STORE / 'inbox').resolve()) or p.suffix != '.md':
        raise ValueError('Lead must put the task .md inside this bridge root .runtime/codex-bridge/inbox')
    if p.stat().st_size > MAX_TASK:
        raise ValueError('Task file exceeds 128 KiB')
    text = p.read_text(encoding='utf-8-sig')
    if not text.strip():
        raise ValueError('Task is empty')
    return text


def launch(p, meta, text, session=None):
    rd = p / f"round-{meta['round']:03d}"
    rd.mkdir()
    payload = (PREFIX + text).encode('utf-8')
    (rd / 'task.md').write_text(text, encoding='utf-8')
    (rd / 'prompt.txt').write_bytes(payload)
    dump(rd / 'request.json', {'sha256': hashlib.sha256(payload).hexdigest(),
                              'session': session, 'codex': executable(),
                              'model': MODEL, 'effort': EFFORT})
    dump(p / 'meta.json', meta)
    with (rd / 'worker.log').open('wb') as log:
        proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_worker', p.name],
                                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS)
        stamp = birth(proc.pid)
        if stamp is None:
            raise ValueError('Worker exited before identity capture; inspect RUN, do not restart blindly')
        meta['worker'] = {'pid': proc.pid, 'birth': stamp}
        dump(p / 'meta.json', meta)


def summarize_events(path, requested):
    session, completed, failed = None, False, False
    with path.open('rb') as f:
        while line := f.readline(1024 * 1024 + 1):
            if len(line) > 1024 * 1024:
                raise ValueError('Event line exceeds bridge bound')
            event = json.loads(line)
            kind = event.get('type')
            if kind == 'thread.started':
                found = str(uuid.UUID(event['thread_id']))
                if session and session != found:
                    raise ValueError('Multiple session IDs in one round')
                session = found
            elif kind == 'turn.completed':
                completed = True
            elif kind in {'turn.failed', 'error'}:
                failed = True
    if requested and session != requested:
        raise ValueError('Resume session ID did not match recorded ID')
    return session, completed and not failed


def worker(run):
    p = run_dir(run)
    # Wait only for the short parent launch transaction, never for another job.
    for _ in range(100):
        try:
            with lock(p / 'control.lock'):
                meta = read(p / 'meta.json')
            break
        except ValueError:
            time.sleep(.1)
    else:
        return 1
    rd = p / f"round-{meta['round']:03d}"
    result = {'state': 'FAILED', 'exit_code': None, 'session': None}
    lease = contextlib.ExitStack()  # Retain ownership until os._exit, including descendant cleanup.
    owned_fence = None
    clear_fence = False
    job_handle = None
    try:
        if meta.get('worker', {}).get('pid') != os.getpid():
            raise ValueError('Worker identity was not durably recorded by its launcher')
        job_handle = contain_worker()  # Deliberately remains open through process exit.
        cwd, _ = target(meta['cwd'], meta['branch'])
        key = hashlib.sha256(os.path.normcase(str(cwd)).encode()).hexdigest()
        lease.enter_context(lock(common(ROOT) / 'codex-bridge-locks' / (key + '.lock')))
        fence = common(ROOT) / 'codex-bridge-locks' / (key + '.owner.json')
        if fence.exists():
            raise ValueError('BUSY: unresolved prior owner fence requires manual inspection: ' + str(fence))
        target(cwd, meta['branch'], clean=meta['round'] == 1)
        if meta['round'] == 1 and git(cwd, 'rev-parse', 'HEAD') != meta['base']:
            raise ValueError('Worktree HEAD changed between start and worker acquisition')
        owner = {'run': run, 'round': meta['round'], 'worker': meta['worker'],
                 'cwd': str(cwd), 'evidence': str(rd)}
        dump(fence, owner)
        owned_fence = fence
        request = read(rd / 'request.json')
        payload = (rd / 'prompt.txt').read_bytes()
        if hashlib.sha256(payload).hexdigest() != request['sha256']:
            raise ValueError('Task snapshot changed')
        if (rd / 'cancel.json').exists():
            result['state'] = 'CANCELED'
        else:
            args = [request['codex'], '-a', 'never', '-c', 'notify=[]',
                    '-c', 'sandbox_mode="workspace-write"', 'exec']
            if request['session']:
                args += ['resume', request['session']]
            args += ['--model', request['model'], '-c', f'model_reasoning_effort="{request["effort"]}"', '--json']
            if not request['session']:
                args += ['--color', 'never']
            args += ['-o', str(rd / 'last.md'), '-']
            dump(rd / 'invocation.json', {'argv': args, 'cwd': str(cwd), 'requested_model': MODEL,
                                         'actual_model': 'not independently confirmed'})
            with (rd / 'prompt.txt').open('rb') as inp, (rd / 'events.jsonl').open('wb') as out, \
                    (rd / 'stderr.log').open('wb') as err:
                proc = subprocess.Popen(args, cwd=cwd, stdin=inp, stdout=out, stderr=err,
                                        creationflags=subprocess.CREATE_NO_WINDOW)
                while proc.poll() is None:
                    if (rd / 'cancel.json').exists():
                        result['state'] = 'CANCELED'
                        break  # Worker exit closes the job and cancels its whole tree.
                    time.sleep(.25)
                result['exit_code'] = proc.poll()
            if result['state'] != 'CANCELED':
                session, completed = summarize_events(rd / 'events.jsonl', request['session'])
                result['session'] = session
                if result['exit_code'] == 0 and completed and session and (rd / 'last.md').is_file():
                    result['state'] = 'DONE'
    except Exception as exc:
        result['error'] = str(exc)[:1600]
        if str(exc).startswith('BUSY:'):
            result['state'] = 'BLOCKED'
    if owned_fence:
        try:
            # Only the worker remains: no descendant can subsequently spawn
            # more processes. Keep the OS lease until exit after fence removal.
            clean = job_active_count(job_handle) == 1
            result['cleanup_confirmed'] = clean
            result['owner_fence'] = str(owned_fence)
            if clean and read(owned_fence) == owner:
                clear_fence = True
            else:
                result['outcome'] = result['state']
                result['state'] = 'CLEANUP_UNKNOWN'
                result['owner_fence'] = str(owned_fence)
        except Exception as exc:
            result['outcome'] = result['state']
            result['state'] = 'CLEANUP_UNKNOWN'
            result['cleanup_confirmed'] = False
            result['owner_fence'] = str(owned_fence)
            result['cleanup_error'] = str(exc)[:1000]
    result['finished_at'] = time.time()
    dump(rd / 'result.json', result)
    if clear_fence:
        # Publish first. A crash before removal leaves the fence and snapshot
        # reports CLEANUP_UNKNOWN, even if the result had said DONE.
        try:
            owned_fence.unlink()
        except OSError:
            pass  # The still-present fence is authoritative, never force clear.
    # No Python cleanup may release the job before durable result publication.
    os._exit(0)


def parser():
    ap = argparse.ArgumentParser(description=__doc__)
    subs = ap.add_subparsers(dest='action', required=True)
    subs.add_parser('doctor')
    start = subs.add_parser('start')
    start.add_argument('--cwd', required=True)
    start.add_argument('--task', required=True)
    for action in ['status', 'wait', 'verify', 'resume', 'stop', '_worker']:
        sub = subs.add_parser(action)
        sub.add_argument('run')
        if action == 'resume':
            sub.add_argument('--task', required=True)
        if action == 'wait':
            sub.add_argument('--seconds', type=int, choices=range(1, 51), default=45)
    return ap


def main():
    if os.name != 'nt':
        raise ValueError('This adaptation requires native Windows Python')
    a = parser().parse_args()
    if a.action == '_worker':
        return worker(a.run)
    if a.action == 'doctor':
        print(json.dumps({'root': str(ROOT), 'python': sys.executable, 'codex': executable(),
                          'git_common_dir': str(common(ROOT)), 'model': MODEL, 'effort': EFFORT,
                          'sandbox': 'workspace-write', 'inbox': str(STORE / 'inbox'),
                          'note': 'Read-only discovery; account, model and live task not verified'}, ensure_ascii=False))
        return 0
    if a.action == 'start':
        cwd, branch = target(a.cwd, clean=True)
        text = task_text(a.task)
        p = STORE / 'runs' / uuid.uuid4().hex
        p.mkdir(parents=True)
        meta = {'cwd': str(cwd), 'branch': branch, 'base': git(cwd, 'rev-parse', 'HEAD'), 'round': 1}
        print('RUN=' + p.name, flush=True)
        with lock(p / 'control.lock'):
            launch(p, meta, text)
        return 0
    p = run_dir(a.run)
    if a.action in {'resume', 'stop'}:
        with lock(p / 'control.lock'):
            meta, rd, state = snapshot(p)
            if a.action == 'stop':
                if state['state'] in TERMINAL:
                    print(json.dumps(state, ensure_ascii=False))
                    return 0
                dump(rd / 'cancel.json', {'requested_at': time.time()})
                print('CANCEL_REQUESTED; use wait/status, this is not a completed stop receipt')
                return 0
            if state['state'] != 'DONE':
                raise ValueError('Resume only a DONE round with a recorded session; failed/unknown runs require manual review')
            cwd, _ = target(meta['cwd'], meta['branch'])
            session = str(uuid.UUID(state['result']['session']))
            text = task_text(a.task)
            meta['round'] += 1
            meta.pop('worker', None)
            launch(p, meta, text, session)
            print('RUN=' + p.name)
            return 0
    until = time.monotonic() + (a.seconds if a.action == 'wait' else 0)
    while True:
        meta, rd, state = snapshot(p)
        if state['state'] in TERMINAL or time.monotonic() >= until:
            break
        time.sleep(.5)
    if a.action == 'verify':
        if state['state'] not in TERMINAL:
            raise ValueError('Cannot verify a running/finalizing round')
        cwd, _ = target(meta['cwd'], meta['branch'])
        state['git'] = {'base': meta['base'], 'head': git(cwd, 'rev-parse', 'HEAD'),
                        'status': git(cwd, 'status', '--short'),
                        'committed_diff': git(cwd, 'diff', '--stat', meta['base'], 'HEAD'),
                        'uncommitted_diff': git(cwd, 'diff', '--stat', 'HEAD')}
        state['meaning'] = 'DONE only means CLI turn completed; Git facts are not semantic acceptance or production authorization'
        dump(rd / 'verification.json', state)
        print(json.dumps(state, ensure_ascii=False, indent=2))
        last = rd / 'last.md'
        if last.exists() and last.stat().st_size <= MAX_TASK:
            print('\n--- Codex final reply (verbatim) ---\n' + last.read_text(encoding='utf-8'))
        elif last.exists():
            print('Final reply exceeds display bound; read: ' + str(last))
    else:
        print(json.dumps(state, ensure_ascii=False, indent=2))
    return 0 if state['state'] == 'DONE' else (3 if state['state'] not in TERMINAL else 1)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print('BRIDGE_ERROR: ' + str(error), file=sys.stderr)
        sys.exit(2)
