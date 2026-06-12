# AGENTS.md — Reglas del proyecto Blender Estatus

Reglas obligatorias para cualquier persona o agente que trabaje en este código.

## Arquitectura

- SPA estática: HTML + CSS + JS modular (ES Modules). Sin frameworks ni build step.
- Firebase SDK v10 modular vía CDN, importado **únicamente** desde `src/firebase.js`. Ningún otro módulo importa del CDN directamente.
- Cada módulo de `src/` tiene una sola responsabilidad. No mezclar capas: datos (Firestore) y render (DOM) viven en funciones separadas aunque estén en el mismo archivo.
- El estado global vive en `store` (`src/utils.js`). La comunicación entre módulos es por eventos (`emit`/`on`), nunca por variables globales sueltas.

## Permisos

- Toda validación de permisos pasa por `can(user, action, resource)` en `src/permissions.js`. **Prohibido** comparar `user.role` fuera de `permissions.js` (excepción: queries por rol en `tickets.js`, documentadas ahí).
- La UI oculta lo que no se puede hacer, pero la seguridad real está en `firebase.rules` y `storage.rules`. Toda regla de negocio nueva se implementa en ambos lados.

## Constantes

- Roles: `src/roles.js`. Catálogos (tratamientos, tipos de envío, prioridades, estatus, columnas default, límites de archivo): `src/utils.js`.
- No hardcodear strings de roles, tratamientos ni colores en otros archivos. Colores solo como variables CSS en `styles.css`.
- No hardcodear datos sensibles. La configuración va en `src/config.js` (copiado de `config.example.js`).

## Datos

- Validar datos **antes** de escribir en Firestore (`validateTicketData`, validación de archivos, comentarios no vacíos). Nunca confiar solo en la UI.
- No guardar archivos como base64 en Firestore: siempre Firebase Storage + metadata en Firestore.
- Todo cambio relevante en un ticket registra actividad (`logActivity`) y, si aplica, notificaciones.
- Timestamps siempre con `serverTimestamp()`.
- La unicidad de `orderNumber` se garantiza con la colección `/orderNumbers/{n}` (create-only). Si se elimina un ticket, eliminar también su doc en `/orderNumbers`.

## UI

- Mobile-first. Cualquier vista nueva debe probarse a 360px de ancho.
- Usar los helpers de `src/ui.js` (toast, confirmDialog, avatarHtml, badges, estados vacíos). No duplicarlos.
- Estados obligatorios en cualquier flujo nuevo: loading, error, vacío, sin permisos, guardando, éxito.
- Accesibilidad básica: botones con `aria-label` cuando solo tienen icono, contraste suficiente, foco visible.
- Escapar siempre contenido de usuario con `escapeHtml` antes de inyectarlo con `innerHTML`.

## Proceso

- Antes de modificar una función existente, buscar dónde se usa (`grep`).
- No crear dependencias nuevas sin justificación escrita en el README.
- Comentarios útiles y breves; no narrar lo obvio.
- Después de cada fase, resumir en el PR/entrega: cambios realizados y pendientes.
- Si cambias roles, dominios o el rol por defecto, actualiza también `firebase.rules` (las listas están duplicadas ahí a propósito).
