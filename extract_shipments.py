
import pandas as pd
import json
import os
from datetime import datetime

# Configuration
excel_path = '/Users/diegorodriguez/.gemini/antigravity/scratch/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
output_path = '/Users/diegorodriguez/.gemini/antigravity/scratch/sistema_gestion_importaciones/webapp/prisma/shipments_seed.json'

def extract_shipments():
    print(f"Reading Excel: {excel_path}")
    try:
        df = pd.read_excel(excel_path, sheet_name='CABE_ENVIOS')
        # Normalize columns
        df.columns = [str(c).upper().strip() for c in df.columns]
        print("Columns found:", df.columns)
        
        shipments = []
        
        def clean_num(n):
            try: 
                s = str(n).replace('$', '').replace(',', '')
                if not s or s.lower() == 'nan': return 0.0
                val = float(s)
                return val if not pd.isna(val) else 0.0
            except: 
                return 0.0
        
        def clean_date(d):
            if pd.isna(d) or str(d).lower() == 'nan': return None
            try:
                # Assuming excel reads as datetime obj usually
                if isinstance(d, datetime):
                    return d.isoformat()
                # If string, try parse (naive)
                return str(d)
            except:
                return None

        # Columns map based on previous inspection
        # 'NRO ENVIO', 'CLIENTE', 'COD CLI', 'FORWARDER', 'FECHA SAL', 'FECHA LLEG'
        # 'PESO FW', 'TIPO CARGA', 'CANT ART', 'VALOR KG', 'PRECIO X ART', 'COSTO TOT'
        # 'DETALLE CARGA', 'PESO CLI', 'VALOR UN', 'ENVIO COB', 'VENTA X KG', 'GANANCIA'
        # 'INVOICE', 'TIPO', 'PAGO?', 'OBSERVACION', 'SEMANA', 'LLEGO?', 'COMI BSAS'
        
        for _, row in df.iterrows():
            shipment_number = row.get('NRO ENVIO')
            # Skip invalid
            if pd.isna(shipment_number): continue
            try:
                shipment_number = int(shipment_number)
            except:
                continue

            # Skip if NRO ENVIO is 0 or empty
            if shipment_number == 0: continue

            cod_cli = row.get('COD CLI')
            try:
                client_id = int(cod_cli) if pd.notna(cod_cli) else None
            except:
                client_id = None
                
            shipment = {
                'shipment_number': shipment_number,
                'client_id': client_id, # Requires mapping to new client DB ID, will use 'old_id' logic?
                # Actually, clients were seeded with 'old_id' = COD CLI. 
                # We will handle the relation in the seed script by looking up the client.
                'old_client_id': client_id, 
                'forwarder': str(row.get('FORWARDER', '')),
                'date_shipped': clean_date(row.get('FECHA SAL')),
                'date_arrived': clean_date(row.get('FECHA LLEG')),
                'weight_fw': clean_num(row.get('PESO FW')),
                'weight_cli': clean_num(row.get('PESO CLI')),
                'type_load': str(row.get('TIPO CARGA', '')),
                'item_count': int(clean_num(row.get('CANT ART', 0))),
                'cost_total': clean_num(row.get('COSTO TOT')),
                'price_total': clean_num(row.get('ENVIO COB')), # Venta total
                'profit': clean_num(row.get('GANANCIA')),
                'invoice': str(row.get('INVOICE', '')),
                'status': str(row.get('LLEGO?', '')), # Using LLEGO? as status for now
                'notes': str(row.get('OBSERVACION', ''))
            }
            
            shipments.append(shipment)
            
        print(f"Found {len(shipments)} shipments.")
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(shipments, f, indent=2, ensure_ascii=False)
            
        print(f"Saved to {output_path}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    extract_shipments()
