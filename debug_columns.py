#!/usr/bin/env python3
"""Quick diagnostic: show column names in CABE_VENTAS"""
import pandas as pd
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
excel_path = os.path.join(SCRIPT_DIR, 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx')

print("Loading CABE_VENTAS sheet...")
xl = pd.ExcelFile(excel_path)

# Try to find header
df_cv_raw = xl.parse('CABE_VENTAS', header=None, nrows=15)
cv_h = 0
for i, r in df_cv_raw.iterrows():
    vals = [str(x).upper().strip() for x in r.values]
    print(f"Row {i}: {vals[:10]}")  # Show first 10 columns
    if any('PEDIDO' in v or 'NRO' in v or 'INV' in v or 'REM' in v for v in vals):
        cv_h = i
        print(f"  ^^ Detected as header row")

print(f"\nUsing header at row {cv_h}")
df_cv = xl.parse('CABE_VENTAS', header=cv_h)
df_cv.columns = [str(c).upper().strip() for c in df_cv.columns]

print(f"\nActual columns found:")
for idx, col in enumerate(df_cv.columns):
    print(f"  {idx}: '{col}'")

print(f"\nTotal columns: {len(df_cv.columns)}")
print(f"Total rows (excluding header): {len(df_cv)}")
