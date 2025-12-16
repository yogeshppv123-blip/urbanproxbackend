const admin = require('firebase-admin');
const path = require('path');

// Path to your downloaded service account key
const serviceAccountPath = path.join(__dirname, '../../service-account.json.json');

try {
    const serviceAccount = require(serviceAccountPath);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log('🔥 Firebase Admin Initialized Successfully');
} catch (error) {
    console.error('❌ Firebase Init Error:', error.message);
    // We don't crash the app if firebase fails, just log it
}

const db = admin.firestore();
// If using a custom database name, specify it:
db.settings({ databaseId: 'default' });
const messager = admin.messaging();

module.exports = { admin, db, messager };
