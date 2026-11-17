"""Open the dashboard in the system browser and keep its server in this terminal."""
from __future__ import annotations

import json
from pathlib import Path
import sys
from threading import Timer
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from autumn_recruitment.cli import main


def launch() -> int:
    address = "http://127.0.0.1:8765/"
    host = "127.0.0.1"
    network_config = Path(__file__).resolve().parent / "data/dashboard-network.json"
    if network_config.is_file():
        try:
            configured_host = json.loads(network_config.read_text(encoding="utf-8-sig")).get("host")
            if configured_host in {"127.0.0.1", "0.0.0.0"}:
                host = configured_host
        except (OSError, ValueError, AttributeError):
            pass
    try:
        with urlopen(address + "api/dashboard?dataset=balanced", timeout=1) as response:
            data = json.load(response)
        if data.get("dataset") == "balanced" and isinstance(data.get("posts"), list):
            webbrowser.open(address)
            return 0
    except (URLError, OSError, ValueError):
        pass
    timer = Timer(1.0, webbrowser.open, args=(address,))
    timer.daemon = True
    timer.start()
    try:
        return main(["serve", "--host", host, "--port", "8765"])
    finally:
        timer.cancel()


if __name__ == "__main__":
    raise SystemExit(launch())
