/* ============================================================
   Shuttlestepz — auth.js  (V3)
   Thin wrapper around database.js
   Keeps window.AUTH API so all pages work without changes.
   ============================================================ */

import DB from './database.js'

// premium.js is a landing page file — access via window.PREMIUM if available
const PREMIUM = window.PREMIUM || null

/* ── Creator emails — full access, no upgrade needed ────────── */
const CREATOR_EMAILS = [
  'aarohan0207.com@gmail.com',
  'aarohan0207@gmail.com',
]

/* ── Session cache ───────────────────────────────────────────── */
const CACHE_KEY = 'ssz_v2_user'
function getCache()   { try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)) } catch { return null } }
function setCache(u)  { sessionStorage.setItem(CACHE_KEY, JSON.stringify(u)) }
function clearCache() { sessionStorage.removeItem(CACHE_KEY) }

/* ── XP / Level ──────────────────────────────────────────────── */
const XP_THRESH = [0, 500, 1200, 2200, 3500, 5200, 7200, 9800, 13000, 17000, 22000]
const LV_TITLES = ['','Rookie','Beginner','Intermediate','Advanced','Expert','Elite','Champion','Legend','Master','Grandmaster']

function calcLevelInfo(xp) {
  let level = 1
  for (let i = 1; i < XP_THRESH.length; i++) {
    if (xp >= XP_THRESH[i]) level = i + 1; else break
  }
  level = Math.min(level, XP_THRESH.length)
  const cur  = XP_THRESH[level - 1] || 0
  const nxt  = XP_THRESH[level]     || XP_THRESH[XP_THRESH.length - 1]
  const prog = Math.min(Math.max((xp - cur) / (nxt - cur), 0), 1) * 100
  return { level, title: LV_TITLES[level] || 'Legend', progress: Math.round(prog), xp, nextXP: nxt }
}

const FREE_LIMIT = 20

/* ── Firebase auth state → populate cache ────────────────────── */
DB.onAuthReady(async (fbUser) => {
  if (!fbUser) {
    clearCache()
    window.dispatchEvent(new CustomEvent('ssz-no-user'))
    return
  }
  try {
    const p   = await DB.getUserProfile(fbUser.uid)
    const lvl = calcLevelInfo(p.xp || 0)

    const email = (p.profile?.email || fbUser.email || '').toLowerCase()

    // Creator emails always get school-level plan — no DB write needed
    const isCreator = CREATOR_EMAILS.includes(email)
    const plan      = isCreator ? 'school' : (p.profile?.plan || 'free')

    setCache({
      uid           : fbUser.uid,
      username      : p.profile?.displayName || fbUser.displayName || 'Athlete',
      email         : p.profile?.email       || fbUser.email,
      role          : p.profile?.role        || 'student',
      plan,
      schoolId      : p.profile?.schoolCode  || null,
      xp            : p.xp          || 0,
      level         : lvl.level,
      levelTitle    : lvl.title,
      streak        : p.streak      || 0,
      bestStreak    : p.bestStreak  || 0,
      totalSessions : p.totalSessions || 0,
      lastSessionDay: p.lastSessionDay || null,
      sessionsToday : p.sessionsToday  || 0,
      createdAt     : p.profile?.createdAt?.seconds
        ? p.profile.createdAt.seconds * 1000 : Date.now(),
    })
    window.dispatchEvent(new CustomEvent('ssz-user-ready', { detail: getCache() }))
  } catch(e) {
    console.error('[AUTH] profile load failed', e)
  }
})

/* ══════════════════════════════════════════════════════════════
   window.AUTH  — public API
══════════════════════════════════════════════════════════════ */
const AUTH = {

  // ── Sign up ───────────────────────────────────────────────
  async signup(username, email, password, role = 'student', schoolId = null, phone = null) {
    if (!username || username.trim().length < 3) return { ok:false, msg:'Username must be at least 3 characters.' }
    if (!email || !email.includes('@'))          return { ok:false, msg:'Enter a valid email address.' }
    if (!password || password.length < 6)        return { ok:false, msg:'Password must be at least 6 characters.' }
    try {
      await DB.registerUser({ email, password, displayName: username.trim(), role, schoolCode: schoolId || '', phone: phone || '' })
      await new Promise(r => setTimeout(r, 700))
      return { ok:true, user: getCache() }
    } catch(err) { return { ok:false, msg: _fbMsg(err) } }
  },

  // ── Log in ────────────────────────────────────────────────
  async login(email, password, remember = true) {
    if (!email || !password) return { ok:false, msg:'Please fill in all fields.' }
    try {
      await DB.loginUser({ email, password, remember })
      await new Promise(r => setTimeout(r, 700))
      return { ok:true, user: getCache() }
    } catch(err) { return { ok:false, msg: _fbMsg(err) } }
  },

  // ── Google sign-in ────────────────────────────────────────
  async loginWithGoogle(remember = true) {
    try {
      await DB.loginWithGoogle({ remember })
      await new Promise(r => setTimeout(r, 700))
      return { ok:true, user: getCache() }
    } catch(err) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        return { ok:false, cancelled:true }
      }
      return { ok:false, msg: _fbMsg(err) }
    }
  },

  // ── Log out ───────────────────────────────────────────────
  async logout() {
    clearCache()
    await DB.logoutUser()
    window.location.href = 'index.html'
  },

  // ── Password reset ────────────────────────────────────────
  async sendPasswordReset(email) {
    try { await DB.resetPassword(email); return { ok:true } }
    catch(err) { return { ok:false, msg: _fbMsg(err) } }
  },

  // ── Getters ───────────────────────────────────────────────
  currentUser() { return getCache() },

  // ── Guards ────────────────────────────────────────────────
  requireAuth(redirect = 'login.html') {
    return new Promise((resolve) => {
      const cached = getCache()
      if (cached) { resolve(cached); return }

      let resolved = false

      const onReady = (e) => {
        if (resolved) return
        resolved = true
        window.removeEventListener('ssz-user-ready', onReady)
        window.removeEventListener('ssz-no-user',    onNone)
        clearTimeout(timer)
        resolve(e.detail)
      }

      const onNone = () => {
        if (resolved) return
        resolved = true
        window.removeEventListener('ssz-user-ready', onReady)
        window.removeEventListener('ssz-no-user',    onNone)
        clearTimeout(timer)
        window.location.href = redirect
        resolve(null)
      }

      window.addEventListener('ssz-user-ready', onReady)
      window.addEventListener('ssz-no-user',    onNone)

      const poll = setInterval(() => {
        const u = getCache()
        if (u && !resolved) {
          resolved = true
          clearInterval(poll)
          window.removeEventListener('ssz-user-ready', onReady)
          window.removeEventListener('ssz-no-user',    onNone)
          resolve(u)
        }
      }, 100)

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          clearInterval(poll)
          window.removeEventListener('ssz-user-ready', onReady)
          window.removeEventListener('ssz-no-user',    onNone)
          if (!getCache()) {
            window.location.href = redirect
            resolve(null)
          } else {
            resolve(getCache())
          }
        }
      }, 4000)
    })
  },

  requireGuest(redirect = 'dashboard.html') {
    if (getCache()) { window.location.href = redirect; return }
    const onReady = () => {
      window.removeEventListener('ssz-user-ready', onReady)
      window.location.href = redirect
    }
    window.addEventListener('ssz-user-ready', onReady)
    setTimeout(() => window.removeEventListener('ssz-user-ready', onReady), 3000)
  },

  requireRole(role, redirect = 'dashboard.html') {
    const u = getCache()
    if (!u || u.role !== role) { window.location.href = redirect; return null }
    return u
  },

  // ── Plan ──────────────────────────────────────────────────
  isPremium() {
    const u = getCache()
    if (!u) return false
    if (CREATOR_EMAILS.includes((u.email || '').toLowerCase())) return true
    return u.plan === 'premium' || u.plan === 'school'
  },

  // ── upgradePlan — offline-safe ────────────────────────────
  // Always updates local cache first so the UI never hangs.
  // Firestore write is attempted silently; if the client is
  // offline or the write fails, the local cache still has the
  // correct plan and Firestore will sync on next connection.
  async upgradePlan(uid, plan = 'premium') {
    // 1. Update local cache immediately — works even when offline
    const c = getCache()
    if (c) { c.plan = plan; setCache(c) }

    // 2. Attempt Firestore write — silently ignore offline/network errors
    try {
      await DB.updateUserProfile({ plan })
    } catch(e) {
      console.warn('[AUTH] upgradePlan: Firestore unavailable, saved locally only.', e.message)
      // Non-fatal — local cache is the source of truth for this session
    }

    return true
  },

  // ── Session limit ─────────────────────────────────────────
  canStartSession() {
    const u = getCache(); if (!u) return false
    if (this.isPremium()) return true
    const today = new Date().toDateString()
    if (u.lastSessionDay !== today) return true
    return (u.sessionsToday || 0) < FREE_LIMIT
  },

  sessionsRemaining() {
    const u = getCache(); if (!u) return 0
    if (this.isPremium()) return Infinity
    const today = new Date().toDateString()
    if (u.lastSessionDay !== today) return FREE_LIMIT
    return Math.max(0, FREE_LIMIT - (u.sessionsToday || 0))
  },

  async incrementSession() {
    const u = getCache(); if (!u || this.isPremium()) return
    const today = new Date().toDateString()
    const count = u.lastSessionDay === today ? (u.sessionsToday || 0) + 1 : 1
    u.sessionsToday = count; u.lastSessionDay = today; setCache(u)
  },

  // ── Record session ────────────────────────────────────────
  async recordSession(data) {
    const u = getCache(); if (!u) return null
    try {
      const acc      = data.totalRounds > 0 ? Math.round((data.hits / data.totalRounds) * 100) : 0
      let xpEarned   = 50 + (data.hits || 0) * 2
      if (acc >= 90)   xpEarned += 30
      xpEarned = Math.round(xpEarned)

      await DB.saveSession({
        drill       : data.mode || 'footwork',
        mode        : data.mode || 'footwork',
        score       : data.score || 0,
        accuracy    : acc,
        hits        : data.hits  || 0,
        totalRounds : data.totalRounds || 0,
        bestStreak  : data.bestStreak  || 0,
        xpEarned,
        reactionTime: data.roundTimings?.length
          ? Math.round(data.roundTimings.reduce((a,b)=>a+b,0)/data.roundTimings.length) : null,
        dirStats    : data.dirStats || {},
      })

      const result = await DB.awardXP(xpEarned)
      u.xp = result.newXP; u.level = result.newLevel; setCache(u)
      return { xpEarned, ...result }
    } catch(err) { console.error('[AUTH] recordSession:', err); return null }
  },

  // ── Stats ─────────────────────────────────────────────────
  async currentStats() {
    const u = getCache(); if (!u) return null
    try {
      const p        = await DB.getUserProfile(u.uid)
      const sessions = await DB.getSessions({ uid: u.uid, limitN: 20 })
      const lvl      = calcLevelInfo(p.xp || 0)

      const history  = sessions.map(s => ({
        id      : s.id,
        date    : s.createdAt?.toMillis?.() || Date.now(),
        score   : s.score,   accuracy: s.accuracy,
        rounds  : s.totalRounds, reaction: s.reactionTime,
        mode    : s.mode,    xpEarned: s.xpEarned,
        streak  : s.bestStreak,
      }))

      const dirStats = {}
      sessions.forEach(s => {
        if (s.dirStats) {
          for (const [dir, ds] of Object.entries(s.dirStats)) {
            if (!dirStats[dir]) dirStats[dir] = { total:0, hit:0 }
            dirStats[dir].total += ds.total || 0
            dirStats[dir].hit   += ds.hit   || 0
          }
        }
      })

      return {
        username: p.profile?.displayName, plan: p.profile?.plan || 'free',
        role    : p.profile?.role || 'student',
        xp: p.xp||0, level: lvl.level, levelTitle: lvl.title,
        levelProgress: lvl.progress, nextXP: lvl.nextXP,
        streak: p.streak||0, bestStreak: p.bestStreak||0,
        totalSessions: p.totalSessions||0,
        bestScore: p.bestScore||0, bestAccuracy: p.bestAccuracy||0,
        history, dirStats,
      }
    } catch(err) { console.error('[AUTH] currentStats:', err); return null }
  },

  // ── Leaderboard ───────────────────────────────────────────
  async getLeaderboard(n = 20) {
    return new Promise(resolve => {
      const unsub = DB.listenLeaderboard(entries => { unsub(); resolve(entries.slice(0, n)) }, n)
    })
  },

  // ── School ────────────────────────────────────────────────
  async getClassStats(schoolCode) {
    try { return await DB.getStudentsBySchoolCode(schoolCode) } catch { return [] }
  },

  // ── Settings ──────────────────────────────────────────────
  async getSettings()    { return DB.getSettings() },
  async saveSettings(s)  { return DB.saveSettings(s) },
  listenSettings(cb)     { return DB.listenSettings(cb) },

  // ── Real-time listeners ───────────────────────────────────
  listenProfile(cb)         { return DB.listenUserProfile(cb) },
  listenSessions(cb, n=20)  { return DB.listenSessions(cb, n) },
  listenLeaderboard(cb, n)  { return DB.listenLeaderboard(cb, n) },
  unsubscribeAll()          { DB.unsubscribeAll() },

  // ── Utils ─────────────────────────────────────────────────
  calcLevel: calcLevelInfo,
}

function _fbMsg(err) {
  const map = {
    'auth/email-already-in-use'   : 'An account with this email already exists.',
    'auth/invalid-email'          : 'Invalid email address.',
    'auth/weak-password'          : 'Password must be at least 6 characters.',
    'auth/user-not-found'         : 'No account found with this email.',
    'auth/wrong-password'         : 'Incorrect password.',
    'auth/invalid-credential'     : 'Incorrect email or password.',
    'auth/too-many-requests'      : 'Too many attempts. Try again later.',
    'auth/network-request-failed' : 'Network error. Check your connection.',
    'auth/popup-blocked'          : 'Popup was blocked. Allow popups for this site and try again.',
    'auth/unauthorized-domain'    : 'This domain is not authorized for Google sign-in.',
    'auth/operation-not-allowed'  : 'Google sign-in is not enabled yet.',
    'auth/account-exists-with-different-credential' : 'An account with this email already exists. Sign in with your password.',
  }
  return map[err.code] || err.message || 'Something went wrong.'
}

window.AUTH = AUTH
window.DB   = DB
export default AUTH
