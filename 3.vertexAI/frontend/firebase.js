import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth"
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "vertexai-746c4.firebaseapp.com",
  projectId: "vertexai-746c4",
  storageBucket: "vertexai-746c4.firebasestorage.app",
  messagingSenderId: "769324829406",
  appId: "1:769324829406:web:0b5cdba46cfd44eb41104f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth=getAuth(app)
export const googleProvider=new GoogleAuthProvider()