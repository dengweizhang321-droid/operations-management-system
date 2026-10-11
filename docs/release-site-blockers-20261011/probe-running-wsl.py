"""Read process metadata only; diagnostic, never production admission."""
import os, json, hashlib, datetime

target = '/mnt/d/teruisi-runtime/django-sales/app.previous'
windows_target = 'd:\\teruisi-runtime\\django-sales\\app.previous'
errors, references, process_ids = [], [], []

def mentioned(value):
    # Literal and canonical /proc links only: not a proof of arbitrary aliases.
    text = value.replace('\\', '/').lower()
    return target in text or windows_target.replace('\\', '/') in text

def identity(pid):
    with open('/proc/' + pid + '/stat', 'r') as f:
        text = f.read(16384)
    # The process name may contain spaces and parentheses.
    return text[text.rfind(')') + 2:].split()[19]

def record(pid, kind, value):
    if mentioned(value):
        references.append({'processId': int(pid), 'kind': kind,
                           'sha256': hashlib.sha256(value.encode()).hexdigest()})

for pid in sorted((p for p in os.listdir('/proc') if p.isdecimal()), key=int):
    try:
        start = identity(pid)
        # Skip this known diagnostic itself; argv is python3 -, no embedded target.
        if int(pid) == os.getpid():
            continue
        process_ids.append(int(pid))
        for kind in ('cwd', 'exe', 'root'):
            try:
                value = os.readlink('/proc/' + pid + '/' + kind)
                record(pid, kind, value)
            except FileNotFoundError:
                if os.path.exists('/proc/' + pid):
                    # Kernel processes have no cwd/exe. Keep missing explicit.
                    errors.append({'processId': int(pid), 'kind': kind, 'error': 'missing'})
            except OSError as e:
                errors.append({'processId': int(pid), 'kind': kind, 'errno': e.errno})
        with open('/proc/' + pid + '/cmdline', 'rb') as f:
            raw = f.read(1048577)
        if len(raw) > 1048576:
            raise ValueError('command metadata exceeds bound')
        record(pid, 'cmdline', raw.decode('utf-8', 'strict').replace('\x00', ' '))
        with open('/proc/' + pid + '/mountinfo', 'r') as f:
            mount = f.read(1048577)
        if len(mount) > 1048576:
            raise ValueError('mount metadata exceeds bound')
        record(pid, 'mountinfo', mount)
        for fd in os.listdir('/proc/' + pid + '/fd'):
            try:
                record(pid, 'fd', os.readlink('/proc/' + pid + '/fd/' + fd))
            except FileNotFoundError:
                pass  # transient fd; never a complete handle-absence guarantee
            except OSError as e:
                errors.append({'processId': int(pid), 'kind': 'fd', 'errno': e.errno})
        if identity(pid) != start:
            errors.append({'processId': int(pid), 'kind': 'instance', 'error': 'changed'})
    except (OSError, ValueError, UnicodeError, IndexError) as e:
        errors.append({'processId': int(pid), 'kind': 'process', 'error': type(e).__name__,
                       'errno': getattr(e, 'errno', None)})

print(json.dumps({'version': 'running-wsl-reference-diagnostic-v1',
                  'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'processesObserved': len(process_ids), 'references': references,
                  'metadataErrors': errors, 'productionActions': 0,
                  'rawMetadataPersisted': False,
                  'scope': 'Only /proc metadata in an already-running distribution; no service lifecycle or business reads. Literal and proc-link checks do not prove arbitrary host aliases, all handles, or absence under concurrent change.'}))
