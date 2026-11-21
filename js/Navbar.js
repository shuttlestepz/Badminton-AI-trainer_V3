/* ShuttleStepz V3 — Global glass pill navbar
   One file. Injects its own CSS + markup. Active page auto-detected.
   Usage on EVERY page: <script src="js/navbar.js" defer></script>
   XP:  ShuttleNav.setXP(3766)  — or  window.dispatchEvent(new CustomEvent('ss:xp',{detail:3766})) */
(function () {
  if (window.__ssNavLoaded) return;
  window.__ssNavLoaded = true;

  var ACCENT = '#39E07A';

  var LINKS = [
    { key: 'dashboard',   label: 'Dashboard',   href: 'dashboard.html',   icon: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>' },
    { key: 'trainer',     label: 'Train',       href: 'trainer.html',     icon: '<polygon points="6 3 20 12 6 21 6 3"/>' },
    { key: 'history',     label: 'History',     href: 'history.html',     icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    { key: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html', icon: '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>' },
    { key: 'social',      label: 'Social',      href: 'social.html',      icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    { key: 'plans',       label: 'Plans',       href: 'plans.html',       icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    { key: 'profile',     label: 'Profile',     href: 'profile.html',     icon: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' }
  ];

  // Pages that should light up a parent tab
  var ALIAS = { premium: 'plans', upgrade: 'plans', trainer: 'trainer', train: 'trainer' };

  function currentKey() {
    var file = (location.pathname.split('/').pop() || 'index.html').replace('.html', '').toLowerCase();
    return ALIAS[file] || file;
  }

  var CSS = '\
:root{--ss-accent:' + ACCENT + ';--ss-bg:#0B100D;--ss-text:#F2F5F2;--ss-muted:#8FA597;--ss-border:rgba(57,224,122,.18);--ss-nav-h:60px}\
body{padding-top:calc(var(--ss-nav-h) + 36px)!important}\
.ssnav-wrap{position:fixed;top:14px;left:0;right:0;z-index:9999;display:flex;justify-content:center;padding:0 12px;pointer-events:none;font-family:"Sora",system-ui,-apple-system,"Segoe UI",sans-serif}\
.ssnav{pointer-events:auto;display:flex;align-items:center;gap:6px;max-width:100%;padding:8px 10px 8px 10px;border-radius:999px;\
background:linear-gradient(180deg,rgba(14,24,18,.72),rgba(8,13,10,.78));\
-webkit-backdrop-filter:blur(22px) saturate(140%);backdrop-filter:blur(22px) saturate(140%);\
border:1px solid var(--ss-border);\
box-shadow:0 0 0 1px rgba(57,224,122,.04) inset,0 10px 40px rgba(0,0,0,.55),0 0 38px rgba(57,224,122,.10)}\
.ssnav a{text-decoration:none}\
.ssnav-brand{display:flex;align-items:center;gap:10px;padding:0 14px 0 4px;color:var(--ss-text);font-weight:800;font-size:15px;letter-spacing:-.2px;white-space:nowrap}\
.ssnav-brand img{width:36px;height:36px;border-radius:50%;object-fit:cover;background:#07100b;border:1px solid var(--ss-border);box-shadow:0 0 14px rgba(57,224,122,.25)}\
.ssnav-brand span{font-weight:500;opacity:.9}\
.ssnav-links{display:flex;align-items:center;gap:2px}\
.ssnav-link{display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;color:var(--ss-muted);font-size:13.5px;font-weight:500;white-space:nowrap;transition:color .25s,background .25s,box-shadow .25s,transform .25s}\
.ssnav-link svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}\
.ssnav-link:hover{color:var(--ss-text);background:rgba(57,224,122,.08)}\
.ssnav-link.is-active{background:var(--ss-accent);color:#04120A;font-weight:700;box-shadow:0 0 22px rgba(57,224,122,.45)}\
.ssnav-link.is-active:hover{background:var(--ss-accent);color:#04120A}\
.ssnav-div{width:1px;height:28px;margin:0 10px;background:var(--ss-border)}\
.ssnav-xp{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(57,224,122,.08);border:1px solid var(--ss-border);color:var(--ss-accent);font-size:12.5px;font-weight:700;white-space:nowrap}\
.ssnav-xp i{width:7px;height:7px;border-radius:50%;background:var(--ss-accent);box-shadow:0 0 10px var(--ss-accent);animation:ssPulse 2s infinite}\
@keyframes ssPulse{50%{opacity:.4}}\
.ssnav-out{width:42px;height:42px;margin-left:8px;display:grid;place-items:center;border-radius:14px;cursor:pointer;color:var(--ss-muted);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);transition:all .25s}\
.ssnav-out svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}\
.ssnav-out:hover{color:var(--ss-accent);background:rgba(57,224,122,.10);border-color:var(--ss-border);box-shadow:0 0 16px rgba(57,224,122,.2)}\
@media(max-width:1100px){.ssnav-link{padding:10px 12px}.ssnav-link span{display:none}.ssnav-link.is-active span{display:inline}}\
@media(max-width:700px){\
 body{padding-top:calc(var(--ss-nav-h) + 76px)!important}\
 .ssnav{display:grid;grid-template-columns:1fr auto auto;grid-template-areas:"brand xp out" "links links links";border-radius:28px;width:100%;row-gap:6px}\
 .ssnav-brand{grid-area:brand}.ssnav-xp{grid-area:xp}.ssnav-out{grid-area:out;margin-left:0}\
 .ssnav-div{display:none}\
 .ssnav-links{grid-area:links;justify-content:space-between;width:100%}\
 .ssnav-link{padding:10px 11px}\
 .ssnav-link.is-active span{display:none}\
}';

  var ICON_OUT = '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>';

  function fmt(n) { return (Number(n) || 0).toLocaleString('en-US') + ' XP'; }

  function build() {
    var active = currentKey();
    var html = '<div class="ssnav-wrap"><nav class="ssnav" aria-label="Main">' +
      '<a class="ssnav-brand" href="dashboard.html"><img src="icon/icon-192.png" alt="ShuttleStepz"><b>Shuttle<span>stepz</span></b></a>' +
      '<div class="ssnav-links">' +
      LINKS.map(function (l) {
        return '<a class="ssnav-link' + (l.key === active ? ' is-active' : '') + '" href="' + l.href + '"' +
          (l.key === active ? ' aria-current="page"' : '') + ' title="' + l.label + '">' +
          '<svg viewBox="0 0 24 24">' + l.icon + '</svg><span>' + l.label + '</span></a>';
      }).join('') +
      '</div><div class="ssnav-div"></div>' +
      '<div class="ssnav-xp" id="ssNavXP"><i></i><em style="font-style:normal" id="ssNavXPVal">' + fmt(localStorage.getItem('ss_xp')) + '</em></div>' +
      '<button class="ssnav-out" id="ssNavOut" type="button" aria-label="Log out" title="Log out"><svg viewBox="0 0 24 24">' + ICON_OUT + '</svg></button>' +
      '</nav></div>';

    var st = document.createElement('style');
    st.id = 'ssnav-css';
    st.textContent = CSS;
    document.head.appendChild(st);
    document.body.insertAdjacentHTML('afterbegin', html);

    document.getElementById('ssNavOut').addEventListener('click', function () {
      try { localStorage.removeItem('ss_xp'); } catch (e) {}
      if (typeof window.logout === 'function') return window.logout();
      if (typeof window.handleLogout === 'function') return window.handleLogout();
      window.dispatchEvent(new CustomEvent('ss:logout'));
      setTimeout(function () { location.href = 'login.html'; }, 400);
    });
  }

  window.ShuttleNav = {
    setXP: function (n) {
      var el = document.getElementById('ssNavXPVal');
      if (el) el.textContent = fmt(n);
      try { localStorage.setItem('ss_xp', String(Number(n) || 0)); } catch (e) {}
    }
  };
  window.addEventListener('ss:xp', function (e) { window.ShuttleNav.setXP(e.detail); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
