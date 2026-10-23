import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut, reload, signInWithPopup, GoogleAuthProvider, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getDatabase, ref, set, onValue, off, get, runTransaction, connectDatabaseEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
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

const localEmulators = ['localhost','127.0.0.1'].includes(location.hostname) && new URL(location.href).searchParams.get('emulators') === '1';
export const app = initializeApp(localEmulators ? {...firebaseConfig,apiKey:'local-demo-only',projectId:'demo-tripsplitter-auth',authDomain:'demo-tripsplitter-auth.localhost',databaseURL:'https://demo-tripsplitter-auth.firebaseio.com',storageBucket:'demo-tripsplitter-auth.appspot.com'} : firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);
if(localEmulators) {
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  connectDatabaseEmulator(db,'127.0.0.1',9000);
  connectFunctionsEmulator(getFunctions(app,'asia-southeast1'),'127.0.0.1',5001);
}

export { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut, reload, signInWithPopup, GoogleAuthProvider, getFunctions, httpsCallable, ref, set, onValue, off, get, runTransaction, storageRef, uploadBytes, getDownloadURL };
