#!/usr/bin/env python3
"""Debug: comprehensive header detection for CABE_VENTAS"""
import pandas as pd
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
excel_path = os.path.join(SCRIPT_DIR, 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx')

print("=" * 60)
print("DEBUGGING CABE_VENTAS HEADER DETECTION")
print("=" * 60)

xl = pd.ExcelFile(excel_path)

# Read first 20 rows without header
df_cv_raw = xl.parse('CABE_VENTAS', header=None, nrows=20)

print(f"\nTotal rows in preview: {len(df_cv_raw)}")
print(f"Total columns: {len(df_cv_raw.columns)}")

for i, r in df_cv_raw.iterrows():
    vals = [str(x).upper().strip() if pd.notna(x) else 'NAN' for x in r.values]
    
    # Check for keywords
    has_invoice = any('INVOICE' in v for v in vals)
    has_pedido = any('PEDIDO' in v for v in vals)
    has_cliente = 'CLIENTE' in vals
    has_fecha = 'FECHA' in vals
    has_total = any('TOTAL' in v for v in vals)
    
    markers = []
    if has_invoice: markers.append('INVOICE')
    if has_pedido: markers.append('PEDIDO')
    if has_cliente: markers.append('CLIENTE')
    if has_fecha: markers.append('FECHA')
    if has_total: markers.append('TOTAL')
    
    marker_str = f" <- {', '.join(markers)}" if markers else ""
    
    print(f"\nRow {i}{marker_str}:")
    print(f"  First 10 cols: {vals[:10]}")
    
    # Decide if this is header
    if (has_invoice or has_pedido) or (has_cliente and has_fecha):
        print(f"  ✅ DETECTED AS HEADER")
        cv_h = i
        break
else:
    print("\n⚠️ NO HEADER DETECTED IN FIRST 20 ROWS")
    cv_h = 0

print(f"\n{'=' * 60}")
print(f"FINAL DECISION: Using row {cv_h} as header")
print(f"{'=' * 60}")

# Now parse with that header
df_cv = xl.parse('CABE_VENTAS', header=cv_h)
df_cv.columns = [str(c).upper().strip() for c in df_cv.columns]

print(f"\nResulting columns after parsing:")
for idx, col in enumerate(df_cv.columns):
    print(f"  {idx:2d}: '{col}'")

print(f"\nFirst data row:")
first_row = df_cv.iloc[0].to_dict()
for k, v in list(first_row.items())[:10]:
    print(f"  {k}: {v}")
