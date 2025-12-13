
import pandas as pd
import json
import os
from datetime import datetime

excel_path = '/Users/diegorodriguez/.gemini/antigravity/scratch/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
output_path = '/Users/diegorodriguez/.gemini/antigravity/scratch/sistema_gestion_importaciones/webapp/prisma/orders_seed.json'

def extract_orders():
    print(f"Reading Excel: {excel_path}")
    try:
        # Read Header and Details
        df_head = pd.read_excel(excel_path, sheet_name='CABE_VENTAS')
        df_det = pd.read_excel(excel_path, sheet_name='DETA_VENTAS')
        
        # Normalize columns
        df_head.columns = [str(c).upper().strip() for c in df_head.columns]
        df_det.columns = [str(c).upper().strip() for c in df_det.columns]
        
        print("Header Cols:", df_head.columns.tolist())
        print("Detail Cols:", df_det.columns.tolist())
        
        # Map Details by Order Number
        # Assuming detail has NRO_PEDIDO or similar
        # Let's inspect detail cols from previous step output or guess
        # If detail cols are unknown, I'll print them first in a real run, but here I'll try to be robust
        
        details_map = {}
        for _, row in df_det.iterrows():
            # Try to find common ID
            # DETA_VENTAS cols: FECHA, INV-REM, TIPO_VTA, COD CLI, ... ENVIO Nro, ...
            order_id = row.get('INV-REM') or row.get('NRO_PEDIDO')
            if pd.isna(order_id): continue
            
            try: order_id = int(order_id)
            except: continue
                
            if order_id not in details_map: details_map[order_id] = []
            
            # Item fields
            sku = str(row.get('SKU', '')).strip()
            qty = row.get('CANT') or row.get('CANTIDAD') or 0
            price = row.get('VTA UNI') or row.get('PRECIO') or 0
            shipment_raw = row.get('ENVIO NRO') # Normalized to upper
            
            shipment_num = None
            if pd.notna(shipment_raw):
                try: shipment_num = int(shipment_raw)
                except: pass
            
            details_map[order_id].append({
                'sku': sku,
                'quantity': int(qty) if pd.notna(qty) else 0,
                'unit_price': float(price) if pd.notna(price) else 0.0,
                'product_name': str(row.get('DETALLE', sku)).strip(), # Col is DETALLE
                'shipment_number': shipment_num
            })

        orders = []
        
        for _, row in df_head.iterrows():
            order_number = row.get('NRO_PEDIDO')
            if pd.isna(order_number): continue
            try: order_number = int(order_number)
            except: continue
            
            # Client info
            # We use NRO CLI (old_id) to link
            client_id = row.get('NRO CLI')
            try: client_id = int(client_id) if pd.notna(client_id) else None
            except: client_id = None
            
            # Date
            date_val = row.get('FECHA')
            date_str = date_val.isoformat() if hasattr(date_val, 'isoformat') else str(date_val)
            
            total = row.get('TOTAL USD')
            total = float(total) if pd.notna(total) else 0.0
            
            # Items
            items = details_map.get(order_number, [])
            
            # Extract main shipment number from items (majority vote or first)
            shipment_number = None
            if items:
                # Get first valid shipment number
                for it in items:
                    if it.get('shipment_number'):
                        shipment_number = it['shipment_number']
                        break
            
            # Basic validation
            if not client_id and not items: continue

            orders.append({
                'order_number': order_number,
                'client_old_id': client_id,
                'date': date_str,
                'total_amount': total,
                'status': 'ENTREGADO', # Default for historical
                'items': items,
                'shipment_number': shipment_number
            })
            
        print(f"Found {len(orders)} orders.")
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(orders, f, indent=2, ensure_ascii=False)
            
        print(f"Saved to {output_path}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    extract_orders()
