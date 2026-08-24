#!/usr/bin/env python3
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "sources.json"
OUTDIR = ROOT / "output"


def post_json(url, payload, timeout=120):
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    cfg = json.loads(CONFIG.read_text())
    base = cfg["firecrawl_base_url"].rstrip("/")
    OUTDIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    summary = {"run_id": stamp, "started_at": datetime.now(timezone.utc).isoformat(), "sources": []}

    enabled = [s for s in cfg["sources"] if s.get("enabled") and s.get("mode") == "firecrawl"]
    if not enabled:
        print("No enabled Firecrawl sources.")
        return 1

    for src in enabled:
        print(f"[{src['name']}] scraping {src['url']}")
        row = {"id": src["id"], "name": src["name"], "url": src["url"], "ok": False}
        try:
            result = post_json(
                f"{base}/v1/scrape",
                {
                    "url": src["url"],
                    "formats": ["markdown"],
                    "onlyMainContent": True
                },
            )
            outfile = OUTDIR / f"{stamp}-{src['id']}.json"
            outfile.write_text(json.dumps(result, ensure_ascii=False, indent=2))
            row["ok"] = bool(result.get("success"))
            row["file"] = str(outfile)
            data = result.get("data") or {}
            md = data.get("markdown") or ""
            metadata = data.get("metadata") or {}
            row["status_code"] = metadata.get("statusCode")
            row["chars"] = len(md)
            row["title"] = metadata.get("title") or metadata.get("ogTitle")
            print(f"  -> ok={row['ok']} status={row['status_code']} chars={row['chars']}")
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as e:
            row["error"] = str(e)
            print(f"  -> ERROR: {e}")
        except Exception as e:
            row["error"] = f"{type(e).__name__}: {e}"
            print(f"  -> ERROR: {row['error']}")
        summary["sources"].append(row)

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    summary_file = OUTDIR / f"{stamp}-summary.json"
    summary_file.write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\nSummary: {summary_file}")

    failed = [s for s in summary["sources"] if not s["ok"]]
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
