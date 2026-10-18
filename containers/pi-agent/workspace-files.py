"""Bounded workspace file operations using anchored no-follow descriptors."""
import base64
import hashlib
import json
import os
import stat
import sys
import uuid

LIMIT = 8 * 1024 * 1024
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def parts(path):
    if (not isinstance(path, str) or len(path.encode('utf-8')) > 1024 or path.startswith('/')
            or '\\' in path or ':' in path or any(ord(c) < 32 for c in path)):
        raise ValueError('unsafe_workspace_path')
    result = path.split('/')
    if not result or result[0] not in {'work', 'inputs', 'outputs'} or any(x in {'', '.', '..'} for x in result):
        raise ValueError('unsafe_workspace_path')
    return result


def parent(path):
    names = parts(path)
    fd = os.open('/workspace', FLAGS)
    try:
        for name in names[:-1]:
            next_fd = os.open(name, FLAGS, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd, names[-1]
    except BaseException:
        os.close(fd)
        raise


def read_at(fd, name):
    handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    try:
        before = os.fstat(handle)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > LIMIT:
            raise ValueError('unsafe_workspace_file')
        data = b''
        while len(data) <= LIMIT:
            chunk = os.read(handle, min(65536, LIMIT + 1 - len(data)))
            if not chunk:
                break
            data += chunk
        after = os.fstat(handle)
        if len(data) != before.st_size or (before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('workspace_file_changed')
        return data, hashlib.sha256(data).hexdigest()
    finally:
        os.close(handle)


def expected(fd, name, value):
    try:
        data, digest = read_at(fd, name)
    except FileNotFoundError:
        if value is None:
            return None
        raise ValueError('workspace_file_missing')
    if not isinstance(value, str) or value != digest:
        raise ValueError('workspace_sha_conflict')
    return digest


def main():
    raw = sys.stdin.buffer.read(12 * 1024 * 1024 + 1)
    if len(raw) > 12 * 1024 * 1024:
        raise ValueError('workspace_request_limit')
    request = json.loads(raw)
    action = request['action']
    path = request.get('path', 'work')
    fd, name = parent(path)
    try:
        if action == 'list':
            folder = os.open(name, FLAGS, dir_fd=fd)
            try:
                result = []
                for child in sorted(os.listdir(folder)):
                    info = os.stat(child, dir_fd=folder, follow_symlinks=False)
                    kind = 'directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) and info.st_nlink == 1 else 'blocked'
                    result.append({'path': path + '/' + child, 'name': child, 'kind': kind, 'sizeBytes': info.st_size})
                    if len(result) > 1000:
                        raise ValueError('workspace_listing_limit')
                return {'path': path, 'entries': result}
            finally:
                os.close(folder)
        if action == 'read':
            data, digest = read_at(fd, name)
            if request.get('expectedSha256') and request['expectedSha256'] != digest:
                raise ValueError('workspace_sha_conflict')
            return {'path': path, 'sha256': digest, 'sizeBytes': len(data), 'base64': base64.b64encode(data).decode('ascii')}
        if action == 'mkdir':
            if len(parts(path)) < 2:
                raise ValueError('workspace_root_protected')
            os.mkdir(name, mode=0o700, dir_fd=fd)
            return {'path': path, 'kind': 'directory'}
        if len(parts(path)) < 2:
            raise ValueError('workspace_root_protected')
        if action == 'write':
            data = base64.b64decode(request['base64'], validate=True)
            if len(data) > LIMIT or 'expectedSha256' not in request:
                raise ValueError('workspace_write_limit')
            expected(fd, name, request['expectedSha256'])
            temporary = '.pi-write-' + uuid.uuid4().hex
            output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            try:
                with os.fdopen(output, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                expected(fd, name, request['expectedSha256'])
                if request['expectedSha256'] is None:
                    # link is an atomic create-if-absent; never replace a new file.
                    os.link(temporary, name, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
                    os.unlink(temporary, dir_fd=fd)
                else:
                    os.replace(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
                os.fsync(fd)
            finally:
                try:
                    os.unlink(temporary, dir_fd=fd)
                except FileNotFoundError:
                    pass
            return {'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'sizeBytes': len(data)}
        if action in {'delete', 'rename'}:
            digest = expected(fd, name, request.get('expectedSha256'))
            if digest is None:
                raise ValueError('workspace_file_missing')
            if action == 'delete':
                os.unlink(name, dir_fd=fd)
                return {'path': path, 'deleted': True, 'sha256': digest}
            target_fd, target_name = parent(request['target'])
            try:
                if len(parts(request['target'])) < 2:
                    raise ValueError('workspace_root_protected')
                # link/unlink implements no-overwrite rename and rejects symlinks.
                os.link(name, target_name, src_dir_fd=fd, dst_dir_fd=target_fd, follow_symlinks=False)
                try:
                    # Both links now identify this same inode. Remove only source.
                    source = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    target = os.stat(target_name, dir_fd=target_fd, follow_symlinks=False)
                    if not stat.S_ISREG(target.st_mode) or source.st_ino != target.st_ino:
                        raise ValueError('workspace_file_changed')
                    os.unlink(name, dir_fd=fd)
                except BaseException:
                    os.unlink(target_name, dir_fd=target_fd)
                    raise
                return {'path': request['target'], 'sha256': digest}
            finally:
                os.close(target_fd)
        raise ValueError('workspace_file_action')
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except Exception as error:
        code = str(error)
        if not code.replace('_', '').isascii() or not code.replace('_', '').isalpha():
            code = 'workspace_file_rejected'
        print(json.dumps({'error': code}))
