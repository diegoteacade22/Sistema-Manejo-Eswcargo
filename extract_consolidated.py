
import pandas as pd
import json
import os
import time
import sys
from datetime import datetime

# Configuration
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
excel_path = os.path.join(SCRIPT_DIR, 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx')
output_dir = os.path.join(SCRIPT_DIR, 'webapp/prisma')
logs_dir = os.path.join(SCRIPT_DIR, 'logs/sync')

def clean_num(n):
    try: 
        s = str(n).replace('$', '').replace(',', '')
        if not s or s.lower() == 'nan': return 0.0
        val = float(s)
        return val if not pd.isna(val) else 0.0
    except: 
        return 0.0

def clean_text(val):
    if pd.isna(val) or val is None: return None
    s = str(val).strip()
    if s.lower() in ['nan', 'none', 'null', '']: return None
    if s.endswith('.0'): s = s[:-2]
    return s

def clean_date(d):
    if pd.isna(d) or str(d).lower() == 'nan': return None
    try:
        if isinstance(d, datetime):
            return d.isoformat()
        return str(d)
    except:
        return None

def parse_int_like(value):
    if pd.isna(value) or value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in ['nan', 'none', 'null']:
        return None
    try:
        f = float(s.replace(',', ''))
        if f.is_integer():
            return int(f)
    except:
        pass
    if s.isdigit():
        return int(s)
    return None

def normalize_status(s):
    if not s or pd.isna(s): return 'COMPRAR'
    s = str(s).strip()
    if not s or s.lower() == 'nan': return 'COMPRAR'
    s_up = s.upper()
    if 'ENCARGADO' in s_up: return 'ENCARGADO'
    if 'SALIENDO' in s_up: return 'SALIENDO'
    if 'LLEGANDO' in s_up: return 'LLEGANDO'
    if 'MIAMI' in s_up: return 'MIAMI'
    if 'BSAS' in s_up or 'LLEGÓ' in s_up or 'LLEGO' in s_up or 'RECIBIDO' in s_up: return 'EN BSAS'
    if 'TRANSITO' in s_up: return 'EN TRANSITO'
    if 'ENTREGADO' in s_up or 'FINALIZADO' in s_up: return 'ENTREGADO'
    if 'CANCELADO' in s_up: return 'CANCELADO'
    return s

def normalize_shipment_status(value):
    raw_status = clean_text(value)
    if not raw_status:
        return None
    normalized_status = normalize_status(raw_status)
    if normalized_status not in {
        'MIAMI',
        'SALIENDO',
        'LLEGANDO',
        'EN BSAS',
        'EN TRANSITO',
        'ENTREGADO',
        'CANCELADO',
    }:
        return None
    return normalized_status

def calculate_active_order_total(items):
    return sum(
        item['unit_price'] * item['quantity']
        for item in items
        if normalize_status(item.get('status')) != 'CANCELADO'
    )

def extract_all():
    start_time = time.time()
    
    # Manejo de filtros de fecha por argumento
    days_filter = None
    force_full = False
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg.upper() == 'FULL':
            force_full = True
            print("🚀 MODO FULL: Se extraerán TODOS los datos sin filtros de fecha.")
        else:
            try:
                days_filter = int(arg)
                if days_filter > 0:
                    print(f"⏱️ Filtrando datos de los últimos {days_filter} días...")
                else:
                    force_full = True
            except:
                pass

    print(f"🚀 Iniciando extracción consolidada desde: {excel_path}")
    
    if not os.path.exists(excel_path):
        print(f"❌ Error: Archivo {excel_path} not found.")
        return

    # Usamos pd.ExcelFile para leer todas las hojas de una vez de forma eficiente
    print("⏳ Leyendo archivo Excel (esto puede demorar unos segundos)...")
    xl = pd.ExcelFile(excel_path)
    sheet_names = xl.sheet_names
    print(f"✅ Archivo cargado. Hojas encontradas: {sheet_names}")

    # 1. CLIENTES (Siempre cargamos todos para mapeo, son livianos)
    print("👥 Extrayendo Clientes...")
    df_clients = xl.parse('CLIENTES')
    df_clients.columns = [str(c).upper().strip() for c in df_clients.columns]
    clients = []
    for _, row in df_clients.iterrows():
        old_id = row.get('COD_CLI')
        if pd.isna(old_id): continue
        try: old_id = int(old_id)
        except: continue
        name = str(row.get('NOMBRE Y APELLIDO', '')).strip()
        if not name: continue
        clients.append({
            'old_id': old_id,
            'name': name,
            'email': clean_text(row.get('MAIL')),
            'phone': clean_text(row.get('TELEFONO')),
            'type': clean_text(row.get('TIPO CLI')) or 'CLIENTE',
            'address': clean_text(row.get('DIRECCION'))
        })
    with open(os.path.join(output_dir, 'clients_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(clients, f, indent=2, ensure_ascii=False)

    # 2. PRODUCTOS (Siempre todos para mapeo de SKUs)
    print("📦 Extrayendo Productos...")
    df_prod = xl.parse('ARTICULOS TECNO')
    df_prod.columns = [str(c).upper().strip() for c in df_prod.columns]
    products = []
    seen_skus = set()
    for _, row in df_prod.iterrows():
        sku = str(row.get('SKU', '')).strip()
        if not sku or sku.lower() in ['nan', 'none', ''] or sku in seen_skus:
            continue
        seen_skus.add(sku)
        products.append({
            'sku': sku,
            'name': str(row.get('NOMBRE ARTICULO', sku)).strip(),
            'color_grade': clean_text(row.get('COLOR/GRADE')),
            'type': clean_text(row.get('TIPO')) or 'PRODUCTO',
            'model': clean_text(row.get('MODELO')),
            'brand': clean_text(row.get('MARCA')),
            'weight': clean_num(row.get('PESO KG')),
            'status': clean_text(row.get('ESTADO')) or 'ACTIVO',
            'stock': int(clean_num(row.get('STOCK'))),
            'lp1': clean_num(row.get('LP1'))
        })
    with open(os.path.join(output_dir, 'products_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(products, f, indent=2, ensure_ascii=False)

    # 3. PROVEEDORES
    print("🏢 Extrayendo Proveedores...")
    df_suppliers = xl.parse('PROVEEDORES')
    df_suppliers.columns = [str(c).upper().strip() for c in df_suppliers.columns]
    suppliers = []
    for _, row in df_suppliers.iterrows():
        old_id = row.get('COD_PRO')
        if pd.isna(old_id): continue
        try: old_id = int(old_id)
        except: continue
        name = clean_text(row.get('COMPAÑIA')) or clean_text(row.get('VENDEDOR'))
        if not name: continue
        suppliers.append({
            'old_id': old_id,
            'name': name,
            'contact': clean_text(row.get('VENDEDOR')),
            'phone': clean_text(row.get('TELEFONO')),
            'city': clean_text(row.get('CIUDAD')),
            'country': clean_text(row.get('Country')),
            'notes': clean_text(row.get('OBSERVACIONES'))
        })
    with open(os.path.join(output_dir, 'suppliers_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(suppliers, f, indent=2, ensure_ascii=False)

    # 4. ENVIOS (CABE_ENVIOS) - FILTRADO POR FECHA
    print("🚛 Extrayendo Envíos...")
    df_env_raw = xl.parse('CABE_ENVIOS', header=None, nrows=10)
    h_idx = 0
    for idx, row in df_env_raw.iterrows():
        headers = [str(x).upper().strip() for x in row.values]
        if 'NRO ENVIO' in headers or 'NUMERO' in headers:
            h_idx = idx
            break
    df_env = xl.parse('CABE_ENVIOS', header=h_idx)
    df_env.columns = [str(c).upper().strip() for c in df_env.columns]
    shipment_number_col = next(
        (column for column in df_env.columns if column in ('NRO ENVIO', 'NUMERO')),
        None,
    )
    if not shipment_number_col:
        raise KeyError(
            "No se encontró la columna de número de envío en CABE_ENVIOS. "
            f"Columnas disponibles: {list(df_env.columns)}"
        )
    shipments = []
    
    now = datetime.now()
    for _, row in df_env.iterrows():
        s_num = row.get(shipment_number_col)
        if pd.isna(s_num): continue
        try: s_num = int(s_num)
        except: continue
        if s_num == 0: continue
        
        # Filtro de fecha
        if days_filter:
            source_dates = []
            for column_name in ('FECHA SAL', 'FECHA LLEG'):
                date_val = row.get(column_name)
                if pd.notna(date_val) and isinstance(date_val, (datetime, pd.Timestamp)):
                    source_dates.append(
                        date_val.to_pydatetime() if hasattr(date_val, 'to_pydatetime') else date_val
                    )
            if source_dates and all((now - date_val).days > days_filter for date_val in source_dates):
                continue

        try:
            raw_cli = row.get('COD CLI')
            if pd.isna(raw_cli): old_client_id = None
            else: old_client_id = int(float(raw_cli))
        except:
            old_client_id = None

        shipment_status = normalize_shipment_status(row.get('LLEGO?'))

        shipments.append({
            'shipment_number': s_num,
            'old_client_id': old_client_id,
            'client_name_match': clean_text(row.get('CLIENTE')),
            'forwarder': clean_text(row.get('FORWARDER')),
            'date_shipped': clean_date(row.get('FECHA SAL')),
            'date_arrived': clean_date(row.get('FECHA LLEG')),
            'weight_fw': clean_num(row.get('PESO')),
            'weight_cli': clean_num(row.get('PESO.1')),
            'type_load': clean_text(row.get('TIPO CARGA')) or clean_text(row.get('TIPO')),
            'status': shipment_status,
            'notes': clean_text(row.get('OBSERVACION')),
            'price_total': clean_num(row.get('ENVIO COB')),
            'cost_total': clean_num(row.get('COSTO TOT')),
            'profit': clean_num(row.get('GANANCIA'))
        })
    with open(os.path.join(output_dir, 'shipments_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(shipments, f, indent=2, ensure_ascii=False)

    # 4. PEDIDOS (CABE_VENTAS + DETA_VENTAS) - FILTRADO POR FECHA
    print("📑 Extrayendo Pedidos y Detalles...")
    # CABE_VENTAS: Header is at row 3 (0-indexed)
    df_cv = xl.parse('CABE_VENTAS', header=3)
    df_cv.columns = [str(c).upper().strip() for c in df_cv.columns]

    # Pre-filtrar cabeceras por fecha si aplica
    if days_filter:
        def is_recent(d):
            if pd.isna(d) or not isinstance(d, (datetime, pd.Timestamp)): return True # Por seguridad incluimos si no hay fecha
            delta = now - (d.to_pydatetime() if hasattr(d, 'to_pydatetime') else d)
            return delta.days <= days_filter
        df_cv = df_cv[df_cv['FECHA'].apply(is_recent)]
        print(f"   (Filtro: {len(df_cv)} pedidos recientes identificados)")

    # Header dinámico para DETA_VENTAS
    df_dv_raw = xl.parse('DETA_VENTAS', header=None, nrows=15)
    dv_h = 0
    for i, r in df_dv_raw.iterrows():
        vals = [str(x).upper().strip() for x in r.values]
        if 'SKU' in vals or 'INV-REM' in vals:
            dv_h = i
            break
    df_dv = xl.parse('DETA_VENTAS', header=dv_h)
    df_dv.columns = [str(c).upper().strip() for c in df_dv.columns]
    
    # Helper para encontrar columnas con mejor matching
    def find_col(df, possible_names, default):
        # First try exact match
        for p in possible_names:
            if p in df.columns:
                return p
        # Then try partial match
        for p in possible_names:
            for c in df.columns:
                if p.upper() in c.upper():
                    return c
        # Return default (must exist)
        if default in df.columns:
            return default
        # Fallback: return first column that seems relevant
        for c in df.columns:
            for p in possible_names:
                if p.upper() in c.upper():
                    return c
        return None

    col_order_name = find_col(df_cv, ['INVOICE', 'INV', 'NRO_PEDIDO', 'PEDIDO', 'NRO'], 'INVOICE')
    if not col_order_name or col_order_name not in df_cv.columns:
        print(f"⚠️ ERROR: No se encontró columna de número de pedido. Columnas disponibles: {list(df_cv.columns)}")
        raise KeyError(f"Column for order number not found in CABE_VENTAS")
    
    recent_order_ids = set(df_cv[col_order_name].tolist())

    # Snapshot completo de detalles para reconciliar asignaciones de envíos.
    # La fecha de venta no cambia cuando se reasigna o se quita un producto.
    all_det_map = {}

    # Mapear detalles por pedido (solo los recientes para el sync financiero)
    det_map = {}
    det_client_map = {} # Map order_id -> {id: ..., name: ...}
    order_status_map = {}
    for _, row in df_dv.iterrows():
        oid = row.get('INV-REM') or row.get('NRO_PEDIDO')
        if pd.isna(oid): continue
        try: oid = int(oid)
        except: continue
        
        st = normalize_status(clean_text(row.get('ESTADO')))
        
        try:
            raw_env_nro = row.get('ENVIO NRO')
            if pd.isna(raw_env_nro): sn_val = None
            else: sn_val = int(float(raw_env_nro))
        except:
            sn_val = None

        item_data = {
            'sku': clean_text(row.get('SKU')),
            'quantity': int(clean_num(row.get('CANT') or row.get('CANTIDAD'))),
            'unit_price': clean_num(row.get('VTA UNI') or row.get('PRECIO')),
            'unit_cost': clean_num(row.get('COSTO') or row.get('COSTO X ART')),
            'profit': clean_num(row.get('GANANCIA')),
            'product_name': clean_text(row.get('DETALLE')),
            'shipment_number': sn_val,
            'status': st
        }
        all_det_map.setdefault(oid, []).append(item_data)

        # --- NUEVO: Capturar cliente desde Detalles para Fallback ---
        if oid not in det_client_map: # Solo si no lo tenemos ya (asumimos consistencia por pedido)
             c_id = None
             try: 
                 raw_cli = row.get('COD CLI')
                 if pd.notna(raw_cli): c_id = int(float(raw_cli))
             except: pass
             
             c_name = clean_text(row.get('NOMBRE')) # En DETA_VENTAS es 'NOMBRE'
             
             if c_id or c_name:
                 det_client_map[oid] = {
                     'id': c_id,
                     'name': c_name
                 }

        if days_filter and oid not in recent_order_ids:
            continue

        det_map.setdefault(oid, []).append(item_data)
        if st != 'COMPRAR':
            order_status_map[oid] = st
    
    # ... (orders processing)
    
    orders = []
    payments_only = []
    order_headers_detected = 0
    
    # Headers finder to make it robust - now passing df_cv
    col_total = find_col(df_cv, ['TOTAL USD', 'TOTAL', 'IMPORTE'], 'TOTAL USD')
    col_pago = find_col(df_cv, ['PAGO', 'COBRO', 'COBRADO'], 'PAGO')
    col_metodo = find_col(df_cv, ['METODO'], 'METODO')
    col_product = find_col(df_cv, ['PRODUCTO', 'DETALLE', 'ARTICULO'], None)

    for _, row in df_cv.iterrows():
        onum_raw = row.get(col_order_name)  # Use the found column name
        onum = parse_int_like(onum_raw)
        if onum is not None:
            order_headers_detected += 1
        total_val = clean_num(row.get(col_total))
        pago_val = clean_num(row.get(col_pago))
        
        # Determine Client
        client_id_val = None
        client_name_val = None
        raw_cli_cabe = row.get('CLIENTE')
        raw_nro_cli = row.get('NRO CLI')
        
        if pd.notna(raw_cli_cabe):
            s_cli = str(raw_cli_cabe).strip()
            if s_cli.isdigit(): client_id_val = int(s_cli)
            else: client_name_val = s_cli
        if pd.notna(raw_nro_cli):
            try: client_id_val = int(float(raw_nro_cli))
            except: pass
            
        if not client_id_val and not client_name_val:
            continue

        # case A: It's an Order (Cargo)
        if onum is not None:
            items = det_map.get(onum, [])
            if items:
                total_val = calculate_active_order_total(items)
            
            if not client_id_val and not client_name_val:
                fallback = det_client_map.get(onum)
                if fallback:
                    client_id_val = fallback['id']
                    client_name_val = fallback['name']

            orders.append({
                'order_number': onum,
                'client_old_id': client_id_val,
                'client_name_match': client_name_val,
                'date': clean_date(row.get('FECHA')),
                'total_amount': total_val,
                'payment_amount': pago_val, # Use the PAGO column if present
                'payment_method': clean_text(row.get(col_metodo)),
                'status': order_status_map.get(onum) or normalize_status(clean_text(row.get('ESTADO'))),
                'items': items
            })
        
        # Case B: It's a Payment-only row
        elif pago_val != 0 or total_val != 0:
            # If total_val is set but no order #, it might be a payment (like in the user image)
            amt = pago_val if pago_val != 0 else total_val
            payments_only.append({
                'client_old_id': client_id_val,
                'client_name_match': client_name_val,
                'date': clean_date(row.get('FECHA')),
                'amount': amt,
                'method': clean_text(row.get(col_metodo)) or 'COBRO',
                'description': clean_text(row.get(col_product)) or 'Cobro / Pago'
            })

    # Save both
    with open(os.path.join(output_dir, 'orders_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(orders, f, indent=2, ensure_ascii=False)
    with open(os.path.join(output_dir, 'payments_extra_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(payments_only, f, indent=2, ensure_ascii=False)

    shipment_reconciliation = [
        {
            'order_number': order_number,
            'client_old_id': det_client_map.get(order_number, {}).get('id'),
            'client_name_match': det_client_map.get(order_number, {}).get('name'),
            'items': items
        }
        for order_number, items in all_det_map.items()
    ]
    with open(os.path.join(output_dir, 'shipment_reconciliation_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(shipment_reconciliation, f, indent=2, ensure_ascii=False)

    # 6. COMPRAS (CAB_COMPRAS + DETA_COMPRAS)
    print("🛒 Extrayendo Compras y Proveedores...")
    # Header dinámico para CAB_COMPRAS
    df_cc_raw = xl.parse('CAB_COMPRAS', header=None, nrows=10)
    cc_h = 0
    for i, r in df_cc_raw.iterrows():
        if 'INVOICE NRO' in [str(x).upper().strip() for x in r.values]:
            cc_h = i
            break
    df_cc = xl.parse('CAB_COMPRAS', header=cc_h)
    df_cc.columns = [str(c).upper().strip() for c in df_cc.columns]
    
    # Header dinámico para DETA_COMPRAS
    df_dc_raw = xl.parse('DETA_COMPRAS', header=None, nrows=10)
    dc_h = 0
    for i, r in df_dc_raw.iterrows():
        if 'SKU' in [str(x).upper().strip() for x in r.values]:
            dc_h = i
            break
    df_dc = xl.parse('DETA_COMPRAS', header=dc_h)
    df_dc.columns = [str(c).upper().strip() for c in df_dc.columns]
    
    # Mapear detalles de compra por factura
    comp_det_map = {}
    for _, row in df_dc.iterrows():
        inv = clean_text(row.get('INV-REM'))
        if not inv: continue
        if inv not in comp_det_map: comp_det_map[inv] = []
        comp_det_map[inv].append({
            'sku': clean_text(row.get('SKU')),
            'product_name': clean_text(row.get('DETALLE')),
            'quantity': int(clean_num(row.get('CANT'))),
            'unit_cost': clean_num(row.get('$ UNI')),
            'subtotal': clean_num(row.get('TOTAL'))
        })
        
    purchases = []
    for _, row in df_cc.iterrows():
        inv = clean_text(row.get('INVOICE NRO'))
        if not inv: continue
        
        # Determine Supplier ID
        p_id = row.get('COD_PRO')
        try: p_id = int(float(p_id)) if pd.notna(p_id) else None
        except: p_id = None
        
        purchases.append({
            'invoice_number': inv,
            'supplier_old_id': p_id,
            'supplier_name': clean_text(row.get('PROVEEDOR')),
            'date': clean_date(row.get('FECHA')),
            'total_amount': clean_num(row.get('TOTAL USD')),
            'payment_method': clean_text(row.get('TIPO PAGO')),
            'items': comp_det_map.get(inv, [])
        })
        
    with open(os.path.join(output_dir, 'purchases_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(purchases, f, indent=2, ensure_ascii=False)

    summary = {
        'clients': len(clients),
        'products': len(products),
        'suppliers': len(suppliers),
        'shipments': len(shipments),
        'orders': len(orders),
        'order_headers_detected': order_headers_detected,
        'payments_extra': len(payments_only),
        'purchases': len(purchases),
        'mode': 'FULL' if force_full else (f'LAST_{days_filter}_DAYS' if days_filter else 'AUTO'),
        'timestamp': datetime.now().isoformat()
    }

    print("\n📊 Resumen de extracción:")
    for key, value in summary.items():
        print(f"   - {key}: {value}")

    if force_full:
        required_non_empty = ['clients', 'products', 'suppliers', 'shipments', 'orders']
        missing = [k for k in required_non_empty if summary[k] == 0]
        if missing:
            raise RuntimeError(f"Extracción FULL inválida: hojas críticas vacías ({', '.join(missing)}).")

    os.makedirs(logs_dir, exist_ok=True)
    latest_summary_path = os.path.join(logs_dir, 'extract_summary_latest.json')
    history_summary_path = os.path.join(logs_dir, 'extract_summary_history.jsonl')
    with open(latest_summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    with open(history_summary_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(summary, ensure_ascii=False) + '\n')
    print(f"🧾 Resumen guardado en: {latest_summary_path}")

    end_time = time.time()
    print(f"\n✅ Extracción completa en {end_time - start_time:.2f} segundos.")
    print(f"📁 Archivos generados en {output_dir}")

if __name__ == "__main__":
    extract_all()
