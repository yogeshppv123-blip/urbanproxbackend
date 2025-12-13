const admin = require('firebase-admin');

// Load service account from environment variable or file (for local dev)
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Production: Parse from environment variable
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('✅ Firebase credentials loaded from environment variable');
    } catch (error) {
        console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT env variable:', error.message);
        throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT format');
    }
} else {
    // Development: Load from local file
    try {
        serviceAccount = require('./firebase-service-account.json');
        console.log('✅ Firebase credentials loaded from local file (dev mode)');
    } catch (error) {
        console.error('❌ Firebase service account not found. Set FIREBASE_SERVICE_ACCOUNT env variable or add firebase-service-account.json');
        throw error;
    }
}

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || 'urbanprox-7aa0d'
});

// Export auth instance
const auth = admin.auth();

module.exports = { admin, auth };
