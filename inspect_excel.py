import pandas as pd
import os
from datetime import datetime

excel_path = '/Users/diegorodriguez/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'

try:
    # --- INSPECT DETA_VENTAS ---
    print("\n--- Inspecting DETA_VENTAS ---")
    df = pd.read_excel(excel_path, sheet_name='DETA_VENTAS', header=None, nrows=15)
    print("First 15 rows raw to find header:")
    print(df.head(15))
    
    header_row = 0
    # Try to find header
    for i, row in df.iterrows():
        row_str_list = row.astype(str).str.upper().tolist()
        if any('NRO' in x for x in row_str_list) or any('ORDER' in x for x in row_str_list):
            print(f"Potential Header at Row {i}: {row_str_list}")
            header_row = i
            break
            
    print(f"Ventas Header Row: {header_row}")
    df_v = pd.read_excel(excel_path, sheet_name='DETA_VENTAS', header=header_row, nrows=50)
    print("Columns:", df_v.columns.tolist())
    
    # Check for relevant columns
    # print("Relevant Columns Check:")
    # for col in df_v.columns:
    #     if 'ENVIO' in str(col).upper() or 'ESTADO' in str(col).upper():
    #         print(f"Found: {col}")
    
    import sys
    sys.exit(0)

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
