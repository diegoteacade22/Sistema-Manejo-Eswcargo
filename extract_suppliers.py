
import pandas as pd
import json
import os

# CONFIG
excel_path = '/Users/diegorodriguez/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
output_path = '/Users/diegorodriguez/sistema_gestion_importaciones/webapp/prisma/suppliers_seed.json'
sheet_name = 'PROVEEDORES'

def extract():
    print(f"Reading {excel_path} sheet {sheet_name}...")
    try:
        df = pd.read_excel(excel_path, sheet_name=sheet_name)
        # Normalize
        df.columns = [str(c).upper().strip() for c in df.columns]
        print(f"Columns: {df.columns}")

        suppliers = []
        
        # Adjust column names based on print output if needed. 
        # Assuming typical names: NOMBRE, CONTACTO, EMAIL, DIRECCION, TEL
        # If headers are different, script might need adjustment.
        
        for _, row in df.iterrows():
            name = str(row.get('COMPAÑIA', row.get('COMPAÑIA', ''))).strip()
            if not name or name.lower() == 'nan':
                 continue
                 
            contact = str(row.get('VENDEDOR', '')).strip()
            if contact == 'nan': contact = ''
            
            # No email column found
            email = ''
            
            phone = str(row.get('TELEFONO', '')).strip()
            if phone == 'nan': phone = ''
            
            city = str(row.get('CIUDAD', '')).strip()
            if city == 'nan': city = ''
            
            state = str(row.get('ESTADO', '')).strip()
            if state == 'nan': state = ''
            
            country = str(row.get('Country', '')).strip()
            if country == 'nan': country = ''
            
            address = f"{city}, {state}, {country}".strip(', ')
            
            suppliers.append({
                'name': name,
                'contact': contact,
                'email': email,
                'phone': phone,
                'address': address
            })
            
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(suppliers, f, indent=2, ensure_ascii=False)
            
        print(f"Saved {len(suppliers)} suppliers to {output_path}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    extract()
