#!/usr/bin/env python3
"""Read-only integrity audit for the CASH FLOW 2026 workbook.

This script never writes to Google Sheets or to the application database. It
keeps Cash Flow controls independent from the operational sales sync.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build


SCRIPT_DIR = Path(__file__).resolve().parent
SPREADSHEET_ID = os.getenv(
    "CASHFLOW_SPREADSHEET_ID", "1PFHlsVhP16Ge-qXF7qn16G2FPBnMVpF7TMkIjDorxc8"
)
SERVICE_ACCOUNT_FILE = Path(
    os.getenv("GOOGLE_CREDENTIALS_FILE", SCRIPT_DIR / "google_credentials.json")
)
OUTPUT_FILE = Path(
    os.getenv("CASHFLOW_AUDIT_OUTPUT", SCRIPT_DIR / "audit-output/cashflow-health.json")
)
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
REQUIRED_TABS = {"CASH DIARIO", "PROXIMOS VENCIMIENTOS"}
CC_TABS = {
    "MARCOS CC",
    "AYLEN CC",
    "FACU FABRI CC",
    "RAMIRO STRAR CC",
    "MARTIN DUS",
    "FEDE CANNING",
    "TOMAS CC",
    "MOLINA OCT",
    "SEBAS LUC CC",
    "LUCA CC",
    "GONZALO CC",
    "NAHUEL CC",
}
FORMULA_ERRORS = {"#REF!", "#VALUE!", "#DIV/0!", "#N/A", "#NAME?", "#NUM!"}


def get_service():
    if not SERVICE_ACCOUNT_FILE.exists():
        raise FileNotFoundError(f"Credentials file not found: {SERVICE_ACCOUNT_FILE}")
    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES
    )
    return build("sheets", "v4", credentials=credentials)


def quote_tab(tab_name: str) -> str:
    return "'" + tab_name.replace("'", "''") + "'"


def scan_formula_errors(values):
    errors = []
    for row_index, row in enumerate(values, start=1):
        for column_index, value in enumerate(row, start=1):
            cell = str(value).strip().upper()
            if cell in FORMULA_ERRORS:
                errors.append({"row": row_index, "column": column_index, "value": cell})
    return errors


def main():
    service = get_service()
    metadata = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    tab_names = [sheet["properties"]["title"] for sheet in metadata.get("sheets", [])]
    missing_tabs = sorted(REQUIRED_TABS.difference(tab_names))
    operational_tabs = [
        tab for tab in tab_names if tab in REQUIRED_TABS or tab in CC_TABS
    ]

    formula_errors = {}
    for tab_name in operational_tabs:
        response = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{quote_tab(tab_name)}!A1:AZ500",
            majorDimension="ROWS",
        ).execute()
        errors = scan_formula_errors(response.get("values", []))
        if errors:
            formula_errors[tab_name] = errors

    report = {
        "auditedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "read-only",
        "spreadsheetId": SPREADSHEET_ID,
        "spreadsheetTitle": metadata.get("properties", {}).get("title"),
        "requiredTabs": sorted(REQUIRED_TABS),
        "missingTabs": missing_tabs,
        "cashDaily": "CASH DIARIO" in tab_names,
        "currentAccounts": sorted(tab for tab in tab_names if tab in CC_TABS),
        "operationalTabsAudited": operational_tabs,
        "formulaErrors": formula_errors,
        "notes": [
            "No se escribio ninguna celda ni registro de base de datos.",
            "Las planillas no operativas quedan fuera de importacion automatica.",
            "El muestreo revisa A1:AZ500 por pestana operativa.",
        ],
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Cash Flow audit: {report['spreadsheetTitle']}")
    print(f"Cuentas corrientes relevadas: {len(report['currentAccounts'])}")
    print(f"Pestanas operativas auditadas: {len(operational_tabs)}")
    if missing_tabs:
        print("Faltan pestanas requeridas: " + ", ".join(missing_tabs))
    if formula_errors:
        print("Errores de formula detectados:")
        for tab_name, errors in formula_errors.items():
            positions = ", ".join(f"R{item['row']}C{item['column']}={item['value']}" for item in errors[:10])
            print(f"- {tab_name}: {positions}")
    else:
        print("Sin errores de formula visibles en el alcance auditado.")

    if missing_tabs:
        return 2
    return 1 if formula_errors else 0


if __name__ == "__main__":
    sys.exit(main())
