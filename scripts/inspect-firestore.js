const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function inspect() {
    console.log('Listing documents in "fantasy" collection...');
    const snapshot = await db.collection('fantasy').get();

    if (snapshot.empty) {
        console.log('No documents found in "fantasy" collection.');
        return;
    }

    snapshot.forEach(doc => {
        console.log(`- ${doc.id} (Size: ~${JSON.stringify(doc.data()).length} bytes)`);
    });

    const docRef = db.collection('fantasy').doc('fantasy_data_2024');
    const docSnap = await docRef.get();

    if (docSnap.exists) {
        console.log('\nfantasy_data_2024 keys:', Object.keys(docSnap.data()));
        if (docSnap.data().weeks) {
            console.log('Weeks found:', Object.keys(docSnap.data().weeks));
        }
    } else {
        console.log('\nfantasy_data_2024 does NOT exist.');
    }
}

inspect().catch(console.error);
