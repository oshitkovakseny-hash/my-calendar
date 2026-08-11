import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

// Тот же проект Firebase, что используется остальным приложением
// (my-calendar-sync-b88cd). Значения ниже — публичный конфиг клиента
// Firebase, они не являются секретом; доступ к данным ограничивается
// правилами безопасности Firestore, а не сокрытием этих значений.
const firebaseConfig = {
  apiKey: "AIzaSyDhfu5fKnbaTA2aZYR7lekcSyEK0GbuYPQ",
  authDomain: "my-calendar-sync-b88cd.firebaseapp.com",
  projectId: "my-calendar-sync-b88cd",
  storageBucket: "my-calendar-sync-b88cd.firebasestorage.app",
  messagingSenderId: "965264661098",
  appId: "1:965264661098:web:98e1708bb97f84f8288813",
};

let app, db;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.warn("Firebase не настроен:", e.message);
}

export const isFirebaseConfigured = () => !!db;

// Сохраняет ответы и результат теста в коллекцию quiz_submissions.
export async function saveSubmission(data) {
  if (!db) return null;
  const ref = await addDoc(collection(db, "quiz_submissions"), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Кладёт письмо в коллекцию mail — её читает расширение Firebase
// «Trigger Email from Firestore» и отправляет письмо через настроенный
// в расширении SMTP. Без установленного расширения документ просто
// останется в базе и ничего не отправит — см. README.md.
export async function queueResultEmail({ to, subject, html }) {
  if (!db) return null;
  const ref = await addDoc(collection(db, "mail"), {
    to: [to],
    message: { subject, html },
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
