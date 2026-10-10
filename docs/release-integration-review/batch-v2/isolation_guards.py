"""Guards for the reviewed Python fixture graph, not an OS native-code sandbox."""
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl, unquote

TOOL_OPTIONS = {
    "customer-service-d1-authority-install.py": {"--source", "--sql", "--backup", "--receipt"},
    "customer-service-r2-retirement-evidence.py": {"--r2-root", "--output"},
}
def owned_path(value, root):
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    final = path.resolve()
    if final != root and root not in final.parents:
        raise RuntimeError("Fixture path escaped owned root")
    return final

def sqlite_target(database, root, uri=False):
    text = os.fsdecode(database)
    if text == ":memory:":
        return text
    if uri:
        url = urlsplit(text)
        if url.scheme != "file" or url.netloc or url.fragment:
            raise RuntimeError("Only exact local SQLite URI is allowed")
        pairs = parse_qsl(url.query, keep_blank_values=True, strict_parsing=True)
        if len({key for key, _ in pairs}) != len(pairs):
            raise RuntimeError("Ambiguous SQLite URI")
        query = dict(pairs)
        if set(query) - {"mode", "cache", "immutable"}:
            raise RuntimeError("Unknown SQLite URI parameter")
        if query.get("mode") == "memory":
            if url.path != "memorydb_default" or query != {"mode": "memory", "cache": "shared"}:
                raise RuntimeError("Only exact Django memory URI is allowed")
            return text
        if query.get("mode", "rwc") not in {"ro", "rw", "rwc"} or query.get("cache", "private") not in {"private", "shared"} or query.get("immutable", "0") not in {"0", "1"}:
            raise RuntimeError("Invalid SQLite URI parameters")
        text = unquote(url.path)
        if os.name == "nt" and len(text) > 3 and text[0] == "/" and text[2] == ":":
            text = text[1:]
    if not Path(text).is_absolute():
        raise RuntimeError("Non-memory SQLite filenames must be absolute")
    return owned_path(text, root)

def fixture_argv(args, root, executables):
    if not isinstance(args, (list, tuple)) or len(args) < 4:
        raise RuntimeError("Exact fixture argv required")
    if Path(args[0]).resolve() not in executables:
        raise RuntimeError("Unknown fixture executable")
    script = owned_path(args[1], root)
    if script.parent != root / "tools" or script.name not in TOOL_OPTIONS:
        raise RuntimeError("Unknown fixture tool")
    values = args[2:]
    if len(values) % 2:
        raise RuntimeError("Complete fixture named arguments required")
    pairs = list(zip(values[::2], values[1::2]))
    if len({key for key, _ in pairs}) != len(pairs) or {key for key, _ in pairs} != TOOL_OPTIONS[script.name]:
        raise RuntimeError("Fixture arguments changed")
    for _, value in pairs:
        owned_path(value, root)
    return script

def install(root, driver):
    import sqlite3
    import sqlite3.dbapi2
    import _sqlite3
    import socket
    import subprocess
    original_connect = sqlite3.connect
    original_class = sqlite3.Connection
    class OwnedConnection(original_class):
        def __init__(self, database, *args, **kwargs):
            sqlite_target(database, root, kwargs.get("uri", False))
            super().__init__(database, *args, **kwargs)
            self.set_authorizer(None)
        def set_authorizer(self, callback):
            def guard(action, first, second, db, trigger):
                if action == sqlite3.SQLITE_ATTACH:
                    try:
                        if not first: return sqlite3.SQLITE_DENY  # bound/unknown ATTACH target cannot be proved
                        sqlite_target(first, root, first.startswith("file:"))
                    except (RuntimeError, ValueError):
                        return sqlite3.SQLITE_DENY
                return callback(action, first, second, db, trigger) if callback else sqlite3.SQLITE_OK
            return super().set_authorizer(guard)
        def enable_load_extension(self, enabled):
            if enabled: raise RuntimeError("Native SQLite extensions denied")
            return super().enable_load_extension(False)
        def load_extension(self, *args, **kwargs):
            raise RuntimeError("Native SQLite extensions denied")
    def connect(database, *args, **kwargs):
        sqlite_target(database, root, kwargs.get("uri", False))
        if kwargs.get("factory", OwnedConnection) is not OwnedConnection:
            raise RuntimeError("Unknown SQLite connection factory")
        kwargs["factory"] = OwnedConnection
        return original_connect(database, *args, **kwargs)
    for module in (sqlite3, sqlite3.dbapi2, _sqlite3):
        module.connect = connect
        module.Connection = OwnedConnection
    def deny(*args, **kwargs):
        raise RuntimeError("Live socket/database interface denied by fixture driver")
    for name in ("connect", "connect_ex", "send", "sendall", "sendto", "sendmsg", "bind"):
        if hasattr(socket.socket, name): setattr(socket.socket, name, deny)
    for name in ("create_connection", "getaddrinfo", "gethostbyname", "gethostbyname_ex", "gethostbyaddr", "getnameinfo"):
        if hasattr(socket, name): setattr(socket, name, deny)
    try:
        import psycopg
        psycopg.connect = deny
        psycopg.Connection.connect = staticmethod(deny)
        psycopg.AsyncConnection.connect = staticmethod(deny)
    except ImportError:
        pass  # The two reviewed stdlib-only fixture tools may use base Python.
    original_popen = subprocess.Popen
    def popen(args, *position, **options):
        if options.get("shell") or options.get("env") is not None:
            raise RuntimeError("Fixture shell/env overrides denied")
        fixture_argv(args, root, {Path(sys.executable).resolve(), Path(sys._base_executable).resolve()})
        if options.get("cwd") is not None and Path(options["cwd"]).resolve() != root:
            raise RuntimeError("Fixture cwd escaped owned root")
        options["cwd"] = str(root)
        if os.name == "nt": options["creationflags"] = options.get("creationflags", 0) | subprocess.CREATE_NO_WINDOW
        guarded = [args[0], "-B", str(driver), str(root), "--fixture-tool", *args[1:]]
        return original_popen(guarded, *position, **options)
    subprocess.Popen = popen
