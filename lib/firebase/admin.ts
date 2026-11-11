import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ?.trim()
  // Accept either a raw PEM or a quoted .env value copied from the service account JSON.
  .replace(/^(["'])(.*)\1$/s, "$2")
  .replace(/\\n/g, "\n")
  .replace(/\r\n/g, "\n");

export const adminConfigured = Boolean(projectId && clientEmail && privateKey);
let app = getApps()[0] ?? null;
export let adminInitializationFailed = false;

if (!app && adminConfigured) {
  try {
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  } catch (error) {
    adminInitializationFailed = true;
    console.error("Firebase Admin initialization failed. Check the service account credentials in the environment.", error);
  }
}

export const adminAuth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
