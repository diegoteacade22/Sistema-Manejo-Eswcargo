
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
    return s

def clean_date(d):
    if pd.isna(d) or str(d).lower() == 'nan': return None
    try:
        if isinstance(d, datetime):
            return d.isoformat()
        return str(d)
    except:
        return None

def normalize_status(s):
    if not s or pd.isna(s): return 'COMPRAR'
    s = str(s).strip()
    if not s or s.lower() == 'nan': return 'COMPRAR'
    s_up = s.upper()
    if 'ENCARGADO' in s_up: return 'ENCARGADO'
    if 'SALIENDO' in s_up: return 'SALIENDO'
    if 'MIAMI' in s_up: return 'MIAMI'
    if 'BSAS' in s_up or 'LLEGÓ' in s_up or 'LLEGO' in s_up or 'RECIBIDO' in s_up: return 'EN BSAS'
    if 'TRANSITO' in s_up: return 'EN TRANSITO'
    if 'ENTREGADO' in s_up or 'FINALIZADO' in s_up: return 'ENTREGADO'
    if 'CANCELADO' in s_up: return 'CANCELADO'
    return s

def extract_all():
    start_time = time.time()
    
    # Manejo de filtros de fecha por argumento
    days_filter = None
    if len(sys.argv) > 1:
        try:
            days_filter = int(sys.argv[1])
            if days_filter > 0:
                print(f"⏱️ Filtrando datos de los últimos {days_filter} días...")
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

    # 3. ENVIOS (CABE_ENVIOS) - FILTRADO POR FECHA
    print("🚛 Extrayendo Envíos...")
    df_env_raw = xl.parse('CABE_ENVIOS', header=None, nrows=10)
    h_idx = 0
    for idx, row in df_env_raw.iterrows():
        if 'NRO ENVIO' in [str(x).upper().strip() for x in row.values]:
            h_idx = idx
            break
    df_env = xl.parse('CABE_ENVIOS', header=h_idx)
    df_env.columns = [str(c).upper().strip() for c in df_env.columns]
    shipments = []
    
    now = datetime.now()
    for _, row in df_env.iterrows():
        s_num = row.get('NRO ENVIO')
        if pd.isna(s_num): continue
        try: s_num = int(s_num)
        except: continue
        if s_num == 0: continue
        
        # Filtro de fecha
        if days_filter:
            date_val = row.get('FECHA SAL')
            if pd.notna(date_val) and isinstance(date_val, (datetime, pd.Timestamp)):
                if (now - date_val.to_pydatetime() if hasattr(date_val, 'to_pydatetime') else now - date_val).days > days_filter:
                    continue

        shipments.append({
            'shipment_number': s_num,
            'old_client_id': int(row.get('COD CLI')) if pd.notna(row.get('COD CLI')) else None,
            'forwarder': clean_text(row.get('FORWARDER')),
            'date_shipped': clean_date(row.get('FECHA SAL')),
            'date_arrived': clean_date(row.get('FECHA LLEG')),
            'weight_fw': clean_num(row.get('PESO')),
            'weight_cli': clean_num(row.get('PESO.1')),
            'type_load': clean_text(row.get('TIPO CARGA')),
            'status': normalize_status(clean_text(row.get('LLEGO?'))),
            'notes': clean_text(row.get('OBSERVACION')),
            'price_total': clean_num(row.get('ENVIO COB')),
            'cost_total': clean_num(row.get('COSTO TOT')),
            'profit': clean_num(row.get('GANANCIA'))
        })
    with open(os.path.join(output_dir, 'shipments_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(shipments, f, indent=2, ensure_ascii=False)

    # 4. PEDIDOS (CABE_VENTAS + DETA_VENTAS) - FILTRADO POR FECHA
    print("📑 Extrayendo Pedidos y Detalles...")
    df_cv_raw = xl.parse('CABE_VENTAS', header=None, nrows=15)
    cv_h = 0
    for i, r in df_cv_raw.iterrows():
        if 'NRO_PEDIDO' in [str(x).upper().strip() for x in r.values]:
            cv_h = i
            break
    df_cv = xl.parse('CABE_VENTAS', header=cv_h)
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
    # Helper para encontrar columnas
    def find_col(possible_names, default):
        for p in possible_names:
            for c in df_cv.columns:
                if p.upper() in c.upper(): return c
        return default

    col_order_name = find_col(['INV', 'REM', 'PEDIDO', 'NRO', 'ORDEN'], 'NRO_PEDIDO')
    recent_order_ids = set(df_cv[col_order_name].tolist())

    # Mapear detalles por pedido (Solo los recientes)
    det_map = {}
    order_status_map = {}
    for _, row in df_dv.iterrows():
        oid = row.get('INV-REM') or row.get('NRO_PEDIDO')
        if pd.isna(oid): continue
        try: oid = int(oid)
        except: continue
        
        if days_filter and oid not in recent_order_ids: continue
        
        if oid not in det_map: det_map[oid] = []
        
        st = normalize_status(clean_text(row.get('ESTADO')))
        if st != 'COMPRAR': order_status_map[oid] = st
        
        det_map[oid].append({
            'sku': clean_text(row.get('SKU')),
            'quantity': int(clean_num(row.get('CANT') or row.get('CANTIDAD'))),
            'unit_price': clean_num(row.get('VTA UNI') or row.get('PRECIO')),
            'unit_cost': clean_num(row.get('COSTO') or row.get('COSTO X ART')),
            'profit': clean_num(row.get('GANANCIA')),
            'product_name': clean_text(row.get('DETALLE')),
            'shipment_number': int(row.get('ENVIO NRO')) if pd.notna(row.get('ENVIO NRO')) else None,
            'status': st
        })

    orders = []
    for _, row in df_cv.iterrows():
        onum = row.get('NRO_PEDIDO')
        if pd.isna(onum): continue
        try: onum = int(onum)
        except: continue
        
        items = det_map.get(onum, [])
        total = clean_num(row.get('TOTAL'))
        
        # Si el total es 0 o NaN pero hay items, sumamos los items
        if (pd.isna(total) or total == 0) and items:
            total = sum(i['unit_price'] * i['quantity'] for i in items)
            
        saldo = clean_num(row.get('SALDO'))
        
        orders.append({
            'order_number': onum,
            'client_old_id': int(row.get('CLIENTE')) if str(row.get('CLIENTE')).isdigit() else None,
            'client_name_match': clean_text(row.get('CLIENTE')) if not str(row.get('CLIENTE')).isdigit() else None,
            'date': clean_date(row.get('FECHA')),
            'total_amount': total,
            'payment_amount': max(0, total - saldo) if pd.notna(saldo) else total,
            'payment_method': clean_text(row.get('METODO')),
            'status': order_status_map.get(onum) or normalize_status(clean_text(row.get('ESTADO'))),
            'items': items
        })
    with open(os.path.join(output_dir, 'orders_seed.json'), 'w', encoding='utf-8') as f:
        json.dump(orders, f, indent=2, ensure_ascii=False)

    end_time = time.time()
    print(f"\n✅ Extracción completa en {end_time - start_time:.2f} segundos.")
    print(f"📁 Archivos generados en {output_dir}")

if __name__ == "__main__":
    extract_all()
