import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection } from "firebase/firestore";

// ИНСТРУКЦИЯ: Создайте проект на https://console.firebase.google.com
// Включите Authentication > Google и Firestore Database
// Затем вставьте сюда ваш конфиг из Project Settings > Your apps
const firebaseConfig = {
  apiKey: "ВСТАВЬТЕ_СЮДА",
  authDomain: "ВСТАВЬТЕ_СЮДА",
  projectId: "ВСТАВЬТЕ_СЮДА",
  storageBucket: "ВСТАВЬТЕ_СЮДА",
  messagingSenderId: "ВСТАВЬТЕ_СЮДА",
  appId: "ВСТАВЬТЕ_СЮДА",
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
