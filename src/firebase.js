import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDa0_OO59UC7r7AtFG2XlkN2Sa_XE5Q0wI",
  authDomain: "airqualitymonitor-ca58a.firebaseapp.com",
  databaseURL: "https://airqualitymonitor-ca58a-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "airqualitymonitor-ca58a",
  storageBucket: "airqualitymonitor-ca58a.firebasestorage.app",
  messagingSenderId: "456571990010",
  appId: "1:456571990010:web:bbe90d2dd9bac03aaefe43",
  measurementId: "G-JNSP497RMV"
};

const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);
export const analytics = getAnalytics(app);

