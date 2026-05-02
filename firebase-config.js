/**
 * firebase-config.js — IMCure KYC Final
 */

const firebaseConfig = {
  apiKey:            "AIzaSyCV9sS8a0CVDicZlb-QQkB5i7uQKn7YBCM",
  authDomain:        "imcure-kyc-system.firebaseapp.com",
  projectId:         "imcure-kyc-system",
  storageBucket:     "imcure-kyc-system.firebasestorage.app",
  messagingSenderId: "792939884118",
  appId:             "1:792939884118:web:b42b4dce824191475315f7",
  measurementId:     "G-WNV03YRK9V"
};

firebase.initializeApp(firebaseConfig);

const auth    = firebase.auth();
const db      = firebase.firestore();

console.log("[IMCure KYC] Firebase initialized ✅");
