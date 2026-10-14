import re
import unittest

from planner_store import ROOT


class NamingTests(unittest.TestCase):
    def test_image_and_repository_names_are_consistent(self):
        compose = (ROOT / "compose.yaml").read_text()
        workflow = (ROOT / ".github/workflows/container.yaml").read_text()
        manifest = (ROOT / "hiveforge.yaml").read_text()
        image = re.search(r"^\s+image: (\S+)$", compose, re.MULTILINE).group(1)
        self.assertRegex(image, r"^ghcr\.io/sepa79/pocketplanner:v\d+\.\d+\.\d+$")
        self.assertIn("IMAGE: ghcr.io/sepa79/pocketplanner", workflow)
        self.assertIn("imageRepository.project: ghcr.io/sepa79/pocketplanner", manifest)
        self.assertIn("repository: https://github.com/sepa79/PocketPlanner.git", manifest)
        self.assertIn("org.opencontainers.image.source=https://github.com/sepa79/PocketPlanner", workflow)

    def test_hiveforge_identity_and_configuration_names_match(self):
        manifest = (ROOT / "hiveforge.yaml").read_text()
        component = (ROOT / "deploy/hiveforge/planner/hiveforge.yaml").read_text()
        renderer = (ROOT / "deploy/hiveforge/planner/ansible/render.yml").read_text()
        template = (ROOT / "deploy/hiveforge/planner/ansible/templates/stack.yml.j2").read_text()
        self.assertIn("name: pocketplanner", manifest)
        self.assertIn("project: pocketplanner", component)
        self.assertIn("  pocketplanner:", template)
        for variable in ("POCKETPLANNER_IMAGE", "POCKETPLANNER_PORT", "POCKETPLANNER_NODE"):
            with self.subTest(variable=variable):
                self.assertIn(variable, component)
                self.assertIn(f"lookup('env', '{variable}')", renderer)
        for variable in ("POCKETPLANNER_MCP_ALLOWED_HOSTS", "POCKETPLANNER_MCP_ALLOWED_ORIGINS"):
            with self.subTest(variable=variable):
                self.assertIn(f"lookup('env', '{variable}')", renderer)
                self.assertIn(variable, template)
        self.assertIn("path: /hf/state/pocketplanner", renderer)
        self.assertIn("'/state/pocketplanner'", template)

    def test_existing_local_service_and_volume_identity_is_preserved(self):
        local = (ROOT / "compose.local.yaml").read_text()
        standalone = (ROOT / "compose.yaml").read_text()
        self.assertIn("services:\n  testplanner:", local)
        self.assertIn("image: pocketplanner-local:latest", local)
        for configuration in (local, standalone):
            self.assertIn("- planner_data:/data", configuration)
            self.assertIn("volumes:\n  planner_data:", configuration)


if __name__ == "__main__":
    unittest.main()
