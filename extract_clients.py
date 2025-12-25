
import pandas as pd
import json
import os

excel_path = '/Users/diegorodriguez/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
output_path = '/Users/diegorodriguez/sistema_gestion_importaciones/webapp/prisma/clients_seed.json'

def extract_clients():
    print(f"Reading Excel: {excel_path}")
    try:
        df = pd.read_excel(excel_path, sheet_name='CLIENTES')
        
        # Normalize columns
        df.columns = [str(c).upper().strip() for c in df.columns]
        print("Columns found:", df.columns)
        
        clients = []
        
        for _, row in df.iterrows():
            old_id = row.get('COD_CLI')
            if pd.isna(old_id): continue
            try: old_id = int(old_id)
            except: continue
            
            name = str(row.get('NOMBRE Y APELLIDO', '')).strip()
            if not name: continue
            
            email = str(row.get('MAIL', '')).strip()
            if email.lower() == 'nan': email = ''
            
            phone = str(row.get('TELEFONO', '')).strip()
            if phone.lower() == 'nan': phone = ''
            
            tipo = str(row.get('TIPO CLI', '')).strip()
            if tipo.lower() == 'nan': tipo = 'CLIENTE'
            
            address = str(row.get('DIRECCION', '')).strip()
            if address.lower() == 'nan': address = ''
            
            clients.append({
                'old_id': old_id,
                'name': name,
                'email': email,
                'phone': phone,
                'type': tipo,
                'address': address
            })
            
        print(f"Found {len(clients)} clients.")
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(clients, f, indent=2, ensure_ascii=False)
            
        print(f"Saved to {output_path}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    extract_clients()
