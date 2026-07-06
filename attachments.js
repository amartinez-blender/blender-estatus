// attachments.js — Adjuntos: archivo en Firebase Storage + metadata en Firestore.
// REGLA: nunca guardar archivos como base64 en Firestore.

import {
  fb, collection, doc, addDoc, deleteDoc, updateDoc, query, orderBy, onSnapshot,
  serverTimestamp, increment, storageRef, uploadBytesResumable, getDownloadURL, deleteObject,
} from "./firebase.js";
import { store, validateFile } from "./utils.js";
import { logActivity } from "./activity.js";
import { notifyUsers } from "./notifications.js";

export function listenAttachments(ticketId, callback) {
  const q = query(
    collection(fb.db, "tickets", ticketId, "attachments"),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error("[attachments] listener:", err)
  );
}

// Sube un archivo con progreso. onProgress recibe 0–100.
export function uploadAttachment(ticket, file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const errors = validateFile(file);
    if (errors.length) return reject(new Error(errors[0]));

    const user = store.currentUser;
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `tickets/${ticket.id}/${Date.now()}_${safeName}`;
    const task = uploadBytesResumable(storageRef(fb.storage, path), file, {
      contentType: file.type,
    });

    task.on(
      "state_changed",
      (snap) => onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      async () => {
        try {
          const downloadURL = await getDownloadURL(task.snapshot.ref);
          await addDoc(collection(fb.db, "tickets", ticket.id, "attachments"), {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            storagePath: path,
            downloadURL,
            uploadedBy: user.uid,
            createdAt: serverTimestamp(),
          });
          await updateDoc(doc(fb.db, "tickets", ticket.id), {
            attachmentsCount: increment(1),
            updatedAt: serverTimestamp(),
          });
          // Log y notificación best-effort: no deben tumbar la subida del adjunto.
          try {
            await logActivity(ticket.id, "attachment_added",
              `${user.displayName} adjuntó "${file.name}".`);
            await notifyUsers([ticket.ownerId], {
              ticketId: ticket.id, type: "attachment",
              title: `Pedido ${ticket.orderNumber}`,
              message: `${user.displayName} adjuntó "${file.name}".`,
            });
          } catch (err) {
            console.warn("[adjunto] Subido, pero falló log/notificación:", err);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

export async function deleteAttachment(ticket, attachment) {
  const user = store.currentUser;
  // Primero el objeto de Storage; si ya no existe, continuar con la metadata.
  try {
    await deleteObject(storageRef(fb.storage, attachment.storagePath));
  } catch (err) {
    if (err.code !== "storage/object-not-found") throw err;
  }
  await deleteDoc(doc(fb.db, "tickets", ticket.id, "attachments", attachment.id));
  await updateDoc(doc(fb.db, "tickets", ticket.id), {
    attachmentsCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  await logActivity(ticket.id, "attachment_deleted",
    `${user.displayName} eliminó el adjunto "${attachment.fileName}".`);
}

export function isImage(attachment) {
  return (attachment.fileType || "").startsWith("image/");
}
