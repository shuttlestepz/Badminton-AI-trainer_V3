/* ============================================================
   ShuttleStepz — social.js
   Social data layer for social.html.
   Keeps the existing js/database.js completely untouched.
   Uses the SAME default Firebase app and Firestore database.
   ============================================================ */

import { getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js'
import {
  getFirestore,
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, orderBy, limit, onSnapshot,
  serverTimestamp, getDocs, where, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'

// Reuse the existing database.js app and auth state.
// Do NOT initialize a second Firebase app.
const app = getApp()
const auth = getAuth(app)
const db = getFirestore(app)

// Existing account/profile/dashboard functions remain in database.js.
export {
  onAuthReady, getUserProfile, logoutUser, listenUserProfile, getSessions,
} from './database.js'

const MSG_MAX = 500
const _unsubscribers = {}

function _requireUID() {
  const uid = auth.currentUser?.uid
  if (uid) return uid
  throw new Error('No authenticated user. Please sign in again.')
}

function _teardown(key) {
  if (_unsubscribers[key]) {
    _unsubscribers[key]()
    delete _unsubscribers[key]
  }
}

function _chatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_')
}

function _rememberListener(key, unsub) {
  _teardown(key)
  _unsubscribers[key] = unsub
  return unsub
}

window.addEventListener('beforeunload', () => {
  Object.keys(_unsubscribers).forEach(_teardown)
})

// ── Search users by username/displayName (substring match) ──
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

  // Only a pending request (or existing friendship) blocks a new one.
  // Previously a declined request blocked re-adding forever.
  const status = await getFriendshipStatus(toUid)
  if (status === 'friends') {
    throw new Error('You are already friends.')
  }
  if (status === 'pending_sent') {
    throw new Error('Request already sent.')
  }
  if (status === 'pending_received') {
    throw new Error('They already sent you a request. Accept it in Requests.')
  }

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
  if (reqData.status !== 'pending') {
    throw new Error('This request was already handled.')
  }

  if (accept) {
    // One atomic batch: status change + both friend-list entries.
    const batch = writeBatch(db)

    batch.update(reqRef, { status: 'accepted' })

    batch.set(doc(db, 'friends', reqData.from, 'list', reqData.to), {
      uid: reqData.to,
      addedAt: serverTimestamp(),
    })

    batch.set(doc(db, 'friends', reqData.to, 'list', reqData.from), {
      uid: reqData.from,
      addedAt: serverTimestamp(),
    })

    await batch.commit()
  } else {
    await updateDoc(reqRef, { status: 'declined' })
  }
}

// Returns the ID of a pending request otherUid sent to me.
export async function getPendingRequestFrom(otherUid) {
  const myUid = _requireUID()

  const q = query(
    collection(db, 'friendRequests'),
    where('from', '==', otherUid),
    where('to', '==', myUid),
    where('status', '==', 'pending')
  )

  const snap = await getDocs(q)
  return snap.empty ? null : snap.docs[0].id
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
  const friendSnap = await getDoc(
    doc(db, 'friends', myUid, 'list', otherUid)
  )

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

// Supports { replyTo: { id, text, fromName } }.
export async function sendMessage(otherUid, text, { replyTo = null } = {}) {
  const myUid = _requireUID()
  const trimmed = String(text || '').trim().slice(0, MSG_MAX)

  if (!trimmed) return

  const chatId = _chatId(myUid, otherUid)

  const data = {
    from: myUid,
    text: trimmed,
    createdAt: serverTimestamp(),
  }

  if (replyTo && replyTo.id) {
    data.replyTo = {
      id: String(replyTo.id),
      text: String(replyTo.text || '').slice(0, 120),
      fromName: String(replyTo.fromName || '').slice(0, 40),
    }
  }

  await addDoc(
    collection(db, 'chats', chatId, 'messages'),
    data
  )

  await setDoc(doc(db, 'chats', chatId), {
    participants: [myUid, otherUid],
    lastMessage: trimmed,
    lastMessageAt: serverTimestamp(),
  }, { merge: true })
}

// Shows the latest messages, then reverses them into chronological order.
export function listenChat(otherUid, callback, limitN = 50) {
  const myUid = _requireUID()
  const chatId = _chatId(myUid, otherUid)

  _teardown('chat_' + chatId)

  const q = query(
    collection(db, 'chats', chatId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(limitN)
  )

  const unsub = onSnapshot(q, (snap) => {
    callback(
      snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse()
    )
  })

  _unsubscribers['chat_' + chatId] = unsub
  return unsub
}

// Delete one message (sender only) and update the chat preview.
export async function deleteMessage(otherUid, messageId) {
  const myUid = _requireUID()
  const chatId = _chatId(myUid, otherUid)

  const ref = doc(db, 'chats', chatId, 'messages', messageId)
  const snap = await getDoc(ref)

  if (!snap.exists()) return

  if (snap.data().from !== myUid) {
    throw new Error('You can only delete your own messages.')
  }

  await deleteDoc(ref)

  // Re-point the thread preview at the newest remaining message.
  const chatRef = doc(db, 'chats', chatId)

  try {
    const last = await getDocs(query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(1)
    ))

    if (last.empty) {
      await updateDoc(chatRef, { lastMessage: '' })
    } else {
      const m = last.docs[0].data()

      await updateDoc(chatRef, {
        lastMessage: m.text || '',
        lastMessageAt: m.createdAt || serverTimestamp(),
      })
    }
  } catch(e) {
    console.warn('[chat] preview sync failed:', e.message)
  }
}

// Save a message report in the reports collection.
export async function reportMessage(otherUid, messageId, reason = '') {
  const myUid = _requireUID()
  const chatId = _chatId(myUid, otherUid)

  const snap = await getDoc(
    doc(db, 'chats', chatId, 'messages', messageId)
  )

  if (!snap.exists()) {
    throw new Error('Message no longer exists.')
  }

  const m = snap.data()

  if (m.from === myUid) {
    throw new Error('You cannot report your own message.')
  }

  await addDoc(collection(db, 'reports'), {
    reporter: myUid,
    reportedUid: m.from,
    chatId,
    messageId,
    messageText: String(m.text || '').slice(0, 300),
    reason: String(reason).slice(0, 200),
    createdAt: serverTimestamp(),
  })
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

        if (lbSnap.exists()) {
          profile = lbSnap.data()
          profileExists = true
        }
      } catch(e) {}

      if (!profileExists) continue

      chats.push({ id: d.id, otherUid, ...data, profile })
    }

    callback(chats)
  })

  _unsubscribers['myChats'] = unsub
  return unsub
}

// Delete messages in chunks of 400.
// Firestore allows a maximum of 500 operations per batch.
async function _deleteAllMessages(chatId) {
  const msgsRef = collection(db, 'chats', chatId, 'messages')

  while (true) {
    const snap = await getDocs(query(msgsRef, limit(400)))

    if (snap.empty) break

    const batch = writeBatch(db)

    snap.docs.forEach(d => batch.delete(d.ref))

    await batch.commit()

    if (snap.size < 400) break
  }
}

export async function clearChat(otherUID) {
  const me = auth.currentUser

  if (!me) throw new Error('Not signed in')

  const chatId = _chatId(me.uid, otherUID)

  await _deleteAllMessages(chatId)

  await updateDoc(
    doc(db, 'chats', chatId),
    { lastMessage: '' }
  ).catch(() => {})
}

export async function deleteChat(otherUID) {
  const me = auth.currentUser

  if (!me) throw new Error('Not signed in')

  const chatId = _chatId(me.uid, otherUID)

  await _deleteAllMessages(chatId)

  await deleteDoc(doc(db, 'chats', chatId))
}
