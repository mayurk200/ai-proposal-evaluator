import admin from 'firebase-admin';
import { env } from './env';
import { createLocalCollection } from './localStore';
import path from 'path';
import fs from 'fs';

let useFirestore = false;

try {
  const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json');

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    useFirestore = true;
    console.log('🔥 Firebase initialized with env credentials');
  } else if (fs.existsSync(serviceAccountPath)) {
    const sa = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
    admin.initializeApp({
      credential: admin.credential.cert(sa),
    });
    useFirestore = true;
    console.log('🔥 Firebase initialized with service account JSON');
  } else {
    console.log('📁 No Firebase credentials found — using local JSON store');
    console.log('   To use Firestore: place firebase-service-account.json in backend/');
  }
} catch (error: any) {
  console.error('❌ Firebase error:', error.message);
  console.log('📁 Falling back to local JSON store');
}

// Set up Firestore if available
if (useFirestore) {
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
}

// Create collections — Firestore or local fallback
function makeCollection(name: string) {
  if (useFirestore) {
    return admin.firestore().collection(name);
  }
  return createLocalCollection(name) as any;
}

export const collections = {
  users: makeCollection('users'),
  proposals: makeCollection('proposals'),
  evaluations: makeCollection('evaluations'),
  comparisons: makeCollection('comparisons'),
  aiLogs: makeCollection('ai_logs'),
  settings: makeCollection('settings'),
};

export default admin;
