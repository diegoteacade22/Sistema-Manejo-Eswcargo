
import pandas as pd
import sys

excel_path = '/Users/diegorodriguez/02_DESARROLLO/Proyectos_Activos/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'

search_value = 828

print(f"Searching for shipment number {search_value} in Excel...")

try:
    # Check DETA_VENTAS (where shipments usually are)
    df = pd.read_excel(excel_path, sheet_name='DETA_VENTAS')
    
    # Try to find columns with 'ENVIO' or similar
    shipment_cols = [c for c in df.columns if 'ENVIO' in str(c).upper() or 'SHIPMENT' in str(c).upper()]
    print(f"Shipment related columns: {shipment_cols}")
    
    found = False
    for col in shipment_cols:
        matches = df[df[col] == search_value]
        if not matches.empty:
            print(f"FOUND in DETA_VENTAS, column '{col}':")
            print(matches)
            found = True
            
    if not found:
        print(f"NOT FOUND in DETA_VENTAS.")
        
    # Check other sheets just in case
    xls = pd.ExcelFile(excel_path)
    for sheet in xls.sheet_names:
        if sheet == 'DETA_VENTAS': continue
        print(f"Checking sheet: {sheet}")
        df_sheet = pd.read_excel(excel_path, sheet_name=sheet)
        for col in df_sheet.columns:
            try:
                matches = df_sheet[df_sheet[col] == search_value]
                if not matches.empty:
                    print(f"FOUND in {sheet}, column '{col}':")
                    print(matches)
                    found = True
            except:
                pass
                
except Exception as e:
    print(f"Error: {e}")
