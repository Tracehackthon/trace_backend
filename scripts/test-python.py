"""Run only the thin Python SDK regression shipped with Trace Runtime.

The product test boundary must be independent of a colocated MyWiKi checkout:
the retired Python runtime and its tests are not part of the active product.
"""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
targets = [root / "tests" / "python"]
raise SystemExit(subprocess.run([sys.executable, "-m", "pytest", *map(str, targets), "-q"], cwd=root).returncode)
