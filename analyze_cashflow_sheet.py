#!/usr/bin/env python3
"""
Analyze structure of the CASH FLOW 2026 Google Sheet.
- Lists sheet tabs
- Shows a detected header row (first non-empty row)
- Shows first 5 data rows after header

Usage:
  python3 analyze_cashflow_sheet.py
  python3 analyze_cashflow_sheet.py --only "TAB1,TAB2"
"""

import argparse
import json
import os
from typing import List, Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_ACCOUNT_FILE = os.path.join(SCRIPT_DIR, "google_credentials.json")
SPREADSHEET_ID = "1PFHlsVhP16Ge-qXF7qn16G2FPBnMVpF7TMkIjDorxc8"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze CASH FLOW 2026 sheet structure")
    parser.add_argument("--only", default="", help="Comma-separated sheet names to analyze")
    return parser.parse_args()


def build_sheets_service():
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise FileNotFoundError(f"Credentials file not found: {SERVICE_ACCOUNT_FILE}")
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES
    )
    return build("sheets", "v4", credentials=creds)


def normalize_sheet_filter(raw: str) -> Optional[List[str]]:
    if not raw:
        return None
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts or None


def find_header_row(values: List[List[str]]) -> int:
    for idx, row in enumerate(values):
        has_any = any(str(cell).strip() for cell in row)
        if has_any:
            return idx
    return -1


def main():
    args = parse_args()
    only_sheets = normalize_sheet_filter(args.only)

    service = build_sheets_service()
    meta = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()

    print("Sheet title:", meta.get("properties", {}).get("title"))
    sheets = meta.get("sheets", [])
    print("Tabs:")
    for s in sheets:
        title = s.get("properties", {}).get("title")
        gid = s.get("properties", {}).get("sheetId")
        print(f"  - {title} (gid={gid})")

    print("\nAnalysis:")
    for s in sheets:
        title = s.get("properties", {}).get("title")
        if only_sheets and title not in only_sheets:
            continue

        # Pull a small window to detect header and preview rows
        range_a1 = f"'{title}'!A1:Z50"
        resp = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=range_a1,
            majorDimension="ROWS",
        ).execute()
        values = resp.get("values", [])

        header_idx = find_header_row(values)
        header = values[header_idx] if header_idx >= 0 else []
        data_preview = []
        if header_idx >= 0:
            data_preview = values[header_idx + 1 : header_idx + 6]

        print(f"\n[{title}]")
        if header_idx < 0:
            print("  No data found in A1:Z50")
            continue

        print(f"  Header row (A1 index): {header_idx + 1}")
        print("  Header:")
        print("   ", json.dumps(header, ensure_ascii=False))

        if data_preview:
            print("  Sample rows:")
            for row in data_preview:
                print("   ", json.dumps(row, ensure_ascii=False))
        else:
            print("  No data rows found after header in preview window.")


if __name__ == "__main__":
    main()
