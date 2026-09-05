"""Offline checks binding the reviewed package, site, notes, and publisher coordinates."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/BigBirdReturns/aperture"


class ReleaseCoordinateTests(unittest.TestCase):
    def load(self, name):
        return json.loads((ROOT / name).read_text(encoding="utf-8"))

    def test_reviewed_coordinates_agree(self):
        package = self.load("package.json")
        publish = self.load("release/publish.json")
        site = self.load("docs/site.json")
        version_source = (ROOT / "lib/version.mjs").read_text(encoding="utf-8")
        match = re.search(r"VERSION\s*=\s*'([^']+)'", version_source)
        self.assertIsNotNone(match)
        version = package["version"]
        self.assertEqual(version, "0.4.5")
        self.assertEqual(match.group(1), version)
        self.assertEqual(publish["version"], version)
        self.assertEqual(site["version"], version)
        self.assertEqual(site["tag"], "v" + version)
        self.assertEqual(site["release_commit"], publish["packageSourceCommit"])
        self.assertEqual(site["package_sha256"], publish["expectedPackageSHA256"])
        self.assertEqual(site["package_bytes"], publish["expectedPackageBytes"])
        expected_url = f"{REPOSITORY}/releases/download/v{version}/bigbirdreturns-aperture-{version}.tgz"
        self.assertEqual(site["package_url"], expected_url)
        self.assertTrue(site["redacted_support_receipt"])
        self.assertRegex(publish["packageSourceCommit"], r"^[0-9a-f]{40}$")
        self.assertRegex(publish["expectedPackageSHA256"], r"^[0-9a-f]{64}$")
        self.assertGreater(publish["expectedPackageBytes"], 0)

    def test_release_notes_and_current_commands_are_bound(self):
        publish = self.load("release/publish.json")
        notes = ROOT / publish["notes"]
        self.assertTrue(notes.is_file())
        note_text = notes.read_text(encoding="utf-8")
        self.assertIn("Aperture 0.4.5", note_text)
        self.assertIn("aperture support", note_text)
        self.assertIn("not anonymous", note_text)
        package_url = self.load("docs/site.json")["package_url"]
        for name in ("README.md", "docs/pages/quickstart.md", "docs/pages/reference.md"):
            text = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn(package_url, text, name)
            self.assertNotIn("releases/download/v0.4.4/bigbirdreturns-aperture-0.4.4.tgz", text, name)
        verification = (ROOT / "VERIFICATION.md").read_text(encoding="utf-8")
        self.assertIn("162 source/control cases", verification)
        self.assertIn(publish["expectedPackageSHA256"], verification)

    def test_publication_workflow_is_manifest_gated(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        for required in (
            "release/publish.json",
            "expectedPackageSHA256",
            "expectedPackageBytes",
            "cmp ",
            "git ls-remote --exit-code --tags",
            "gh release create",
            "gh workflow run docs.yml --ref main",
        ):
            self.assertIn(required, workflow)


if __name__ == "__main__":
    unittest.main()
