# 🔄 Guía Rápida de Sincronización Bidireccional

## ¿Qué significa sincronización bidireccional?

✅ **Los datos editados en la app NO se borran** al sincronizar con Excel
✅ **Los datos editados en Excel se importan** a la aplicación
✅ **Los datos editados en la app se exportan** de vuelta a Excel

---

## 🚀 Uso Rápido

### Opción 1: Script Interactivo (Recomendado)

```bash
cd /Users/diegorodriguez/02_DESARROLLO/Proyectos_Activos/sistema_gestion_importaciones
./sync.sh
```

Verás un menú con 3 opciones:
1. **Excel → BD**: Importa datos desde Excel (preserva ediciones manuales)
2. **BD → Excel**: Exporta datos desde la app a Excel
3. **Bidireccional**: Hace ambas cosas (recomendado)

### Opción 2: Comandos Manuales

#### Solo importar desde Excel:
```bash
# Paso 1: Extraer desde Excel
python3 extract_clients.py

# Paso 2: Aplicar a BD
cd webapp
npx tsx prisma/seed_clients.ts
cd ..
```

#### Solo exportar a Excel:
```bash
python3 export_to_excel.py
```

---

## 📋 ¿Qué datos se preservan?

### Al importar desde Excel (Excel → BD):

**SE ACTUALIZAN:**
- Nombre del cliente (siempre)
- Tipo de cliente (siempre)

**SE PRESERVAN (no se sobrescriben):**
- Email ← Solo se importa si está vacío en la BD
- Teléfono ← Solo se importa si está vacío en la BD
- Dirección ← Solo se importa si está vacío en la BD
- Ciudad ← Nunca se importa desde Excel
- Provincia/Estado ← Nunca se importa desde Excel
- País ← Nunca se importa desde Excel
- Notas ← Nunca se importa desde Excel

### Al exportar a Excel (BD → Excel):

**SE ACTUALIZAN:**
- Campos vacíos en Excel se completan con datos de la BD
- Clientes nuevos se agregan a Excel

**SE PRESERVAN:**
- Datos existentes en Excel NO se sobrescriben

---

## 💡 Ejemplo Práctico

### Escenario:
1. Tienes un cliente "Marcos Roku" en Excel SIN email
2. Lo editas en la app y agregas: `marcos@example.com`
3. Ejecutas sincronización bidireccional

### Resultado:
✅ El email `marcos@example.com` se mantiene en la BD
✅ El email se exporta a Excel (porque Excel tenía ese campo vacío)
✅ La próxima vez que sincronices, el email NO se borrará

---

## ⚠️ Importante

- **Siempre hace backup**: El script crea `*_backup.xlsx` antes de modificar Excel
- **Es seguro**: No borra datos, solo completa campos vacíos
- **Puedes ejecutarlo múltiples veces**: Es idempotente

---

## 🛠️ Requisitos

```bash
# Instalar dependencias de Python (si no están instaladas)
pip install pandas openpyxl psycopg2-binary python-dotenv
```

---

## 📝 Archivos Importantes

- `sync.sh` - Script interactivo principal
- `extract_clients.py` - Extrae desde Excel
- `export_to_excel.py` - Exporta a Excel
- `webapp/prisma/seed_clients.ts` - Aplica cambios a BD
- `SINCRONIZACION_BIDIRECCIONAL.md` - Documentación detallada

---

**¿Tienes dudas?** Lee `SINCRONIZACION_BIDIRECCIONAL.md` para más detalles.
