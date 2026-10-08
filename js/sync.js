/*
 * Geräte-Sync über ein privates GitHub-Repository (kostenlos, ohne eigenen Server).
 * Alle Daten liegen als planfood.json im Repo; jede Änderung wird als Commit gespeichert
 * (damit gibt es nebenbei eine Versionsgeschichte als Backup).
 *
 * Zugangsdaten (Token) bleiben nur auf dem jeweiligen Gerät (localStorage) und sind
 * nicht Teil der synchronisierten Daten oder des JSON-Exports.
 */
window.PF_SYNC = (function () {
  const S = window.PF_STORE;
  const CFG_KEY = 'planfood:sync';
  const API = 'https://api.github.com';
  const FILE = 'planfood.json';
  const PUSH_DELAY = 2500; // Änderungen kurz sammeln → weniger Commits
  const POLL_MS = 45000;

  let cfg = loadCfg();
  let status = { state: cfg ? 'idle' : 'off', message: '', at: null };
  const statusListeners = new Set();
  let pushTimer = null;
  let pollTimer = null;
  let queue = Promise.resolve();

  function loadCfg() {
    try {
      return JSON.parse(localStorage.getItem(CFG_KEY)) || null;
    } catch {
      return null;
    }
  }
  function saveCfg() {
    try {
      if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(CFG_KEY);
    } catch {
      /* privater Modus o. Ä. */
    }
  }
  function setStatus(state, message = '') {
    status = { state, message, at: state === 'ok' ? new Date() : status.at };
    statusListeners.forEach((fn) => fn(status));
  }

  /* ---------- GitHub-API ---------- */
  async function api(path, { method = 'GET', body, headers = {}, token = cfg && cfg.token } = {}) {
    const res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }
  async function apiError(res, what) {
    let detail = '';
    try {
      detail = (await res.json()).message || '';
    } catch {
      /* egal */
    }
    if (res.status === 401) return new Error('Der Zugangsschlüssel stimmt nicht oder ist abgelaufen – bitte neu kopieren bzw. einen neuen erstellen.');
    if (res.status === 403) return new Error(`Keine Berechtigung (${what}) – beim Schlüssel muss „planfood-daten“ ausgewählt und „Contents“ auf „Read and write“ gestellt sein.`);
    if (res.status === 404) return new Error(`${what} nicht gefunden`);
    return new Error(`${what}: HTTP ${res.status} ${detail}`);
  }

  // UTF-8-sicheres Base64
  function toB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromB64(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  const contentsPath = () => `/repos/${cfg.owner}/${cfg.repo}/contents/${FILE}`;

  /** Datei im Repo lesen → { data, sha } | { notModified } | null (gibt es noch nicht) */
  async function readRemote({ useEtag = true } = {}) {
    const res = await api(contentsPath(), { headers: useEtag && cfg.etag ? { 'If-None-Match': cfg.etag } : {} });
    if (res.status === 304) return { notModified: true };
    if (res.status === 404) return null;
    if (!res.ok) throw await apiError(res, 'Sync-Datei');
    const meta = await res.json();
    let text;
    if (meta.content) text = fromB64(meta.content);
    else {
      // > 1 MB: Inhalt separat als Rohdaten holen
      const raw = await api(contentsPath(), { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!raw.ok) throw await apiError(raw, 'Sync-Datei');
      text = await raw.text();
    }
    return { data: JSON.parse(text), sha: meta.sha, etag: res.headers.get('ETag') };
  }

  async function writeRemote() {
    const body = {
      message: `Planfood: Daten aktualisiert (${new Date().toLocaleString('de-DE')})`,
      content: toB64(JSON.stringify(S.state)),
      ...(cfg.sha ? { sha: cfg.sha } : {}),
    };
    const res = await api(contentsPath(), { method: 'PUT', body });
    if (res.status === 409 || res.status === 422) return { conflict: true };
    if (!res.ok) throw await apiError(res, 'Hochladen');
    const out = await res.json();
    cfg.sha = out.content.sha;
    cfg.etag = null; // nächstes Lesen holt frischen Stand
    cfg.syncedAt = S.updatedAt();
    saveCfg();
    return { ok: true };
  }

  /* ---------- Abgleich ---------- */
  /** Alles nacheinander ausführen, nie zwei Abgleiche gleichzeitig. */
  function enqueue(job) {
    queue = queue.then(job, job);
    return queue;
  }

  /** Holen und – je nach Zeitstempel – übernehmen oder eigene Änderungen hochladen. */
  function sync() {
    if (!cfg) return Promise.resolve();
    return enqueue(async () => {
      setStatus('syncing');
      try {
        const remote = await readRemote();
        const localDirty = S.updatedAt() > (cfg.syncedAt || 0);
        if (remote && !remote.notModified) {
          cfg.sha = remote.sha;
          cfg.etag = remote.etag;
          const remoteAt = (remote.data.meta && remote.data.meta.updatedAt) || 0;
          if (remoteAt > S.updatedAt()) {
            // anderes Gerät war neuer → übernehmen (bei gleichzeitigen Änderungen gewinnt die neuere)
            S.replaceFromSync(remote.data);
            cfg.syncedAt = S.updatedAt();
            saveCfg();
            setStatus('ok', localDirty ? 'Neuere Änderungen eines anderen Geräts übernommen' : 'Aktualisiert');
            return;
          }
          saveCfg();
        }
        if (!remote || localDirty) {
          let r = await writeRemote();
          if (r.conflict) {
            // jemand war schneller → frisch holen und nochmal entscheiden
            cfg.etag = null;
            const fresh = await readRemote({ useEtag: false });
            cfg.sha = fresh ? fresh.sha : null;
            const freshAt = fresh ? (fresh.data.meta && fresh.data.meta.updatedAt) || 0 : 0;
            if (fresh && freshAt > S.updatedAt()) {
              S.replaceFromSync(fresh.data);
              cfg.syncedAt = S.updatedAt();
              saveCfg();
              setStatus('ok', 'Neuere Änderungen eines anderen Geräts übernommen');
              return;
            }
            r = await writeRemote();
            if (r.conflict) throw new Error('Konflikt beim Hochladen – bitte später erneut versuchen');
          }
        }
        setStatus('ok');
      } catch (e) {
        setStatus('error', navigator.onLine === false ? 'Offline – wird nachgeholt' : e.message);
      }
    });
  }

  function schedulePush() {
    if (!cfg) return;
    clearTimeout(pushTimer);
    setStatus('pending');
    pushTimer = setTimeout(() => {
      pushTimer = null;
      sync();
    }, PUSH_DELAY);
  }

  function startLoops() {
    clearInterval(pollTimer);
    if (!cfg) return;
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') sync();
    }, POLL_MS);
  }

  /* ---------- Einrichten ---------- */
  /**
   * Verbinden: prüft Token & Repo. Gibt zurück, ob schon Daten im Repo liegen,
   * damit die Oberfläche fragen kann, welche Seite gelten soll.
   */
  async function connect(token, repoInput) {
    token = token.trim();
    let repo = repoInput.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    let owner;
    const me = await api('/user', { token });
    if (!me.ok) throw await apiError(me, 'Anmeldung');
    const login = (await me.json()).login;
    if (repo.includes('/')) [owner, repo] = repo.split('/');
    else owner = login;
    const r = await api(`/repos/${owner}/${repo}`, { token });
    if (r.status === 404) throw new Error(`Der Ordner „${repo}“ wurde nicht gefunden – bitte Schritt 1 erledigen und beim Schlüssel genau diesen Ordner auswählen.`);
    if (!r.ok) throw await apiError(r, 'Repository');
    const info = await r.json();
    if (!info.private) throw new Error(`Der Ordner „${repo}“ ist öffentlich – bitte auf GitHub unter Settings auf „Private“ stellen, sonst wären deine Daten für alle sichtbar.`);
    const candidate = { token, owner, repo, sha: null, etag: null, syncedAt: 0 };
    const prev = cfg;
    cfg = candidate;
    try {
      const remote = await readRemote({ useEtag: false });
      return { owner, repo, remote: remote ? { updatedAt: (remote.data.meta && remote.data.meta.updatedAt) || 0, recipes: remote.data.recipes.length, data: remote.data, sha: remote.sha } : null };
    } finally {
      cfg = prev;
    }
  }

  /** Verbindung übernehmen. mode: 'upload' (dieses Gerät gilt) | 'download' (Cloud gilt) */
  async function activate(token, owner, repo, mode, remote) {
    cfg = { token, owner, repo, sha: remote ? remote.sha : null, etag: null, syncedAt: 0 };
    saveCfg();
    S.createBackup('Vor dem Einrichten des Geräte-Syncs');
    if (mode === 'download' && remote) {
      S.replaceFromSync(remote.data);
      cfg.syncedAt = S.updatedAt();
      saveCfg();
      setStatus('ok', 'Daten aus der Cloud übernommen');
    } else {
      setStatus('syncing');
      await enqueue(async () => {
        try {
          // dieses Gerät gilt: Zeitstempel erneuern, damit es „neuer“ ist als die Cloud
          S.state.meta.updatedAt = Math.max(Date.now(), (remote && remote.updatedAt + 1) || 0);
          S.save(false);
          const r = await writeRemote();
          if (r.conflict) throw new Error('Konflikt beim ersten Hochladen');
          setStatus('ok', 'Daten hochgeladen');
        } catch (e) {
          setStatus('error', e.message);
        }
      });
    }
    startLoops();
  }

  /* ---------- Weiteres Gerät koppeln ---------- */
  const b64url = (str) => toB64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64url = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/'));

  /** Link mit den Zugangsdaten im #-Teil (wird nie an einen Server geschickt). */
  function pairingLink() {
    if (!cfg) return '';
    const payload = b64url(JSON.stringify({ t: cfg.token, o: cfg.owner, r: cfg.repo }));
    return `${location.origin}${location.pathname}#sync=${payload}`;
  }
  /** Kopplungsdaten aus der Adresse lesen (und dort entfernen). */
  function readPairingFromUrl() {
    const m = location.hash.match(/^#sync=([\w-]+)$/);
    if (!m) return null;
    history.replaceState(null, '', location.pathname + location.search);
    try {
      const d = JSON.parse(fromB64url(m[1]));
      return d.t && d.o && d.r ? { token: d.t, owner: d.o, repo: d.r } : null;
    } catch {
      return null;
    }
  }

  function disconnect() {
    cfg = null;
    saveCfg();
    clearInterval(pollTimer);
    clearTimeout(pushTimer);
    setStatus('off');
  }

  function init() {
    S.onLocalChange(schedulePush);
    document.addEventListener('visibilitychange', () => {
      if (!cfg) return;
      // beim Zurückkommen holen, beim Weggehen ausstehende Änderungen sofort senden
      if (document.visibilityState === 'visible' || pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
        sync();
      }
    });
    window.addEventListener('online', () => cfg && sync());
    if (!cfg) return;
    startLoops();
    sync();
  }

  return {
    init,
    connect,
    activate,
    disconnect,
    sync,
    pairingLink,
    readPairingFromUrl,
    get status() {
      return status;
    },
    get config() {
      return cfg ? { owner: cfg.owner, repo: cfg.repo } : null;
    },
    onStatus(fn) {
      statusListeners.add(fn);
    },
  };
})();
