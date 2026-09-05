"""Offline contract tests. These do not substitute for the deployed-site job."""
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from check_public_release import (
    BASE_URL, REPOSITORY, check_social, compare_live, digest, read_expected,
    unpack_artifact, validate_release, verify_install, verify_package,
)


def package_bytes(version="1.2.3", extra=None):
    manifest = {"name": "@bigbirdreturns/aperture", "version": version,
                "bin": {"aperture": "bin/aperture.mjs"}, "scripts": {"test": "node --test"}}
    manifest.update(extra or {})
    data = json.dumps(manifest).encode()
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as bundle:
        member = tarfile.TarInfo("package/package.json")
        member.size = len(data)
        bundle.addfile(member, io.BytesIO(data))
    return stream.getvalue()


def metadata(data=None):
    data = package_bytes() if data is None else data
    return {"version": "1.2.3", "tag": "v1.2.3", "repository": REPOSITORY,
            "base_url": BASE_URL, "release_commit": "a" * 40,
            "package_url": REPOSITORY + "/releases/download/v1.2.3/bigbirdreturns-aperture-1.2.3.tgz",
            "package_sha256": digest(data), "package_bytes": len(data)}


def social():
    values = {"og:url": BASE_URL + "/", "og:image": BASE_URL + "/assets/social-preview.png",
              "og:image:width": "1200", "og:image:height": "630", "og:title": "Aperture",
              "og:description": "Local model setup", "twitter:card": "summary_large_image",
              "twitter:image": BASE_URL + "/assets/social-preview.png"}
    return (f'<link rel="canonical" href="{BASE_URL}/">' + "".join(
        f'<meta property="{k}" content="{v}">' for k, v in values.items())).encode()


class PublicReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_valid_release(self):
        validate_release(metadata())

    def test_release_mismatch_and_unbound_inputs_fail(self):
        for key, value in [("version", "../other"), ("tag", "v0.0.0"),
                           ("package_url", "https://example.com/a.tgz"),
                           ("package_sha256", "missing"), ("release_commit", "main"),
                           ("package_bytes", True), ("package_bytes", 0),
                           ("repository", "https://example.com"), ("base_url", "http://localhost")]:
            with self.subTest(key=key, value=value):
                meta = metadata(); meta[key] = value
                with self.assertRaises(ValueError):
                    validate_release(meta)

    def test_social_card(self):
        check_social(social())

    def test_wrong_social_image_fails(self):
        with self.assertRaises(ValueError):
            check_social(social().replace(b"social-preview.png", b"old.png"))

    def test_wrong_canonical_fails(self):
        with self.assertRaises(ValueError):
            check_social(social().replace(b'rel="canonical"', b'rel="alternate"'))

    def test_matching_live_files(self):
        files = {"index.html": b"home", "release.json": b"{}"}
        replies = {BASE_URL + "/": b"home", BASE_URL + "/release.json": b"{}"}
        result = compare_live(files, reader=lambda url, limit, timeout: replies[url])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["sha256"], digest(b"home"))

    def test_mismatched_live_file_never_passes(self):
        with self.assertRaisesRegex(ValueError, "did not converge"):
            compare_live({"index.html": b"expected"}, timeout=.02,
                         reader=lambda url, limit, timeout: b"old")

    def test_transient_failure_retried(self):
        replies = [OSError("temporary"), b"home"]
        def reader(url, limit, timeout):
            value = replies.pop(0)
            if isinstance(value, Exception):
                raise value
            return value
        with patch("check_public_release.time.sleep"):
            result = compare_live({"index.html": b"home"}, reader=reader)
        self.assertEqual(len(result), 1)
        self.assertEqual(replies, [])

    def test_package_integrity_and_identity(self):
        data = package_bytes()
        result = verify_package(metadata(data), self.root, reader=lambda *a: data)
        self.assertEqual(result["sha256"], digest(data))
        self.assertEqual((self.root / "public-package.tgz").read_bytes(), data)

    def test_changed_package_rejected_before_write(self):
        with self.assertRaisesRegex(ValueError, "checksum"):
            verify_package(metadata(), self.root, reader=lambda *a: b"bad")
        self.assertFalse((self.root / "public-package.tgz").exists())

    def test_wrong_package_version_rejected(self):
        data = package_bytes("9.9.9")
        with self.assertRaisesRegex(ValueError, "identity"):
            verify_package(metadata(data), self.root, reader=lambda *a: data)

    def test_lifecycle_scripts_rejected(self):
        data = package_bytes(extra={"scripts": {"postinstall": "unexpected"}})
        with self.assertRaisesRegex(ValueError, "lifecycle"):
            verify_package(metadata(data), self.root, reader=lambda *a: data)

    def write_tar(self, name="index.html", member_type=tarfile.REGTYPE):
        archive = self.root / "artifact.tar"
        with tarfile.open(archive, "w") as bundle:
            member = tarfile.TarInfo(name)
            member.type = member_type
            member.linkname = "outside" if member_type != tarfile.REGTYPE else ""
            member.size = 4 if member_type == tarfile.REGTYPE else 0
            bundle.addfile(member, io.BytesIO(b"home") if member.size else None)
        return archive

    def test_artifact_regular_file(self):
        unpack_artifact(self.write_tar("./index.html"), self.root / "expected")
        self.assertEqual((self.root / "expected/index.html").read_bytes(), b"home")

    def test_artifact_unsafe_entries(self):
        for index, (name, kind) in enumerate([("../outside", tarfile.REGTYPE),
                ("/outside", tarfile.REGTYPE), ("C:/outside", tarfile.REGTYPE),
                ("a\\outside", tarfile.REGTYPE), ("linked", tarfile.SYMTYPE),
                ("hardlink", tarfile.LNKTYPE)]):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    unpack_artifact(self.write_tar(name, kind), self.root / str(index))

    def test_missing_expected_files(self):
        with self.assertRaises(ValueError):
            read_expected(self.root)

    def test_fresh_install_is_version_only(self):
        seen = {}
        def run(args, **kwargs):
            seen.update(kwargs); seen["args"] = args
            self.assertFalse(Path(kwargs["env"]["npm_config_cache"]).exists())
            self.assertEqual(kwargs["env"]["npm_config_ignore_scripts"], "true")
            self.assertEqual(args[-2:], ["aperture", "--version"])
            return type("Result", (), {"returncode": 0, "stdout": "1.2.3\n", "stderr": ""})()
        with patch("check_public_release.shutil.which", return_value="npx"), \
                patch("check_public_release.subprocess.run", side_effect=run):
            result = verify_install(metadata(), self.root)
        self.assertTrue(result["fresh_cache"])
        self.assertFalse(result["native_inference_performed"])
        self.assertFalse(Path(seen["cwd"]).exists())

    def test_wrong_installed_version_fails(self):
        result = type("Result", (), {"returncode": 0, "stdout": "0.0.0\n", "stderr": ""})()
        with patch("check_public_release.shutil.which", return_value="npx"), \
                patch("check_public_release.subprocess.run", return_value=result):
            with self.assertRaises(ValueError):
                verify_install(metadata(), self.root)

    def test_version_command_must_not_create_runtime_state(self):
        def run(args, **kwargs):
            Path(kwargs["env"]["APERTURE_HOME"]).mkdir()
            return type("Result", (), {"returncode": 0, "stdout": "1.2.3\n", "stderr": ""})()
        with patch("check_public_release.shutil.which", return_value="npx"), \
                patch("check_public_release.subprocess.run", side_effect=run):
            with self.assertRaisesRegex(ValueError, "runtime state"):
                verify_install(metadata(), self.root)

    def test_incomplete_release_reports_field(self):
        for field in ("version", "tag", "base_url", "repository", "package_url",
                      "package_sha256", "release_commit"):
            with self.subTest(field=field):
                meta = metadata(); meta[field] = None
                with self.assertRaisesRegex(ValueError, "incomplete: " + field):
                    validate_release(meta)
        with self.assertRaises(ValueError):
            validate_release(None)

    def test_preflight_does_not_compare_future_pages_to_old_site(self):
        from contextlib import redirect_stdout
        from check_public_release import main
        source = self.root / "site"; source.mkdir()
        (source / "assets").mkdir()
        (source / "assets/social-preview.png").write_bytes(b"fixture")
        (source / "index.html").write_bytes(social())
        (source / "release.json").write_text(json.dumps(metadata()), encoding="utf-8")
        output = self.root / "result"
        arguments = ["check", "--site", str(source), "--out", str(output), "--preflight"]
        with patch("sys.argv", arguments), patch("check_public_release.compare_live") as live, \
                patch("check_public_release.verify_package", return_value={"verified": True}) as package, \
                patch("check_public_release.verify_install") as install, redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 0)
        live.assert_not_called(); install.assert_not_called(); package.assert_called_once()
        report = json.loads((output / "public-release-check.json").read_text())
        self.assertEqual(report["phase"], "BEFORE_DEPLOYMENT")
        self.assertFalse(report["live_site_checked"])
        self.assertEqual(report["status"], "PASSED")

    def test_incomplete_preflight_stops_before_network(self):
        from contextlib import redirect_stdout
        from check_public_release import main
        source = self.root / "site"; source.mkdir()
        (source / "assets").mkdir()
        (source / "assets/social-preview.png").write_bytes(b"fixture")
        (source / "index.html").write_bytes(social())
        meta = metadata(); meta["package_sha256"] = None
        (source / "release.json").write_text(json.dumps(meta), encoding="utf-8")
        output = self.root / "result"
        arguments = ["check", "--site", str(source), "--out", str(output), "--preflight"]
        with patch("sys.argv", arguments), patch("check_public_release.compare_live") as live, \
                patch("check_public_release.verify_package") as package, redirect_stdout(io.StringIO()):
            self.assertEqual(main(), 1)
        live.assert_not_called(); package.assert_not_called()
        report = json.loads((output / "public-release-check.json").read_text())
        self.assertIn("incomplete: package_sha256", report["error"])
        self.assertEqual(report["status"], "FAILED")


if __name__ == "__main__":
    unittest.main()
