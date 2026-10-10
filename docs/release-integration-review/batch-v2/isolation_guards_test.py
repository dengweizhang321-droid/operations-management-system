import unittest
import sys
import sqlite3
import sqlite3.dbapi2
import _sqlite3
import socket
import subprocess
from pathlib import Path
from isolation_guards import install, sqlite_target, fixture_argv

ROOT = (Path(__file__).resolve().parents[3] / '.runtime/owner-acceptance').resolve()
DRIVER = Path(__file__).with_name('owner-isolated-tests.py')
install(ROOT, DRIVER)
class GuardTests(unittest.TestCase):
    def test_exact_memory_uri_and_private_read_uri(self):
        sqlite_target('file:memorydb_default?mode=memory&cache=shared', ROOT, True)
        sqlite_target('file:'+str(ROOT/'fixture.sqlite3').replace('\\','/')+'?mode=ro', ROOT, True)
        for value in ['file:memory-other?mode=memory&cache=shared', 'file:memorydb_default?mode=ro&mode=memory&cache=shared',
                      'file:memorydb_default?mode=memory&cache=shared&x=1', 'file://remote/any?mode=ro', 'file:../outside.sqlite3?mode=ro']:
            with self.assertRaises((RuntimeError, ValueError)): sqlite_target(value, ROOT, True)
    def test_all_sqlite_aliases_and_connection_constructor(self):
        outside=ROOT.parent/'forbidden-guard-probe.sqlite3'
        self.assertFalse(outside.exists())
        for module in (sqlite3, sqlite3.dbapi2, _sqlite3):
            with self.assertRaises(RuntimeError): module.connect(str(outside))
            with self.assertRaises(RuntimeError): module.Connection(str(outside))
        self.assertFalse(outside.exists())
    def test_relative_sqlite_paths_cannot_follow_a_different_cwd(self):
        self.assertNotEqual(Path.cwd().resolve(), ROOT)
        for value in ('relative-guard-probe.sqlite3','file:relative-guard-probe.sqlite3?mode=rwc'):
            with self.assertRaises(RuntimeError): sqlite3.connect(value,uri=value.startswith('file:'))
        self.assertFalse((Path.cwd()/'relative-guard-probe.sqlite3').exists())
    def test_attach_and_native_extensions_do_not_escape(self):
        conn=sqlite3.connect(':memory:')
        try:
            target=ROOT.parent/'attach-forbidden-v2.sqlite3'
            self.assertFalse(target.exists())
            with self.assertRaises(sqlite3.DatabaseError): conn.execute('ATTACH DATABASE ? AS escaped',(str(target),))
            with self.assertRaises(RuntimeError): conn.enable_load_extension(True)
            self.assertFalse(target.exists())
        finally: conn.close()
    def test_subprocess_paths_options_cwd_env_and_shell(self):
        args=[sys.executable,str(ROOT/'tools/customer-service-r2-retirement-evidence.py'),'--r2-root',str(ROOT/'temp'),'--output',str(ROOT/'temp/result.json')]
        fixture_argv(args,ROOT,{Path(sys.executable).resolve()})
        bad=list(args);bad[-1]='../outside.json'
        with self.assertRaises(RuntimeError): fixture_argv(bad,ROOT,{Path(sys.executable).resolve()})
        for patch in ({'cwd':ROOT.parent},{'env':{}},{'shell':True}):
            with self.assertRaises(RuntimeError): subprocess.Popen(args,**patch)
        with self.assertRaises(RuntimeError): subprocess.Popen('python arbitrary.py')
    def test_socket_udp_dns_and_known_psycopg_interfaces_denied(self):
        with self.assertRaises(RuntimeError): socket.getaddrinfo('fixture.invalid',80)
        sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        try:
            with self.assertRaises(RuntimeError): sock.sendto(b'fixture',('127.0.0.1',1))
        finally: sock.close()
        import psycopg
        for connect in (psycopg.connect,psycopg.Connection.connect,psycopg.AsyncConnection.connect):
            with self.assertRaises(RuntimeError): connect('postgresql://fixture')
if __name__ == '__main__': unittest.main(verbosity=2)
