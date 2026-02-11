const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://topina-9cd75-default-rtdb.firebaseio.com/"
});

const db = admin.database();

async function inspect() {
    console.log('Inspecting RTDB root...');
    const ref = db.ref('/');
    const snapshot = await ref.once('value');

    if (snapshot.exists()) {
        const data = snapshot.val();
        console.log('Root keys:', Object.keys(data));

        if (data.fantasy) {
            console.log('Fantasy keys:', Object.keys(data.fantasy));
            const s2024 = data.fantasy.fantasy_data_2024;
            if (s2024) {
                console.log('fantasy_data_2024 size:', JSON.stringify(s2024).length, 'bytes');
            }
        }
        if (data.draft) {
            console.log('Draft keys:', Object.keys(data.draft));
        }
        if (data.stats) {
            console.log('Stats keys:', Object.keys(data.stats));
        }
    } else {
        console.log('Database is empty.');
    }
}

inspect().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
