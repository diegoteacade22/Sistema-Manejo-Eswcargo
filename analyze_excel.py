import pandas as pd
import os

file_path = '/Users/diegorodriguez/.gemini/antigravity/scratch/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'

try:
    xl = pd.ExcelFile(file_path)
    print("Sheet names:", xl.sheet_names)

    for sheet in xl.sheet_names:
        print(f"\n--- Sheet: {sheet} ---")
        df = pd.read_excel(file_path, sheet_name=sheet, nrows=5)
        print("Columns:", list(df.columns))
        print("First 3 rows:")
        print(df.head(3).to_string())
        print("-" * 30)

except Exception as e:
    print(f"Error reading Excel file: {e}")
