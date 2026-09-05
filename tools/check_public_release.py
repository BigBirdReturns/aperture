"""Verify deployed documentation and its pinned public package; never run inference."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
from html.parser import HTMLParser
from urllib.request import Request, urlopen

MAX_BYTES = 32 * 1024 * 1024
BASE_URL = "https://bigbirdreturns.github.io/aperture"
REPOSITORY = "https://github.com/BigBirdReturns/aperture"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def unpack_artifact(archive: Path, destination: Path) -> None:
    """Extract only bounded regular files from the reviewed Pages artifact."""
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive, "r:*") as bundle:
        members = bundle.getmembers()
        if len(members) > 512 or sum(m.size for m in members) > MAX_BYTES:
            raise ValueError("Pages artifact exceeds inspection limits")
        seen = set()
        for member in members:
            name = PurePosixPath(member.name)
            if (name.is_absolute() or ".." in name.parts or "\\" in member.name
                    or ":" in member.name or not (member.isfile() or member.isdir())):
                raise ValueError("Pages artifact contains an unsafe entry")
            if name.as_posix() in seen:
                raise ValueError("Pages artifact contains duplicate entries")
            seen.add(name.as_posix())
        for member in members:
            path = destination.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                stream = bundle.extractfile(member)
                if stream is None:
                    raise ValueError("Pages artifact file is unreadable")
                with path.open("xb") as output:
                    shutil.copyfileobj(stream, output)


def read_expected(folder: Path) -> dict[str, bytes]:
    files = {}
    for path in sorted(folder.rglob("*")):
        if path.is_symlink():
            raise ValueError("Expected site cannot contain symbolic links")
        if path.is_file() and path.name != ".nojekyll":
            files[path.relative_to(folder).as_posix()] = path.read_bytes()
    if not files or len(files) > 512 or sum(map(len, files.values())) > MAX_BYTES:
        raise ValueError("Expected site is empty or exceeds inspection limits")
    if not {"index.html", "release.json", "assets/social-preview.png"} <= files.keys():
        raise ValueError("Expected site is missing release or social metadata")
    return files


def validate_release(meta: dict) -> None:
    version = meta.get("version", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Invalid release version")
    url = f"{REPOSITORY}/releases/download/v{version}/bigbirdreturns-aperture-{version}.tgz"
    if (meta.get("base_url", "").rstrip("/") != BASE_URL
            or meta.get("repository") != REPOSITORY
            or meta.get("tag") != "v" + version or meta.get("package_url") != url):
        raise ValueError("Release coordinates do not agree with this project")
    if not re.fullmatch(r"[0-9a-f]{64}", meta.get("package_sha256", "")):
        raise ValueError("Release package requires an exact SHA-256")
    if not re.fullmatch(r"[0-9a-f]{40}", meta.get("release_commit", "")):
        raise ValueError("Release requires an exact source commit")
    size = meta.get("package_bytes")
    if type(size) is not int or not 0 < size <= MAX_BYTES:
        raise ValueError("Invalid release package size")


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = {}
        self.canonical = None

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta":
            self.tags[values.get("property", values.get("name"))] = values.get("content")
        if tag == "link" and values.get("rel") == "canonical":
            self.canonical = values.get("href")


def check_social(home: bytes) -> None:
    page = Metadata()
    page.feed(home.decode("utf-8"))
    expected = {"og:url": BASE_URL + "/", "og:image": BASE_URL + "/assets/social-preview.png",
                "og:image:width": "1200", "og:image:height": "630",
                "twitter:card": "summary_large_image",
                "twitter:image": BASE_URL + "/assets/social-preview.png"}
    if page.canonical != BASE_URL + "/" or any(page.tags.get(k) != v for k, v in expected.items()):
        raise ValueError("Published canonical or social card metadata does not match")
    if not page.tags.get("og:title") or not page.tags.get("og:description"):
        raise ValueError("Published social card lacks a title or description")


def fetch(url: str, limit: int, timeout: float = 20) -> bytes:
    request = Request(url, headers={"User-Agent": "Aperture-public-release-check",
                                   "Cache-Control": "no-cache", "Accept-Encoding": "identity"})
    with urlopen(request, timeout=timeout) as response:
        if response.status != 200 or not response.url.startswith("https://"):
            raise ValueError("Public resource did not return HTTPS 200")
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Public resource exceeded the expected byte limit")
    return data


def compare_live(files: dict[str, bytes], timeout: float = 180, reader=fetch) -> list[dict]:
    pending = dict(files)
    matches = {}
    failures = {}
    deadline = time.monotonic() + timeout
    while pending and time.monotonic() < deadline:
        for name, expected in list(pending.items()):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                url = BASE_URL + "/" + ("" if name == "index.html" else name)
                actual = reader(url, max(len(expected), 65536), timeout=min(20, remaining))
                if actual != expected:
                    raise ValueError("Public bytes differ from the reviewed artifact")
                matches[name] = {"file": name, "bytes": len(actual), "sha256": digest(actual)}
                del pending[name]
                failures.pop(name, None)
            except Exception as error:
                failures[name] = str(error)
        if pending and time.monotonic() < deadline:
            time.sleep(min(3, max(0, deadline - time.monotonic())))
    if pending:
        raise ValueError("Public files did not converge: " + json.dumps(failures, sort_keys=True))
    return [matches[name] for name in sorted(matches)]


def verify_package(meta: dict, output: Path, reader=fetch) -> dict:
    data = reader(meta["package_url"], meta["package_bytes"])
    if len(data) != meta["package_bytes"] or digest(data) != meta["package_sha256"]:
        raise ValueError("Public npm package does not match the release checksum")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as bundle:
        manifest = bundle.getmember("package/package.json")
        if not manifest.isfile() or manifest.size > 65536:
            raise ValueError("Invalid package manifest")
        package = json.load(bundle.extractfile(manifest))
    if (package.get("name") != "@bigbirdreturns/aperture"
            or package.get("version") != meta["version"]
            or package.get("bin", {}).get("aperture") != "bin/aperture.mjs"):
        raise ValueError("Public package identity differs from the release record")
    lifecycle = {"preinstall", "install", "postinstall", "prepare"}
    if lifecycle & package.get("scripts", {}).keys():
        raise ValueError("Unexpected installation lifecycle scripts")
    output.mkdir(parents=True, exist_ok=True)
    (output / "public-package.tgz").write_bytes(data)
    return {"url": meta["package_url"], "bytes": len(data), "sha256": digest(data)}


def verify_install(meta: dict, output: Path) -> dict:
    executable = shutil.which("npx.cmd" if os.name == "nt" else "npx")
    if executable is None:
        raise ValueError("Node.js with npx is required for the public-install check")
    with tempfile.TemporaryDirectory(prefix="aperture-public-install-") as temporary:
        folder = Path(temporary)
        empty = folder / "empty-npmrc"
        empty.write_text("", encoding="utf-8")
        env = {k: v for k, v in os.environ.items()
               if k.lower() not in {"npm_config_cache", "npm_config_userconfig", "npm_config_globalconfig"}}
        env.update({"npm_config_cache": str(folder / "cache"), "npm_config_userconfig": str(empty),
                    "npm_config_globalconfig": str(folder / "global-npmrc"),
                    "npm_config_ignore_scripts": "true", "npm_config_update_notifier": "false",
                    "APERTURE_HOME": str(folder / "home")})
        args = [executable, "--yes", "--package=" + meta["package_url"], "aperture", "--version"]
        result = subprocess.run(args, cwd=folder, env=env, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=180)
        (output / "install.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        if result.returncode or result.stdout.strip() != meta["version"]:
            raise ValueError("Fresh-cache public command failed or reported the wrong version")
        if (folder / "home").exists():
            raise ValueError("Version check unexpectedly created Aperture runtime state")
    return {"version": result.stdout.strip(), "exit_code": result.returncode,
            "fresh_cache": True, "lifecycle_scripts_disabled": True,
            "native_inference_performed": False, "runtime_home_created": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--site", type=Path)
    source.add_argument("--artifact", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--install", action="store_true", help="Run the public command with --version")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    report = {"schema": "aperture-public-release-check/1", "status": "FAILED",
              "native_inference_performed": False,
              "checked_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "workflow_commit": os.getenv("GITHUB_SHA")}
    try:
        folder = args.site
        if args.artifact:
            folder = args.out / "expected"
            unpack_artifact(args.artifact, folder)
        files = read_expected(folder)
        meta = json.loads(files["release.json"])
        validate_release(meta)
        check_social(files["index.html"])
        report.update({"site": BASE_URL + "/", "version": meta["version"],
                       "release_commit": meta["release_commit"]})
        report["files"] = compare_live(files)
        report["package"] = verify_package(meta, args.out)
        report["installation"] = verify_install(meta, args.out) if args.install else {"status": "NOT_RUN"}
        report["status"] = "PASSED"
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    (args.out / "public-release-check.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return int(report["status"] != "PASSED")


if __name__ == "__main__":
    raise SystemExit(main())
