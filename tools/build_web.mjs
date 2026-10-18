// Baut die eigenständige Web-App (GitHub Pages): App-Code öffentlich, Karten und Fotos AES-GCM-verschlüsselt.
// Aufruf: node build_web.mjs <app-ordner> <ausgabe-ordner> <passwort-datei>
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto as crypto, randomInt } from 'node:crypto';

const [APP, OUT, PWFILE] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

// Passwort: einmal erzeugen, danach wiederverwenden, damit Updates dasselbe Passwort behalten
const WORDS = ['Anis', 'Arnika', 'Baldrian', 'Birke', 'Eibisch', 'Enzian', 'Fenchel', 'Hopfen', 'Kamille', 'Lavendel', 'Linde', 'Malve',
  'Melisse', 'Mistel', 'Primel', 'Rosmarin', 'Salbei', 'Thymian', 'Wermut', 'Holunder', 'Hagebutte', 'Leinsamen', 'Flohsamen', 'Nelke',
  'Wacholder', 'Schafgarbe', 'Ringelblume', 'Pfefferminze', 'Eiche', 'Heidelbeere', 'Brennnessel', 'Spitzwegerich'];
let password;
if (existsSync(PWFILE)) password = readFileSync(PWFILE, 'utf8').trim();
else {
  password = [0, 1, 2, 3].map(() => WORDS[randomInt(WORDS.length)]).join('-') + '-' + randomInt(10, 100);
  writeFileSync(PWFILE, password + '\n', { mode: 0o600 });
}

// Inhalt: aktueller Lernstand aus dem Konto-Export, Fotos als data-URLs
const deckDir = join(APP, 'export', 'decks');
const decks = readdirSync(deckDir).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const raw = JSON.parse(readFileSync(join(deckDir, f), 'utf8'));
  const body = raw.data && raw.data.cards ? raw.data : raw;
  // Für alle Nutzer: frischer Start ohne persönlichen Lernstand
  const cards = body.cards.map((c) => ({ ...c, box: 1, due: '2026-10-18', ok: 0, bad: 0, seen: null }));
  return { id: f.replace(/\.json$/, ''), ...body, cards };
});
const images = {};
for (const f of readdirSync(join(APP, 'drogen')).filter((x) => x.endsWith('.jpg')).sort()) {
  images['drogen/' + f] = 'data:image/jpeg;base64,' + readFileSync(join(APP, 'drogen', f)).toString('base64');
}
const stats = null; // keine persönliche Statistik im gemeinsamen Paket
const plain = new TextEncoder().encode(JSON.stringify({ decks, images, stats }));

// Verschlüsseln: PBKDF2-SHA-256 (600 000 Runden) -> AES-256-GCM
const ITER = 600000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
const b64 = (u8) => Buffer.from(u8).toString('base64');
const pack = { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };

// App-Fragment aufteilen: Kopfteile (title, meta, links, style) in den <head>, Rest in den <body>
const frag = readFileSync(join(APP, 'otc-sachkunde.html'), 'utf8');
const cut = frag.indexOf('<header class="topbar">');
if (cut < 0) throw new Error('Kopfleiste nicht gefunden');
const fragHead = frag.slice(0, cut).replace(/<title>[^<]*<\/title>\s*/, '').replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, '');
const fragBody = frag.slice(cut);

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>OTC Sachkunde</title>
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#FFE500">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="OTC Sachkunde">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-192.png">
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; font: 14px system-ui, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
#lock { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 24px max(16px, env(safe-area-inset-right, 0px)) 24px max(16px, env(safe-area-inset-left, 0px)); background: #F4F4F2; color: #1A1A1A; font-family: "Atkinson Hyperlegible", system-ui, sans-serif; }
.lock-card { width: 100%; max-width: 380px; background: #FFFFFF; border: 1px solid #DCDCD6; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 26px -14px rgba(28, 28, 26, .35); }
.lock-head { background: #FFE500; border-bottom: 5px solid #DC0D15; padding: 18px 20px; font: 800 1.7rem/1 "Barlow Condensed", "Arial Narrow", system-ui, sans-serif; text-transform: uppercase; color: #DC0D15; }
#lock-form { display: flex; flex-direction: column; gap: 10px; padding: 20px; }
#lock-form label { font-weight: 700; font-size: .95rem; }
#lock-pw { font-family: inherit; font-size: 1.05rem; line-height: 1.4; padding: 12px 14px; border: 1.5px solid #DCDCD6; border-radius: 10px; }
#lock-pw:focus { outline: none; border-color: #DC0D15; box-shadow: 0 0 0 3px #FDE2E3; }
#lock-btn { min-height: 54px; border: 0; border-radius: 12px; background: #DC0D15; color: #FFFFFF; font: 800 1.25rem/1 "Barlow Condensed", "Arial Narrow", system-ui, sans-serif; text-transform: uppercase; letter-spacing: .03em; cursor: pointer; }
#lock-btn:disabled { opacity: .6; }
#lock-msg { min-height: 1.4em; margin: 0; color: #A50E16; font-weight: 700; }
.lock-hint { margin: 0; color: #5A5A56; font-size: .9rem; }
.lock-user { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
.lock-pwrow { display: flex; gap: 8px; }
.lock-pwrow #lock-pw { flex: 1; min-width: 0; }
#lock-show { flex: none; min-height: 48px; padding: 0 14px; border: 1.5px solid #DCDCD6; border-radius: 10px; background: #FFFFFF; color: #1A1A1A; font: 700 .9rem/1 inherit; font-family: inherit; cursor: pointer; }
.lock-check { display: flex; align-items: center; gap: 10px; font-weight: 400 !important; font-size: .95rem; min-height: 44px; }
.lock-check input { width: 22px; height: 22px; accent-color: #DC0D15; }
</style>
${fragHead}</head>
<body>
<div id="lock" hidden>
  <div class="lock-card">
    <div class="lock-head">OTC Sachkunde</div>
    <form id="lock-form" method="post" action="#">
      <input class="lock-user" type="text" name="username" autocomplete="username" value="OTC Sachkunde" readonly tabindex="-1" aria-hidden="true">
      <label for="lock-pw">Passwort</label>
      <div class="lock-pwrow">
        <input id="lock-pw" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required>
        <button id="lock-show" type="button" aria-pressed="false">Anzeigen</button>
      </div>
      <label class="lock-check"><input type="checkbox" id="lock-remember" checked> Passwort auf diesem Gerät speichern</label>
      <button id="lock-btn" type="submit">Öffnen</button>
      <p id="lock-msg" role="alert"></p>
      <p class="lock-hint">Mit Häkchen fragt die App auf diesem Gerät nicht wieder. Dein Passwort-Manager kann es zusätzlich sichern.</p>
    </form>
  </div>
</div>
<script>
(() => {
  'use strict';
  const PACK = ${JSON.stringify(pack)};
  const KEY_STORE = 'otc-sachkunde.key';
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (buf) => { let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
  let resolveGate;
  window.OTC_GATE = new Promise((r) => { resolveGate = r; });
  const lock = document.getElementById('lock'), form = document.getElementById('lock-form');
  const pw = document.getElementById('lock-pw'), btn = document.getElementById('lock-btn'), msg = document.getElementById('lock-msg');
  const show = document.getElementById('lock-show'), remember = document.getElementById('lock-remember');
  show.addEventListener('click', () => {
    const visible = pw.type === 'password';
    pw.type = visible ? 'text' : 'password'; show.textContent = visible ? 'Verbergen' : 'Anzeigen'; show.setAttribute('aria-pressed', String(visible)); pw.focus();
  });
  async function decrypt(key) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(PACK.iv) }, key, b64(PACK.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function unlock(data) { window.OTC_DATA = data; lock.remove(); resolveGate(); }
  async function tryStoredKey() {
    try {
      let raw = null;
      try { raw = localStorage.getItem(KEY_STORE) || sessionStorage.getItem(KEY_STORE); } catch { /* kein Speicher */ }
      if (!raw) return false;
      const key = await crypto.subtle.importKey('raw', b64(raw), 'AES-GCM', false, ['decrypt']);
      unlock(await decrypt(key)); return true;
    } catch { return false; }
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Prüfe …'; msg.textContent = '';
    try {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.value.trim()), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(PACK.salt), iterations: PACK.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
      const data = await decrypt(key);
      const raw = toB64(await crypto.subtle.exportKey('raw', key));
      try { (remember.checked ? localStorage : sessionStorage).setItem(KEY_STORE, raw); } catch { /* ohne Merken weiter */ }
      if (remember.checked && window.PasswordCredential && navigator.credentials) {
        try { navigator.credentials.store(new PasswordCredential({ id: 'OTC Sachkunde', name: 'OTC Sachkunde', password: pw.value })).catch(() => {}); } catch { /* nicht unterstützt */ }
      }
      pw.type = 'password';
      unlock(data);
    } catch {
      msg.textContent = 'Das Passwort stimmt nicht. Achte auf Bindestriche und Großbuchstaben.';
      btn.disabled = false; btn.textContent = 'Öffnen'; pw.select();
    }
  });
  if (!window.crypto || !crypto.subtle) { lock.hidden = false; msg.textContent = 'Dieser Browser kann die App nicht entschlüsseln. Bitte Safari oder Chrome verwenden.'; btn.disabled = true; return; }
  tryStoredKey().then((ok) => { if (!ok) { lock.hidden = false; pw.focus(); } });
})();
</script>
${fragBody}
</body>
</html>
`;
writeFileSync(join(OUT, 'index.html'), html);
writeFileSync(join(OUT, 'manifest.webmanifest'), JSON.stringify({
  name: 'OTC Sachkunde', short_name: 'OTC Sachkunde', lang: 'de', start_url: './', scope: './', display: 'standalone',
  background_color: '#F4F4F2', theme_color: '#FFE500',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
}, null, 2) + '\n');
writeFileSync(join(OUT, '.nojekyll'), '');
writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB · ${decks.length} Stapel · ${Object.keys(images).length} Fotos · verschlüsselt`);
