# Sistema de Gestión de Importaciones - ESW Cargo

## 🚀 Despliegue Rápido

### Estado Actual
- ✅ Repositorio: https://github.com/diegoteacade22/Sistema-Manejo-Eswcargo
- ⚠️ Pendiente: Push bloqueado por credenciales en historial

### Solución Rápida

**Opción 1: Permitir el secreto en GitHub (Más Rápido)**

1. Ve a este enlace (proporcionado por GitHub):
   https://github.com/diegoteacade22/Sistema-Manejo-Eswcargo/security/secret-scanning/unblock-secret/37LhFyANYdRy2PpWew7EBGp8pod

2. Click en "Allow secret" o "I'll fix it later"

3. Luego ejecuta:
   ```bash
   cd /Users/diegorodriguez/sistema_gestion_importaciones
   git push origin main
   ```

**Opción 2: Limpiar historial de Git (Más Seguro)**

Si prefieres eliminar completamente las credenciales del historial:

```bash
# Instalar BFG Repo-Cleaner
brew install bfg

# Hacer backup
cd /Users/diegorodriguez
cp -r sistema_gestion_importaciones sistema_gestion_importaciones_backup

# Limpiar el archivo del historial
cd sistema_gestion_importaciones
bfg --delete-files google_credentials.json

# Limpiar referencias
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Forzar push
git push origin main --force
```

---

## 📋 Pasos para Desplegar en Vercel

### 1. Acceder a Vercel
1. Ve a: https://vercel.com/login
2. Inicia sesión con GitHub

### 2. Importar Proyecto
1. Click en "Add New..." → "Project"
2. Busca: `Sistema-Manejo-Eswcargo`
3. Click en "Import"

### 3. Configurar Proyecto
- **Framework Preset:** Next.js (detectado automáticamente)
- **Root Directory:** `webapp`
- **Build Command:** `npm run build`
- **Output Directory:** `.next`

### 4. Variables de Entorno

Copia y pega estas variables en Vercel:

```env
DATABASE_URL=postgres://postgres.bvpcmghxfwmjdngrumou:ImportSys_2025!@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true

DIRECT_URL=postgres://postgres.bvpcmghxfwmjdngrumou:ImportSys_2025!@aws-1-us-east-1.pooler.supabase.com:5432/postgres

AUTH_SECRET=MWy0JV+SXLJpdnmdQqJQMkiWZC0CaHG9u+mYcl9hdsU=

NEXT_PUBLIC_SUPABASE_URL=https://bvpcmghxfwmjdngrumou.supabase.co

NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2cGNtZ2h4ZndtamRuZ3J1bW91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2MTE4MTQsImV4cCI6MjA4MjE4NzgxNH0.KR4isAg8HDbf2FczthTrpQN9MBN6w7GaFOxzlbq6-pQ

SMTP_HOST=smtp.hostinger.com

SMTP_PORT=465

SMTP_USER=info@eswcargo.com

SMTP_PASS=Ironman.3
```

### 5. Desplegar
1. Click en "Deploy"
2. Espera 2-3 minutos
3. ✅ Tu app estará en: `https://sistema-manejo-eswcargo.vercel.app`

---

## 🌐 Conectar Subdominio app.eswcargo.com

### En Vercel (después del despliegue)

1. Ve a tu proyecto → "Settings" → "Domains"
2. Agrega: `app.eswcargo.com`
3. Vercel te mostrará los DNS necesarios

### En Hostinger

1. Ve a: https://hpanel.hostinger.com
2. Dominios → `eswcargo.com` → DNS/Nameservers
3. Agrega estos registros:

**Para subdominio app:**
```
Type: A
Name: app
Points to: 76.76.21.21
TTL: 3600
```

**O alternativa CNAME (recomendada):**
```
Type: CNAME
Name: app
Points to: cname.vercel-dns.com
TTL: 3600
```

**Verificación (si Vercel lo requiere):**
```
Type: TXT
Name: _vercel
Value: [El que te proporcione Vercel]
TTL: 3600
```

### Esperar Propagación
- Tiempo: 5 minutos a 48 horas
- Verificar en: https://dnschecker.org

---

## ✅ Checklist de Despliegue

- [ ] Resolver problema de push a GitHub
- [ ] Importar proyecto en Vercel
- [ ] Configurar variables de entorno
- [ ] Desplegar aplicación
- [ ] Verificar que funcione en URL de Vercel
- [ ] Agregar dominio personalizado en Vercel
- [ ] Configurar DNS en Hostinger
- [ ] Verificar SSL (automático en Vercel)
- [ ] Probar login con credenciales admin
- [ ] Verificar funcionalidad completa

---

## 🔐 Credenciales de Acceso

**Usuario:** admin  
**Contraseña:** ESWCargo2025!  
**Email:** admin@eswcargo.com

---

## 📞 Soporte

Si encuentras algún problema:
1. Revisa los logs en Vercel Dashboard
2. Verifica que todas las variables de entorno estén correctas
3. Asegúrate de que Supabase esté accesible

---

**Fecha:** 25 de Diciembre, 2025
