import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBNFDPZjBJmVUnDsF6M-C1DO5lkKnnr4ts",
  authDomain: "chessforge-4ce57.firebaseapp.com",
  projectId: "chessforge-4ce57",
  storageBucket: "chessforge-4ce57.firebasestorage.app",
  messagingSenderId: "917207299364",
  appId: "1:917207299364:web:5e78248833678bf340efb1",
  measurementId: "G-TKRZ00ZM7B"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { app, auth, googleProvider, signInWithPopup, signOut };
