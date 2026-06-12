// comments.js — Comentarios tipo Trello con menciones @nombre.

import {
  fb, collection, doc, addDoc, updateDoc, query, orderBy, onSnapshot,
  serverTimestamp, increment,
} from "./firebase.js";
import { store } from "./utils.js";
import { logActivity } from "./activity.js";
import { notifyUsers } from "./notifications.js";

// ===================== Menciones =====================

// Detecta menciones comparando el texto contra los displayName conocidos.
// Devuelve array de uids mencionados.
export function parseMentions(text) {
  const mentions = [];
  for (const u of store.users) {
    const name = u.displayName;
    if (name && text.includes(`@${name}`)) mentions.push(u.uid || u.id);
  }
  return [...new Set(mentions)];
}

// Sugerencias para el autocompletado: usuarios activos cuyo nombre
// empieza con el fragmento escrito tras "@".
export function mentionSuggestions(fragment) {
  const f = fragment.toLowerCase();
  return store.users
    .filter((u) => u.active !== false && (u.displayName || "").toLowerCase().includes(f))
    .slice(0, 6);
}

// ===================== CRUD =====================

export function listenComments(ticketId, callback) {
  const q = query(
    collection(fb.db, "tickets", ticketId, "comments"),
    orderBy("createdAt", "asc")
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error("[comments] listener:", err)
  );
}

export async function addComment(ticket, text) {
  const user = store.currentUser;
  const clean = String(text || "").trim();
  if (!clean) throw new Error("El comentario no puede estar vacío.");

  const mentions = parseMentions(clean);

  await addDoc(collection(fb.db, "tickets", ticket.id, "comments"), {
    text: clean,
    mentions,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: null,
    deleted: false,
  });

  await updateDoc(doc(fb.db, "tickets", ticket.id), {
    commentsCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  await logActivity(ticket.id, "comment_added", `${user.displayName} comentó.`);

  // Notificar al responsable…
  await notifyUsers([ticket.ownerId], {
    ticketId: ticket.id, type: "comment",
    title: `Pedido ${ticket.orderNumber}`,
    message: `${user.displayName} comentó: "${clean.slice(0, 80)}"`,
  });
  // …y a los mencionados.
  if (mentions.length) {
    await notifyUsers(mentions, {
      ticketId: ticket.id, type: "mention",
      title: `Te mencionaron en el pedido ${ticket.orderNumber}`,
      message: `${user.displayName}: "${clean.slice(0, 80)}"`,
    });
  }
}

export async function editComment(ticketId, commentId, text) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("El comentario no puede estar vacío.");
  await updateDoc(doc(fb.db, "tickets", ticketId, "comments", commentId), {
    text: clean,
    mentions: parseMentions(clean),
    updatedAt: serverTimestamp(),
  });
}

// Soft delete: el comentario se conserva con deleted=true.
export async function softDeleteComment(ticket, comment) {
  const user = store.currentUser;
  await updateDoc(doc(fb.db, "tickets", ticket.id, "comments", comment.id), {
    deleted: true,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(fb.db, "tickets", ticket.id), {
    commentsCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  await logActivity(ticket.id, "comment_deleted", `${user.displayName} eliminó un comentario.`);
}

// Resalta @menciones en el texto ya escapado de un comentario.
export function highlightMentions(escapedText) {
  let html = escapedText;
  for (const u of store.users) {
    if (!u.displayName) continue;
    const escaped = u.displayName
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
    html = html.split(`@${escaped}`).join(`<span class="mention">@${escaped}</span>`);
  }
  return html;
}
