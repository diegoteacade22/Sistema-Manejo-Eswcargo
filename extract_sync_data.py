
import pandas as pd
import json
import os
import sys

excel_path = 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
output_path = 'webapp/sync_data.json'

def clean_value(val):
    if pd.isna(val):
        return None
    return str(val).strip()

def extract_sync_data():
    if not os.path.exists(excel_path):
        print(f"Error: File {excel_path} not found.")
        sys.exit(1)

    print("Reading Excel file...")
    # Read DETA_VENTAS to link Orders -> Shipments
    # Based on previous inspections, header might be row 1 (0-indexed) or changes.
    # Let's inspect or assume standard. Usually row 1.
    
    try:
        df = pd.read_excel(excel_path, sheet_name='DETA_VENTAS', header=3) 
        
        # Verify columns exist
        print("Columns found:", df.columns.tolist())
        
        sync_data = []
        
        for idx, row in df.iterrows():
            try:
                # Extract using known names
                order_val = row.get('INV-REM')
                shipment_val = row.get('ENVIO Nro')
                status_val = row.get('ESTADO')
                
                if pd.notna(order_val):
                    # Clean Order - sometimes might be string like "2233" or "2233.0"
                    order_val_str = str(order_val).replace('.0', '').strip()
                    if not order_val_str.isdigit():
                        continue 
                        
                    order_num = int(order_val_str)
                    
                    # Clean Shipment
                    shipment_num = None
                    if pd.notna(shipment_val):
                        s_str = str(shipment_val).replace('.0', '').strip()
                        if s_str.isdigit():
                            shipment_num = int(s_str)
                    
                    status = str(status_val).strip() if pd.notna(status_val) else None
                    
                    sync_item = {
                        'order_number': order_num,
                        'shipment_number': shipment_num,
                        'status': status,
                        'qty': row.get('CANT'),
                        'desc': row.get('DETALLE'),
                        'color': row.get('COLOR')
                    }
                    sync_data.append(sync_item)
            except Exception as e:
                # print(f"Row error: {e}")
                continue

        print(f"Extracted {len(sync_data)} rows.")
        
        # Filter for 2233 and 2253-2259 for verification
        check_orders = [x for x in sync_data if x['order_number'] in [2233, 797]] # 797 is shipment, order 2233
        print("Data for Order 2233:", [x for x in sync_data if x['order_number'] == 2233])
        
        with open(output_path, 'w') as f:
            json.dump(sync_data, f, indent=2)
            
        print(f"Data saved to {output_path}")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    extract_sync_data()
