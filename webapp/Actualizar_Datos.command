#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo -n -e "\033]0;Actualizador Dale Gas\007"
echo "===================================================="
echo "      ACTUALIZANDO DATOS DESDE GOOGLE SHEETS"
echo "===================================================="
echo ""

# Ejecutar script de sincronización
./sync_excel.sh

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ EXITO: Datos actualizados correctamente."
    # Opcional: Reiniciar servidor si está corriendo? 
    # Next.js suele recargar datos si se refresca la página, 
    # pero prisma necesita 'prisma generate' si cambia esquema, aquí solo cambian datos.
    # Los datos se leen de la DB, que acaba de ser re-sembrada.
else
    echo ""
    echo "❌ ERROR: Hubo un problema al actualizar."
    echo "Revisa los mensajes de error arriba."
fi

echo ""
echo "Presiona cualquier tecla para cerrar..."
read -n 1 -s
