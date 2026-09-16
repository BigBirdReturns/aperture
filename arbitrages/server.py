"""Loopback calculator; data-only requests, bounded search, no shell or upload."""
from __future__ import annotations
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from urllib.parse import urlsplit
from .model import Scenario, InputError, MAX_BYTES, strict_loads
from .planner import optimize
from .audit import audit_report
from .report import render


def handler_class(initial: Scenario):
    initial_report = optimize(initial, 64)
    audit_report(initial_report)
    page = render(initial_report, live=True).encode()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # No request or input-content telemetry.

        def _headers(self, status, kind, length):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(length))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            self.end_headers()

        def _json(self, status, value):
            body = json.dumps(value, allow_nan=False).encode()
            self._headers(status, "application/json; charset=utf-8", len(body))
            self.wfile.write(body)

        def _local(self):
            # DNS rebinding guard. Access using 127.0.0.1 or localhost only.
            host = self.headers.get("Host", "")
            allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if host not in allowed:
                self._json(403, {"error": "loopback Host required"}); return False
            origin = self.headers.get("Origin")
            if origin and origin not in {"http://" + h for h in allowed}:
                self._json(403, {"error": "same-origin request required"}); return False
            return True

        def do_GET(self):
            if not self._local(): return
            if self.path == "/":
                self._headers(200, "text/html; charset=utf-8", len(page)); self.wfile.write(page)
            elif self.path == "/health":
                self._json(200, {"ok": True, "mode": "local-data-only"})
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            # Consume bounded bodies before an early error response. Closing a
            # Windows socket with unread request bytes can reset the response.
            try:
                length = int(self.headers.get("Content-Length", "-1"))
                if not 0 <= length <= MAX_BYTES:
                    self._json(413, {"error": "invalid or oversized request"}); return
                self.connection.settimeout(10)
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise InputError("incomplete request")
                if not self._local(): return
                if self.path != "/api/plan":
                    self._json(404, {"error": "not found"}); return
                if self.headers.get_content_type() != "application/json":
                    self._json(415, {"error": "application/json required"}); return
                sc = Scenario.parse(strict_loads(raw.decode("utf-8")))
                if len(sc.stages) > 12 or len(sc.resources) > 8:
                    raise InputError("interactive limit: 12 stages and 8 resources; use CLI for larger inputs")
                report = optimize(sc, 32); audit_report(report)
                self._json(200, report)
            except (InputError, UnicodeError, ValueError, TimeoutError) as exc:
                self._json(400, {"error": str(exc)})

    return Handler


def serve(initial: Scenario, port: int = 8765):
    if not 1 <= port <= 65535:
        raise InputError("port must be in 1..65535")
    server = HTTPServer(("127.0.0.1", port), handler_class(initial))
    print(f"Arbitrages calculator: http://127.0.0.1:{port}", flush=True)
    print("Local data-only planning. No automatic cloud spend or workload execution.", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
