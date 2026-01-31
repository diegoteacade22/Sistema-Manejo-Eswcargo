#!/bin/bash

# 🔄 Script de Sincronización Bidireccional
# Sincroniza datos entre Excel y la Base de Datos en ambas direcciones

echo "🔄 Sistema de Sincronización Bidireccional"
echo "=========================================="
echo ""

# Directorio del proyecto
PROJECT_DIR="/Users/diegorodriguez/02_DESARROLLO/Proyectos_Activos/sistema_gestion_importaciones"
cd "$PROJECT_DIR"

# Detectar Python (Prioridad venv)
PYTHON_EXEC="python3"
if [ -f "./venv/bin/python3" ]; then
    PYTHON_EXEC="./venv/bin/python3"
elif [ -f "./venv_new/bin/python3" ]; then
    PYTHON_EXEC="./venv_new/bin/python3"
fi

# Función para mostrar menú
show_menu() {
    echo "Selecciona una opción:"
    echo ""
    echo "  1) 📥 Importar desde Excel a BD (Excel → BD)"
    echo "  2) 📤 Exportar desde BD a Excel (BD → Excel)"
    echo "  3) 🔄 Sincronización completa (Bidireccional)"
    echo "  4) 🧹 LIMPIEZA Y SINCRONIZACIÓN TOTAL"
    echo "  5) ❌ Salir"
    echo ""
}

# Función para importar desde Excel (Optimizada con Velocidades)
import_from_excel() {
    echo "Elija la velocidad de sincronización:"
    echo "  1) ⚡ FLASH (Últimos 7 días) - Recomendado para el día a día"
    echo "  2) 🏃 RÁPIDA (Últimos 30 días)"
    echo "  3) 🐢 COMPLETA (Todo el historial)"
    echo "  4) 🧹 TOTAL CON LIMPIEZA"
    read -p "Opción: " speed_opt
    
    DAYS=0
    case $speed_opt in
        1) DAYS=7 ;;
        2) DAYS=30 ;;
        3) DAYS=0 ;;
        4) DAYS="FULL" ;;
        *) echo "❌ Opción inválida"; return 1 ;;
    esac

    echo ""
    echo "🚀 Iniciando sincronización ($DAYS)..."
    echo ""
    
    # Llamar al script interno de webapp que ya maneja venv y pasos
    cd webapp
    ./sync_excel.sh $DAYS
    cd ..
}

# Función para exportar a Excel
export_to_excel() {
    echo "📤 Exportando datos desde Base de Datos a Excel..."
    echo ""
    
    $PYTHON_EXEC export_to_excel.py
    
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
    echo "4) 🧹 Limpieza y Sincronización Total"
    echo "5) ❌ Salir"
    echo ""
    read -p "Opción: " option
    
    case $option in
        1) import_from_excel ;;
        2) export_to_excel ;;
        3) bidirectional_sync ;;
        4) 
           cd webapp
           ./sync_excel.sh FULL
           cd ..
           ;;
        5) exit 0 ;;
        *) echo "❌ Opción inválida" ;;
    esac
    
    echo ""
    read -p "Presiona Enter para continuar..."
    clear
done
