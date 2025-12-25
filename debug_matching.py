
import pandas as pd
import os

excel_path = '/Users/diegorodriguez/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'

print(f"Reading {excel_path}...")
df_head = pd.read_excel(excel_path, sheet_name='CABE_VENTAS') # Auto header?
df_det = pd.read_excel(excel_path, sheet_name='DETA_VENTAS')

# Find a sample order that failed
sample_id = 2258

print(f"\n--- Looking for Order {sample_id} in DETAILS ---")
found_det = df_det[df_det.apply(lambda row: str(sample_id) in str(row.values), axis=1)]
print(found_det)

print(f"\n--- Checking 'INV-REM' and 'NRO_PEDIDO' columns in DETAILS for {sample_id} ---")
# Check if columns exist
cols = [str(c).upper().strip() for c in df_det.columns]
print("Columns:", cols)

# Try raw iteration like the script
print("\n--- Simulating Script Logic ---")
count = 0
for idx, row in df_det.iterrows():
    # Emulate extraction
    order_id_val = row.get('INV-REM') or row.get('NRO_PEDIDO')
    if str(order_id_val) == str(sample_id):
        print(f"Match found at row {idx}: {row.values}")
        count += 1
        
print(f"Total Matches: {count}")
