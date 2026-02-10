import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBwGgLLBmHaq1DXKwtvj-Au6bGlzk8Yq_s",
    authDomain: "topina-9cd75.firebaseapp.com",
    projectId: "topina-9cd75",
    storageBucket: "topina-9cd75.firebasestorage.app",
    messagingSenderId: "1061652348912",
    appId: "1:1061652348912:web:5d6b0300162cac80b2a735",
    measurementId: "G-HJJT75RJFY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { app, analytics, db };
