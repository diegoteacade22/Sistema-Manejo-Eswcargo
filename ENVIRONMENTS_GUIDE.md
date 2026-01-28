# Guía de Entornos Separados (Admin vs Producción)

Para garantizar la estabilidad del sistema de los clientes mientras mantienes agilidad en el desarrollo, hemos separado el proyecto en dos entornos.

## 1. Los Dos Entornos

| Entorno | Rama Git | URL (Vercel) | Propósito |
| :--- | :--- | :--- | :--- |
| **Admin / Dev** | `main` | `sistema-manejo-eswcargo.vercel.app` | Pruebas rápidas, cambios inmediatos y administración. |
| **Producción** | `production` | `app.eswcargo.com` | Versión estable para los clientes. Sin errores de compilación. |

---

## 2. Flujo de Trabajo (Workflow)

### Paso A: Desarrollo y Administración (`main`)
1. Trabaja normalmente en Localhost o solicita cambios.
2. Los cambios se envían a la rama `main` (`git push origin main`).
3. Vercel actualiza el **Entorno Admin** inmediatamente.
4. **Tú pruebas el cambio aquí.** Si hay un error de tipos, solo se rompe este entorno.

### Paso B: Pase a Producción (`production`)
Una vez que verificaste que todo funciona perfecto en el Entorno Admin, pasamos los cambios a los clientes:

```bash
# Comandos para actualizar la web de clientes:
git checkout production
git merge main
git push origin production
git checkout main
```

---

## 3. Identificación Visual
El sistema ahora muestra una etiqueta en la parte superior de la barra lateral (Sidebar) para que sepas en qué entorno estás:
- 🛠️ **Localhost / Dev**: Estás en tu computadora.
- 🛡️ **Entorno Admin**: Estás en la web de pruebas (Vercel branch `main`).
- 🌐 **Producción**: Estás en la web oficial de clientes (Vercel branch `production`).

---

## 4. Configuración en Vercel
Para que las etiquetas funcionen correctamente, asegúrate de tener estas variables de entorno en Vercel:
1. `NEXT_PUBLIC_VERCEL_ENV` (Vercel lo pone automático, pero asegúrate que esté disponible).
