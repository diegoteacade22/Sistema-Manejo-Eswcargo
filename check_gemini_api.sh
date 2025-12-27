#!/bin/bash

# 🔍 Script para verificar configuración de API Key de Gemini

echo "======================================"
echo "🔑 Verificación de API Key de Gemini"
echo "======================================"
echo ""

# Verificar que la variable esté configurada
if [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ ERROR: GEMINI_API_KEY no está configurada"
    echo ""
    echo "Solución:"
    echo "  1. Asegúrate de tener la línea en ~/.zshrc:"
    echo "     export GEMINI_API_KEY=\"tu_clave_aqui\""
    echo ""
    echo "  2. Recarga la configuración:"
    echo "     source ~/.zshrc"
    exit 1
fi

echo "✅ GEMINI_API_KEY está configurada"
echo ""

# Mostrar primeros y últimos caracteres (por seguridad)
KEY_START="${GEMINI_API_KEY:0:10}"
KEY_END="${GEMINI_API_KEY: -5}"
KEY_LENGTH="${#GEMINI_API_KEY}"

echo "📊 Información de la clave:"
echo "   Longitud: $KEY_LENGTH caracteres"
echo "   Inicio: ${KEY_START}..."
echo "   Final: ...${KEY_END}"
echo ""

# Verificar en .zshrc
echo "📁 Verificando archivo ~/.zshrc:"
if grep -q "GEMINI_API_KEY" ~/.zshrc; then
    echo "   ✅ Encontrada en ~/.zshrc"
    LINES_COUNT=$(grep -c "GEMINI_API_KEY" ~/.zshrc)
    if [ "$LINES_COUNT" -gt 1 ]; then
        echo "   ⚠️  ADVERTENCIA: Hay $LINES_COUNT líneas con GEMINI_API_KEY"
        echo "      Deberías tener solo UNA. Revisa con:"
        echo "      grep GEMINI_API_KEY ~/.zshrc"
    fi
else
    echo "   ❌ NO encontrada en ~/.zshrc"
    echo "      La clave solo está en memoria, se perderá al cerrar terminal"
fi
echo ""

# Test básico de la API
echo "🧪 Probando conexión con Gemini API..."
echo "   (Esto hará una llamada de prueba muy pequeña)"
echo ""

# Hacer una llamada de prueba muy simple
RESPONSE=$(curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [{
      "parts":[{"text": "Hi"}]
    }]
  }')

# Verificar si hay error
if echo "$RESPONSE" | grep -q "error"; then
    echo "❌ ERROR en la llamada a la API:"
    echo ""
    ERROR_MSG=$(echo "$RESPONSE" | grep -o '"message":"[^"]*"' | head -1)
    echo "   $ERROR_MSG"
    echo ""
    echo "Posibles causas:"
    echo "   1. La API key no es válida"
    echo "   2. La API no está habilitada en Google Cloud Console"
    echo "   3. Hay restricciones configuradas que bloquean esta IP"
    echo ""
    echo "Verifica en: https://console.cloud.google.com/apis/credentials"
else
    echo "✅ Conexión exitosa con Gemini API"
    echo ""
    # Extraer respuesta (opcional)
    if echo "$RESPONSE" | grep -q "text"; then
        REPLY=$(echo "$RESPONSE" | grep -o '"text":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "   Respuesta de Gemini: $REPLY"
    fi
fi

echo ""
echo "======================================"
echo "📋 Resumen"
echo "======================================"
echo ""
echo "Estado de configuración:"
echo "  • Variable de entorno: ✅"
echo "  • Archivo .zshrc: $(grep -q 'GEMINI_API_KEY' ~/.zshrc && echo '✅' || echo '❌')"
echo "  • Conexión a API: $(echo "$RESPONSE" | grep -q 'error' && echo '❌' || echo '✅')"
echo ""
echo "💡 Documentación completa en:"
echo "   GEMINI_API_KEY_CONFIG.md"
echo ""
echo "🔗 Enlaces útiles:"
echo "   • Google Cloud Console: https://console.cloud.google.com/"
echo "   • API Keys: https://console.cloud.google.com/apis/credentials"
echo "   • Billing: https://console.cloud.google.com/billing"
echo ""
