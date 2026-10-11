"""Pinned proposed guard collector: /proc metadata only; output stays in pipe."""
import os, json, hashlib

MAX = 1048576
errors, processes, namespaces = [], [], {}
self_pid = os.getpid()

def read(path, binary=False):
    with open(path, 'rb' if binary else 'r') as stream:
        value = stream.read(MAX + 1)
    if len(value) > MAX:
        raise ValueError('metadata size bound')
    return value

def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()

def stat_metadata(pid):
    fields = read('/proc/%s/stat' % pid).rsplit(')', 1)[1].split()
    return fields[19], int(fields[6])

def start(pid):
    return stat_metadata(pid)[0]

def links(base, flags):
    result = {}
    for name in ('cwd', 'exe', 'root'):
        try:
            result[name] = os.readlink(base + '/' + name)
        except FileNotFoundError:
            if not flags & 0x00200000:
                raise
            result[name] = None
    return result

def epoch():
    return {'bootId': read('/proc/sys/kernel/random/boot_id').strip(),
            'btime': next(line.split()[1] for line in read('/proc/stat').splitlines() if line.startswith('btime ')),
            'pid1Start': start(1), 'osrelease': read('/proc/sys/kernel/osrelease').strip()}

def ids():
    values = sorted(int(x) for x in os.listdir('/proc') if x.isdecimal() and int(x) != self_pid)
    if len(values) > 512:
        raise ValueError('process count bound')
    return values

def fd_links(base):
    fds = sorted(os.listdir(base + '/fd'))
    if len(fds) > 4096:
        raise ValueError('fd count bound')
    return {fd: os.readlink(base + '/fd/' + fd) for fd in fds}

before = epoch()
pids_before = ids()
for pid in pids_before:
    try:
        base = '/proc/%s' % pid
        birth, flags = stat_metadata(pid)
        ns = os.readlink(base + '/ns/mnt')
        mounts = read(base + '/mountinfo')
        if ns in namespaces and namespaces[ns] != mounts:
            raise ValueError('mount namespace changed')
        namespaces[ns] = mounts
        initial_links = links(base, flags)
        args = read(base + '/cmdline', True).decode('utf-8', 'strict').split('\0')
        fds = fd_links(base)
        after_links = links(base, flags)
        after_args = read(base + '/cmdline', True).decode('utf-8', 'strict').split('\0')
        after_fds = fd_links(base)
        final_start, final_flags = stat_metadata(pid)
        final_ns = os.readlink(base + '/ns/mnt')
        final_mounts = read(base + '/mountinfo')
        processes.append({'pid': pid, 'startBefore': birth, 'startAfter': final_start,
                          'flagsBefore': flags, 'flagsAfter': final_flags,
                          'namespaceBefore': ns, 'namespaceAfter': final_ns,
                          'mountSha256Before': sha(mounts), 'mountSha256After': sha(final_mounts),
                          'linksBefore': initial_links, 'linksAfter': after_links,
                          'argvBefore': args, 'argvAfter': after_args,
                          'fdsBefore': fds, 'fdsAfter': after_fds})
    except (OSError, ValueError, UnicodeError, IndexError) as error:
        errors.append({'pid': pid, 'error': type(error).__name__, 'errno': getattr(error, 'errno', None)})
result = {'version': 'teruisi-live-wsl-metadata-v1', 'before': before, 'after': epoch(),
          'pidInventoryBefore': pids_before, 'pidInventoryAfter': ids(),
          'selfPid': self_pid, 'processes': processes,
          'namespaces': [{'identity': ns, 'mountinfo': value} for ns, value in namespaces.items()],
          'errors': errors}
print(json.dumps(result, ensure_ascii=True))
