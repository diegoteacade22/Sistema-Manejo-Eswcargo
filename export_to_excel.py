#!/usr/bin/env python3
"""
Script para EXPORTAR datos desde la Base de Datos PostgreSQL hacia Excel
Esto completa la sincronización BIDIRECCIONAL

Uso:
    python3 export_to_excel.py

Funcionalidad:
- Lee clientes desde la base de datos PostgreSQL
- Actualiza la hoja CLIENTES en Excel
- Preserva datos existentes en Excel
- Solo actualiza campos que están vacíos en Excel
"""

import pandas as pd
import psycopg2
import os
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv('webapp/.env')

# Configuración
EXCEL_PATH = 'VENTAS COMPRAS 2023 al 2025 Para Sistema en Gemini.xlsx'
SHEET_NAME = 'CLIENTES'

# Obtener DATABASE_URL desde .env
DATABASE_URL = os.getenv('DIRECT_URL') or os.getenv('DATABASE_URL')

if not DATABASE_URL:
    print("❌ Error: No se encontró DATABASE_URL en webapp/.env")
    exit(1)

def connect_db():
    """Conecta a la base de datos PostgreSQL"""
    try:
        # Parsear la URL de conexión
        # Format: postgres://user:pass@host:port/dbname
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    except Exception as e:
        print(f"❌ Error conectando a la base de datos: {e}")
        exit(1)

def export_clients_to_excel():
    """Exporta clientes desde BD a Excel"""
    print("📤 Exportando clientes desde BD a Excel...")
    
    # Conectar a BD
    conn = connect_db()
    cursor = conn.cursor()
    
    try:
        # Leer clientes desde BD
        query = """
            SELECT 
                "old_id" as cod_cli,
                "name" as nombre,
                "email" as mail,
                "phone" as telefono,
                "document_id" as dni_cuit,
                "address" as direccion,
                "city" as ciudad,
                "state" as provincia,
                "country" as pais,
                "type" as tipo_cli,
                "notes" as notas
            FROM "Client"
            WHERE "old_id" IS NOT NULL
            ORDER BY "old_id"
        """
        
        cursor.execute(query)
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        
        # Crear DataFrame desde BD
        df_db = pd.DataFrame(rows, columns=columns)
        print(f"✓ Leídos {len(df_db)} clientes desde la BD")
        
        # Leer Excel existente
        if not os.path.exists(EXCEL_PATH):
            print(f"❌ Error: No se encontró {EXCEL_PATH}")
            return
        
        df_excel = pd.read_excel(EXCEL_PATH, sheet_name=SHEET_NAME)
        print(f"✓ Leídos {len(df_excel)} clientes desde Excel")
        
        # Normalizar columnas de Excel
        df_excel.columns = [str(c).upper().strip() for c in df_excel.columns]
        
        # Mapeo de columnas BD → Excel
        column_map = {
            'cod_cli': 'COD_CLI',
            'nombre': 'NOMBRE Y APELLIDO',
            'mail': 'MAIL',
            'telefono': 'TELEFONO',
            'dni_cuit': 'DNI/CUIT',
            'direccion': 'DIRECCION',
            'tipo_cli': 'TIPO CLI'
        }
        
        # Actualizar Excel con datos de BD (SOLO si Excel está vacío)
        updated_count = 0
        for idx, db_row in df_db.iterrows():
            cod_cli = db_row['cod_cli']
            
            # Buscar en Excel
            excel_idx = df_excel[df_excel['COD_CLI'] == cod_cli].index
            
            if len(excel_idx) > 0:
                # Cliente existe en Excel - actualizar solo campos vacíos
                excel_idx = excel_idx[0]
                
                for db_col, excel_col in column_map.items():
                    if excel_col in df_excel.columns:
                        db_value = db_row[db_col]
                        excel_value = df_excel.at[excel_idx, excel_col]
                        
                        # Solo actualizar si Excel está vacío y BD tiene valor
                        if pd.isna(excel_value) and pd.notna(db_value) and db_value != '':
                            df_excel.at[excel_idx, excel_col] = db_value
                            updated_count += 1
                            print(f"  → Actualizado {db_row['nombre']}: {excel_col} = {db_value}")
            else:
                # Cliente NO existe en Excel - agregar nueva fila
                new_row = {}
                for db_col, excel_col in column_map.items():
                    if excel_col in df_excel.columns:
                        new_row[excel_col] = db_row[db_col]
                
                df_excel = pd.concat([df_excel, pd.DataFrame([new_row])], ignore_index=True)
                print(f"  + Agregado nuevo cliente: {db_row['nombre']}")
                updated_count += 1
        
        if updated_count > 0:
            # Guardar Excel actualizado
            # Crear backup primero
            backup_path = EXCEL_PATH.replace('.xlsx', '_backup.xlsx')
            if os.path.exists(EXCEL_PATH):
                import shutil
                shutil.copy2(EXCEL_PATH, backup_path)
                print(f"✓ Backup creado en: {backup_path}")
            
            # Guardar con todas las hojas
            with pd.ExcelFile(EXCEL_PATH) as xls:
                with pd.ExcelWriter(EXCEL_PATH, engine='openpyxl') as writer:
                    # Copiar todas las hojas menos CLIENTES
                    for sheet_name in xls.sheet_names:
                        if sheet_name != SHEET_NAME:
                            df_sheet = pd.read_excel(xls, sheet_name=sheet_name)
                            df_sheet.to_excel(writer, sheet_name=sheet_name, index=False)
                    
                    # Escribir hoja CLIENTES actualizada
                    df_excel.to_excel(writer, sheet_name=SHEET_NAME, index=False)
            
            print(f"\n✅ Excel actualizado: {updated_count} cambios aplicados")
        else:
            print("\n✓ No hay cambios para aplicar a Excel")
        
    except Exception as e:
        print(f"❌ Error durante la exportación: {e}")
        import traceback
        traceback.print_exc()
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    export_clients_to_excel()
