#!/usr/bin/env python3
"""Exporta variaciones de Cash Flow para auditoria; no escribe datos."""

import json
import os
import re
import sys
from datetime import datetime, timedelta

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "client-balance-controls.json")
SERVICE_ACCOUNT_FILE = os.environ.get(
    "GOOGLE_CREDENTIALS_FILE",
    os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "google_credentials.json")),
)
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


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


def parse_date(value):
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(value or "").strip(), fmt)
        except ValueError:
            continue
    return None


def is_numeric_cell(value):
    text = str(value or "").replace("\xa0", " ").strip().upper()
    return bool(re.fullmatch(r"(?:USD\s*)?[-(]?\$?\s*[0-9][0-9,]*(?:\.[0-9]+)?\)?", text))


def find_header(values):
    for index, row in enumerate(values):
        normalized = [str(cell).strip().upper() for cell in row]
        if "SALDO" in normalized:
            return index, normalized.index("SALDO")
    raise ValueError("No se encontro columna SALDO")


def extract_date_and_description(row, saldo_index):
    date_index = next((index for index, cell in enumerate(row[:saldo_index]) if parse_date(cell)), None)
    date_value = parse_date(row[date_index]) if date_index is not None else None
    description = ""
    if date_index is not None:
        for cell in row[date_index + 1 : saldo_index]:
            text = str(cell or "").strip()
            if text and not is_numeric_cell(text):
                description = text
                break
    return date_value, description or "Movimiento Cash Flow"


def transaction_from_balance_change(previous_balance, balance):
    """The Cash Flow balance grows on a client payment and falls on a charge."""
    amount = round(balance - previous_balance, 3)
    if abs(amount) <= 0.005:
        return None
    return "PAGO" if amount > 0 else "CARGO", amount


def main():
    with open(CONFIG_FILE, "r", encoding="utf-8") as handle:
        config = json.load(handle)
    credentials = service_account.Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    service = build("sheets", "v4", credentials=credentials)
    transactions = []

    for account in config["cashFlowAccounts"]:
        sheet = account["sheet"]
        values = service.spreadsheets().values().get(
            spreadsheetId=config["spreadsheetId"], range=f"'{sheet}'!A1:Z1000", majorDimension="ROWS"
        ).execute().get("values", [])
        header_index, saldo_index = find_header(values)
        previous_balance = 0.0
        sheet_ref = re.sub(r"[^A-Z0-9]+", "_", sheet.upper()).strip("_")

        for row_number, row in enumerate(values[header_index + 1 :], header_index + 2):
            if len(row) <= saldo_index:
                continue
            balance = parse_money(row[saldo_index])
            if balance is None:
                continue
            date_value, description = extract_date_and_description(row, saldo_index)
            if not date_value:
                previous_balance = balance
                continue
            transaction = transaction_from_balance_change(previous_balance, balance)
            previous_balance = balance
            if transaction is None:
                continue
            tx_type, amount = transaction
            transactions.append({
                "oldId": account["oldId"], "sheet": sheet, "row": row_number,
                "date": (date_value + timedelta(minutes=row_number)).isoformat(),
                "type": tx_type, "amount": amount,
                "description": description,
                "reference": f"CASHFLOW-RAW-2026:{sheet_ref}:{row_number}",
            })

    json.dump(transactions, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
