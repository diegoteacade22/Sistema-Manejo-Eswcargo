# 🚀 Guía de Despliegue - Sistema de Gestión de Importaciones
## Desplegar en eswcargo.com

---

## 📌 **Opción Recomendada: Vercel + Dominio Personalizado**

### **Paso 1: Preparar el Proyecto**

#### 1.1 Crear repositorio en GitHub (si no existe)
```bash
cd /Users/diegorodriguez/sistema_gestion_importaciones
git init
git add .
git commit -m "Initial commit - Sistema de Gestión de Importaciones"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/sistema_gestion_importaciones.git
git push -u origin main
```

#### 1.2 Verificar archivos necesarios
- ✅ `.env` (NO subir a GitHub - ya está en .gitignore)
- ✅ `package.json`
- ✅ `next.config.ts`
- ✅ `prisma/schema.prisma`

---

### **Paso 2: Desplegar en Vercel**

#### 2.1 Crear cuenta en Vercel
1. Ve a [vercel.com](https://vercel.com)
2. Regístrate con tu cuenta de GitHub
3. Autoriza a Vercel para acceder a tus repositorios

#### 2.2 Importar proyecto
1. Click en "Add New Project"
2. Selecciona tu repositorio: `sistema_gestion_importaciones`
3. Vercel detectará automáticamente que es Next.js

#### 2.3 Configurar Variables de Entorno
En la sección "Environment Variables", agrega:

```env
# Database
DATABASE_URL=postgres://postgres.bvpcmghxfwmjdngrumou:ImportSys_2025!@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgres://postgres.bvpcmghxfwmjdngrumou:ImportSys_2025!@aws-1-us-east-1.pooler.supabase.com:5432/postgres

# Auth
AUTH_SECRET=MWy0JV+SXLJpdnmdQqJQMkiWZC0CaHG9u+mYcl9hdsU=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://bvpcmghxfwmjdngrumou.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2cGNtZ2h4ZndtamRuZ3J1bW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MTE4MTQsImV4cCI6MjA4MjE4NzgxNH0.KR4isAg8HDbf2FczthTrpQN9MBN6w7GaFOxzlbq6-pQ

# Email (SMTP)
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=info@eswcargo.com
SMTP_PASS=Ironman.3
```

#### 2.4 Desplegar
1. Click en "Deploy"
2. Espera 2-3 minutos
3. Tu app estará disponible en: `https://tu-proyecto.vercel.app`

---

### **Paso 3: Conectar Dominio Personalizado (eswcargo.com)**

#### 3.1 En Vercel
1. Ve a tu proyecto desplegado
2. Click en "Settings" → "Domains"
3. Agrega tu dominio: `eswcargo.com`
4. También agrega: `www.eswcargo.com`
5. Vercel te mostrará los registros DNS que necesitas configurar

#### 3.2 En Hostinger (Panel de Control)
1. Inicia sesión en [hpanel.hostinger.com](https://hpanel.hostinger.com)
2. Ve a "Dominios" → Selecciona `eswcargo.com`
3. Click en "DNS / Nameservers"
4. Agrega/Modifica estos registros:

**Registro A:**
```
Type: A
Name: @
Value: 76.76.21.21 (IP de Vercel)
TTL: 3600
```

**Registro CNAME para www:**
```
Type: CNAME
Name: www
Value: cname.vercel-dns.com
TTL: 3600
```

**Registro TXT (para verificación):**
```
Type: TXT
Name: _vercel
Value: [El valor que te proporcione Vercel]
TTL: 3600
```

#### 3.3 Esperar propagación DNS
- Puede tomar de 5 minutos a 48 horas
- Verifica en: [dnschecker.org](https://dnschecker.org)

---

### **Paso 4: Verificar SSL**
Vercel automáticamente:
- ✅ Genera certificado SSL (HTTPS)
- ✅ Redirige HTTP → HTTPS
- ✅ Renueva certificados automáticamente

---

## 🔧 **Opción Alternativa: VPS de Hostinger**

Si prefieres tener control total y alojar en tu propio servidor:

### **Requisitos:**
- Plan VPS de Hostinger (KVM1 o superior)
- Conocimientos básicos de Linux/SSH

### **Pasos Resumidos:**
1. Conectar al VPS vía SSH
2. Instalar Node.js (v18+)
3. Instalar PM2 (gestor de procesos)
4. Clonar repositorio
5. Instalar dependencias
6. Configurar Nginx como reverse proxy
7. Configurar SSL con Let's Encrypt
8. Iniciar aplicación con PM2

**¿Quieres que te proporcione la guía detallada para VPS?**

---

## 📊 **Comparación de Opciones**

| Característica | Vercel + Dominio | VPS Hostinger |
|---------------|------------------|---------------|
| **Facilidad** | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **Costo** | Gratis (hasta límites) | $4-10/mes |
| **Mantenimiento** | Automático | Manual |
| **Escalabilidad** | Automática | Manual |
| **SSL** | Automático | Manual (Let's Encrypt) |
| **Tiempo Setup** | 15 minutos | 1-2 horas |
| **Control** | Limitado | Total |

---

## ✅ **Próximos Pasos**

1. **¿Qué opción prefieres?**
   - Vercel + Dominio (Recomendada)
   - VPS de Hostinger

2. **Si eliges Vercel:**
   - Te ayudo a crear el repositorio en GitHub
   - Configuramos el despliegue
   - Conectamos el dominio

3. **Si eliges VPS:**
   - Te proporciono la guía completa paso a paso
   - Te ayudo con la configuración

---

## 🆘 **Soporte**

Si tienes algún problema durante el despliegue:
- Revisa los logs en Vercel Dashboard
- Verifica que todas las variables de entorno estén configuradas
- Asegúrate de que Supabase esté accesible desde internet

---

## 📝 **Notas Importantes**

- ✅ Tu base de datos ya está en Supabase (accesible desde internet)
- ✅ El servidor SMTP de Hostinger funcionará desde cualquier ubicación
- ✅ Las credenciales de admin seguirán siendo las mismas
- ⚠️ NUNCA subas el archivo `.env` a GitHub
- ⚠️ Usa variables de entorno en Vercel para datos sensibles

---

**Última actualización:** 25 de Diciembre, 2025
