
import pandas as pd
import os

excel_path = 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'

if not os.path.exists(excel_path):
    print("Excel not found")
    exit()

xl = pd.ExcelFile(excel_path, engine='openpyxl')
print("Sheets:", xl.sheet_names)

# Inspect CABE_VENTAS headers
df_cv_raw = xl.parse('CABE_VENTAS', header=None, nrows=15)
cv_h = 0
for i, r in df_cv_raw.iterrows():
    if 'NRO_PEDIDO' in [str(x).upper().strip() for x in r.values] or 'NRO PEDIDO' in [str(x).upper().strip() for x in r.values]:
        cv_h = i
        break
df_cv = xl.parse('CABE_VENTAS', header=cv_h)
print("\n--- CABE_VENTAS HEADERS ---")
print(df_cv.columns.tolist())

# Inspect DETA_VENTAS headers
df_dv_raw = xl.parse('DETA_VENTAS', header=None, nrows=15)
dv_h = 0
for i, r in df_dv_raw.iterrows():
    vals = [str(x).upper().strip() for x in r.values]
    if 'SKU' in vals or 'INV-REM' in vals:
        dv_h = i
        break
df_dv = xl.parse('DETA_VENTAS', header=dv_h)
print("\n--- DETA_VENTAS HEADERS ---")
print(df_dv.columns.tolist())
