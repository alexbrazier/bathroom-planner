#!/usr/bin/env python3
"""Serve the bathroom designer locally with caching disabled, so code/data updates always load."""
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
print(f'Bathroom designer: http://localhost:{port}')
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
