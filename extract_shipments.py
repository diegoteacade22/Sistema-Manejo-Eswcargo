
import pandas as pd
import json
import os
from datetime import datetime

# Configuration
excel_path = '/Users/diegorodriguez/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
output_path = '/Users/diegorodriguez/sistema_gestion_importaciones/webapp/prisma/shipments_seed.json'

def clean_text(text):
    if pd.isna(text) or str(text).lower() == 'nan': return ""
    return str(text).strip()

def normalize_status(s):
    if not s: return ""
    s_up = s.upper().strip()
    if 'BSAS' in s_up or 'LLEGÓ' in s_up or 'LLEGO' in s_up or 'RECIBIDO' in s_up: return 'EN BSAS'
    if 'TRANSITO' in s_up: return 'EN TRANSITO'
    if 'ENTREGADO' in s_up or 'FINALIZADO' in s_up: return 'ENTREGADO'
    return s_up

def extract_shipments():
    print(f"Reading Excel: {excel_path}")
    try:
        # Dynamically find header for CABE_ENVIOS
        df_raw = pd.read_excel(excel_path, sheet_name='CABE_ENVIOS', header=None, nrows=20)
        header_idx = 0
        for idx, row in df_raw.iterrows():
            row_str = [str(x).upper().strip() for x in row.values]
            if 'NRO ENVIO' in row_str:
                header_idx = idx
                break
        
        print(f"Computed Shipment Header Row Index: {header_idx}")
        df = pd.read_excel(excel_path, sheet_name='CABE_ENVIOS', header=header_idx)
        
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

        # Columns map based on inspection
        # 'NRO ENVIO', 'CLIENTE', 'COD CLI', 'FORWARDER', 'FECHA SAL', 'FECHA LLEG', 'PESO', 'TIPO', 'CANT ART', ...
        # 'TIPO CARGA', 'PESO.1', 'VALOR UN', 'ENVIO COB', 'VENTA X KG', 'GANANCIA', 'INVOICE', 'TIPO.1', 'PAGO?', 'OBSERVACION', ...
        
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
                
            status_raw = clean_text(row.get('LLEGO?'))
            status = normalize_status(status_raw)
            if status == 'COMPRAR' or not status:
                # Infer from dates
                if row.get('FECHA LLEG') and pd.notna(row.get('FECHA LLEG')):
                    status = 'EN BSAS'
                elif row.get('FECHA SAL') and pd.notna(row.get('FECHA SAL')):
                    status = 'EN TRANSITO'
                else:
                    status = 'MIAMI'

            shipment = {
                'shipment_number': shipment_number,
                'client_id': client_id,
                'old_client_id': client_id, 
                'forwarder': str(row.get('FORWARDER', '')),
                'date_shipped': clean_date(row.get('FECHA SAL')),
                'date_arrived': clean_date(row.get('FECHA LLEG')),
                'weight_fw': clean_num(row.get('PESO')), 
                'weight_cli': clean_num(row.get('PESO.1')), 
                'type_load': str(row.get('TIPO CARGA', '')),
                'item_count': int(clean_num(row.get('CANT ART', 0))),
                'cost_total': clean_num(row.get('COSTO TOT')),
                'price_total': clean_num(row.get('ENVIO COB')), 
                'profit': clean_num(row.get('GANANCIA')),
                'invoice': str(row.get('INVOICE', '')),
                'status': status, 
                'notes': str(row.get('OBSERVACION', '')),
                'is_paid': str(row.get('PAGO?', '')).lower() in ['si', 'yes', 'ok', 's', 'true']
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
