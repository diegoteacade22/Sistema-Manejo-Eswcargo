# Sistema de Gestión de Importaciones - ESW Cargo

Sistema web para gestión de importaciones, clientes, pedidos, envíos y contabilidad.

## 📋 Requisitos del Servidor

- Docker y Docker Compose ya instalados
- Puertos disponibles: **3002** (o modificar en `docker-compose.yml`)
- Acceso a Supabase (base de datos externa)

## 🚀 Despliegue Rápido

### 1. Clonar el repositorio

```bash
git clone https://github.com/diegoteacade22/Sistema-Manejo-Eswcargo.git
cd Sistema-Manejo-Eswcargo
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
nano .env  # Editar con tus credenciales
```

### 3. Construir y levantar el contenedor

```bash
docker-compose up -d --build
```

### 4. Verificar que esté corriendo

```bash
docker-compose ps
docker-compose logs -f eswcargo-webapp
```

La aplicación estará disponible en: `http://TU_IP:3002`

---

## 🔧 Arquitectura

### Base de Datos
- **PostgreSQL en Supabase** (externa, no en Docker)
- No requiere contenedor de base de datos local
- Conexión configurada vía variables de entorno

### Puertos
- **Puerto externo**: 3002
- **Puerto interno**: 3000
- **Evita colisión con**: 3001, 8080

### Contenedor
- **Nombre**: `eswcargo-webapp`
- **Red**: `eswcargo-network`
- **Healthcheck**: Activo cada 30s

---

## 📝 Comandos Útiles

```bash
# Ver logs en tiempo real
docker-compose logs -f eswcargo-webapp

# Reiniciar el servicio
docker-compose restart eswcargo-webapp

# Detener el servicio
docker-compose down

# Reconstruir después de cambios
docker-compose up -d --build --force-recreate

# Acceder al contenedor
docker exec -it eswcargo-webapp sh

# Ver estado
docker-compose ps
```

---

## 🔄 Actualizar con nuevos cambios

```bash
cd Sistema-Manejo-Eswcargo
git pull origin main
docker-compose up -d --build
```

---

## ⏱️ Sincronización con Google Sheets

La operación normal se ejecuta desde **Mantenimiento → ACTUALIZAR AHORA (DIRECTO)**. Compara los
últimos 7 días y escribe solamente cambios confirmados. La reconciliación FULL de GitHub Actions es
un respaldo diario y no debe usarse como botón operativo.

Los pedidos cuyo detalle se reduzca quedan en cuarentena: no se borran sus artículos y tampoco
bloquean los demás cambios. Consultar `docs/DIRECT_SHEETS_SYNC.md` para validación, diagnóstico y
rollback.

---

## 🌐 Configurar con Nginx (Opcional)

Si quieres usar un dominio (ej: `app.eswcargo.com`):

```nginx
server {
    listen 80;
    server_name app.eswcargo.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Para SSL con Let's Encrypt:
```bash
sudo certbot --nginx -d app.eswcargo.com
```

---

## 🔑 Variables de Entorno Críticas

| Variable | Descripción | Obligatoria |
|----------|-------------|-------------|
| `DATABASE_URL` | Conexión a Supabase (pooling) | ✅ |
| `DIRECT_URL` | Conexión directa a Supabase | ✅ |
| `AUTH_SECRET` | Secreto para NextAuth | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública de Supabase | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Key anónima de Supabase | ✅ |
| `SMTP_*` | Configuración de email | ⚠️ Opcional |
| `AUTO_NOTIFY_*` | Envío automático de Invoice/Packing List | ⚠️ Opcional |
| `WHATSAPP_*` / `TWILIO_*` | Canal WhatsApp (fallback si no hay email) | ⚠️ Opcional |
| `GEMINI_API_KEY` | API de Google Gemini AI | ⚠️ Opcional |

---

## 🔔 Notificación automática de documentos

- Al crear un pedido, el sistema intenta enviar automáticamente el **Invoice** al cliente.
- Si el pedido queda asociado a un envío, también intenta enviar el **Packing List**.
- Prioridad de canal:
  - Primero `email` (si el cliente tiene casilla).
  - Si no hay email o falla el correo, usa `WhatsApp`.
- Cuando se envía por WhatsApp y el cliente no tiene email, el mensaje solicita actualizar su casilla.

---

## 🐛 Troubleshooting

### El contenedor no inicia
```bash
docker-compose logs eswcargo-webapp
```

### Puerto 3002 ya en uso
Edita `docker-compose.yml` y cambia el puerto:
```yaml
ports:
  - "NUEVO_PUERTO:3000"
```

### Error de conexión a base de datos
Verifica que `DATABASE_URL` y `DIRECT_URL` estén correctamente configurados en `.env`

---

## 📦 Estructura del Proyecto

```
Sistema-Manejo-Eswcargo/
├── docker-compose.yml      # Configuración de Docker Compose
├── .env.example            # Plantilla de variables de entorno
├── webapp/
│   ├── Dockerfile          # Imagen de la aplicación
│   ├── package.json
│   ├── prisma/
│   │   └── schema.prisma
│   └── app/                # Aplicación Next.js
└── README.md
```

---

## 👨‍💻 Desarrollo Local

Para desarrollo en tu máquina (sin Docker):

```bash
cd webapp
npm install
cp .env.example .env  # Configurar variables
npx prisma generate
npm run dev  # Puerto 3000
```
