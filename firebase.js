// Firebase SDK imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDJ-KvLYyNG_a0lxjYzDslbSg5mqQA9aNQ",
  authDomain: "quewise-95ebb.firebaseapp.com",
  projectId: "quewise-95ebb",
  storageBucket: "quewise-95ebb.firebasestorage.app",
  messagingSenderId: "835797482752",
  appId: "1:835797482752:web:367c09d25502d83d4e87e5",
  measurementId: "G-FWWGY9VBPV"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Authentication
const auth = getAuth(app);

// Initialize Firestore Database
const db = getFirestore(app);

// Export Firebase services for other JS files
export { app, auth, db };

console.log("QueWise Firebase connected successfully!", app);