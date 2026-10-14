"""Responsibility: load and validate the canonical application version. Contract: docs/ARCHITECTURE.md#application-version."""

import re
from pathlib import Path

APP_NAME = "PocketPlanner"
APP_VERSION = (Path(__file__).resolve().parent / "VERSION").read_text(encoding="utf-8").strip()
if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", APP_VERSION):
    raise ValueError("VERSION must contain an application version such as 0.2.1-dev")
