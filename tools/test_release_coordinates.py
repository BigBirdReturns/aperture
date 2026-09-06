"""Offline checks binding the reviewed package, site, notes, receipt, and publisher coordinates."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/BigBirdReturns/aperture"
PACKAGE_SOURCE_COMMIT = "86e0bfbe4defeff06b521fa0508c1a2c58466713"
PACKAGE_SHA256 = "4e614815b7ce0453081b493d800bd1d5aa2f2e4e6f68f5c3886376ea88723ee7"
RTX6KPRO_COMMIT = "3023e7c2e572cd445cd62234607aaf765121da58"


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
        self.assertEqual(version, "0.4.7")
        self.assertEqual(match.group(1), version)
        self.assertEqual(publish["version"], version)
        self.assertEqual(site["version"], version)
        self.assertEqual(site["tag"], "v" + version)
        self.assertEqual(site["release_commit"], publish["packageSourceCommit"])
        self.assertEqual(site["package_sha256"], publish["expectedPackageSHA256"])
        self.assertEqual(site["package_bytes"], publish["expectedPackageBytes"])
        self.assertEqual(publish["packageSourceCommit"], PACKAGE_SOURCE_COMMIT)
        self.assertEqual(publish["expectedPackageSHA256"], PACKAGE_SHA256)
        expected_url = f"{REPOSITORY}/releases/download/v{version}/bigbirdreturns-aperture-{version}.tgz"
        self.assertEqual(site["package_url"], expected_url)
        self.assertTrue(site["native_prefit_before_download"])
        self.assertTrue(site["redacted_support_receipt"])
        self.assertTrue(site["managed_cache_reuse_without_transfer_permission"])
        self.assertTrue(site["recipe_lab_source_pinned"])
        self.assertIn(RTX6KPRO_COMMIT, site["recipe_lab_first_source"])
        self.assertRegex(publish["packageSourceCommit"], r"^[0-9a-f]{40}$")
        self.assertRegex(publish["expectedPackageSHA256"], r"^[0-9a-f]{64}$")
        self.assertGreater(publish["expectedPackageBytes"], 0)

    def test_release_notes_and_current_commands_are_bound(self):
        publish = self.load("release/publish.json")
        notes = ROOT / publish["notes"]
        self.assertTrue(notes.is_file())
        note_text = notes.read_text(encoding="utf-8")
        self.assertIn("Aperture 0.4.7", note_text)
        self.assertIn("Recipe Lab", note_text)
        self.assertIn(RTX6KPRO_COMMIT, note_text)
        self.assertIn(publish["expectedPackageSHA256"], note_text)
        package_url = self.load("docs/site.json")["package_url"]
        old_url = "releases/download/v0.4.6/bigbirdreturns-aperture-0.4.6.tgz"
        for name in (
            "README.md",
            "docs/pages/quickstart.md",
            "docs/pages/reference.md",
            "docs/pages/experiments.md",
        ):
            text = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn(package_url, text, name)
            self.assertNotIn(old_url, text, name)
        recipes = (ROOT / "docs/pages/recipes.md").read_text(encoding="utf-8")
        self.assertIn("aperture recipes --allow-scan", recipes)
        self.assertIn(RTX6KPRO_COMMIT, recipes)
        support = (ROOT / "docs/pages/support.md").read_text(encoding="utf-8")
        self.assertIn("169 source/control tests", support)
        self.assertIn("windows-cache-reuse-20260905.json", support)
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn("## 0.4.7", changelog)

    def test_cache_reuse_receipt_remains_bound_to_its_0_4_6_release(self):
        receipt = self.load("verification/windows-cache-reuse-20260905.json")
        self.assertEqual(receipt["schema"], "aperture-native-cache-reuse/1")
        self.assertEqual(
            receipt["candidate"]["releasePackageSourceCommit"],
            "cfbc8222f932e43a6d4397cbc2ce4f1cb8131d97",
        )
        self.assertEqual(receipt["model"]["format"], "GGUF")
        self.assertEqual(receipt["model"]["sha256"], "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db")
        self.assertFalse(receipt["managedCache"]["modelHostRequestDuringResume"])
        self.assertFalse(receipt["managedCache"]["weightTransferDuringResume"])
        self.assertTrue(receipt["managedCache"]["completeIntegrityHashRepeated"])
        self.assertTrue(receipt["managedCache"]["nativeFitRepeatedBeforeLoad"])
        self.assertEqual(receipt["execution"]["exitCode"], 0)
        self.assertEqual(receipt["execution"]["observedGpuLayers"], 25)
        self.assertEqual(receipt["controls"]["sourceControlTestsPassed"], 169)
        self.assertFalse(receipt["privacy"]["localPathsIncluded"])
        self.assertFalse(receipt["privacy"]["gpuUuidsIncluded"])
        self.assertFalse(receipt["privacy"]["hostOrUserNameIncluded"])
        self.assertFalse(receipt["privacy"]["modelWeightsIncluded"])
        self.assertFalse(receipt["privacy"]["privateRunRecordIncluded"])
        serialized = json.dumps(receipt).lower()
        for forbidden in ("c:\\", "/home/", "\\\\users\\\\", '"gpu-'):
            self.assertNotIn(forbidden, serialized)

    def test_recipe_source_is_pinned_and_nonexecuting(self):
        catalog = (ROOT / "lib/recipe-catalog.mjs").read_text(encoding="utf-8")
        resolver = (ROOT / "lib/recipes.mjs").read_text(encoding="utf-8")
        cli = (ROOT / "bin/aperture.mjs").read_text(encoding="utf-8")
        self.assertIn(RTX6KPRO_COMMIT, catalog)
        self.assertIn("FACTS_AND_MEASUREMENTS_ONLY", catalog)
        self.assertIn("execution: 'NOT_RUN'", resolver)
        self.assertIn("modelAccess: false", resolver)
        self.assertIn("download: false", resolver)
        self.assertIn("install: false", resolver)
        self.assertIn("run: false", resolver)
        self.assertIn("'recipes'", cli)

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
