
import pandas as pd
import os

path = 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
print(f"Loading {path}...")

# Load raw to find header
df_raw = pd.read_excel(path, sheet_name='CABE_ENVIOS', header=None, nrows=20)
header_idx = 0
for i, row in df_raw.iterrows():
    vals = [str(x).upper().strip() for x in row.values]
    if 'NRO ENVIO' in vals:
        header_idx = i
        break

print(f"Header at index {header_idx}")
df = pd.read_excel(path, sheet_name='CABE_ENVIOS', header=header_idx)
df.columns = [str(c).upper().strip() for c in df.columns]

# Filter
target = 825
print(f"Looking for full data of Shipment {target}...")

for i, r in df.iterrows():
    try:
        if int(r['NRO ENVIO']) == target:
            print(f"--- MATCH ROW {i} ---")
            for col, val in r.items():
                print(f"{col}: {val}")
            break
    except: pass
