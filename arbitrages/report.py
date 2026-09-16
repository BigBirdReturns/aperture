"""Self-contained report rendering. All user strings enter the DOM as text."""
from pathlib import Path
import json
from .audit import audit_report


def render(report: dict, live: bool = False) -> str:
    audit_report(report)
    text = json.dumps({"report": report, "live": live}, ensure_ascii=True, allow_nan=False)
    # Data must never close its script element, including user-supplied names.
    text = text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return Path(__file__).with_name("ui.html").read_text(encoding="utf-8").replace("__ARBITRAGES_DATA__", text)
