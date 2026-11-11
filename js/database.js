/* ============================================================
   Shuttlestepz — database.js
   Firebase Firestore + Auth (Email/Password)
   Real-time listeners · Full data layer
   ============================================================ */

import { initializeApp }                from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  GoogleAuthProvider,
  signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc,
  addDoc, deleteDoc,
  collection, query, orderBy, limit,
  onSnapshot, serverTimestamp, increment,
  getDocs, where, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'

/* ── 1. FIREBASE CONFIG ─────────────────────────────────────── */
const FIREBASE_CONFIG = {
  apiKey            : 'AIzaSyDAznGVHeLIAR6pPSVewiw3hUpSPYtXgO4',
  authDomain        : 'shuttlestepz-bac23.firebaseapp.com',
  projectId         : 'shuttlestepz-bac23',
  storageBucket     : 'shuttlestepz-bac23.firebasestorage.app',
  messagingSenderId : '167174250097',
  appId             : '1:167174250097:web:d2b2cd1afa8818005fc5d0',
  measurementId     : 'G-Y0CJ1JVD45',
}

const CREATOR_EMAILS = ['techycoder1@gmail.com']

const app  = initializeApp(FIREBASE_CONFIG)
const auth = getAuth(app)
const db   = getFirestore(app)

/* ── 2. STATE ────────────────────────────────────────────────── */
let currentUser      = null
const _unsubscribers = {}

/* ═══════════════════════════════════════════════════════════════
   3. AUTH
═══════════════════════════════════════════════════════════════ */

export async function registerUser({ email, password, displayName, role = 'student', schoolCode = '' }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  const uid  = cred.user.uid
  await updateProfile(cred.user, { displayName })
  await setDoc(doc(db, 'users', uid), {
    profile: {
      displayName,
      email,
      role,
      schoolCode : schoolCode.toUpperCase(),
      plan       : 'free',
      createdAt  : serverTimestamp(),
    },
    xp            : 0,
    level         : 1,
    totalSessions : 0,
    bestStreak    : 0,
    settings: {
      voiceOn        : true,
      beepOn         : true,
      preferredDiff  : 'medium',
      preferredGroup : 'all',
    },
  })
  await _syncLeaderboard(uid, { displayName, xp: 0, level: 1, role })
  return cred.user
}

export async function loginUser({ email, password, remember = true }) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
  const cred = await signInWithEmailAndPassword(auth, email, password)
  return cred.user
}

export async function loginWithGoogle({ remember = true } = {}) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const cred = await signInWithPopup(auth, provider)
  const user = cred.user

  // First-time Google user: create the same docs registerUser() creates
  const userRef  = doc(db, 'users', user.uid)
  const userSnap = await getDoc(userRef)
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      profile: {
        displayName : user.displayName || user.email,
        email       : user.email,
        role        : 'student',
        schoolCode  : '',
        plan        : 'free',
        createdAt   : serverTimestamp(),
      },
      xp: 0, level: 1, totalSessions: 0, bestStreak: 0,
      lastActive: serverTimestamp(),
      lastReminderStage: 0,
      settings: { voiceOn:true, beepOn:true, preferredDiff:'medium', preferredGroup:'all' },
    })
  }
  const lbSnap = await getDoc(doc(db, 'leaderboard', user.uid))
  if (!lbSnap.exists()) {
    await _syncLeaderboard(user.uid, {
      displayName: user.displayName || user.email, xp: 0, level: 1, role: 'student',
    })
  }
  return user
}

export async function logoutUser() {
  _teardownAllListeners()
  await signOut(auth)
  currentUser = null
  window.dispatchEvent(new CustomEvent('ss-auth-change', { detail: { user: null } }))
}

export async function resetPassword(email) {
  try {
    console.log('Attempting reset for:', email)
    await sendPasswordResetEmail(auth, email)
    console.log('Reset email sent successfully!')
  } catch(e) {
    console.error('Reset error code:', e.code)
    console.error('Reset error message:', e.message)
    throw e
  }
}

export function onAuthReady(callback) {
  return onAuthStateChanged(auth, async (user) => {
    currentUser = user
    if (user) {
      const snap = await getDoc(doc(db, 'users', user.uid))
      if (!snap.exists()) {
        await setDoc(doc(db, 'users', user.uid), {
          profile: {
            displayName : user.displayName || user.email,
            email       : user.email,
            role        : 'student',
            schoolCode  : '',
            plan        : 'free',
            createdAt   : serverTimestamp(),
          },
          xp: 0, level: 1, totalSessions: 0, bestStreak: 0,
          lastActive: serverTimestamp(),
          lastReminderStage: 0,
          settings: { voiceOn:true, beepOn:true, preferredDiff:'medium', preferredGroup:'all' },
        })
      } else {
        await updateDoc(doc(db, 'users', user.uid), {
          lastActive: serverTimestamp(),
          lastReminderStage: 0,
        }).catch(() => {})
      }
    }
    window.dispatchEvent(new CustomEvent('ss-auth-change', { detail: { user } }))
    callback(user)
  })
}

export async function setEmailOptOut(optOut) {
  const uid = _requireUID()
  await updateDoc(doc(db, 'users', uid), { emailOptOut: optOut })
}

export function getCurrentUser() { return currentUser }

/* ═══════════════════════════════════════════════════════════════
   4. USER PROFILE
═══════════════════════════════════════════════════════════════ */

export async function getUserProfile(uid = null) {
  const id = uid || currentUser?.uid
  if (!id) throw new Error('No authenticated user and no uid provided.')
  const snap = await getDoc(doc(db, 'users', id))
  if (!snap.exists()) throw new Error(`User ${id} not found`)
  return { uid: id, ...snap.data() }
}

export async function updateUserProfile(updates) {
  const uid  = _requireUID()
  const safe = {}
  if (updates.displayName) safe['profile.displayName'] = updates.displayName
  if (updates.username)    safe['profile.username']    = updates.username
  if (updates.role)        safe['profile.role']        = updates.role
  if (updates.schoolCode)  safe['profile.schoolCode']  = updates.schoolCode.toUpperCase()
  if (updates.plan)        safe['profile.plan']        = updates.plan
  if (updates.avatarURL)   safe['profile.avatarURL']   = updates.avatarURL
  if (updates.phone)       safe['profile.phone']       = updates.phone
  if (updates.dob)         safe['profile.dob']         = updates.dob
  if (updates.gender)      safe['profile.gender']      = updates.gender
  if (updates.location)    safe['profile.location']    = updates.location
  if (updates.bio)         safe['profile.bio']         = updates.bio
  if (updates.skillLevel)  safe['profile.skillLevel']  = updates.skillLevel
  if (updates.playStyle)   safe['profile.playStyle']   = updates.playStyle
  if (updates.favShot)     safe['profile.favShot']     = updates.favShot
  if (updates.weakness)    safe['profile.weakness']    = updates.weakness
  if (updates.yearsExp !== undefined) safe['profile.yearsExp'] = updates.yearsExp
  if (updates.dominantHand) safe['profile.dominantHand'] = updates.dominantHand

  await updateDoc(doc(db, 'users', uid), safe)

  if (updates.displayName || updates.username) {
     if (updates.displayName) await updateProfile(auth.currentUser, { displayName: updates.displayName })
     await _syncLeaderboard(uid, { displayName: updates.displayName, username: updates.username })
   }
}

export function listenUserProfile(callback) {
  const uid = _requireUID()
  _teardown('userProfile')
  const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
    if (snap.exists()) callback({ uid, ...snap.data() })
  })
  _unsubscribers['userProfile'] = unsub
  return unsub
}

/* ═══════════════════════════════════════════════════════════════
   5. XP & LEVEL
═══════════════════════════════════════════════════════════════ */

const XP_THRESHOLDS = [0, 500, 1200, 2200, 3500, 5200, 7200, 9800, 13000, 17000, 22000]

function _calcLevel(xp) {
  let lv = 1
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) lv = i + 1; else break
  }
  return Math.min(lv, XP_THRESHOLDS.length)
}

export async function awardXP(amount) {
  const uid      = _requireUID()
  const snap     = await getDoc(doc(db, 'users', uid))
  const data     = snap.data()
  const oldXP    = data.xp    || 0
  const oldLevel = data.level || 1
  const newXP    = oldXP + amount
  const newLevel = _calcLevel(newXP)
  await updateDoc(doc(db, 'users', uid), { xp: newXP, level: newLevel })
  await _syncLeaderboard(uid, { xp: newXP, level: newLevel })
  return { newXP, newLevel, leveledUp: newLevel > oldLevel }
}

export async function getXPProgress(uid = null) {
  const id   = uid || _requireUID()
  const snap = await getDoc(doc(db, 'users', id))
  const { xp = 0, level = 1 } = snap.data()
  const cur  = XP_THRESHOLDS[level - 1] || 0
  const nxt  = XP_THRESHOLDS[level]     || XP_THRESHOLDS[XP_THRESHOLDS.length - 1]
  return {
    xp,
    level,
    toNextLevel : nxt - xp,
    pct         : Math.min(Math.max((xp - cur) / (nxt - cur), 0), 1) * 100,
  }
}

/* ═══════════════════════════════════════════════════════════════
   6. SESSIONS
   ✅ FIX: saveSession no longer increments totalSessions here —
   it's recalculated from actual records in getSessionStats
   to keep dashboard + history always in sync 🎯
═══════════════════════════════════════════════════════════════ */

export async function saveSession(sessionData) {
  const uid = _requireUID()

  // Save session record
  const ref = await addDoc(collection(db, 'sessions', uid, 'records'), {
    drill        : sessionData.drill        || 'footwork',
    mode         : sessionData.mode         || 'footwork',
    score        : sessionData.score        || 0,
    accuracy     : sessionData.accuracy     || 0,
    hits         : sessionData.hits         || 0,
    totalRounds  : sessionData.totalRounds  || 0,
    bestStreak   : sessionData.bestStreak   || 0,
    xpEarned     : sessionData.xpEarned     || 0,
    reactionTime : sessionData.reactionTime || null,
    consistency  : sessionData.consistency  || null,
    movement     : sessionData.movement     || null,
    difficulty   : sessionData.difficulty   || null,
    timePerDir   : sessionData.timePerDir   || null,
    dirStats     : sessionData.dirStats     || {},
    results      : sessionData.results      || [],
    roundTimings : sessionData.roundTimings || [],
    createdAt    : serverTimestamp(),
  })

  // ✅ Recalculate totalSessions from actual records count
  // instead of blindly incrementing (avoids double-count bug)
  const allSessions = await getDocs(collection(db, 'sessions', uid, 'records'))
  const realCount   = allSessions.size

  const userRef  = doc(db, 'users', uid)
  const userSnap = await getDoc(userRef)
  const userData = userSnap.data()
  const newBest  = Math.max(userData.bestStreak || 0, sessionData.bestStreak || 0)

  await updateDoc(userRef, {
    totalSessions : realCount,  // ✅ always accurate
    bestStreak    : newBest,
  })

  return ref.id
}

export async function updateSession(sessionId, updates = {}) {
  const uid = _requireUID()
  const safe = {}
  if (updates.feedback) safe.feedback = updates.feedback
  if (!Object.keys(safe).length) return
  await updateDoc(doc(db, 'sessions', uid, 'records', sessionId), safe)
}

export async function getSessions({ uid = null, limitN = 20 } = {}) {
  const id = uid || currentUser?.uid
  if (!id) throw new Error('No authenticated user and no uid provided.')
  const q    = query(
    collection(db, 'sessions', id, 'records'),
    orderBy('createdAt', 'desc'),
    limit(limitN)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export function listenSessions(callback, limitN = 20) {
  const uid = _requireUID()
  _teardown('sessions')
  const q = query(
    collection(db, 'sessions', uid, 'records'),
    orderBy('createdAt', 'desc'),
    limit(limitN)
  )
  const unsub = onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
  _unsubscribers['sessions'] = unsub
  return unsub
}

export async function getSessionStats(uid = null) {
  const id       = uid || _requireUID()

  // ✅ FIX: Calculate ALL stats from actual session records
  // so dashboard + history page always show identical numbers 🎯
  const sessions = await getSessions({ uid: id, limitN: 500 })

  const totalXP  = sessions.reduce((s, r) => s + (r.xpEarned  || 0), 0)
  const avgScore = sessions.length
    ? Math.round(sessions.reduce((s, r) => s + (r.score    || 0), 0) / sessions.length) : 0
  const avgAcc   = sessions.length
    ? Math.round(sessions.reduce((s, r) => s + (r.accuracy || 0), 0) / sessions.length) : 0
  const bestStreak = sessions.reduce((b, r) => Math.max(b, r.bestStreak || 0), 0)

  // ✅ Also fix the user doc to stay in sync
  const userRef = doc(db, 'users', id)
  await updateDoc(userRef, {
    totalSessions : sessions.length,
    bestStreak,
  }).catch(() => {}) // silent fail if not owner

  return {
    totalSessions : sessions.length,  // ✅ from real records
    totalXP,                          // ✅ from real records
    bestStreak,                       // ✅ from real records
    avgScore,
    avgAccuracy   : avgAcc,
  }
}

export async function deleteSession(sessionId) {
  const uid = _requireUID()
  await deleteDoc(doc(db, 'sessions', uid, 'records', sessionId))
}

/* ═══════════════════════════════════════════════════════════════
   6b. PLANS (diet / hydration / workout)
═══════════════════════════════════════════════════════════════ */

export async function savePlan(planType, planData) {
  const uid = _requireUID()
  const ref = await addDoc(collection(db, 'plans', uid, planType), {
    data      : planData,
    createdAt : serverTimestamp(),
  })
  return ref.id
}

export async function getPlans(planType, { uid = null, limitN = 10 } = {}) {
  const id = uid || _requireUID()
  const q = query(
    collection(db, 'plans', id, planType),
    orderBy('createdAt', 'desc'),
    limit(limitN)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export function listenPlans(planType, callback, limitN = 10) {
  const uid = _requireUID()
  _teardown('plans_' + planType)
  const q = query(
    collection(db, 'plans', uid, planType),
    orderBy('createdAt', 'desc'),
    limit(limitN)
  )
  const unsub = onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
  _unsubscribers['plans_' + planType] = unsub
  return unsub
}

export async function deletePlan(planType, planId) {
  const uid = _requireUID()
  await deleteDoc(doc(db, 'plans', uid, planType, planId))
}

/* ═══════════════════════════════════════════════════════════════
   7. LEADERBOARD
═══════════════════════════════════════════════════════════════ */

export function listenLeaderboard(callback, topN = 50) {
  _teardown('leaderboard')
  const q = query(
    collection(db, 'leaderboard'),
    orderBy('xp', 'desc'),
    limit(topN)
  )
  const unsub = onSnapshot(q, (snap) => {
    const entries = snap.docs.map((d, i) => ({
      uid         : d.id,
      rank        : i + 1,
      displayName : d.data().displayName,
      username    : d.data().username    || null,
      avatarURL   : d.data().avatarURL   || null,
      xp          : d.data().xp,
      level       : d.data().level,
      role        : d.data().role,
    }))
    callback(entries)
  })
  _unsubscribers['leaderboard'] = unsub
  return unsub
}

/* ── Weekly / monthly boards (written only by the Cloud Function) ── */
function _periodEntry(id, d) {
  const sessions = d.sessions || 0
  return {
    uid: id, displayName: d.displayName, username: d.username || null,
    avatarURL: d.avatarURL || null, role: d.role, level: d.level || 1,
    xp: d.xp || 0, sessions,
    avgScore: sessions ? Math.round((d.scoreTotal || 0) / sessions) : 0,
    bestScore: d.bestScore || 0,
  }
}

export function listenPeriodLeaderboard(periodKey, callback, onError, topN = 50) {
  _teardown('leaderboardPeriod')
  const q = query(
    collection(db, 'leaderboardPeriods', periodKey, 'players'),
    orderBy('xp', 'desc'),
    limit(topN)
  )
  const unsub = onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d, i) => ({ ..._periodEntry(d.id, d.data()), rank: i + 1 }))),
    (err) => { console.error('[period board]', err.message); if (onError) onError(err) }
  )
  _unsubscribers['leaderboardPeriod'] = unsub
  return unsub
}

export async function getPeriodEntries(periodKey, uids) {
  const snaps = await Promise.all(uids.map(u =>
    getDoc(doc(db, 'leaderboardPeriods', periodKey, 'players', u)).catch(() => null)))
  return snaps.filter(s => s && s.exists()).map(s => _periodEntry(s.id, s.data()))
}

export async function getPeriodRank(periodKey, uid) {
  const snap = await getDoc(doc(db, 'leaderboardPeriods', periodKey, 'players', uid))
  if (!snap.exists()) return null
  const entry = _periodEntry(uid, snap.data())
  const above = await getDocs(query(
    collection(db, 'leaderboardPeriods', periodKey, 'players'),
    where('xp', '>', entry.xp)
  ))
  return { rank: above.size + 1, entry }
}

export async function getUserRank(uid = null) {
  const id   = uid || _requireUID()
  const snap = await getDoc(doc(db, 'leaderboard', id))
  if (!snap.exists()) return null
  const myXP = snap.data().xp || 0
  const q    = query(collection(db, 'leaderboard'), where('xp', '>', myXP))
  const above= await getDocs(q)
  return above.size + 1
}

/* ═══════════════════════════════════════════════════════════════
   8. SETTINGS
═══════════════════════════════════════════════════════════════ */

export async function getSettings(uid = null) {
  const id   = uid || _requireUID()
  const snap = await getDoc(doc(db, 'users', id))
  return snap.data()?.settings || {}
}

export async function saveSettings(settings) {
  const uid     = _requireUID()
  const patch   = {}
  const allowed = ['voiceOn', 'beepOn', 'preferredDiff', 'preferredGroup']
  allowed.forEach(k => { if (settings[k] !== undefined) patch[`settings.${k}`] = settings[k] })
  await updateDoc(doc(db, 'users', uid), patch)
}

export function listenSettings(callback) {
  const uid = _requireUID()
  _teardown('settings')
  const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
    if (snap.exists()) callback(snap.data()?.settings || {})
  })
  _unsubscribers['settings'] = unsub
  return unsub
}

/* ═══════════════════════════════════════════════════════════════
   9. SCHOOL / COACH
═══════════════════════════════════════════════════════════════ */

export async function getStudentsBySchoolCode(schoolCode) {
  const q    = query(
    collection(db, 'users'),
    where('profile.schoolCode', '==', schoolCode.toUpperCase()),
    where('profile.role', '==', 'student')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }))
}

export function listenStudentsBySchoolCode(schoolCode, callback) {
  _teardown('students')
  const q = query(
    collection(db, 'users'),
    where('profile.schoolCode', '==', schoolCode.toUpperCase()),
    where('profile.role', '==', 'student')
  )
  const unsub = onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ uid: d.id, ...d.data() })))
  })
  _unsubscribers['students'] = unsub
  return unsub
}

/* ═══════════════════════════════════════════════════════════════
   10. RESET
═══════════════════════════════════════════════════════════════ */

export async function resetUserData() {
  const uid   = _requireUID()
  const batch = writeBatch(db)
  batch.update(doc(db, 'users', uid), { xp:0, level:1, totalSessions:0, bestStreak:0 })
  batch.update(doc(db, 'leaderboard', uid), { xp:0, level:1, updatedAt:serverTimestamp() })
  await batch.commit()
  const sessions = await getSessions({ limitN: 500 })
  if (sessions.length > 0) {
    const del = writeBatch(db)
    sessions.forEach(s => del.delete(doc(db, 'sessions', uid, 'records', s.id)))
    await del.commit()
  }
}

/* ═══════════════════════════════════════════════════════════════
   11. LISTENER CLEANUP
═══════════════════════════════════════════════════════════════ */

export function unsubscribeAll() { _teardownAllListeners() }
export function unsubscribe(key) { _teardown(key) }

function _requireUID() {
  if (currentUser?.uid) return currentUser.uid
  try {
    const cached = JSON.parse(sessionStorage.getItem('ssz_v2_user'))
    if (cached?.uid) return cached.uid
  } catch(e) {}
  throw new Error('No authenticated user.')
}
function _teardown(key) {
  if (_unsubscribers[key]) { _unsubscribers[key](); delete _unsubscribers[key] }
}
function _teardownAllListeners() {
  Object.keys(_unsubscribers).forEach(_teardown)
}
async function _syncLeaderboard(uid, patch = {}) {
  const ref   = doc(db, 'leaderboard', uid)
  const snap  = await getDoc(ref)
  const uSnap = await getDoc(doc(db, 'users', uid))
  const uData = uSnap.exists() ? uSnap.data() : {}
  const username  = patch.username  || uData.profile?.username  || null
  const avatarURL = patch.avatarURL || uData.profile?.avatarURL || null
   
  if (snap.exists()) {
      await updateDoc(ref, { ...patch, avatarURL, username, updatedAt: serverTimestamp() })
  } else {
    await setDoc(ref, {
     displayName : patch.displayName || uData.profile?.displayName || 'Player',
     username    : username,
     xp          : patch.xp         || uData.xp    || 0,
     level       : patch.level      || uData.level || 1,
     role        : patch.role       || uData.profile?.role || 'student',
     avatarURL,
     updatedAt   : serverTimestamp(),
   })
  }
}

window.addEventListener('beforeunload', _teardownAllListeners);

export async function deleteUserData(uid) {
  // Delete sessions subcollection
  const sessionsRef = collection(db, 'sessions', uid, 'records')
  const sessions = await getDocs(sessionsRef)
  await Promise.all(sessions.docs.map(d => deleteDoc(d.ref)))

  // Delete leaderboard entry
  await deleteDoc(doc(db, 'leaderboard', uid)).catch(() => {})

  // Remove from all friends' lists
  const myFriendsSnap = await getDocs(collection(db, 'friends', uid, 'list'))
  for (const d of myFriendsSnap.docs) {
    const friendUid = d.id
    await deleteDoc(doc(db, 'friends', friendUid, 'list', uid)).catch(() => {})
    await deleteDoc(doc(db, 'friends', uid, 'list', friendUid)).catch(() => {})
  }

  // Remove pending friend requests involving this user
  const sentQ = query(collection(db, 'friendRequests'), where('from', '==', uid))
  const recvQ = query(collection(db, 'friendRequests'), where('to', '==', uid))
  const [sentSnap, recvSnap] = await Promise.all([getDocs(sentQ), getDocs(recvQ)])
  await Promise.all([
    ...sentSnap.docs.map(d => deleteDoc(d.ref)),
    ...recvSnap.docs.map(d => deleteDoc(d.ref)),
  ])

// Delete all chats involving this user (both messages + chat doc)
  const chatsQ = query(collection(db, 'chats'), where('participants', 'array-contains', uid))
  const chatsSnap = await getDocs(chatsQ)
  for (const chatDoc of chatsSnap.docs) {
    const msgsSnap = await getDocs(collection(db, 'chats', chatDoc.id, 'messages'))
    const delBatch = writeBatch(db)
    msgsSnap.docs.forEach(m => delBatch.delete(m.ref))
    delBatch.delete(chatDoc.ref)
    await delBatch.commit()
  }

  // Delete user document
  await deleteDoc(doc(db, 'users', uid))
}

/* ═══════════════════════════════════════════════════════════════
   12. DEFAULT EXPORT
═══════════════════════════════════════════════════════════════ */

export async function saveAITips(tips) {
  const uid = _requireUID()
  await setDoc(doc(db, 'users', uid, 'meta', 'ai_tips'), tips)
}

export async function getAITips(uid = null) {
  const id = uid || _requireUID()
  const snap = await getDoc(doc(db, 'users', id, 'meta', 'ai_tips'))
  return snap.exists() ? snap.data() : null
}
/* ═══════════════════════════════════════════════════════════════
   14. PUSH NOTIFICATIONS
═══════════════════════════════════════════════════════════════ */

export async function savePushSubscription(subscription) {
  const uid = _requireUID()
  await setDoc(doc(db, 'pushSubscriptions', uid), {
    subscription: JSON.parse(JSON.stringify(subscription)),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function removePushSubscription() {
  const uid = _requireUID()
  await deleteDoc(doc(db, 'pushSubscriptions', uid)).catch(() => {})
}

export async function getLastSessionTime(uid = null) {
  const id = uid || _requireUID()
  const sessions = await getSessions({ uid: id, limitN: 1 })
  if (!sessions.length) return null
  const ts = sessions[0].createdAt
  if (!ts) return null
  return ts.toMillis ? ts.toMillis() : ts
}

export default {
  registerUser, loginUser, loginWithGoogle, logoutUser, resetPassword, onAuthReady, getCurrentUser,
  getUserProfile, updateUserProfile, listenUserProfile,
  awardXP, getXPProgress,
  saveSession, updateSession, getSessions, listenSessions, getSessionStats, deleteSession,
  listenLeaderboard, listenPeriodLeaderboard, getPeriodEntries, getPeriodRank, getUserRank,
  getSettings, saveSettings, listenSettings,
  getStudentsBySchoolCode, listenStudentsBySchoolCode,
  unsubscribeAll, unsubscribe, resetUserData, saveAITips, getAITips, deleteUserData,
  setEmailOptOut,   searchUsersByUsername, sendFriendRequest, respondToFriendRequest,
  listenFriendRequests, listenFriends, getFriendshipStatus,
  sendMessage, listenChat, listenMyChats, clearChat, deleteChat,savePushSubscription, removePushSubscription, getLastSessionTime,
  savePlan, getPlans, listenPlans, deletePlan,
}

/* ═══════════════════════════════════════════════════════════════
   13. SOCIAL — Find Players, Friends, Chat
═══════════════════════════════════════════════════════════════ */

// ── Search users by username/displayName (prefix match) ──
export async function searchUsersByUsername(searchQuery) {
  const term = searchQuery.trim().toLowerCase()
  if (!term) return []

  const snap = await getDocs(collection(db, 'leaderboard'))
  const myUid = _requireUID()

  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => u.uid !== myUid)
    .filter(u => {
      const uname = (u.username || '').toLowerCase()
      const dname = (u.displayName || '').toLowerCase()
      return uname.includes(term) || dname.includes(term)
    })
    .slice(0, 20)
}

// ── Friend requests ──
export async function sendFriendRequest(toUid) {
  const fromUid = _requireUID()
  if (fromUid === toUid) throw new Error('Cannot add yourself.')

  // Check existing request/friendship
  const existingQ = query(
    collection(db, 'friendRequests'),
    where('from', '==', fromUid),
    where('to', '==', toUid)
  )
  const existing = await getDocs(existingQ)
  if (!existing.empty) throw new Error('Request already sent.')

  await addDoc(collection(db, 'friendRequests'), {
    from: fromUid,
    to: toUid,
    status: 'pending',
    createdAt: serverTimestamp(),
  })
}

export async function respondToFriendRequest(requestId, accept) {
  const myUid = _requireUID()
  const reqRef = doc(db, 'friendRequests', requestId)
  const reqSnap = await getDoc(reqRef)
  if (!reqSnap.exists()) throw new Error('Request not found.')
  const reqData = reqSnap.data()
  if (reqData.to !== myUid) throw new Error('Not authorized.')

  if (accept) {
    await updateDoc(reqRef, { status: 'accepted' })
    // Add to both users' friend lists
    const batch = writeBatch(db)
    batch.set(doc(db, 'friends', reqData.from, 'list', reqData.to), {
      uid: reqData.to, addedAt: serverTimestamp(),
    })
    batch.set(doc(db, 'friends', reqData.to, 'list', reqData.from), {
      uid: reqData.from, addedAt: serverTimestamp(),
    })
    await batch.commit()
  } else {
    await updateDoc(reqRef, { status: 'declined' })
  }
}

export function listenFriendRequests(callback) {
  const uid = _requireUID()
  _teardown('friendRequests')
  const q = query(
    collection(db, 'friendRequests'),
    where('to', '==', uid)
  )
  const unsub = onSnapshot(q, async (snap) => {
    const requests = []
    for (const d of snap.docs.filter(d => d.data().status === 'pending')) {
      const data = d.data()
      let fromProfile = {}
      try {
        const lbSnap = await getDoc(doc(db, 'leaderboard', data.from))
        if (lbSnap.exists()) fromProfile = lbSnap.data()
      } catch(e) {}
      requests.push({ id: d.id, ...data, fromProfile })
    }
    callback(requests)
  })
  _unsubscribers['friendRequests'] = unsub
  return unsub
}

export function listenFriends(callback) {
  const uid = _requireUID()
  _teardown('friends')
  const q = collection(db, 'friends', uid, 'list')
  const unsub = onSnapshot(q, async (snap) => {
    const friends = []
    for (const d of snap.docs) {
      const friendUid = d.id
      let profile = {}
      try {
        const lbSnap = await getDoc(doc(db, 'leaderboard', friendUid))
        if (lbSnap.exists()) profile = lbSnap.data()
      } catch(e) {}
      friends.push({ uid: friendUid, ...profile })
    }
    callback(friends)
  })
  _unsubscribers['friends'] = unsub
  return unsub
}

export async function getFriendshipStatus(otherUid) {
  const myUid = _requireUID()

  // Already friends?
  const friendSnap = await getDoc(doc(db, 'friends', myUid, 'list', otherUid))
  if (friendSnap.exists()) return 'friends'

  // Pending request sent by me?
  const sentQ = query(
    collection(db, 'friendRequests'),
    where('from', '==', myUid),
    where('to', '==', otherUid),
    where('status', '==', 'pending')
  )
  const sent = await getDocs(sentQ)
  if (!sent.empty) return 'pending_sent'

  // Pending request received from them?
  const recvQ = query(
    collection(db, 'friendRequests'),
    where('from', '==', otherUid),
    where('to', '==', myUid),
    where('status', '==', 'pending')
  )
  const recv = await getDocs(recvQ)
  if (!recv.empty) return 'pending_received'

  return 'none'
}

// ── Chat ──
function _chatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_')
}

export async function sendMessage(otherUid, text) {
  const myUid = _requireUID()
  const trimmed = text.trim()
  if (!trimmed) return
  const chatId = _chatId(myUid, otherUid)

  await addDoc(collection(db, 'chats', chatId, 'messages'), {
    from: myUid,
    text: trimmed,
    createdAt: serverTimestamp(),
  })

  await setDoc(doc(db, 'chats', chatId), {
    participants: [myUid, otherUid],
    lastMessage: trimmed,
    lastMessageAt: serverTimestamp(),
  }, { merge: true })
}

export function listenChat(otherUid, callback, limitN = 50) {
  const myUid = _requireUID()
  const chatId = _chatId(myUid, otherUid)
  _teardown('chat_' + chatId)

  const q = query(
    collection(db, 'chats', chatId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(limitN)
  )
  const unsub = onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
  _unsubscribers['chat_' + chatId] = unsub
  return unsub
}

export function listenMyChats(callback) {
  const uid = _requireUID()
  _teardown('myChats')
  const q = query(
    collection(db, 'chats'),
    where('participants', 'array-contains', uid),
    orderBy('lastMessageAt', 'desc'),
    limit(30)
  )
  const unsub = onSnapshot(q, async (snap) => {
    const chats = []
    for (const d of snap.docs) {
      const data = d.data()
      const otherUid = data.participants.find(p => p !== uid)
      let profile = {}
      let profileExists = false
      try {
        const lbSnap = await getDoc(doc(db, 'leaderboard', otherUid))
        if (lbSnap.exists()) { profile = lbSnap.data(); profileExists = true }
      } catch(e) {}
      if (!profileExists) continue // skip chats with deleted/missing users
      chats.push({ id: d.id, otherUid, ...data, profile })
    }
    callback(chats)
  })
  _unsubscribers['myChats'] = unsub
  return unsub
}
export async function clearChat(otherUID) {
  const me = auth.currentUser;
  if (!me) throw new Error('Not signed in');
  const chatId = [me.uid, otherUID].sort().join('_');
  const msgsRef = collection(db, 'chats', chatId, 'messages');
  const snap = await getDocs(msgsRef);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

export async function deleteChat(otherUID) {
  const me = auth.currentUser;
  if (!me) throw new Error('Not signed in');
  const chatId = [me.uid, otherUID].sort().join('_');
  const msgsRef = collection(db, 'chats', chatId, 'messages');
  const snap = await getDocs(msgsRef);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, 'chats', chatId));
  await batch.commit();
}
