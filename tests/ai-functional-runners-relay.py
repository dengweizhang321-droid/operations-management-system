"""Bounded TCP byte relay from Windows loopback to the private WSL loopback."""
import json
import os
from pathlib import Path
import shutil
import socket
import socketserver
import subprocess
import threading
import time


DISTRO = "Codex-AI-Batch2-20261108"
ROOT = Path("D:/codex-isolated/native-control-ai-functional-runners-20261108")
PORTS = (28121, 28123)
CLIENT = """
import os,select,socket,sys
assert os.getuid()==1000 and os.environ.get("WSL_DISTRO_NAME")=="Codex-AI-Batch2-20261108"
port=int(sys.argv[1])
assert port in (28121,28123)
with socket.create_connection(("127.0.0.1",port),timeout=45) as sock:
    inputs=[0,sock]
    while True:
        ready,_,_=select.select(inputs,[],[],65)
        if not ready:raise TimeoutError()
        for stream in ready:
            if stream==0:
                raw=os.read(0,65536)
                if raw:sock.sendall(raw)
                else:
                    sock.shutdown(socket.SHUT_WR)
                    inputs.remove(0)
            else:
                raw=sock.recv(65536)
                if not raw:raise SystemExit(0)
                data=memoryview(raw)
                while data:data=data[os.write(1,data):]
"""


class RelayHandler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(65)
        if not self.server.slots.acquire(blocking=False):
            return
        try:
            self.relay()
        finally:
            self.server.slots.release()

    def relay(self):
        wsl = shutil.which("wsl.exe")
        assert wsl
        env = {key: os.environ[key] for key in ("SystemRoot", "SystemDrive", "PATH", "TEMP", "TMP") if key in os.environ}
        command = [wsl, "-d", DISTRO, "-u", "teruisi-pandas", "--exec", "/usr/bin/python3", "-I", "-B",
                   "-c", CLIENT, str(self.server.server_address[1])]
        with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, bufsize=0, env=env) as process:
            def input_copy():
                try:
                    while raw := self.request.recv(65536):
                        data = memoryview(raw)
                        while data:
                            data = data[process.stdin.write(data):]
                except OSError:
                    pass
                finally:
                    process.stdin.close()

            reader = threading.Thread(target=input_copy, daemon=True)
            reader.start()
            try:
                while raw := process.stdout.read(65536):
                    self.request.sendall(raw)
                process.wait(timeout=3)
            finally:
                try:
                    self.request.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                reader.join(3)
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=3)


class Relay(socketserver.ThreadingTCPServer):
    daemon_threads = True
    slots = threading.BoundedSemaphore(8)

    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


if __name__ == "__main__":
    stop = ROOT / "relay.stop"
    assert (ROOT / "isolation.json").is_file() and not stop.exists()
    keepalive = [shutil.which("wsl.exe"), "-d", DISTRO, "-u", "teruisi-pandas", "--exec", "/usr/bin/timeout",
                 "3600", "/usr/bin/python3", "-I", "-B", "-c",
                 "import os,sys; assert os.environ.get('WSL_DISTRO_NAME')=='Codex-AI-Batch2-20261108'; "
                 "print('held',flush=True); sys.stdin.read()"]
    with subprocess.Popen(keepalive, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as hold, \
            Relay(("127.0.0.1", PORTS[0]), RelayHandler) as first, Relay(("127.0.0.1", PORTS[1]), RelayHandler) as second:
        assert hold.stdout.readline() == b"held\n"
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (first, second)]
        for thread in threads:
            thread.start()
        print(json.dumps({"bound": PORTS, "pid": os.getpid(), "endToEndHmac": True}), flush=True)
        deadline = time.monotonic() + 3600
        try:
            while not stop.is_file() and time.monotonic() < deadline:
                assert hold.poll() is None
                time.sleep(0.25)
        finally:
            for server in (first, second):
                server.shutdown()
            hold.stdin.close()
            hold.wait(timeout=8)
        print(json.dumps({"stopped": PORTS, "requested": stop.is_file()}), flush=True)
