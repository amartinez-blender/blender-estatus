// firebase.js — Inicialización y re-export del SDK de Firebase.
// REGLA: ningún otro módulo importa del CDN; todo Firebase pasa por aquí.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Instancias compartidas (se llenan en initFirebase).
export const fb = { app: null, auth: null, db: null, storage: null };

export function initFirebase(config) {
  fb.app = initializeApp(config);
  fb.auth = getAuth(fb.app);
  fb.db = getFirestore(fb.app);
  fb.storage = getStorage(fb.app);
  return fb;
}

// --- Re-exports: Auth ---
export {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- Re-exports: Firestore ---
export {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  writeBatch,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Re-exports: Storage ---
export {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
