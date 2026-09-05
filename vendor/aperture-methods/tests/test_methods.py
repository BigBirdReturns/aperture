from __future__ import annotations

import json
import os
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from aperture_methods.__main__ import parser
from aperture_methods.artifacts import gguf_metadata, gguf_artifact, hf_artifact, safe_relative
from aperture_methods.common import MethodError, size, fingerprint, verify_fingerprint, bind_method, read_method, write_json, canonical_hash
from aperture_methods.configure import configure, choose_gpu, base_request
from aperture_methods.execute import execute, check_readback, fresh_headroom, terminate_owned
from aperture_methods.experiment import variant, export_summary, experiment
from aperture_methods.fetch import validate_name, fetch
from aperture_methods.probe import probe

ROOT = Path(__file__).resolve().parent.parent
DOUBLE = ROOT / "tests" / "protocol_double.py"


def gguf(path, metadata=None, version=3):
    metadata = {"general.architecture": "llama", "llama.context_length": 8192, **(metadata or {})}
    body = b"GGUF" + struct.pack("<IQQ", version, 0, len(metadata))
    for key, value in metadata.items():
        encoded = key.encode()
        body += struct.pack("<Q", len(encoded)) + encoded
        if isinstance(value, str):
            encoded = value.encode()
            body += struct.pack("<IQ", 8, len(encoded)) + encoded
        else:
            body += struct.pack("<II", 4, value)
    path.write_bytes(body + b"TEST_FIXTURE_NOT_MODEL_WEIGHTS")


def hf(root, dtype="F32", file="model.safetensors"):
    (root / "config.json").write_text(json.dumps({"model_type": "llama", "max_position_embeddings": 8192}))
    header = json.dumps({"weight": {"dtype": dtype, "shape": [2], "data_offsets": [0, 8]}}).encode()
    (root / file).write_bytes(struct.pack("<Q", len(header)) + header + b"\x00" * 8)


class Isolated(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def candidate(self, parallel=1):
        model = self.root / "fixture.gguf"
        if not model.exists():
            gguf(model)
        args = parser().parse_args(["configure", "--model", str(model), "--runtime", str(DOUBLE), "--gpu", "cpu",
                                    "--ram", "256MiB", "--reserve", "64MiB", "--parallel", str(parallel), "--out", str(self.root / "method.json")])
        doc = configure(args)
        write_json(self.root / "method.json", doc)
        return doc


class BasicTests(Isolated):
    def test_binary_sizes(self):
        for value, result in [("1GiB", 1024**3), ("1GB", 1000**3), ("0.5MiB", 524288), ("16", 16)]:
            self.assertEqual(size(value), result)
    def test_invalid_sizes(self):
        for v in ["-1GiB", "nan", "inf", "0", "one", "1PB", "1e99"]:
            with self.subTest(v=v), self.assertRaises(MethodError): size(v)
    def test_fingerprint_detects_change(self):
        p = self.root / "x"; p.write_bytes(b"abc"); f = fingerprint(p); p.write_bytes(b"def")
        with self.assertRaises(MethodError): verify_fingerprint(f)
    def test_fingerprint_passes_unchanged(self):
        p = self.root / "x"; p.write_bytes(b"abc"); verify_fingerprint(fingerprint(p))
    def test_exclusive_write(self):
        p = self.root / "x"; write_json(p, {})
        with self.assertRaises(FileExistsError): write_json(p, {"overwrite": True})
    def test_method_checksum(self):
        p = self.root / "method.json"; doc = bind_method({"format": "aperture-method/1", "backend": "llama.cpp"}); write_json(p, doc)
        self.assertEqual(read_method(p)["backend"], "llama.cpp")
    def test_modified_method_rejected(self):
        p = self.root / "method.json"; doc = bind_method({"format": "aperture-method/1", "backend": "llama.cpp"}); doc["backend"] = "x"; write_json(p, doc)
        with self.assertRaises(MethodError): read_method(p)
    def test_private_file_mode(self):
        p = self.root / "private"; write_json(p, {}, private=True)
        if os.name != "nt": self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
    def test_probe_non_mutating_surface(self):
        result = probe(self.root)
        self.assertIn("available_bytes", result["ram"])
        self.assertNotIn("hostname", result["system"])
        self.assertNotIn("username", result["system"])
    def test_probe_unknown_gpu_not_no_gpu(self):
        with patch("shutil.which", return_value=None):
            self.assertEqual(probe(self.root)["nvidia"]["status"], "NOT_DISCOVERED")
    def test_cli_requires_subcommand(self):
        self.assertIn("configure", parser().format_help())
    def test_fetch_path_traversal(self):
        for name in ["../model", "/model", "C:\\model", "a/../../b", "a\\b"]:
            with self.subTest(name=name), self.assertRaises(MethodError): validate_name(name)
    def test_fetch_valid_relative_name(self):
        self.assertEqual(validate_name("model-00001-of-00002.safetensors"), "model-00001-of-00002.safetensors")


class ArtifactTests(Isolated):
    def test_gguf_metadata(self):
        p = self.root / "a.gguf"; gguf(p)
        self.assertEqual(gguf_metadata(p)["metadata"]["llama.context_length"], 8192)
    def test_gguf_v2(self):
        p = self.root / "a.gguf"; gguf(p, version=2)
        self.assertEqual(gguf_metadata(p)["tensor_count"], 0)
    def test_invalid_gguf_magic(self):
        p = self.root / "a.gguf"; p.write_bytes(b"NOPE" + b"\0" * 100)
        with self.assertRaises(MethodError): gguf_metadata(p)
    def test_truncated_gguf(self):
        p = self.root / "a.gguf"; p.write_bytes(b"GGUF")
        with self.assertRaises(MethodError): gguf_metadata(p)
    def test_gguf_large_count(self):
        p = self.root / "a.gguf"; p.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 1_000_000))
        with self.assertRaises(MethodError): gguf_metadata(p)
    def test_gguf_single_content_hash(self):
        p = self.root / "a.gguf"; gguf(p); result = gguf_artifact(p)
        self.assertEqual(result["checkpoint_bytes"], p.stat().st_size)
    def test_split_set_complete(self):
        for i in range(2): gguf(self.root / f"x-{i+1:05d}-of-00002.gguf", {"split.no": i, "split.count": 2})
        result = gguf_artifact(self.root / "x-00001-of-00002.gguf")
        self.assertEqual(len(result["files"]), 2)
    def test_split_missing(self):
        p = self.root / "x-00001-of-00002.gguf"; gguf(p, {"split.no": 0, "split.count": 2})
        with self.assertRaises(MethodError): gguf_artifact(p)
    def test_split_wrong_entrypoint(self):
        p = self.root / "x-00002-of-00002.gguf"; gguf(p, {"split.no": 1, "split.count": 2})
        with self.assertRaises(MethodError): gguf_artifact(p)
    def test_split_wrong_number(self):
        for i in range(2): gguf(self.root / f"x-{i+1:05d}-of-00002.gguf", {"split.no": 0, "split.count": 2})
        with self.assertRaises(MethodError): gguf_artifact(self.root / "x-00001-of-00002.gguf")
    def test_hf_header_and_float_identity(self):
        hf(self.root); result = hf_artifact(self.root)
        self.assertEqual(result["floating_dtypes"], ["F32"])
        self.assertEqual(result["tensor_payload_bytes"], 8)
    def test_hf_quantized_not_silently_changed(self):
        hf(self.root); (self.root / "config.json").write_text('{"quantization_config":{"kind":"test"}}')
        with self.assertRaises(MethodError): hf_artifact(self.root)
    def test_hf_missing_index(self):
        hf(self.root); (self.root / "second.safetensors").write_bytes((self.root / "model.safetensors").read_bytes())
        with self.assertRaises(MethodError): hf_artifact(self.root)
    def test_hf_index_traversal(self):
        hf(self.root); (self.root / "model.safetensors.index.json").write_text('{"weight_map":{"weight":"../other.safetensors"}}')
        with self.assertRaises(MethodError): hf_artifact(self.root)
    def test_hf_index_mismatch(self):
        hf(self.root); (self.root / "model.safetensors.index.json").write_text('{"weight_map":{"wrong":"model.safetensors"}}')
        with self.assertRaises(MethodError): hf_artifact(self.root)
    def test_hf_truncated_header(self):
        hf(self.root); (self.root / "model.safetensors").write_bytes(struct.pack("<Q", 999999))
        with self.assertRaises(MethodError): hf_artifact(self.root)
    def test_hf_nonstandard_single_file_requires_adapter(self):
        hf(self.root, file="other.safetensors")
        with self.assertRaisesRegex(MethodError, "expects model.safetensors"): hf_artifact(self.root)
    def test_hf_nonstandard_index_requires_adapter(self):
        hf(self.root)
        (self.root / "other.safetensors.index.json").write_text('{"weight_map":{"weight":"model.safetensors"}}')
        with self.assertRaisesRegex(MethodError, "standard model.safetensors.index.json"): hf_artifact(self.root)
    def test_hf_safe_relative_valid(self):
        p = self.root / "x"; p.write_text("x"); self.assertEqual(safe_relative(self.root, "x"), p)


@unittest.skipIf(os.name == "nt", "Unix executable protocol double; real Windows native executable remains untested")
class ControlTests(Isolated):
    def test_cpu_candidate_no_vram_gate(self):
        doc = self.candidate()
        self.assertFalse(doc["placement"]["checkpoint_must_fit_vram"])
        self.assertEqual(doc["runtime_claims"]["model_inference"], "NOT_EXECUTED")
    def test_explanation_preserves_target_and_candidate_boundary(self):
        from aperture_methods.explain import explain
        self.candidate()
        text = explain(self.root/"method.json")
        self.assertIn("fixture.gguf", text)
        self.assertIn("4096 tokens per sequence", text)
        self.assertIn("candidate method", text)
        self.assertIn("not changed", text)
    def test_fixed_context_and_slots(self):
        doc = self.candidate(parallel=2); argv = doc["runtime"]["arguments"]
        self.assertEqual(argv[argv.index("--ctx-size")+1], "8192")
        self.assertEqual(argv[argv.index("--parallel")+1], "2")
        self.assertIn("--no-context-shift", argv)
    def test_native_no_automatic_quantization(self):
        doc = self.candidate(); argv = doc["runtime"]["arguments"]
        self.assertNotIn("--hf-repo", argv)
        self.assertEqual(argv[argv.index("--model")+1], str(self.root / "fixture.gguf"))
    def test_readback_success(self):
        doc = self.candidate(); alias = "aperture-" + doc["artifact"]["content_sha256"][:16]
        result = check_readback(doc, {"total_slots":1,"model_path":doc["artifact"]["entrypoint"]}, [{"n_ctx":4096}], {"data":[{"id":alias}]})
        self.assertEqual(result["slots"], 1)
    def test_readback_short_context(self):
        doc = self.candidate()
        with self.assertRaisesRegex(MethodError, "context"):
            check_readback(doc, {"total_slots":1}, [{"n_ctx":2048}], {})
    def test_readback_missing_context(self):
        doc = self.candidate()
        with self.assertRaises(MethodError): check_readback(doc, {"total_slots":1}, [{}], {})
    def test_readback_concurrency_change(self):
        doc = self.candidate()
        with self.assertRaises(MethodError): check_readback(doc, {"total_slots":2}, [{"n_ctx":4096}], {})
    def test_readback_wrong_model(self):
        doc = self.candidate()
        with self.assertRaises(MethodError): check_readback(doc, {"total_slots":1,"model_path":"wrong"}, [{"n_ctx":4096}], {})
    def test_readback_wrong_alias(self):
        doc = self.candidate()
        with self.assertRaises(MethodError): check_readback(doc, {"total_slots":1,"model_path":doc["artifact"]["entrypoint"]}, [{"n_ctx":4096}], {"data":[{"id":"wrong"}]})
    def test_protocol_lifecycle_only_not_inference(self):
        self.candidate()
        result = execute(self.root/"method.json", self.root/"run", prompt="Test", tokens=4, seconds=20, event_output=False)
        self.assertEqual(result["status"], "COMPLETED")
        raw = json.loads((self.root/"run/result.json").read_text())
        self.assertEqual(raw["text"], "PROTOCOL_TEST_NOT_MODEL_OUTPUT")
    def test_context_overflow_stops(self):
        self.candidate()
        result = execute(self.root/"method.json", self.root/"run", prompt="x"*4096, tokens=4, seconds=20, event_output=False)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["reason"], "CONTEXT_OVERFLOW")
    def test_artifact_drift_stops_before_start(self):
        self.candidate(); (self.root/"fixture.gguf").write_bytes(b"changed")
        result = execute(self.root/"method.json", self.root/"run", prompt="Test", tokens=4, seconds=20, event_output=False)
        self.assertEqual(result["reason"], "ARTIFACT_CHANGED")
        self.assertFalse((self.root/"run/server.log").exists())
    def test_time_budget_stops_worker(self):
        self.candidate()
        result = execute(self.root/"method.json", self.root/"run", prompt="Test", tokens=4, seconds=.001, event_output=False)
        self.assertEqual(result["status"], "TIME_BUDGET_EXCEEDED")
    def test_existing_run_directory_not_overwritten(self):
        self.candidate(); (self.root/"run").mkdir()
        with self.assertRaises(FileExistsError): execute(self.root/"method.json", self.root/"run", prompt="Test", tokens=4, seconds=20)
    def test_serve_duration_is_bounded(self):
        self.candidate()
        result = execute(self.root/"method.json", self.root/"serve", prompt="", tokens=1, seconds=2, serve=True, event_output=False)
        self.assertEqual(result["status"], "SERVE_BUDGET_COMPLETE")
    def test_variant_keeps_artifact_and_context(self):
        doc = self.candidate(); other = variant(doc, 0)
        self.assertEqual(other["artifact"], doc["artifact"])
        self.assertEqual(other["request"]["context_per_sequence"], doc["request"]["context_per_sequence"])
    def test_cpu_method_rejects_nonzero_gpu_variant(self):
        doc = self.candidate()
        with self.assertRaises(MethodError): variant(doc, 1)
    def test_missing_experiment_consent(self):
        self.candidate()
        args=SimpleNamespace(method=str(self.root/"method.json"), acknowledge=False)
        with self.assertRaises(MethodError): experiment(args)
    def test_experiment_full_protocol_path(self):
        self.candidate()
        args=SimpleNamespace(method=str(self.root/"method.json"), acknowledge=True, repeats=2, seconds=30, tokens=8,
                             gpu_layers=None,out=str(self.root/"experiment"),chat=False)
        result=experiment(args)
        self.assertEqual(result["completed_trials"],2)
        self.assertEqual(result["results"][1]["comparison_to_first_completed_run"],"MATCH")
    def test_export_excludes_private_data(self):
        self.candidate(); execute(self.root/"method.json",self.root/"run",prompt="MY_PRIVATE_PROMPT",tokens=4,seconds=20,event_output=False)
        result=export_summary(self.root/"run/run.json",self.root/"share.json")
        text=json.dumps(result)
        for value in ["MY_PRIVATE_PROMPT","PROTOCOL_TEST_NOT_MODEL_OUTPUT",str(self.root),"api-key", "prompt_token"]:
            self.assertNotIn(value,text)
    def test_missing_hf_concurrency_adapter(self):
        hf(self.root)
        args=parser().parse_args(["configure","--model",str(self.root),"--gpu","cpu","--parallel","2","--out",str(self.root/"method.json")])
        with self.assertRaisesRegex(MethodError,"one sequence"): configure(args)


class FetchBoundaryTests(Isolated):
    def run_fetch(self, names, *, allow=False, limit="1GiB", filename=None, sha="a"*40):
        siblings = [SimpleNamespace(rfilename=n, size=b, lfs=None) for n,b in names.items()]
        fake_api = SimpleNamespace(model_info=lambda *a, **k: SimpleNamespace(sha=sha, siblings=siblings))
        def no_download(*a, **k):
            raise AssertionError("No file download was expected")
        fake_module = SimpleNamespace(HfApi=lambda: fake_api, hf_hub_download=no_download)
        args = SimpleNamespace(repo="fixture/model", revision="main", directory=str(self.root/"model"),
                               filename=filename, allow_download=allow, max_download=limit)
        with patch.dict(sys.modules, {"huggingface_hub":fake_module}):
            return fetch(args)
    def test_sharded_preview_writes_no_files(self):
        result=self.run_fetch({"config.json":100,"model.safetensors.index.json":200})
        self.assertEqual(result["status"],"PREVIEW_REQUIRES_INDEX_METADATA")
        self.assertFalse((self.root/"model").exists())
    def test_single_preview_writes_no_files(self):
        result=self.run_fetch({"config.json":100,"model.safetensors":500})
        self.assertEqual(result["status"],"PREVIEW_ONLY")
        self.assertEqual(result["download_bytes"],600)
        self.assertFalse((self.root/"model").exists())
    def test_download_ceiling_applies_before_bytes(self):
        with self.assertRaisesRegex(MethodError,"above"):
            self.run_fetch({"config.json":100,"model.safetensors":500},allow=True,limit="200B")
    def test_immutable_revision_required(self):
        with self.assertRaisesRegex(MethodError,"immutable"):
            self.run_fetch({"config.json":100,"model.safetensors":500},sha="main")


@unittest.skipIf(os.name == "nt", "POSIX process-group cleanup; Windows Job Object containment is not implemented")
class CleanupTests(Isolated):
    def test_child_is_stopped_after_group_leader_exits(self):
        import time
        import psutil
        script = "import subprocess,sys; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(p.pid,flush=True)"
        proc=subprocess.Popen([sys.executable,"-c",script],stdout=subprocess.PIPE,text=True,start_new_session=True)
        child_pid=int(proc.stdout.readline())
        child=psutil.Process(child_pid)
        proc.wait(timeout=5)
        try:
            terminate_owned(proc)
            for _ in range(20):
                if not child.is_running() or child.status()==psutil.STATUS_ZOMBIE: break
                time.sleep(.05)
            self.assertTrue(not child.is_running() or child.status()==psutil.STATUS_ZOMBIE)
        finally:
            try:
                if child.is_running(): child.kill()
            except psutil.Error:
                pass
            proc.stdout.close()


class DeviceSelectionTests(unittest.TestCase):
    def profile(self):
        return {"nvidia":{"devices":[{"index":0,"uuid":"GPU-a","name":"RTX","free_bytes":123,"requires_external_capacity_qualification":False},
                                      {"index":1,"uuid":"GPU-b","name":"CMP","free_bytes":999,"requires_external_capacity_qualification":True}]}}
    def test_cmp_not_auto_admitted(self): self.assertEqual(choose_gpu(self.profile(),"auto")["uuid"],"GPU-a")
    def test_cmp_explicit_holds(self):
        with self.assertRaises(MethodError): choose_gpu(self.profile(),"1")
    def test_uuid_resolution(self): self.assertEqual(choose_gpu(self.profile(),"GPU-a")["index"],0)
    def test_cpu_is_explicit(self): self.assertIsNone(choose_gpu(self.profile(),"cpu"))
    def test_absent_gpu_is_not_substituted(self):
        with self.assertRaises(MethodError): choose_gpu(self.profile(),"GPU-missing")


if __name__ == "__main__": unittest.main()
