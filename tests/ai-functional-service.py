"""Private real WSGI service, with an audit-level exact endpoint allowlist."""
import os, sys
from ai_functional_environment import environment, network_guard
private_env=environment()
os.environ.clear();os.environ.update(private_env)
network_guard()
from django.core.wsgi import get_wsgi_application
from wsgiref.simple_server import make_server,WSGIServer
from socketserver import ThreadingMixIn
class PrivateServer(ThreadingMixIn,WSGIServer):
    daemon_threads=True
port=int(sys.argv[1])
assert port in (28444,28447)
make_server('127.0.0.1',port,get_wsgi_application(),server_class=PrivateServer).serve_forever()
