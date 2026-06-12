# Blender Estatus

Aplicación web interna tipo Trello para el seguimiento de tickets/pedidos de **Blender Group**. SPA estática (HTML + CSS + JavaScript modular, sin frameworks ni build step) que usa **Firebase** como backend: autenticación con Google, base de datos en tiempo real (Firestore), adjuntos (Storage) y reglas de seguridad.

## Funcionalidades del MVP

Tablero Kanban en tiempo real con columnas configurables y drag & drop; login con Google restringido al dominio `@blendergroup.com`; sistema de 6 roles con permisos centralizados; tickets de pedido con validaciones (número único de máximo 5 dígitos, tratamiento, tipo de envío, modalidad de entrega, dirección); comentarios con menciones `@nombre`; adjuntos JPG/PNG/WEBP/PDF (máximo 10 MB) con captura de cámara en móvil; notificaciones in-app con contador de no leídas; historial de actividad por ticket; dashboard con métricas y filtros; panel de administración de usuarios y columnas; diseño responsive mobile-first.

## Stack

- HTML5, CSS3, JavaScript (ES Modules) — sin dependencias npm, sin build.
- Firebase Authentication (Google), Cloud Firestore, Firebase Storage.
- Firebase SDK v10 (modular) cargado vía CDN.
- Tipografía Montserrat (Google Fonts).
- Drag & drop nativo de HTML5 (en móvil se mueve desde el detalle del ticket).

## Estructura

```txt
/
├─ index.html            Layout completo de la SPA
├─ styles.css            Identidad visual y componentes
├─ AGENTS.md             Reglas del proyecto
├─ firebase.rules        Reglas de Firestore
├─ storage.rules         Reglas de Storage
└─ src/
   ├─ app.js             Entrada: arranque, router, orquestación
   ├─ firebase.js        Init + re-exports del SDK
   ├─ config.example.js  Plantilla de configuración
   ├─ auth.js            Login Google + dominio + ciclo de usuario
   ├─ users.js           Usuarios + Admin>Usuarios
   ├─ roles.js           Constantes de roles
   ├─ permissions.js     can(user, action, resource) centralizado
   ├─ board.js           Kanban + modal de ticket
   ├─ columns.js         Columnas + Admin>Columnas
   ├─ tickets.js         CRUD de tickets, queries por rol
   ├─ comments.js        Comentarios y menciones
   ├─ attachments.js     Adjuntos (Storage + metadata)
   ├─ notifications.js   Notificaciones in-app
   ├─ dashboard.js       Métricas y filtros
   ├─ activity.js        Historial de actividad
   ├─ ui.js              Toasts, modales, badges, estados
   ├─ utils.js           Constantes, store, helpers, validaciones
   └─ seed.js            Columnas default, settings, datos demo
```

Colecciones Firestore: `/users`, `/columns`, `/tickets` (+ subcolecciones `comments`, `attachments`, `activity`), `/notifications`, `/settings/app` y `/orderNumbers` (colección auxiliar create-only que garantiza unicidad del número de pedido a nivel servidor).

## Configuración paso a paso

### 1. Crear el proyecto Firebase

1. Entra a [console.firebase.google.com](https://console.firebase.google.com) y crea un proyecto (p. ej. `blender-estatus`).
2. Agrega una **app web** (icono `</>`): copia el objeto `firebaseConfig` que te muestra.

### 2. Activar Google Authentication

1. En la consola: **Authentication → Sign-in method → Google → Habilitar**.
2. En **Authentication → Settings → Authorized domains** agrega los dominios donde correrá la app: `localhost` (ya incluido) y tu dominio de GitHub Pages, p. ej. `tuusuario.github.io`.

### 3. Configurar Firestore

1. **Firestore Database → Crear base de datos** (modo producción, región cercana).
2. En **Reglas**, pega el contenido de `firebase.rules` y publica.
3. Índice necesario para "Actividad reciente" del dashboard: la primera vez que un admin abra el dashboard, la consola del navegador mostrará un error con un **enlace directo** para crear el índice collection-group sobre `activity.createdAt`. Haz clic y créalo (tarda ~1 min). Alternativa: Firestore → Índices → Agregar exención de índice de grupo de colecciones para `activity`, campo `createdAt`.

### 4. Configurar Storage

1. **Storage → Comenzar** (misma región).
2. En **Reglas**, pega el contenido de `storage.rules` y publica.

### 5. Configurar la app

```bash
cp src/config.example.js src/config.js
```

Edita `src/config.js`:

- `firebaseConfig`: los datos de tu app web de Firebase. *(No es información secreta: la seguridad la dan las reglas.)*
- `allowedDomain`: dominio permitido (`blendergroup.com`).
- `superAdminEmails`: correos que recibirán rol SuperAdmin automáticamente.

### 6. Definir SuperAdmin

1. Agrega tu correo a `superAdminEmails` en `src/config.js`.
2. Agrega **el mismo correo** a la función `isConfiguredSuperAdmin()` de `firebase.rules` (las reglas no pueden leer config.js; la duplicación es intencional) y vuelve a publicar las reglas.
3. Inicia sesión: tu usuario se creará con rol SuperAdmin y el seed creará automáticamente las 5 columnas por defecto y `/settings/app`.

Los demás usuarios entran con rol **Pendiente** y ven una pantalla de espera hasta que un SuperAdmin les asigne rol en **Admin → Usuarios**.

### 7. Correr localmente

Los módulos ES requieren servirse por HTTP (no `file://`):

```bash
# opción A
npx serve .
# opción B
python3 -m http.server 8080
```

Abre `http://localhost:8080`.

### 8. Publicar en GitHub Pages

1. Crea un repositorio y sube todo el proyecto **incluyendo `src/config.js`** (recuerda: no contiene secretos).
2. En GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. Espera el deploy y abre `https://tuusuario.github.io/turepositorio/`.
4. Agrega ese dominio en Firebase **Authentication → Authorized domains** (paso 2.2).

La app no usa rutas del servidor (todo es una sola página), así que funciona en Pages sin configuración extra. También puede desplegarse en Firebase Hosting (`firebase init hosting && firebase deploy`) si se prefiere.

## Roles y permisos

| Rol | Ver | Crear | Editar | Mover | Comentar/Adjuntar | Dashboard | Admin |
|---|---|---|---|---|---|---|---|
| SuperAdmin | Todo | ✔ | ✔ | ✔ | ✔ | ✔ | Total |
| Administrador de Ventas | Todo | ✔ | ✔ | ✔ | ✔ | ✔ | Solo lectura de usuarios |
| Ejecutivo de Ventas | Propios | ✔ | Propios | ✘ | Propios | ✘ | ✘ |
| Producción | Fabricación | ✘ | ✘ | Fabricación | Fabricación | ✘ | ✘ |
| Almacén | Almacén | ✘ | ✘ | Almacén | Almacén | ✘ | ✘ |
| Auditor | Todo | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ |

Toda la lógica está en `src/permissions.js` (frontend) y replicada en `firebase.rules` (servidor).

## Limitaciones del MVP

1. **Notificaciones fan-out en cliente**: las crea el navegador de quien ejecuta la acción; si cierra antes de terminar, pueden no generarse. Solución fase 2: Cloud Functions.
2. **Sin push notifications**: solo in-app. El módulo está preparado para integrar FCM.
3. **Eliminación de tickets**: borra el ticket y libera el número de pedido, pero las subcolecciones (comentarios/adjuntos/actividad) quedan huérfanas en Firestore. Fase 2: Cloud Function de limpieza (o extensión "Delete User Data").
4. **Storage con control grueso**: cualquier usuario del dominio puede subir/borrar objetos en `tickets/*` a nivel Storage; el control fino por rol se aplica en la metadata de Firestore. Fase 2: custom claims o `firestore.get()` en storage.rules.
5. **El número de pedido no es editable** después de crear el ticket (mantiene la garantía de unicidad).
6. **Tiempo promedio por columna** no incluido (requiere agregación; fase 2).
7. La lista de SuperAdmins está duplicada en `config.js` y `firebase.rules` (limitación de las reglas).

## Recomendaciones de seguridad antes de producción

- Activar **App Check** (reCAPTCHA v3) para Firestore y Storage.
- Revisar que `email_verified` sea true si se habilitan métodos de login adicionales (con Google Workspace ya viene verificado).
- Mover la asignación de SuperAdmin a **custom claims** vía Cloud Function (elimina la duplicación config/rules).
- Configurar presupuesto y alertas de uso en Firebase.
- Hacer backup programado de Firestore (Export en Cloud Storage).
- Revisar las reglas con el **Rules Playground** de la consola antes de publicar cambios.

## Pendientes para fase 2

Cloud Functions para notificaciones, limpieza de subcolecciones y contadores atómicos; push con Firebase Cloud Messaging; tiempo promedio por columna y SLA; búsqueda/filtrado de tickets en el tablero; exportación de datos (CSV/Excel); edición de columnas con drag & drop; reordenamiento de tarjetas dentro de una columna; modo oscuro; auditoría completa (log global); pruebas automatizadas de reglas con el emulador de Firebase.
