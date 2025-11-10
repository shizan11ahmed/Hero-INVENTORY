import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth'
import { getFirestore, enableIndexedDbPersistence, collection, doc, setDoc, addDoc, updateDoc, onSnapshot, query, where, orderBy, serverTimestamp, getDoc } from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { firebaseConfig } from './firebaseConfig'

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

// Offline persistence
enableIndexedDbPersistence(db).catch(()=>{})

export const provider = new GoogleAuthProvider()

export function signin() { return signInWithPopup(auth, provider) }
export function signout() { return SignOut(auth) }
// fix typo: implement a helper signout below
export function SignOut(authInstance){ return signOut(authInstance) }

export async function setUserRole({ email, role, expiresAt }) {
  const refDoc = doc(db, 'users', email.toLowerCase())
  await setDoc(refDoc, { email: email.toLowerCase(), role, expiresAt, updatedAt: serverTimestamp() }, { merge: true })
}
export async function getUserRole(email) {
  const refDoc = doc(db, 'users', email.toLowerCase())
  const snap = await getDoc(refDoc)
  return snap.exists() ? snap.data() : null
}

export function listenInventory({ dealership, date }, cb) {
  const col = collection(db, 'inventory')
  const q = query(col, where('dealership','==',dealership), where('date','==',date), orderBy('model'))
  return onSnapshot(q, (snap) => {
    const items = []
    snap.forEach(docu => items.push({ id: docu.id, ...docu.data() }))
    cb(items)
  })
}

export async function addInventory(item) {
  const col = collection(db, 'inventory')
  await addDoc(col, { ...item, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}

export async function updateInventory(id, patch) {
  const refDoc = doc(db, 'inventory', id)
  await updateDoc(refDoc, { ...patch, updatedAt: serverTimestamp() })
}

export async function uploadPhoto(file, path) {
  const r = ref(storage, path)
  await uploadBytes(r, file)
  return await getDownloadURL(r)
}
