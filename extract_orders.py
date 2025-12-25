
import pandas as pd
import json
import os
from datetime import datetime

excel_path = '/Users/diegorodriguez/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
output_path = '/Users/diegorodriguez/sistema_gestion_importaciones/webapp/prisma/orders_seed.json'

def extract_orders():
    # Read Header and Details
    # Try to find header row dynamically
    # Read a chunk of rows to find the header
    try:
        print(f"Reading from: {excel_path}")
        mod_time = datetime.fromtimestamp(os.path.getmtime(excel_path))
        print(f"File Last Modified: {mod_time}")
        
        current_time = datetime.now()
        if (current_time - mod_time).days > 1:
            print("WARNING: The Excel file has not been modified in the last 24 hours. Are you editing the correct file?")

        df_head_raw = pd.read_excel(excel_path, sheet_name='CABE_VENTAS', header=None, nrows=20)
        
        # Find row with NRO_PEDIDO
        header_idx = 0
        for idx, row in df_head_raw.iterrows():
            row_str = [str(x).upper().strip() for x in row.values]
            if 'NRO_PEDIDO' in row_str:
                header_idx = idx
                break
        
        print(f"Computed Header Row Index: {header_idx}")
        df_head = pd.read_excel(excel_path, sheet_name='CABE_VENTAS', header=header_idx)
        # Find header for DETA_VENTAS (Look for 'SKU' or 'INV-REM')
        df_det_raw = pd.read_excel(excel_path, sheet_name='DETA_VENTAS', header=None, nrows=20)
        det_header_idx = 0
        for idx, row in df_det_raw.iterrows():
            row_str = [str(x).upper().strip() for x in row.values]
            if 'SKU' in row_str or 'INV-REM' in row_str:
                det_header_idx = idx
                break
        
        print(f"Computed Details Header Row Index: {det_header_idx}")
        df_det = pd.read_excel(excel_path, sheet_name='DETA_VENTAS', header=det_header_idx)

        # Normalize columns
        df_head.columns = [str(c).upper().strip() for c in df_head.columns]
        df_det.columns = [str(c).upper().strip() for c in df_det.columns]
        
        # Map Details by Order Number
        def clean_num(n):
            try: 
                s = str(n).replace('$', '').replace(',', '')
                if not s or s.lower() == 'nan': return 0.0
                val = float(s)
                return val if not pd.isna(val) else 0.0
            except: 
                return 0.0

        details_map = {}
        order_status_map = {} 

        def normalize_status(s):
            if not s or pd.isna(s): return 'COMPRAR'
            s = str(s).strip()
            # If it's a known value we want to keep clean, we can map it, 
            # but user says "don't invent", so let's just clean whitespace and return.
            if not s or s.lower() == 'nan': return 'COMPRAR'
            
            # Map some common ones to uppercase for consistency in UI badges if they are obvious
            s_up = s.upper()
            if 'ENCARGADO' in s_up: return 'ENCARGADO'
            if 'SALIENDO' in s_up: return 'SALIENDO'
            if 'MIAMI' in s_up: return 'MIAMI'
            if 'ENTREGADO' in s_up: return 'ENTREGADO'
            if 'CANCELADO' in s_up: return 'CANCELADO'
            
            return s

        def clean_text(val):
            if pd.isna(val) or val is None: return None
            s = str(val).strip()
            if s.lower() in ['nan', 'none', 'null', '']: return None
            return s

        for _, row in df_det.iterrows():
            order_id = row.get('INV-REM') or row.get('NRO_PEDIDO')
            if pd.isna(order_id): continue
            
            try: order_id = int(order_id)
            except: continue
                
            if order_id not in details_map: details_map[order_id] = []
            
            sku = clean_text(row.get('SKU')) or ''
            qty = clean_num(row.get('CANT') or row.get('CANTIDAD'))
            price = clean_num(row.get('VTA UNI') or row.get('PRECIO'))
            profit = clean_num(row.get('GANANCIA')) 
            cost = clean_num(row.get('COSTO') or row.get('COSTO X ART'))
            
            item_status_raw = row.get('ESTADO')
            item_status = normalize_status(item_status_raw)
            # Store the status for the order logic (Latest items overwrite, which is usually fine or we filter)
            if item_status != 'COMPRAR':
                 order_status_map[order_id] = item_status 

            shipment_raw = row.get('ENVIO NRO')
            shipment_num = None
            if pd.notna(shipment_raw):
                try: shipment_num = int(shipment_raw)
                except: pass
            
            supplier_name = clean_text(row.get('SUPPLIER'))
            purchase_invoice = clean_text(row.get('INVOICE'))
            if purchase_invoice:
                 purchase_invoice = purchase_invoice.replace('.0', '')

            details_map[order_id].append({
                'sku': sku,
                'quantity': int(qty),
                'unit_price': float(price),
                'unit_cost': float(cost),
                'profit': float(profit),
                'product_name': clean_text(row.get('DETALLE')) or sku,
                'shipment_number': shipment_num,
                'supplier_name': supplier_name,
                'purchase_invoice': purchase_invoice,
                'status': item_status
            })

        # Identify key columns inside the function
        # Use df_head for column identification
        # Smarter col detection
        def find_col(possible_names, default):
            for p in possible_names:
                for c in df_head.columns:
                    if p.upper() in c.upper(): return c
            return default

        col_order = find_col(['INV', 'REM', 'PEDIDO', 'NRO', 'ORDEN'], 'NRO_PEDIDO')
        col_client = find_col(['CLIENTE', 'NOMBRE'], 'CLIENTE')
        col_date = find_col(['FECHA', 'DATE'], 'FECHA')
        col_status = find_col(['ESTADO', 'STATUS'], 'ESTADO')
        col_total = find_col(['TOTAL'], 'TOTAL')
        col_saldo = find_col(['SALDO', 'DEUDA'], 'SALDO')
        col_method = find_col(['METODO', 'FORMA', 'PAGO'], 'METODO')
        col_envio = next((c for c in df_head.columns if 'ENVIO' in c and 'NRO' not in c), None)
        if not col_envio:
             col_envio = find_col(['ENVIO', 'SHIP'], 'ENVIO')
             
        print(f"Columns Found: Order={col_order}, Total={col_total}, Saldo={col_saldo}, Envio={col_envio}")

        orders = []
        
        for index, row in df_head.iterrows(): # Changed df to df_head
            try:
                order_num_raw = row.get(col_order)
                if pd.isna(order_num_raw): continue
                order_number = int(order_num_raw)
            except: continue
                
            try:
                client_val = row.get(col_client)
                client_old_id = None
                client_name_match = None
                
                if pd.notna(client_val):
                    try:
                        client_old_id = int(client_val) 
                    except:
                        # It's likely a name
                        raw_name = clean_text(client_val)
                        if raw_name:
                            client_name_match = raw_name
                                
                date_val = row.get(col_date)
                date_str = date_val.isoformat() if hasattr(date_val, 'isoformat') else str(date_val)
                
                # Total Amount
                total_val = clean_num(row.get(col_total))
                
                # Saldo parsing
                saldo_val = clean_num(row.get(col_saldo))
                
                # Logic: Total - Saldo = Paid Amount
                # Example: Total 100, Saldo 20 (owes 20) -> Paid 80
                # Example: Total 100, Saldo 0 -> Paid 100
                payment_amount = float(total_val) - float(saldo_val)
                if payment_amount < 0: payment_amount = 0 
                # Removed clamp to allow recording overpayments (credit)
                
                payment_method = clean_text(row.get(col_method)) or ''

                # Shipment
                try: 
                    ship_val = row.get(col_envio)
                    shipment_number = int(ship_val) if pd.notna(ship_val) else None
                except: 
                    shipment_number = None

                items = details_map.get(order_number, [])
                
                # INHERIT SHIPMENT FROM ITEMS IF HEADER IS MISSING IT
                if not shipment_number and items:
                    for itm in items:
                        if itm.get('shipment_number'):
                            shipment_number = itm['shipment_number']
                            break
                
                # PRIMARY STATUS SOURCE: DETA_VENTAS (order_status_map)
                # User says: "Tomas los valores de la columna M(estado) ... es simple"
                final_status = order_status_map.get(order_number)
                
                # Fallback to Header if Detail status is somehow missing
                if not final_status or final_status == 'COMPRAR':
                     header_status_raw = str(row.get(col_status, 'COMPRAR'))
                     if header_status_raw != 'nan':
                         final_status = normalize_status(header_status_raw)
                
                if not final_status: final_status = 'COMPRAR'

                order = {
                    'order_number': order_number,
                    'client_old_id': client_old_id,
                    'client_name_match': client_name_match,
                    'date': date_str,
                    'total_amount': total_val,
                    'payment_amount': payment_amount,
                    'payment_method': payment_method,
                    'status': final_status, 
                    'items': items,
                    'shipment_number': shipment_number
                }
                orders.append(order)
                
            except Exception as e:
                print(f"Error processing row {index}: {e}")
                continue

        print(f"Found {len(orders)} orders.")
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(orders, f, indent=2, ensure_ascii=False)
            
        print(f"Saved to {output_path}")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    extract_orders()
