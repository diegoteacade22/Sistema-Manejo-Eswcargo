
import pandas as pd
import json
import os

# Configuration
excel_path = '/Users/diegorodriguez/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
output_path = '/Users/diegorodriguez/sistema_gestion_importaciones/webapp/prisma/products_seed.json'

def extract_products():
    print(f"Reading Excel: {excel_path}")
    try:
        # Load the sheet. Using 'VENTAS' as it likely has the product details used in sales.
        # Alternatively check for a 'PRODUCTOS' or 'STOCK' sheet if it exists, but analyze_excel.py didn't show all sheets clearly.
        # Let's inspect sheet names first just in case.
        xl = pd.ExcelFile(excel_path)
        print("Sheets found:", xl.sheet_names)
        
        target_sheet = "ARTICULOS TECNO"
        print(f"Extracting products strictly from sheet: {target_sheet}")
        
        try:
            df = pd.read_excel(excel_path, sheet_name=target_sheet)
        except Exception:
            # Fallback if case sensitivity is an issue, though logs showed uppercase
            target_sheet = "Articulos Tecno"
            df = pd.read_excel(excel_path, sheet_name=target_sheet)
        
        # Normalize columns
        df.columns = [str(c).upper().strip() for c in df.columns]
        print("Columns found:", df.columns)
        
        products_map = {}
        
        for _, row in df.iterrows():
            sku = str(row.get('SKU', '')).strip()
            if not sku or sku.lower() in ['nan', 'none', '']:
                continue
                
            # Valid products only
            if sku in products_map:
                continue
                
            name = str(row.get('NOMBRE ARTICULO', sku)).strip()
            
            # Mapping fields
            def clean_str(s):
                if pd.isna(s): return None
                s = str(s).strip()
                if s.lower() in ['nan', 'none', '']: return None
                return s

            # Mapping fields
            # Text fields
            color_grade = clean_str(row.get('COLOR/GRADE'))
            
            # Boolean & Status Logic
            tipo = clean_str(row.get('TIPO')) or 'PRODUCTO' # Default to PRODUCTO if None? Or just let it be None if schema allows. Assuming required for logic below.
            if not tipo: tipo = '' # Handle for logic
            
            modelo = clean_str(row.get('MODELO'))
            marca = clean_str(row.get('MARCA'))
            status_raw = clean_str(row.get('ESTADO')) or 'ACTIVO' 
            webpage = clean_str(row.get('WEBPAGE')) or ''
            
            activo = row.get('ACTIVO')
            
            # Robust Active check
            # 1. Default to True if valid product
            active = True
            
            # 2. Check explicit "NO"
            if pd.notna(activo):
                s_act = str(activo).upper()
                if 'NO' in s_act or 'FALSE' in s_act:
                    active = False
            
            # 3. OVERRIDE: If Type is REPUESTO, set as inactive/discontinued
            if 'REPUESTO' in str(tipo).upper():
                active = False
                status_raw = 'DISCONTINUADO'

            # Numeric fields
            def clean_num(n):
                try: 
                    s = str(n).replace('$', '').replace(',', '')
                    if not s or s.lower() == 'nan': return 0.0
                    val = float(s)
                    return val if not pd.isna(val) else 0.0
                except: 
                    return 0.0

            weight = clean_num(row.get('PESO KG', 0))
            volum = clean_num(row.get('VOLUM', 0))
            last_purchase_cost = clean_num(row.get('ULT CPRA', 0))
            lp1 = clean_num(row.get('LP1', 0))
            lp2 = clean_num(row.get('LP2', 0))
            lp3 = clean_num(row.get('LP3', 0))
            
            # Debugging LP1 specific
            # ... (removed verbose debug for speed) ...
            
            stock = int(clean_num(row.get('STOCK', 0)))
            
            products_map[sku] = {
                'sku': sku,
                'name': name,
                'color_grade': color_grade,
                'type': tipo,
                'model': modelo,
                'brand': marca,
                'weight': weight,
                'volum': volum,
                'status': status_raw,
                'last_purchase_cost': last_purchase_cost,
                'active': active,
                'webpage': webpage,
                'lp1': lp1,
                'lp2': lp2,
                'lp3': lp3
            }
            
        print(f"Found {len(products_map)} unique products.")
        lp1_count = sum(1 for p in products_map.values() if p['lp1'] > 0)
        print(f"Products with valid LP1: {lp1_count}")
        
        # Save to JSON
        products_list = list(products_map.values())
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(products_list, f, indent=2, ensure_ascii=False)
            
        print(f"Saved to {output_path}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    extract_products()
