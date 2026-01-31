import pandas as pd
import numpy as np
from datetime import datetime

excel_path = 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
xl = pd.ExcelFile(excel_path)
df_env_raw = xl.parse('CABE_ENVIOS', header=None, nrows=20)

h_idx = -1
for idx, row in df_env_raw.iterrows():
    vals = [str(x).upper().strip() for x in row.values]
    if 'NRO ENVIO' in vals:
        h_idx = idx
        break

if h_idx != -1:
    print(f"Header found at row {h_idx}")
    df = xl.parse('CABE_ENVIOS', header=h_idx)
    # Filter for Tomas Rodriguez
    tomas = df[df.iloc[:, 1].astype(str).str.contains('Tomas Rodriguez', case=False, na=False)]
    print("\nColumns found:")
    print(df.columns.tolist())
    print("\nData for Tomas Rodriguez (first 5 rows):")
    cols_of_interest = ['NRO ENVIO', 'CLIENTE', 'PESO', 'ENVIO COB', 'VENTA X KG']
    # Check which of these are actually in df.columns
    existing_cols = [c for c in df.columns if any(p in str(c).upper() for p in ['NRO ENVIO', 'CLIENTE', 'PESO', 'ENVIO COB', 'VENTA X KG'])]
    print(df[existing_cols].head(5).to_string())
else:
    print("NRO ENVIO not found in first 20 rows")
