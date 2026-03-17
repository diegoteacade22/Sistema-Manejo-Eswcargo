#!/usr/bin/env python3
"""
Import historical CC transactions from CASH FLOW 2026 Google Sheet to database.
- Reads 8 CC tabs (MARCOS CC, AYLEN CC, etc.)
- Maps each tab to the corresponding client
- Imports transactions to Transaction table
- Preserves existing transactions (no duplicates)

Usage:
  python import_cc_from_sheets.py [--dry-run]
"""

import argparse
import json
import os
import sys
from datetime import datetime
from typing import Optional, List, Dict, Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_ACCOUNT_FILE = os.path.join(SCRIPT_DIR, "google_credentials.json")
SPREADSHEET_ID = "1PFHlsVhP16Ge-qXF7qn16G2FPBnMVpF7TMkIjDorxc8"  # CASH FLOW 2026
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# Map CC tab names to exact client names (as they appear in the database)
CC_TAB_TO_CLIENT = {
    "MARCOS CC": "MARCOS ROKU",
    "AYLEN CC": "AYLEN GENTILETTI",
    "FACU FABRI CC": "FACU FABRICCINI",
    "LUCA CC": "LUCA STA FE NAHUEL",
    "SEBAS LUC CC": "SEBASTIAN X LUCAS",
    "GONZALO CC": "GONZALO LEMESOFF",
    "TOMAS CC": "TOMAS RODRIGUEZ",
    "NAHUEL CC": "NAHUEL NUEVO",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import CC transactions from Google Sheets")
    parser.add_argument("--dry-run", action="store_true", help="Preview without inserting to DB")
    return parser.parse_args()


def build_sheets_service():
    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise FileNotFoundError(f"Credentials file not found: {SERVICE_ACCOUNT_FILE}")
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES
    )
    return build("sheets", "v4", credentials=creds)


def parse_date(date_str: str) -> Optional[datetime]:
    """Parse date from various formats."""
    if not date_str or date_str.strip() == "":
        return None
    
    date_str = date_str.strip()
    
    # Try common formats
    formats = [
        "%d/%m/%Y",  # 15/02/2026
        "%d-%m-%Y",  # 15-02-2026
        "%Y-%m-%d",  # 2026-02-15
        "%d/%m/%y",  # 15/02/26
        "%d-%m-%y",  # 15-02-26
    ]
    
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    
    return None


def parse_amount(amount_str: str) -> Optional[float]:
    """Parse amount, removing currency symbols and handling negatives."""
    if not amount_str or amount_str.strip() == "":
        return None
    
    # Remove common currency symbols and spaces
    cleaned = amount_str.strip().replace("$", "").replace("USD", "").replace(",", "").strip()
    
    try:
        return float(cleaned)
    except ValueError:
        return None


def read_cc_tab(service, tab_name: str) -> List[Dict[str, Any]]:
    """Read transactions from a specific CC tab."""
    range_a1 = f"'{tab_name}'!A1:G500"  # FECHA, CONCEPTO, PESO en KG, IMPORTE, SALDO, VALOR KG, Observaciones
    
    try:
        resp = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=range_a1,
            majorDimension="ROWS",
        ).execute()
    except Exception as e:
        print(f"  ⚠️  Error reading tab '{tab_name}': {e}")
        return []
    
    values = resp.get("values", [])
    if not values:
        return []
    
    # Find header row
    header_idx = -1
    for idx, row in enumerate(values):
        if any("FECHA" in str(cell).upper() for cell in row):
            header_idx = idx
            break
    
    if header_idx < 0:
        print(f"  ⚠️  No header found in '{tab_name}'")
        return []
    
    header = values[header_idx]
    data_rows = values[header_idx + 1:]
    
    # Find column indices
    fecha_col = next((i for i, h in enumerate(header) if "FECHA" in str(h).upper()), 0)
    concepto_col = next((i for i, h in enumerate(header) if "CONCEPTO" in str(h).upper()), 1)
    importe_col = next((i for i, h in enumerate(header) if "IMPORTE" in str(h).upper()), 3)
    
    transactions = []
    
    for row in data_rows:
        if not row or len(row) <= fecha_col:
            continue
        
        fecha_str = row[fecha_col] if fecha_col < len(row) else ""
        concepto = row[concepto_col] if concepto_col < len(row) else ""
        importe_str = row[importe_col] if importe_col < len(row) else ""
        
        # Skip empty or header-like rows
        if not fecha_str or "FECHA" in str(fecha_str).upper():
            continue
        
        date = parse_date(fecha_str)
        amount = parse_amount(importe_str)
        
        if not date:
            continue
        
        # Default to 0 if amount is missing
        if amount is None:
            amount = 0.0
        
        transactions.append({
            "date": date,
            "description": concepto.strip() if concepto else "Transacción importada",
            "amount": amount,
        })
    
    return transactions


def load_clients_from_json() -> Dict[str, int]:
    """Load clients from JSON seed file to map names to IDs."""
    clients_json = os.path.join(SCRIPT_DIR, "webapp", "prisma", "clients_seed.json")
    
    if not os.path.exists(clients_json):
        print(f"⚠️  Clients JSON not found: {clients_json}")
        return {}
    
    with open(clients_json, "r", encoding="utf-8") as f:
        clients = json.load(f)
    
    # Map name to old_id (which is used in the DB)
    name_to_id = {}
    for client in clients:
        name = client.get("name", "").upper().strip()
        old_id = client.get("old_id")
        if name and old_id:
            name_to_id[name] = old_id
    
    return name_to_id


def main():
    args = parse_args()
    
    print("=" * 60)
    print("  IMPORTACIÓN CC: GOOGLE SHEETS → BASE DE DATOS")
    print("=" * 60)
    
    # Load clients mapping
    print("\n📋 Cargando clientes desde JSON...")
    client_map = load_clients_from_json()
    
    if not client_map:
        print("❌ No se encontraron clientes. Ejecuta extract_consolidated.py primero.")
        sys.exit(1)
    
    print(f"✅ {len(client_map)} clientes cargados")
    
    # Build sheets service
    print("\n🔑 Autenticando con Google Sheets...")
    service = build_sheets_service()
    print("✅ Autenticado")
    
    # Process each CC tab
    all_transactions = []
    
    for tab_name, client_name_target in CC_TAB_TO_CLIENT.items():
        print(f"\n📄 Procesando: {tab_name}")
        
        # Find matching client using exact name first (avoids ambiguous names like MARCOS)
        client_id = client_map.get(client_name_target.upper())

        # Fallback: contains-based matching only if unique
        if not client_id:
            candidates = [cid for name, cid in client_map.items() if client_name_target.upper() in name]
            if len(candidates) == 1:
                client_id = candidates[0]
            elif len(candidates) > 1:
                print(f"  ⚠️  Mapeo ambiguo para '{client_name_target}': {len(candidates)} candidatos")
                continue
        
        if not client_id:
            print(f"  ⚠️  No se encontró cliente para '{client_name_target}'")
            continue
        
        print(f"  ✅ Cliente encontrado: ID {client_id}")
        
        # Read transactions
        transactions = read_cc_tab(service, tab_name)
        print(f"  📊 {len(transactions)} transacciones encontradas")
        
        # Add client ID to each transaction with unique reference
        for txn in transactions:
            txn["clientId"] = client_id
            txn["type"] = "MANUAL"  # Mark as manually imported
            # Create unique reference based on tab, date, and amount to prevent duplicates
            date_str = txn["date"].strftime("%Y%m%d")
            txn["reference"] = f"CC-Import-{tab_name.replace(' ', '_')}-{date_str}-{abs(int(txn['amount']))}"
        
        all_transactions.extend(transactions)
    
    print("\n" + "=" * 60)
    print(f"📊 RESUMEN: {len(all_transactions)} transacciones totales")
    print("=" * 60)
    
    if args.dry_run:
        print("\n🔍 DRY RUN - Preview de primeras 10 transacciones:")
        for i, txn in enumerate(all_transactions[:10], 1):
            print(f"  {i}. Cliente {txn['clientId']} | {txn['date'].strftime('%d/%m/%Y')} | ${txn['amount']} | {txn['description'][:40]}")
        print(f"\n✅ Vista previa completa. Ejecuta sin --dry-run para importar.")
    else:
        # Generate transactions.json for seed_fast.ts to import
        output_file = os.path.join(SCRIPT_DIR, "webapp", "prisma", "transactions.json")
        
        # Convert datetime to ISO format for JSON
        json_transactions = []
        for txn in all_transactions:
            json_transactions.append({
                "clientId": txn["clientId"],
                "date": txn["date"].isoformat(),
                "type": txn["type"],
                "amount": txn["amount"],
                "description": txn["description"],
                "reference": txn["reference"],
            })
        
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(json_transactions, f, ensure_ascii=False, indent=2)
        
        print(f"\n📁 Archivo generado: {output_file}")
        print(f"✅ Ejecuta 'npx tsx prisma/seed_fast.ts' para importar a la BD")


if __name__ == "__main__":
    main()
