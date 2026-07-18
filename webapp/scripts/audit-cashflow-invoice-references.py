#!/usr/bin/env python3
"""Contrasta referencias INV de Cash Flow con CABE_VENTAS, sin escribir datos."""

import json
import os
import re
import sys
from collections import defaultdict

from google.oauth2 import service_account
from googleapiclient.discovery import build


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "client-balance-controls.json")
SERVICE_ACCOUNT_FILE = os.environ.get(
    "GOOGLE_CREDENTIALS_FILE",
    os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "google_credentials.json")),
)
SALES_SPREADSHEET_ID = os.environ.get("SALES_SPREADSHEET_ID", "1GhLokb_V5Yok2ubxBg8Tr0jxE3nFkwCD2sMvWDHZ20o")
HISTORICAL_SALES_SPREADSHEET_ID = os.environ.get("HISTORICAL_SALES_SPREADSHEET_ID", "12ba_3FX1xK6d8UmzkeRBXhCVYXfi8plL-Uga5tXpajE")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
EPSILON = 0.01
ROUNDING_TOLERANCE = float(os.environ.get("CASHFLOW_INVOICE_ROUNDING_TOLERANCE", "1"))
INVOICE_PATTERN = re.compile(r"\bINV(?:OICE)?\s*#?\s*(\d+)\b", re.IGNORECASE)
REVERSAL_PATTERN = re.compile(r"\b(?:DEVOL(?:UCION)?|RETORNO|REFUND|REVERS)\b", re.IGNORECASE)


def parse_money(value):
    text = str(value or "").replace("\xa0", " ").strip()
    if not text:
        return None
    negative = "-" in text or "(" in text
    cleaned = re.sub(r"[^0-9,.-]", "", text).replace(",", "")
    if not cleaned:
        return None
    try:
        amount = float(cleaned)
    except ValueError:
        return None
    return -abs(amount) if negative else amount


def find_header(values, label):
    for index, row in enumerate(values):
        headers = [str(cell).strip().upper() for cell in row]
        if label in headers:
            return index, headers
    raise ValueError(f"No se encontro cabecera {label}")


def cell(row, index):
    return row[index] if isinstance(index, int) and index < len(row) else ""


def source_invoice_rows(service, config):
    invoices = []
    skipped = []
    for account in config["cashFlowAccounts"]:
        sheet = account["sheet"]
        values = service.spreadsheets().values().get(
            spreadsheetId=config["spreadsheetId"], range=f"'{sheet}'!A1:Z1000", majorDimension="ROWS"
        ).execute().get("values", [])
        header_row, headers = find_header(values, "SALDO")
        indexes = {
            "date": headers.index("FECHA") if "FECHA" in headers else None,
            "concept": headers.index("CONCEPTO") if "CONCEPTO" in headers else None,
            "amount": next((headers.index(name) for name in ("IMPORTE", "MONTO") if name in headers), None),
            "balance": headers.index("SALDO"),
        }
        required = [name for name in ("date", "concept", "amount") if indexes[name] is None]
        if required:
            skipped.append({"sheet": sheet, "missingColumns": required})
            continue

        previous_balance = 0.0
        for row_number, row in enumerate(values[header_row + 1 :], header_row + 2):
            balance = parse_money(cell(row, indexes["balance"]))
            if balance is None:
                continue
            delta = round(balance - previous_balance, 3)
            previous_balance = balance
            concept = str(cell(row, indexes["concept"])).strip()
            match = INVOICE_PATTERN.search(concept)
            if not match:
                continue
            invoices.append({
                "sheet": sheet,
                "oldId": account["oldId"],
                "row": row_number,
                "date": cell(row, indexes["date"]),
                "invoice": int(match.group(1)),
                "concept": concept,
                "listedAmount": parse_money(cell(row, indexes["amount"])),
                # Aumento de saldo representa CARGO negativo en ESWCARGO.
                "systemAmount": round(-delta, 3),
                "isReversal": bool(REVERSAL_PATTERN.search(concept)),
            })
    return invoices, skipped


def sales_by_invoice(service, spreadsheet_id):
    values = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range="'CABE_VENTAS'!A1:N2000", majorDimension="ROWS"
    ).execute().get("values", [])
    header_row, headers = find_header(values, "INVOICE")
    indexes = {name: headers.index(name) for name in ("INVOICE", "CLIENTE", "NRO CLI", "FECHA", "TOTAL USD")}
    rows = defaultdict(list)
    for row_number, row in enumerate(values[header_row + 1 :], header_row + 2):
        invoice = parse_money(cell(row, indexes["INVOICE"]))
        if invoice is None:
            continue
        rows[int(invoice)].append({
            "row": row_number,
            "oldId": int(parse_money(cell(row, indexes["NRO CLI"])) or 0),
            "client": cell(row, indexes["CLIENTE"]),
            "date": cell(row, indexes["FECHA"]),
            "amount": parse_money(cell(row, indexes["TOTAL USD"])),
        })
    return rows


def main():
    with open(CONFIG_FILE, "r", encoding="utf-8") as handle:
        config = json.load(handle)
    credentials = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    service = build("sheets", "v4", credentials=credentials)
    cashflow, skipped_sheets = source_invoice_rows(service, config)
    sales = sales_by_invoice(service, SALES_SPREADSHEET_ID)
    historical_sales = sales_by_invoice(service, HISTORICAL_SALES_SPREADSHEET_ID)
    results = []
    balance_delta_conflicts = []
    for row in cashflow:
        if row["isReversal"]:
            continue
        current_sales = sales.get(row["invoice"], [])
        historical = historical_sales.get(row["invoice"], [])
        matching_sales = [sale for sale in current_sales if sale["oldId"] == row["oldId"]]
        historical_matching_sales = [sale for sale in historical if sale["oldId"] == row["oldId"]]
        verifiable_sales = [sale for sale in matching_sales if (sale["amount"] or 0) != 0]
        source_name = "current"
        if not verifiable_sales and historical_matching_sales:
            matching_sales = historical_matching_sales
            verifiable_sales = [sale for sale in matching_sales if (sale["amount"] or 0) != 0]
            source_name = "historical"
        classification = "matching"
        if not current_sales and not historical:
            classification = "invoice_missing_in_sales"
        elif not matching_sales:
            classification = "client_mismatch"
        else:
            differences = [
                abs(abs(row["listedAmount"] or 0) - abs(sale["amount"]))
                for sale in matching_sales
                if sale["amount"] is not None
            ]
            if not any(difference <= EPSILON for difference in differences):
                if any(difference <= ROUNDING_TOLERANCE for difference in differences):
                    classification = "rounding_difference"
                else:
                    classification = "amount_mismatch" if verifiable_sales else "sales_amount_unverifiable"
        reviewed = {
            **row,
            "classification": classification,
            "salesSource": source_name,
            "sales": matching_sales or current_sales or historical,
        }
        results.append(reviewed)
        if row["systemAmount"] > EPSILON:
            balance_delta_conflicts.append(reviewed)

    groups = defaultdict(list)
    for row in results:
        groups[(row["oldId"], row["invoice"])].append(row)
    repeated_charges = []
    for (old_id, invoice), group in groups.items():
        charges = [row for row in group if row["systemAmount"] < -EPSILON]
        if len(charges) > 1:
            repeated_charges.append({"oldId": old_id, "invoice": invoice, "rows": charges})

    counts = defaultdict(int)
    for row in results:
        counts[row["classification"]] += 1
    report = {
        "source": {
            "cashFlowSpreadsheet": config["spreadsheetId"],
            "salesSpreadsheet": SALES_SPREADSHEET_ID,
            "historicalSalesSpreadsheet": HISTORICAL_SALES_SPREADSHEET_ID,
        },
        "cashFlowInvoiceRows": len(cashflow),
        "reviewedInvoiceRows": len(results),
        "counts": dict(sorted(counts.items())),
        "balanceDeltaConflicts": balance_delta_conflicts,
        "repeatedChargeReferences": repeated_charges,
        "skippedSheets": skipped_sheets,
        "issues": [row for row in results if row["classification"] != "matching"],
    }
    summary = {
        "cashFlowInvoiceRows": report["cashFlowInvoiceRows"],
        "reviewedInvoiceRows": report["reviewedInvoiceRows"],
        "counts": report["counts"],
        "balanceDeltaConflicts": len(balance_delta_conflicts),
        "repeatedChargeReferences": [
            {"oldId": item["oldId"], "invoice": item["invoice"]}
            for item in repeated_charges
        ],
        "skippedSheets": skipped_sheets,
    }
    print(json.dumps(summary if "--summary" in sys.argv else report, ensure_ascii=False, indent=2))
    if report["issues"] or repeated_charges or balance_delta_conflicts or skipped_sheets:
        print(
            "Advertencia Cash Flow: referencias de Invoice con diferencias de fuente; revisar reporte antes de modificar movimientos.",
            file=sys.stderr,
        )
    if os.environ.get("CASHFLOW_INVOICE_AUDIT_STRICT") == "1" and (report["issues"] or repeated_charges or balance_delta_conflicts or skipped_sheets):
        sys.exit(2)


if __name__ == "__main__":
    main()
