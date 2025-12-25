
import pandas as pd

excel_path = '/Users/diegorodriguez/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'

try:
    xl = pd.ExcelFile(excel_path)
    print("Sheets:", xl.sheet_names)
    
    if 'CABE_VENTAS' in xl.sheet_names:
        df = pd.read_excel(excel_path, sheet_name='CABE_VENTAS', nrows=5)
        print("CABE_VENTAS Columns:", df.columns.tolist())
        print("Sample Data:", df.head(1).to_dict(orient='records'))
    else:
        print("CABE_VENTAS not found")
        
except Exception as e:
    print(f"Error: {e}")
