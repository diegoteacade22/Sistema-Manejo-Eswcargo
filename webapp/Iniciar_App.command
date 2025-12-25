#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Título de la ventana
echo -n -e "\033]0;Dale Gas - App\007"

echo "===================================================="
echo "   Iniciando DALE GAS - Sistema de Importaciones"
echo "===================================================="
echo "Por favor espere mientras se carga el sistema..."
echo ""

# Esperar a que el servidor esté listo (máximo 60 segundos) para abrir el navegador
(
    count=0
    while ! nc -z localhost 3000 2>/dev/null; do   
      sleep 1
      count=$((count+1))
      if [ $count -gt 60 ]; then break; fi
    done
    # Pequeña pausa extra para asegurar que Next.js pueda responder
    sleep 1
    open "http://localhost:3000"
) &

# Ejecutar el script principal que levanta el servidor
# Asumimos que iniciar_sistema.sh está en el mismo directorio
if [ -f "./iniciar_sistema.sh" ]; then
    bash ./iniciar_sistema.sh
else
    echo "Error: No se encontró iniciar_sistema.sh"
    npm run dev
fi
