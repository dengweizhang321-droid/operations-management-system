"""Serve the comparison design demo only, on loopback, without a business backend."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
CSP = (
    "default-src 'none'; script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'none'; object-src 'none'; "
    "frame-src 'none'; base-uri 'none'; form-action 'none'; "
    "frame-ancestors 'self'"
)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._read(False)

    def do_HEAD(self):
        self._read(True)

    def _read(self, head):
        if self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
            self.send_error(403)
            return
        path = unquote(urlsplit(self.path).path)
        name = 'index.html' if path == '/' else path.removeprefix('/')
        file = (ROOT / name).resolve()
        if not file.is_relative_to(ROOT) or file.suffix not in ('.html', '.css', '.js') or not file.is_file():
            self.send_error(404)
            return
        if file.suffix == '.html' and file.name != 'index.html':
            self.send_error(404)
            return
        mime = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript'}[file.suffix]
        data = file.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', f'{mime}; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if not head:
            self.wfile.write(data)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=3170)
    args = parser.parse_args()
    if not 3100 <= args.port <= 3900:
        parser.error('Preview port must be in 3100..3900')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Comparison synthetic design preview: http://127.0.0.1:{args.port}/', flush=True)
    server.serve_forever()
