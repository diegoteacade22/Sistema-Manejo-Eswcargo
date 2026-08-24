#!/usr/bin/env python3
import csv
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTDIR = ROOT / "output"
CSV_OUT = ROOT / "latest.csv"
JSON_OUT = ROOT / "latest.json"
HEADERS = ["Retailer","Modelo","Capacidad","Color","Condición","Tipo","Precio","Moneda","Stock","URL","Fecha","Origen"]

COLORS = [
    "Cosmic Orange","Deep Blue","Silver","Black","White","Blue","Green","Pink","Purple",
    "Natural Titanium","Black Titanium","White Titanium","Desert Titanium","Graphite","Gold","Red"
]
MODEL_RE = re.compile(r"\b(iPhone\s+(?:1[0-9]|[0-9])(?:e)?(?:\s+Pro\s+Max|\s+Pro|\s+Plus|\s+mini)?|Galaxy\s+[A-Z][A-Za-z0-9+ -]{1,25}|Pixel\s+[0-9]+(?:a|\s+Pro\s+XL|\s+Pro)?)\b", re.I)
CAP_RE = re.compile(r"\b(64|128|256|512)\s*GB\b|\b([124])\s*TB\b", re.I)
PRICE_RE = re.compile(r"\$\s*([0-9]{2,4}(?:,[0-9]{3})*(?:\.[0-9]{2})?)")
LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)")


def norm_model(s):
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"(?i)^iphone", "iPhone", s)
    return s


def infer_capacity(text):
    m = CAP_RE.search(text)
    if not m: return ""
    return (m.group(1) + "GB") if m.group(1) else (m.group(2) + "TB")


def infer_color(text):
    low = text.lower()
    for c in COLORS:
        if c.lower() in low:
            return c
    return ""


def infer_condition(text):
    low = text.lower()
    if "open box" in low or "open-box" in low: return "Open Box"
    if "renewed" in low: return "Renewed"
    if "refurb" in low: return "Refurbished"
    if "pre-owned" in low or "preowned" in low: return "Pre-Owned"
    return "New"


def infer_type(text):
    low = text.lower()
    if "unlocked" in low or "connect on your own later" in low: return "Unlocked"
    for carrier in ("at&t","t-mobile","verizon","boost","cricket"):
        if carrier in low: return carrier
    return ""


def infer_stock(text):
    low = text.lower()
    if "out of stock" in low or "sold out" in low or "unavailable" in low: return "Out of Stock"
    return "Available"


def clean_price(s):
    return float(s.replace(",", ""))


def parse_apple(markdown, source_url, stamp):
    rows = []
    # Apple exposes variant links with display size/capacity/color and unlocked price.
    pat = re.compile(
        r"\[([^\]]*?(?:64|128|256|512)GB|[^\]]*?[124]TB)[^\]]*?Connect on your own later\.\s*\$([0-9,]+(?:\.\d{2})?)\]\((https://www\.apple\.com/shop/buy-iphone/iphone-[^)]+)\)",
        re.I,
    )
    for m in pat.finditer(markdown):
        label, price_s, url = m.groups()
        cap = infer_capacity(label)
        color = infer_color(label)
        if "6.9-inch" in url:
            model = "iPhone 17 Pro Max" if "iphone-17-pro" in url else "iPhone"
        elif "6.3-inch" in url and "iphone-17-pro" in url:
            model = "iPhone 17 Pro"
        else:
            mm = MODEL_RE.search(label)
            model = norm_model(mm.group(1)) if mm else "iPhone"
        rows.append(["Apple", model, cap, color, "New", "Unlocked", clean_price(price_s), "USD", "Available", url, stamp, "Firecrawl"])
    # Fallback for pages that expose model/storage in plain text but not variant links.
    if not rows:
        rows.extend(parse_generic("Apple", markdown, source_url, stamp))
    return rows


def parse_generic(retailer, markdown, source_url, stamp):
    rows = []
    lines = [re.sub(r"!\[[^\]]*\]\([^)]+\)", "", x).strip() for x in markdown.splitlines()]
    lines = [x for x in lines if x]
    for i, line in enumerate(lines):
        if "$" not in line:
            continue
        context = " | ".join(lines[max(0, i-2):min(len(lines), i+3)])
        model_m = MODEL_RE.search(context)
        price_m = PRICE_RE.search(context)
        if not model_m or not price_m:
            continue
        model = norm_model(model_m.group(1))
        cap = infer_capacity(context)
        color = infer_color(context)
        links = LINK_RE.findall(context)
        url = links[-1][1] if links else source_url
        rows.append([
            retailer, model, cap, color, infer_condition(context), infer_type(context), clean_price(price_m.group(1)),
            "USD", infer_stock(context), url, stamp, "Firecrawl"
        ])
    return rows


def latest_source_files():
    summaries = sorted(OUTDIR.glob("*-summary.json"), reverse=True)
    if not summaries:
        return []
    summary = json.loads(summaries[0].read_text())
    return [x for x in summary.get("sources", []) if x.get("ok") and x.get("file")]


def dedupe(rows):
    best = {}
    for r in rows:
        key = tuple(str(x).lower() for x in (r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[9]))
        best[key] = r
    return sorted(best.values(), key=lambda r: (r[1], r[2], r[3], float(r[6]), r[0]))


def write_outputs(rows):
    with CSV_OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADERS)
        w.writerows(rows)
    JSON_OUT.write_text(json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "rows": [dict(zip(HEADERS,r)) for r in rows]}, ensure_ascii=False, indent=2))


def publish_git():
    # Google Sheets imports latest.csv directly from this public branch, avoiding Google credentials on the server.
    repo = ROOT.parent.parent
    subprocess.run(["git","add","github-app-sandbox/market-radar/latest.csv","github-app-sandbox/market-radar/latest.json"], cwd=repo, check=True)
    diff = subprocess.run(["git","diff","--cached","--quiet"], cwd=repo)
    if diff.returncode == 0:
        print("No normalized changes to publish.")
        return
    msg = "Market radar: update normalized prices"
    subprocess.run(["git","commit","-m",msg], cwd=repo, check=True)
    subprocess.run(["git","push","origin","HEAD:lab/github-app-sandbox"], cwd=repo, check=True)


def main():
    scan = subprocess.run([sys.executable, str(ROOT / "run_scan.py")], cwd=ROOT)
    sources = latest_source_files()
    if not sources:
        raise SystemExit("No successful Firecrawl source output found.")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = []
    for src in sources:
        payload = json.loads(Path(src["file"]).read_text())
        md = ((payload.get("data") or {}).get("markdown") or "")
        sid = src.get("id", "")
        if sid.startswith("apple"):
            rows.extend(parse_apple(md, src.get("url",""), today))
        elif sid.startswith("walmart"):
            rows.extend(parse_generic("Walmart", md, src.get("url",""), today))
        elif sid.startswith("bh"):
            rows.extend(parse_generic("B&H Photo", md, src.get("url",""), today))
    rows = dedupe(rows)
    write_outputs(rows)
    print(f"Normalized rows: {len(rows)}")
    print(f"CSV: {CSV_OUT}")
    publish_git()
    return 0 if rows else 3

if __name__ == "__main__":
    raise SystemExit(main())
