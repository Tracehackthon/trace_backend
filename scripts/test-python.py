"""Run the legacy capability regression only when it is colocated with MyWiKi.

The exported Trace source repository must remain standalone, so it falls back
to the thin Python SDK tests shipped inside this repository.
"""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
workspace_tests = [root.parent / "capability_runtime" / "tests", root.parent / "capability_release" / "tests"]
targets = workspace_tests if all(path.exists() for path in workspace_tests) else [root / "tests" / "python"]
raise SystemExit(subprocess.run([sys.executable, "-m", "pytest", *map(str, targets), "-q"], cwd=root).returncode)
