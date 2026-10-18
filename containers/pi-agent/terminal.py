"""Fixed JSONL bridge to a real Linux PTY. Never reads host configuration."""
import base64
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def main():
    init = json.loads(sys.stdin.buffer.readline(16385))
    if set(init) != {'cols', 'rows'}:
        raise ValueError('terminal_init_required')
    master, slave = pty.openpty()
    def resize(cols, rows):
        if type(cols) is not int or type(rows) is not int or not 2 <= cols <= 500 or not 2 <= rows <= 300:
            raise ValueError('terminal_size')
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    resize(init['cols'], init['rows'])
    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        for fd in (0, 1, 2):
            os.dup2(slave, fd)
        if slave > 2:
            os.close(slave)
        os.chdir('/workspace/work')
        os.execve('/bin/bash', ['bash', '--noprofile', '--norc', '-i'], {
            'PATH': '/workspace/venv/bin:/usr/local/bin:/usr/bin:/bin',
            'HOME': '/workspace/home', 'LANG': 'C.UTF-8', 'TERM': 'xterm-256color',
            'TMPDIR': '/tmp', 'PS1': '\\w $ ', 'PYTHONUTF8': '1',
        })
    os.close(slave)
    emit({'type': 'ready'})
    pending = b''
    try:
        while True:
            ready, _, _ = select.select([master, 0], [], [], .2)
            if master in ready:
                try:
                    data = os.read(master, 16384)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    data = b''
                if not data:
                    break
                emit({'type': 'output', 'base64': base64.b64encode(data).decode('ascii')})
            if 0 in ready:
                data = os.read(0, 65536)
                if not data:
                    break
                pending += data
                if len(pending) > 131072:
                    raise ValueError('terminal_record_limit')
                while b'\n' in pending:
                    raw, pending = pending.split(b'\n', 1)
                    command = json.loads(raw)
                    if command['type'] == 'input':
                        data = base64.b64decode(command['base64'], validate=True)
                        if len(data) > 32768:
                            raise ValueError('terminal_input_limit')
                        while data:
                            size = os.write(master, data)
                            data = data[size:]
                        emit({'type': 'ack', 'id': command['id']})
                    elif command['type'] == 'resize':
                        resize(command['cols'], command['rows'])
                        emit({'type': 'ack', 'id': command['id']})
                    elif command['type'] == 'close':
                        return
                    else:
                        raise ValueError('terminal_command')
            child, status = os.waitpid(pid, os.WNOHANG)
            if child:
                emit({'type': 'exit', 'exitCode': os.waitstatus_to_exitcode(status)})
                return
    finally:
        os.close(master)
        try:
            os.killpg(pid, signal.SIGHUP)
        except ProcessLookupError:
            pass


if __name__ == '__main__':
    main()
