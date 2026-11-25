#!/usr/bin/env python3
"""Serve v2 for development, with one rule python -m http.server does not have.

A browser will happily keep app.js and style.css from an hour ago and show a
half-old screen after a change, which looks exactly like a bug in the app. So
every answer here says: do not cache. Production is a static host with its own
caching; this file only exists for the machine the app is written on.

    python3 serve.py 8099            # 0.0.0.0:8099
    python3 serve.py 8099 127.0.0.1  # only this machine
"""

import sys
import os
import json
import urllib.parse
import urllib.request
import urllib.error
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Same job as functions/api/chat.js in production: model APIs do not send
# CORS headers, so the browser refuses their answer. This forwards from the
# server, where CORS does not exist. Keep the two allowlists in step.
ALLOWED = {
    'api.openai.com', 'openrouter.ai', 'api.groq.com', 'api.mistral.ai',
    'api.together.xyz', 'api.deepseek.com', 'api.fireworks.ai',
    'api.perplexity.ai', 'api.cerebras.ai', 'api.sambanova.ai',
    'api.novita.ai', 'api.hyperbolic.xyz', 'integrate.api.nvidia.com',
    'api.x.ai', 'generativelanguage.googleapis.com',
    'models.inference.ai.azure.com',
    # the suite's own vp door, so a vp key works in local development too
    'api.terg.hr',
}
ALLOWED_SUFFIX = ('openai.azure.com',)

# The other door: api.terg.hr/fetch, matching functions/fetch.js. Legal sources
# only — eur-lex and narodne-novine send HTML and no CORS headers, so a page
# cannot read them. Keep this list in step with the function's.
SOURCES = [
    'eur-lex.europa.eu', 'narodne-novine.nn.hr', 'zakon.hr',
    'data.gov.hr', 'www.hzinfra.hr', 'www.azop.hr',
]
FETCH_MAX = 3 * 1024 * 1024
FETCH_TIMEOUT = 15


def html_to_text(html):
    import re
    s = str(html or '')
    s = re.sub(r'<!--[\s\S]*?-->', ' ', s)
    s = re.sub(r'<(script|style|noscript|svg|head)\b[\s\S]*?</\1>', ' ', s, flags=re.I)
    s = re.sub(r'</(p|div|section|article|li|tr|h[1-6]|blockquote|table|header|footer)>', '\n', s, flags=re.I)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'<li\b[^>]*>', '· ', s, flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    for a, b in (('&nbsp;', ' '), ('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                 ('&quot;', '"'), ('&#39;', "'")):
        s = s.replace(a, b)
    s = re.sub(r'&(?:#\d+|#x[0-9a-f]+);', ' ', s, flags=re.I)
    s = s.replace('\r', '')
    s = re.sub(r'[ \t\u00a0]+', ' ', s)
    s = re.sub(r' *\n *', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def source_allowed(host):
    h = (host or '').lower()
    return any(h == src or h.endswith('.' + src) for src in SOURCES)


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

    # ── the proxy, matching functions/api/chat.js ──────────────────────
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('X-Vpl-Proxy', '1')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path.split('?')[0] == '/api/fetch':
            return self._fetch()
        if self.path.split('?')[0] != '/api/chat':
            self.send_error(404, 'not a post office')
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        except Exception:
            return self._json({'error': 'send json'}, 400)

        url = str(body.get('url') or '')
        key = body.get('key') or ''
        if not url.lower().startswith('https://'):
            return self._json({'error': 'only https endpoints'}, 400)
        if not key:
            return self._json({'error': 'no key'}, 400)
        if not body.get('messages'):
            return self._json({'error': 'no messages'}, 400)

        host = urllib.parse.urlparse(url).hostname or ''
        ok = host in ALLOWED or any(host == s or host.endswith('.' + s) for s in ALLOWED_SUFFIX)
        if not ok:
            return self._json({'error': 'this app will not forward to %s' % host}, 403)

        payload = {k: body[k] for k in ('model', 'messages', 'max_tokens', 'temperature') if k in body}
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + key,
                'Origin': self.headers.get('Origin', ''),
                # Cloudflare in front of api.terg.hr refuses python's default
                # agent (error 1010), which would make local dev lie about a
                # door that works in production
                'User-Agent': 'vpl-dev/1.0',
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                status = r.status
                ctype = r.headers.get('Content-Type') or 'application/json'
        except urllib.error.HTTPError as e:
            raw = e.read()
            status = e.code
            ctype = e.headers.get('Content-Type') or 'application/json'
        except Exception as e:
            return self._json({'error': 'could not reach %s: %s' % (host, e)}, 502)

        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('X-Vpl-Proxy', '1')
        self.end_headers()
        self.wfile.write(raw)

    # ── the fetch door, matching functions/api/fetch.js ────────────────
    def _fetch(self):
        origin = self.headers.get('Origin') or ''
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        except Exception:
            return self._json({'error': 'send json'}, 400)
        raw = str(body.get('url') or '').strip()
        if not raw:
            return self._json({'error': 'no url'}, 400)
        u = urllib.parse.urlparse(raw)
        if u.scheme != 'https':
            return self._json({'error': 'only https'}, 400)
        if not source_allowed(u.hostname):
            return self._json({'error': 'that source is not on the list — download the pdf and drop it here',
                               'source': False}, 422)
        req = urllib.request.Request(raw, headers={
            'User-Agent': 'vpl-vc/1.0 (compliance check; +https://terg.hr)',
            'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
            'Accept-Language': 'hr,en;q=0.8',
            'Origin': origin,
        })
        try:
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
                final = urllib.parse.urlparse(r.geturl())
                if not source_allowed(final.hostname):
                    return self._json({'error': 'it redirected somewhere that is not on the list'}, 422)
                ctype = (r.headers.get('Content-Type') or '').lower()
                if 'pdf' in ctype:
                    return self._json({'error': 'that is a pdf — download it and drop it into the library instead',
                                       'isPdf': True, 'url': r.geturl()}, 422)
                data = r.read(FETCH_MAX + 1)
                if len(data) > FETCH_MAX:
                    return self._json({'error': 'larger than 3 MB — take the part you need'}, 413)
                html = data.decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            return self._json({'error': 'the source answered %d' % e.code}, 502)
        except Exception:
            return self._json({'error': 'could not reach it'}, 502)
        text = html_to_text(html)
        if len(text) < 40:
            return self._json({'error': 'the page answered, but there was no readable text in it'}, 422)
        import re
        m = re.search(r'<title[^>]*>([\s\S]*?)</title>', html, flags=re.I)
        return self._json({'url': final.geturl(), 'title': html_to_text(m.group(1)) if m else '',
                           'text': text, 'chars': len(text)})

    def _json(self, body, status=200):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('X-Vpl-Proxy', '1')
        self.end_headers()
        self.wfile.write(raw)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    host = sys.argv[2] if len(sys.argv) > 2 else '0.0.0.0'
    # third argument: the folder to serve. Defaults to this file's folder, so
    # `python3 serve.py 8099` still works on its own.
    root = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(os.path.abspath(__file__))
    handler = partial(NoCache, directory=root)
    srv = ThreadingHTTPServer((host, port), handler)
    print('serving %s on http://%s:%d/' % (root, host, port), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
