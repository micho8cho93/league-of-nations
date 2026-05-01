import functools
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = '/Users/Michel/Desktop/league-of-nations'
Handler = functools.partial(SimpleHTTPRequestHandler, directory=ROOT)
HTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
