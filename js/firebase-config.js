import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";
import { sweepStorage } from "./utils/storage.js?v=1";

const firebaseConfig = {
    apiKey: "AIzaSyBwGgLLBmHaq1DXKwtvj-Au6bGlzk8Yq_s",
    authDomain: "topina-9cd75.firebaseapp.com",
    databaseURL: "https://topina-9cd75-default-rtdb.firebaseio.com",
    projectId: "topina-9cd75",
    storageBucket: "topina-9cd75.firebasestorage.app",
    messagingSenderId: "1061652348912",
    appId: "1:1061652348912:web:5d6b0300162cac80b2a735",
    measurementId: "G-HJJT75RJFY"
};

// PRIMA di Firebase, sempre. L'SDK scrive `firebase:previous_websocket_failure`
// dentro WebSocketConnection.open senza try/catch: con lo storage pieno quella
// setItem lancia, la open si interrompe e il sito resta senza dati — ogni
// fetchFantasyData va in timeout. Qui garantiamo che lo spazio ci sia.
sweepStorage();

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getDatabase(app);

export { app, analytics, db };
