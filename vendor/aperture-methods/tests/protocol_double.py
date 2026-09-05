#!/usr/bin/env python3
"""TEST DOUBLE ONLY. No weights are read; no model computation or inference occurs."""
import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

FLAGS = "--model --host --port --ctx-size --parallel --cache-type-k --cache-type-v --n-gpu-layers --device --split-mode --no-context-shift --slots --api-key-file --alias --batch-size --ubatch-size --threads --fit --fit-target --load-mode --no-mmproj --no-op-offload"
if "--help" in sys.argv:
    print(FLAGS)
    raise SystemExit(0)
if "--version" in sys.argv:
    print("TEST_DOUBLE_NO_MODEL_COMPUTATION")
    raise SystemExit(0)
if "--list-devices" in sys.argv:
    print("CUDA0: TEST DEVICE NOT REAL")
    raise SystemExit(0)
p = argparse.ArgumentParser()
for flag in FLAGS.split():
    if flag in ("--no-context-shift", "--slots", "--no-mmproj", "--no-op-offload"):
        p.add_argument(flag, action="store_true")
    else:
        p.add_argument(flag)
a = p.parse_args()
key = Path(a.api_key_file).read_text()
per_context = int(a.ctx_size) // int(a.parallel)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *unused):
        pass
    def reply(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer " + key:
            return self.reply({"error": "unauthorized"}, 401)
        if self.path == "/health":
            return self.reply({"status": "ok"})
        if self.path == "/props":
            return self.reply({"model_path": a.model, "total_slots": int(a.parallel), "build_info": "TEST_DOUBLE_NO_INFERENCE"})
        if self.path == "/slots":
            return self.reply([{"id": i, "n_ctx": per_context} for i in range(int(a.parallel))])
        if self.path == "/v1/models":
            return self.reply({"data": [{"id": a.alias}]})
        self.reply({}, 404)
    def do_POST(self):
        if self.headers.get("Authorization") != "Bearer " + key:
            return self.reply({}, 401)
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/tokenize":
            return self.reply({"tokens": list(body["content"].encode())})
        if self.path == "/apply-template":
            return self.reply({"prompt": body["messages"][0]["content"]})
        if self.path == "/completion":
            return self.reply({"content": "PROTOCOL_TEST_NOT_MODEL_OUTPUT", "tokens_predicted": 1, "tokens": [42],
                               "truncated": False, "timings": {"predicted_ms": 1}})
        self.reply({}, 404)

HTTPServer((a.host, int(a.port)), Handler).serve_forever()
