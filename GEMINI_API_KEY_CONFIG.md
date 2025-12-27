# 🔑 Configuración de API Key de Gemini

## ✅ API Key Configurada

Tu API key de Gemini ha sido configurada exitosamente en tu sistema.

### 📍 Ubicación
La API key está almacenada en: `~/.zshrc`

```bash
export GEMINI_API_KEY="AIzaSyCxAdr-xmTkWVtvVq2vcElunVi108u71Xk"
```

---

## 🎯 ¿Qué significa esto?

Ahora **Antigravity (este asistente de código)** usará TU cuenta de Google Cloud/Gemini para:
- Procesar tus solicitudes
- Generar código
- Analizar documentos
- Todas las interacciones con IA

**Resultado:** Los costos de tokens se cargarán a **TU cuenta de Google Cloud**, no a la cuenta por defecto.

---

## 💰 Monitorear Costos

### Ver uso en Google Cloud Console:
1. Ve a: https://console.cloud.google.com/
2. Navega a: **APIs & Services → Dashboard**
3. Busca: **Generative Language API**
4. Revisa métricas de uso

### Ver facturación:
- https://console.cloud.google.com/billing

---

## 🔒 Seguridad - IMPORTANTE

⚠️ **Tu API key está ahora en texto plano en varios lugares:**

1. **En este chat** - Este historial puede estar almacenado
2. **En ~/.zshrc** - Cualquier persona con acceso a tu Mac puede verla
3. **En variables de entorno** - Visible con `echo $GEMINI_API_KEY`

### Recomendaciones de Seguridad:

#### 1️⃣ **Rotar tu clave periódicamente**
```bash
# Ve a Google Cloud Console
https://console.cloud.google.com/apis/credentials
# Revoca la clave anterior y genera una nueva
```

#### 2️⃣ **Restringir permisos de .zshrc**
```bash
chmod 600 ~/.zshrc
```

#### 3️⃣ **Configurar restricciones de API** (Recomendado)
En Google Cloud Console:
- Restringe la API key solo a **Generative Language API**
- Restringe por dirección IP (si tienes IP fija)
- Establece cuotas de uso diario

#### 4️⃣ **Nunca subir la clave a GitHub**
Si tienes .zshrc en un repositorio:
```bash
# Agregar a .gitignore
echo ".zshrc" >> ~/.gitignore
```

---

## 🔄 Verificar que Antigravity la está usando

### Método 1: Variable de entorno
```bash
echo $GEMINI_API_KEY
```
Debería mostrar: `AIzaSyCxAdr-xmTkWVtvVq2vcElunVi108u71Xk`

### Método 2: Reiniciar terminal
```bash
# Cierra y abre una nueva terminal, luego:
echo $GEMINI_API_KEY
```

### Método 3: Monitorear uso en Google Cloud
- Después de usar Antigravity, revisa el dashboard
- Deberías ver incremento en las llamadas a la API

---

## 🚨 Si algo sale mal

### La API key no funciona:
```bash
# Verificar que esté configurada
echo $GEMINI_API_KEY

# Recargar configuración
source ~/.zshrc

# Verificar permisos en Google Cloud Console
```

### Quieres remover la configuración:
```bash
# Editar .zshrc y eliminar la línea
nano ~/.zshrc
# Busca y elimina: export GEMINI_API_KEY="..."

# Recargar
source ~/.zshrc
```

### Costos inesperados:
```bash
# Ve a Google Cloud Console → Billing
# Configura alertas de presupuesto
# Establece un límite de cuota diaria para la API
```

---

## 📊 Información Técnica

**API Key actual:** `AIzaSyCxAdr-xmTkWVtvVq2vcElunVi108u71Xk`
- Tipo: API Key de Google Cloud
- Servicio: Generative Language API (Gemini)
- Configurado: 26 de Diciembre, 2025
- Ubicación: `~/.zshrc`

**Modelos disponibles con esta key:**
- `gemini-2.0-flash-exp`
- `gemini-1.5-pro`
- `gemini-1.5-flash`

---

## ✅ Estado Actual

🟢 **API Key configurada correctamente**
- Variable de entorno: ✓
- Archivo .zshrc: ✓
- Cargada en sesión actual: ✓

**Próximos pasos recomendados:**
1. ✅ Configurar restricciones en Google Cloud Console
2. ✅ Establecer alertas de presupuesto
3. ✅ Monitorear uso en las próximas 24 horas
4. ⚠️ Considerar rotar la clave si fue expuesta públicamente

---

**Última actualización:** 26 de Diciembre, 2025
