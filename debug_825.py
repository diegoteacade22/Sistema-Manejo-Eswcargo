
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
print(f"Looking for Shipment {target}...")

# Check dtypes
# print(df['NRO ENVIO'].dtype)

row = df[df['NRO ENVIO'] == target]
if row.empty:
    print("Not found by direct match. Checking loose match...")
    # iterate
    for i, r in df.iterrows():
        try:
            if int(r['NRO ENVIO']) == target:
                print(f"Found at row index {i}")
                print(r)
                print(f"COD CLI RAW VALUE: '{r['COD CLI']}'")
                print(f"COD CLI TYPE: {type(r['COD CLI'])}")
                break
        except: pass
else:
    print("Found direct match.")
    r = row.iloc[0]
    print(r)
    print(f"COD CLI RAW VALUE: '{r['COD CLI']}'")
    print(f"COD CLI TYPE: {type(r['COD CLI'])}")
