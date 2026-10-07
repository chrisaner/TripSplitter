import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, set, onValue, off, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyATPWfxHpNCqBNaf2q1mAsv_YWfnfNOnyw",
  authDomain: "tripsplitter-d0e56.firebaseapp.com",
  projectId: "tripsplitter-d0e56",
  databaseURL: "https://tripsplitter-d0e56-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "tripsplitter-d0e56.firebasestorage.app",
  messagingSenderId: "697978868312",
  appId: "1:697978868312:web:c61a26330f077a769b702d",
  measurementId: "G-B0KJVT1L27"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);

export { signInAnonymously, ref, set, onValue, off, get, storageRef, uploadBytes, getDownloadURL };
