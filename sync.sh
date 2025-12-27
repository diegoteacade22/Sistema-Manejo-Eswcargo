#!/bin/bash

# 🔄 Script de Sincronización Bidireccional
# Sincroniza datos entre Excel y la Base de Datos en ambas direcciones

echo "🔄 Sistema de Sincronización Bidireccional"
echo "=========================================="
echo ""

# Directorio del proyecto
PROJECT_DIR="/Users/diegorodriguez/sistema_gestion_importaciones"
cd "$PROJECT_DIR"

# Función para mostrar menú
show_menu() {
    echo "Selecciona una opción:"
    echo ""
    echo "  1) 📥 Importar desde Excel a BD (Excel → BD)"
    echo "  2) 📤 Exportar desde BD a Excel (BD → Excel)"
    echo "  3) 🔄 Sincronización completa (Bidireccional)"
    echo "  4) ❌ Salir"
    echo ""
}

# Función para importar desde Excel (Optimizada con Velocidades)
import_from_excel() {
    echo "Elija la velocidad de sincronización:"
    echo "  1) ⚡ FLASH (Últimos 7 días) - Recomendado para el día a día"
    echo "  2) 🏃 RÁPIDA (Últimos 30 días)"
    echo "  3) 🐢 COMPLETA (Todo el historial)"
    read -p "Opción: " speed_opt
    
    DAYS=0
    case $speed_opt in
        1) DAYS=7 ;;
        2) DAYS=30 ;;
        3) DAYS=0 ;;
        *) echo "❌ Opción inválida"; return 1 ;;
    esac

    echo ""
    echo "🚀 Iniciando sincronización ($DAYS días)..."
    echo ""
    
    # 1. Extracción Consolidada con filtro
    echo "📊 Paso 1/2: Extrayendo datos desde Excel..."
    python3 extract_consolidated.py $DAYS
    
    if [ $? -ne 0 ]; then
        echo "❌ Error en fase de extracción"
        return 1
    fi
    
    # 2. Sembrado Diferencial
    echo ""
    echo "💾 Paso 2/2: Aplicando cambios a la base de datos..."
    cd webapp
    npx tsx prisma/seed_fast.ts
    cd ..
    
    if [ $? -ne 0 ]; then
        echo "❌ Error en fase de aplicación a BD"
        return 1
    fi
    
    echo ""
    echo "✅ Sincronización completada exitosamente"
}

# Función para exportar a Excel
export_to_excel() {
    echo "📤 Exportando datos desde Base de Datos a Excel..."
    echo ""
    
    python3 export_to_excel.py
    
    if [ $? -ne 0 ]; then
        echo "❌ Error al exportar a Excel"
        return 1
    fi
    
    echo ""
    echo "✅ Exportación completada exitosamente"
}

# Función para sincronización bidireccional
bidirectional_sync() {
    echo "🔄 Sincronización Bidireccional Selectiva"
    echo "=========================================="
    import_from_excel
    
    if [ $? -ne 0 ]; then
        echo "❌ Error en importación, abortando"
        return 1
    fi
    
    echo ""
    echo "Paso 2/2: BD → Excel"
    echo "--------------------"
    export_to_excel
}

# Loop principal
while true; do
    echo ""
    echo "🔄 Sistema de Sincronización"
    echo "============================"
    echo "1) 📥 Importar (Excel → BD)"
    echo "2) 📤 Exportar (BD → Excel)"
    echo "3) 🔄 Bidireccional (Ambos)"
    echo "4) ❌ Salir"
    echo ""
    read -p "Opción: " option
    
    case $option in
        1) import_from_excel ;;
        2) export_to_excel ;;
        3) bidirectional_sync ;;
        4) exit 0 ;;
        *) echo "❌ Opción inválida" ;;
    esac
    
    echo ""
    read -p "Presiona Enter para continuar..."
    clear
done
