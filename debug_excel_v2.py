import pandas as pd
import numpy as np

excel_path = 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
xl = pd.ExcelFile(excel_path)
df = xl.parse('CABE_ENVIOS', header=1) # Header is at row 1 (0-indexed)

# Normalize column names
df.columns = [str(c).strip() for c in df.columns]

print("Columns:", df.columns.tolist())

# Try to find Envio 166 (or whatever number it is)
# Since the image says Tomas Rodriguez has Peso 2.1 and Envio Cob 210
target = df[(df['PESO'] == 2.1) | (df['PESO.1'] == 2.1)]
print("\nRows with PESO 2.1:")
print(target[['NRO ENVIO', 'CLIENTE', 'PESO', 'PESO.1', 'ENVIO COB', 'VENTA X KG']].to_string())

# Also search for Tomas Rodriguez again, but print more rows
tomas = df[df['CLIENTE'].astype(str).str.contains('Tomas Rodriguez', case=False, na=False)]
print("\nAll Tomas Rodriguez rows:")
print(tomas[['NRO ENVIO', 'CLIENTE', 'PESO', 'PESO.1', 'ENVIO COB', 'VENTA X KG']].to_string())
