
import pandas as pd

excel_path = '/Users/diegorodriguez/02_DESARROLLO/Proyectos_Activos/sistema_gestion_importaciones/VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'

pedido_nro = 2306

print(f"Buscando el pedido {pedido_nro} en el Excel...")

try:
    # Leer DETA_VENTAS
    df_dv = pd.read_excel(excel_path, sheet_name='DETA_VENTAS')
    
    # Buscar el pedido en las columnas posibles (INV-REM, NRO_PEDIDO)
    col = None
    for c in df_dv.columns:
        if str(c).upper() in ['INV-REM', 'NRO_PEDIDO']:
            col = c
            break
            
    if col:
        matches = df_dv[df_dv[col] == pedido_nro]
        if not matches.empty:
            print(f"Encontrado en DETA_VENTAS ({len(matches)} items):")
            # Mostrar solo columnas relevantes para depurar
            relevant_cols = [col, 'DETALLE', 'ENVIO NRO', 'ESTADO', 'ENVIO', 'SHIPMENT']
            existing_relevant = [c for c in relevant_cols if c in df_dv.columns]
            print(matches[existing_relevant])
        else:
            print("No se encontró el nro de pedido en DETA_VENTAS.")
    else:
        print("No se encontró columna de nro de pedido en DETA_VENTAS.")

    # Revisar CABE_VENTAS para ver el estado general
    df_cv = pd.read_excel(excel_path, sheet_name='CABE_VENTAS')
    col_cv = None
    for c in df_cv.columns:
        if 'PEDIDO' in str(c).upper() or 'NRO' in str(c).upper():
            col_cv = c
            break
    
    if col_cv:
        match_cv = df_cv[df_cv[col_cv] == pedido_nro]
        if not match_cv.empty:
             print("\nDatos en CABE_VENTAS:")
             print(match_cv)
except Exception as e:
    print(f"Error: {e}")
