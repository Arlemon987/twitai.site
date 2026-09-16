import admin from "firebase-admin";

let initialized = false;

function getPrivateKey() {
  const value = process.env.FIREBASE_PRIVATE_KEY;
  if (!value) throw new Error("FIREBASE_PRIVATE_KEY is missing.");
  return value.replace(/\\n/g, "\n");
}

export function getFirebaseAdmin() {
  if (!initialized) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: getPrivateKey()
      })
    });
    initialized = true;
  }

  return admin;
}

export async function requireUser(req) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    const error = new Error("Authentication required.");
    error.statusCode = 401;
    error.code = "AUTH_REQUIRED";
    throw error;
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    const error = new Error("Authentication required.");
    error.statusCode = 401;
    error.code = "AUTH_REQUIRED";
    throw error;
  }

  const firebase = getFirebaseAdmin();
  const decoded = await firebase.auth().verifyIdToken(idToken);
  return decoded;
}

export function getDb() {
  return getFirebaseAdmin().firestore();
}

export function timestamp() {
  return getFirebaseAdmin().firestore.FieldValue.serverTimestamp();
}
