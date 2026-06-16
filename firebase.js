import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection } from "firebase/firestore";

// ИНСТРУКЦИЯ: Создайте проект на https://console.firebase.google.com
// Включите Authentication > Google и Firestore Database
// Затем вставьте сюда ваш конфиг из Project Settings > Your apps
const firebaseConfig = {
  apiKey: "AIzaSyDhfu5fKnbaTA2aZYR7lekcSyEK0GbuYPQ",
  authDomain: "my-calendar-sync-b88cd.firebaseapp.com",
  projectId: "my-calendar-sync-b88cd",
  storageBucket: "my-calendar-sync-b88cd.firebasestorage.app",
  messagingSenderId: "965264661098",
  appId: "1:965264661098:web:98e1708bb97f84f8288813",
};

let app, auth, db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase не настроен:", e.message);
}

export { auth, db, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, doc, setDoc, getDoc, onSnapshot, collection };
export const isFirebaseConfigured = () => firebaseConfig.apiKey !== "ВСТАВЬТЕ_СЮДА";
