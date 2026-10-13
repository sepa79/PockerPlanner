"""Responsibility: dispatch an explicit offline workspace replacement. Must not: bypass validation. Contract: docs/ARCHITECTURE.md#data-contract."""

import argparse
import json
from pathlib import Path

from planner_store import replace_explicitly

parser = argparse.ArgumentParser()
parser.add_argument("file", type=Path)
arguments = parser.parse_args()
replace_explicitly(json.loads(arguments.file.read_text(encoding="utf-8")))
print("Workspace imported")
