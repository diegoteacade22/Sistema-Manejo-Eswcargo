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
OPP_OUT = ROOT / "opportunities.csv"

BASE_HEADERS = ["Retailer","Modelo","Capacidad","Color","Condición","Tipo","Precio","Moneda","Stock","URL","Fecha","Origen"]
HEADERS = BASE_HEADERS + ["Apple Ref","Ahorro USD","Ahorro %","Comparable","Mejor Precio","Señal"]

COLORS = [
    "Cosmic Orange","Deep Blue","Silver","Black","White","Blue","Green","Pink","Purple",
    "Natural Titanium","Black Titanium","White Titanium","Desert Titanium","Graphite","Gold","Red",
    "Space Black","Cloud White","Mist Blue","Lavender","Sage","Soft Pink"
]
MODEL_RE = re.compile(r"\b(iPhone\s+(?:1[0-9]|[0-9])(?:e)?(?:\s+Pro\s+Max|\s+Pro|\s+Plus|\s+mini)?|Galaxy\s+[A-Z][A-Za-z0-9+ -]{1,25}|Pixel\s+[0-9]+(?:a|\s+Pro\s+XL|\s+Pro)?)\b", re.I)
CAP_RE = re.compile(r"\b(64|128|256|512)\s*GB\b|\b([124])\s*TB\b", re.I)
PRICE_RE = re.compile(r"\$\s*([0-9]{2,4}(?:,[0-9]{3})*(?:\.[0-9]{2})?)")
LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)")


def norm_model(s):
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"(?i)^iphone", "iPhone", s)
    s = re.sub(r"(?i)pro max", "Pro Max", s)
    s = re.sub(r"(?i)\bpro\b", "Pro", s)
    return s


def infer_capacity(text):
    m = CAP_RE.search(text)
    if not m:
        return ""
    return (m.group(1) + "GB") if m.group(1) else (m.group(2) + "TB")


def infer_color(text):
    low = text.lower()
    for c in COLORS:
        if c.lower() in low:
            return c
    return ""


def infer_condition(text):
    low = text.lower()
    if "open box" in low or "open-box" in low:
        return "Open Box"
    if "renewed premium" in low or "premium renewed" in low:
        return "Renewed Premium"
    if "renewed" in low:
        return "Renewed"
    if "refurb" in low or "restored" in low:
        return "Refurbished"
    if "pre-owned" in low or "preowned" in low or "pre owned" in low:
        if "premium" in low:
            return "Pre-Owned Premium"
        if "good" in low:
            return "Pre-Owned Good"
        return "Pre-Owned"
    return "New"


def infer_type(text):
    low = text.lower()
    if "unlocked" in low or "connect on your own later" in low or "fully unlocked" in low:
        return "Unlocked"
    if "straight talk" in low:
        return "Straight Talk Locked"
    for carrier in ("at&t", "t-mobile", "verizon", "boost", "cricket"):
        if carrier in low:
            return carrier
    return ""


def infer_stock(text):
    low = text.lower()
    if "out of stock" in low or "sold out" in low or "currently unavailable" in low or "unavailable" in low:
        return "Out of Stock"
    return "Available"


def clean_price(s):
    return float(s.replace(",", ""))


def parse_apple(markdown, source_url, stamp):
    rows = []
    pat = re.compile(
        r"\[([^\]]*?(?:64|128|256|512)GB|[^\]]*?[124]TB)[^\]]*?Connect on your own later\.\s*\$([0-9,]+(?:\.\d{2})?)\]\((https://www\.apple\.com/shop/buy-iphone/iphone-[^)]+)\)",
        re.I,
    )
    for m in pat.finditer(markdown):
        label, price_s, url = m.groups()
        cap = infer_capacity(label)
        color = infer_color(label)
        if "6.9-inch" in url and "iphone-17-pro" in url:
            model = "iPhone 17 Pro Max"
        elif "6.3-inch" in url and "iphone-17-pro" in url:
            model = "iPhone 17 Pro"
        else:
            mm = MODEL_RE.search(label)
            model = norm_model(mm.group(1)) if mm else "iPhone"
        rows.append(["Apple", model, cap, color, "New", "Unlocked", clean_price(price_s), "USD", "Available", url, stamp, "Firecrawl"])
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
        context = " | ".join(lines[max(0, i-3):min(len(lines), i+4)])
        model_m = MODEL_RE.search(context)
        price_m = PRICE_RE.search(context)
        if not model_m or not price_m:
            continue
        model = norm_model(model_m.group(1))
        cap = infer_capacity(context)
        if not cap:
            continue
        color = infer_color(context)
        links = LINK_RE.findall(context)
        url = links[-1][1] if links else source_url
        price = clean_price(price_m.group(1))
        # Elimina cuotas mensuales y accesorios obvios que contaminan búsquedas de teléfonos.
        if price < 150:
            continue
        rows.append([
            retailer, model, cap, color, infer_condition(context), infer_type(context), price,
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
        key = tuple(str(x).lower() for x in (r[0], r[1], r[2], r[3], r[4], r[5], r[9]))
        if key not in best or float(r[6]) < float(best[key][6]):
            best[key] = r
    return sorted(best.values(), key=lambda r: (r[1], r[2], r[3], r[4], float(r[6]), r[0]))


def apple_reference(rows):
    refs = {}
    # Preferencia 1: modelo+capacidad+color exactos. Preferencia 2: modelo+capacidad si color no aparece.
    by_model_cap = {}
    for r in rows:
        if r[0] != "Apple" or r[4] != "New" or r[5] != "Unlocked":
            continue
        refs[(r[1], r[2], r[3])] = float(r[6])
        by_model_cap.setdefault((r[1], r[2]), []).append(float(r[6]))
    fallback = {k: min(v) for k, v in by_model_cap.items()}
    return refs, fallback


def enrich(rows):
    refs, fallback = apple_reference(rows)
    enriched = []
    group_min = {}
    for r in rows:
        comparable_key = (r[1], r[2], r[3], r[4], r[5])
        group_min[comparable_key] = min(group_min.get(comparable_key, float("inf")), float(r[6]))

    for r in rows:
        price = float(r[6])
        apple_ref = refs.get((r[1], r[2], r[3])) or fallback.get((r[1], r[2]))
        ahorro_usd = round((apple_ref - price), 2) if apple_ref else ""
        ahorro_pct = round((ahorro_usd / apple_ref), 4) if apple_ref else ""
        comparable = "SI" if r[4] == "New" and r[5] == "Unlocked" else "NO"
        min_price = group_min[(r[1], r[2], r[3], r[4], r[5])]
        mejor = "SI" if abs(price - min_price) < 0.005 else ""

        if r[8] == "Out of Stock":
            signal = "SIN STOCK"
        elif not apple_ref:
            signal = "SIN REFERENCIA"
        elif r[5] not in ("Unlocked", ""):
            signal = "LOCKED - NO COMPARABLE"
        elif r[4] != "New":
            if ahorro_pct != "" and ahorro_pct >= 0.15:
                signal = "REFURB/USADO - REVISAR"
            else:
                signal = "NO COMPARABLE"
        elif comparable == "SI" and ahorro_pct >= 0.15:
            signal = "OPORTUNIDAD"
        elif comparable == "SI" and ahorro_pct >= 0.08:
            signal = "REVISAR"
        elif mejor == "SI":
            signal = "MEJOR PRECIO"
        else:
            signal = ""

        enriched.append(r + [apple_ref if apple_ref else "", ahorro_usd, ahorro_pct, comparable, mejor, signal])
    return enriched


def write_outputs(rows):
    with CSV_OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADERS)
        w.writerows(rows)
    JSON_OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rows": [dict(zip(HEADERS, r)) for r in rows]
    }, ensure_ascii=False, indent=2))

    ranked = [r for r in rows if r[-1] in ("OPORTUNIDAD", "REVISAR", "REFURB/USADO - REVISAR")]
    ranked.sort(key=lambda r: float(r[14]) if r[14] != "" else -999, reverse=True)
    with OPP_OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADERS)
        w.writerows(ranked)


def publish_git():
    repo = ROOT.parent.parent
    files = [
        "github-app-sandbox/market-radar/latest.csv",
        "github-app-sandbox/market-radar/latest.json",
        "github-app-sandbox/market-radar/opportunities.csv",
    ]
    subprocess.run(["git", "add", *files], cwd=repo, check=True)
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo)
    if diff.returncode == 0:
        print("No normalized changes to publish.")
        return
    subprocess.run(["git", "commit", "-m", "Market radar: refresh normalized comparison"], cwd=repo, check=True)
    # Public data branch consumed by Google Sheets.
    subprocess.run(["git", "push", "origin", "HEAD:market-radar-data"], cwd=repo, check=True)


def main():
    subprocess.run([sys.executable, str(ROOT / "run_scan.py")], cwd=ROOT)
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
            rows.extend(parse_apple(md, src.get("url", ""), today))
        elif sid.startswith("walmart"):
            rows.extend(parse_generic("Walmart", md, src.get("url", ""), today))
        elif sid.startswith("bh"):
            rows.extend(parse_generic("B&H Photo", md, src.get("url", ""), today))
        elif sid.startswith("amazon"):
            rows.extend(parse_generic("Amazon", md, src.get("url", ""), today))
        elif sid.startswith("bestbuy"):
            rows.extend(parse_generic("Best Buy", md, src.get("url", ""), today))

    rows = dedupe(rows)
    enriched = enrich(rows)
    write_outputs(enriched)

    counts = {}
    for r in enriched:
        counts[r[0]] = counts.get(r[0], 0) + 1
    print(f"Normalized rows: {len(enriched)}")
    print("By retailer:", json.dumps(counts, ensure_ascii=False))
    print(f"Opportunities: {sum(1 for r in enriched if r[-1] == 'OPORTUNIDAD')}")
    print(f"Review: {sum(1 for r in enriched if r[-1] in ('REVISAR','REFURB/USADO - REVISAR'))}")
    print(f"CSV: {CSV_OUT}")
    print(f"Opportunities CSV: {OPP_OUT}")
    publish_git()
    return 0 if enriched else 3


if __name__ == "__main__":
    raise SystemExit(main())
