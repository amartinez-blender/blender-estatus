// chat.js — Aviso por Google Chat mediante un webhook entrante de un espacio.
//
// Limitaciones (sitio estático, sin backend):
//  - Publica en el ESPACIO del webhook, no es un mensaje privado al vendedor.
//  - El navegador puede bloquear la petición por CORS; si pasa, la notificación
//    in-app sigue funcionando. Para DM por usuario se necesita una Cloud Function
//    con la API de Google Chat (fase 2).
//
// Configura la URL en src/config.js → APP_CONFIG.googleChatWebhookUrl.

import { store } from "./utils.js";

export async function sendGoogleChat(text) {
  const url = store.config?.app?.googleChatWebhookUrl;
  if (!url) return; // No configurado: se omite silenciosamente.
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    // No bloquea la operación principal.
    console.warn("[chat] No se pudo enviar a Google Chat (¿CORS o URL inválida?):", err);
  }
}
