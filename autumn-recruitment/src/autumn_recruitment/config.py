"""Load study settings relative to this isolated project's directory."""

from __future__ import annotations

import copy
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PLATFORMS = ("weibo", "xiaohongshu", "x")


def _project_path(root: Path, value: str) -> str:
    path = (root / value).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Storage and output paths must remain inside the project directory")
    return str(path)


def load_config(path: str | Path | None = None) -> dict:
    """Return validated JSON settings. Default resolution is independent of cwd.

    Config files may be supplied from another directory; private data still lives
    inside this project's root, as required by the study's isolation boundary.
    """
    source = Path(path).expanduser().resolve() if path else PROJECT_ROOT / "config.json"
    with source.open(encoding="utf-8") as handle:
        config = copy.deepcopy(json.load(handle))
    years = config.get("years", [])
    if not years or any(not isinstance(year, int) or isinstance(year, bool) for year in years):
        raise ValueError("years must contain calendar years as integers")
    config["years"] = sorted(set(years))
    target = config.get("target_per_platform", 200)
    if not isinstance(target, int) or isinstance(target, bool) or target < 1:
        raise ValueError("target_per_platform must be a positive integer")
    config["target_per_platform"] = target
    if config.get("sampling", {}).get("mode", "balanced") not in {"balanced", "available"}:
        raise ValueError("sampling.mode must be balanced or available")
    ZoneInfo(config.get("timezone", "Asia/Shanghai"))
    window = config.get("window", {})
    for year in years:
        start = datetime(year, window.get("start_month", 8), window.get("start_day", 1))
        end = datetime(year, window.get("end_month", 11), window.get("end_day", 18))
        if end <= start:
            raise ValueError("The exclusive season end must follow its start within the same calendar year")
    platforms = config.get("platforms", {})
    unknown = set(platforms) - set(PLATFORMS)
    if unknown:
        raise ValueError(f"Unknown platforms: {', '.join(sorted(unknown))}")
    for platform, settings in platforms.items():
        if settings.get("enabled", True) and not settings.get("queries"):
            raise ValueError(f"{platform} needs at least one search query")
    config["project_root"] = str(PROJECT_ROOT)
    config["config_path"] = str(source)
    storage = config.setdefault("storage", {})
    config["db_path"] = _project_path(PROJECT_ROOT, storage.get("database", "data/study.sqlite3"))
    config["raw_dir"] = _project_path(PROJECT_ROOT, storage.get("raw_dir", "data/raw"))
    config["output_dir"] = _project_path(PROJECT_ROOT, storage.get("output_dir", "outputs"))
    config["data_dir"] = str(PROJECT_ROOT / "data")
    return config
