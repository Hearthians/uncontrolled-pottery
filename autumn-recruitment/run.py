"""Run the isolated project without installing it into the parent workspace."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
from autumn_recruitment.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
