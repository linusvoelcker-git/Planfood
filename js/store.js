/*
 * Datenhaltung: Rezepte, Zutaten-Nährwerte, Wochenpläne, Einkaufslisten, Archiv.
 * Gespeichert im localStorage des Browsers; Export/Import als JSON-Datei.
 */
window.PF_STORE = (function () {
  const N = window.PF_NUTRITION;
  const STORAGE_KEY = 'planfood:v1';

  const MEALS = [
    { key: 'breakfast', label: 'Frühstück' },
    { key: 'lunch', label: 'Mittagessen' },
    { key: 'dinner', label: 'Abendessen' },
    { key: 'snack', label: 'Snack' },
  ];
  const CATEGORIES = ['Frühstück', 'Hauptgericht', 'Snack', 'Sonstiges'];
  const COLORS = ['#e76f51', '#f4a261', '#e9c46a', '#8ab17d', '#2a9d8f', '#4d908e', '#577590', '#9b5de5', '#d6607e'];
  // Farben für Tags (gut unterscheidbar, auf hellem und dunklem Grund lesbar)
  const TAG_COLORS = ['#d64545', '#e08a1e', '#2f9e5b', '#2b7bb9', '#8e5bd6', '#1f9aa0', '#c2457e', '#6b7a2a', '#7a5a3a'];
  const DEFAULT_TAGS = [
    ['High Protein', '#d64545'],
    ['Schnell', '#e08a1e'],
    ['Vegan', '#2f9e5b'],
    ['Low Carb', '#2b7bb9'],
    ['Meal Prep', '#8e5bd6'],
    ['Günstig', '#1f9aa0'],
  ];
  const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  let state = null;
  const listeners = new Set();
  const localListeners = new Set();

  /* ---------- IDs & Datum ---------- */
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dow = (d.getDay() + 6) % 7; // Mo=0
    d.setDate(d.getDate() - dow);
    return d;
  }
  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }
  function currentWeekStart() {
    return isoDate(mondayOf(new Date()));
  }
  function isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }

  /* ---------- Laden / Speichern ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) {
      console.warn('Konnte gespeicherte Daten nicht lesen', e);
    }
    if (!state || !Array.isArray(state.recipes)) state = seed();
    normalize();
    save(false);
    return state;
  }

  /** Fehlende Felder ergänzen, ältere Datenstände umwandeln. */
  function normalize() {
    state.ingredients ||= {};
    state.weeks ||= {};
    state.settings ||= { usdaKey: '' };
    state.meta ||= { updatedAt: 0 };
    migrateTags();
    migrateProfile();
    Object.values(state.weeks).forEach(migrateShopping);
    autoArchive();
  }

  /**
   * Speichern. Eigene Änderungen (local) bekommen einen neuen Zeitstempel und
   * werden an den Geräte-Sync gemeldet; vom Sync geholte Daten nicht.
   */
  function save(notify = true, { local = true } = {}) {
    if (notify && local) state.meta.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Speichern fehlgeschlagen', e);
    }
    if (notify) listeners.forEach((fn) => fn());
    if (notify && local) localListeners.forEach((fn) => fn());
  }

  function onChange(fn) {
    listeners.add(fn);
  }
  /** Nur eigene Änderungen auf diesem Gerät (für den Sync). */
  function onLocalChange(fn) {
    localListeners.add(fn);
  }
  /* ---------- Sicherungen auf diesem Gerät ---------- */
  // Bevor Daten von außen ersetzt werden (Sync, Import, Zurücksetzen), wird der bisherige
  // Stand lokal gesichert – die letzten MAX_BACKUPS bleiben erhalten.
  const BACKUP_KEY = 'planfood:backups';
  const MAX_BACKUPS = 5;
  function listBackups() {
    try {
      return JSON.parse(localStorage.getItem(BACKUP_KEY)) || [];
    } catch {
      return [];
    }
  }
  function createBackup(reason) {
    if (!state) return;
    const list = listBackups();
    list.unshift({
      at: Date.now(),
      reason,
      recipes: state.recipes.length,
      data: JSON.stringify(state),
    });
    // bei vollem Speicher die ältesten verwerfen
    while (list.length) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, MAX_BACKUPS)));
        return;
      } catch {
        list.pop();
      }
    }
  }
  function restoreBackup(at) {
    const b = listBackups().find((x) => x.at === at);
    if (!b) throw new Error('Sicherung nicht gefunden');
    createBackup('Vor dem Wiederherstellen');
    state = JSON.parse(b.data);
    normalize();
    save(); // gilt als eigene, neue Änderung → wird auch auf andere Geräte übertragen
  }

  /** Daten von einem anderen Gerät übernehmen (ohne sie erneut hochzuladen). */
  function replaceFromSync(data) {
    if (!data || !Array.isArray(data.recipes)) throw new Error('Ungültige Sync-Daten');
    createBackup('Vor Übernahme von einem anderen Gerät');
    state = data;
    normalize();
    save(true, { local: false });
  }
  function updatedAt() {
    return (state.meta && state.meta.updatedAt) || 0;
  }

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }
  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.recipes) || typeof data.weeks !== 'object') {
      throw new Error('Keine gültige Planfood-Datei');
    }
    createBackup('Vor dem Import');
    state = data;
    normalize();
    save();
  }
  function reset() {
    createBackup('Vor dem Zurücksetzen');
    state = seed();
    normalize();
    save();
  }

  /* ---------- Rezepte ---------- */
  function getRecipe(id, week) {
    const live = state.recipes.find((r) => r.id === id);
    if (week && week.archived && week.recipeSnapshot && week.recipeSnapshot[id]) return week.recipeSnapshot[id];
    return live || (week && week.recipeSnapshot && week.recipeSnapshot[id]) || null;
  }

  function upsertRecipe(recipe) {
    recipe.ingredients = recipe.ingredients.filter((i) => i.name.trim() && i.amount > 0);
    for (const ing of recipe.ingredients) {
      const key = N.norm(ing.name);
      if (!state.ingredients[key]) {
        const hit = N.autoDetect(ing.name);
        if (hit) state.ingredients[key] = { name: ing.name.trim(), ...hit };
      }
    }
    const idx = state.recipes.findIndex((r) => r.id === recipe.id);
    if (idx >= 0) state.recipes[idx] = recipe;
    else state.recipes.push(recipe);
    save();
  }

  function deleteRecipe(id) {
    state.recipes = state.recipes.filter((r) => r.id !== id);
    // aus offenen (nicht archivierten) Wochen entfernen
    for (const week of Object.values(state.weeks)) {
      if (week.archived) continue;
      forEachSlot(week, (list, day, meal) => {
        week.slots[day][meal] = list.filter((e) => e.recipeId !== id);
      });
    }
    save();
  }

  function deleteRecipes(ids) {
    const set = new Set(ids);
    state.recipes = state.recipes.filter((r) => !set.has(r.id));
    for (const week of Object.values(state.weeks)) {
      if (week.archived) continue;
      forEachSlot(week, (list, day, meal) => {
        week.slots[day][meal] = list.filter((e) => !set.has(e.recipeId));
      });
    }
    save();
  }

  /* ---------- Profil & Ziele ---------- */
  // mode: 'min' = mindestens, 'max' = höchstens, 'target' = ungefähr (±10 %)
  const GOAL_DEFS = [
    { key: 'kcal', mode: 'target' },
    { key: 'protein', mode: 'min' },
    { key: 'carbs', mode: 'max' },
    { key: 'fat', mode: 'max' },
    { key: 'fiber', mode: 'min' },
    { key: 'sugar', mode: 'max' },
  ];
  function migrateProfile() {
    const p = (state.profile ||= {});
    p.weightKg ??= null;
    p.heightCm ??= null;
    p.age ??= null;
    p.sex ??= '';
    p.activity ??= 1.55;
    p.weightLog ||= [];
    p.goals ||= {};
    for (const g of GOAL_DEFS) p.goals[g.key] ||= { value: null, period: 'day', mode: g.mode };
  }
  function setProfile(changes) {
    const p = state.profile;
    const newWeight = changes.weightKg;
    Object.assign(p, changes);
    // Gewichtsverlauf: neuer Eintrag, wenn sich das Gewicht ändert (pro Tag höchstens einer)
    if (newWeight > 0) {
      const today = isoDate(new Date());
      const last = p.weightLog[p.weightLog.length - 1];
      if (last && last.date === today) last.kg = newWeight;
      else if (!last || last.kg !== newWeight) p.weightLog.push({ date: today, kg: newWeight });
    }
    save();
  }
  function bmi(p = state.profile) {
    if (!(p.weightKg > 0) || !(p.heightCm > 0)) return null;
    const v = p.weightKg / (p.heightCm / 100) ** 2;
    const cat =
      v < 18.5 ? ['Untergewicht', 'low'] : v < 25 ? ['Normalgewicht', 'ok'] : v < 30 ? ['Übergewicht', 'high'] : ['Adipositas', 'bad'];
    return { value: Math.round(v * 10) / 10, label: cat[0], level: cat[1] };
  }
  /** Tagesziel eines Nährwerts (Wochenziele werden auf 7 Tage verteilt). */
  function dailyGoal(key) {
    const g = state.profile.goals[key];
    if (!g || !(g.value > 0)) return null;
    return { target: g.period === 'week' ? g.value / 7 : g.value, mode: g.mode };
  }
  function weeklyGoal(key) {
    const d = dailyGoal(key);
    return d ? { target: d.target * 7, mode: d.mode } : null;
  }
  /** true = Ziel erfüllt, false = nicht erfüllt */
  function meetsGoal(value, goal) {
    const v = value || 0;
    if (goal.mode === 'min') return v >= goal.target * 0.95;
    if (goal.mode === 'max') return v <= goal.target * 1.05;
    return Math.abs(v - goal.target) <= goal.target * 0.1;
  }
  /** Bedarf grob schätzen (Mifflin-St Jeor × Aktivität) und daraus Ziele vorschlagen. */
  function suggestGoals(p = state.profile) {
    if (!(p.weightKg > 0 && p.heightCm > 0 && p.age > 0) || !p.sex) return null;
    const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'm' ? 5 : -161);
    const kcal = Math.round((bmr * (p.activity || 1.55)) / 50) * 50;
    const protein = Math.round(p.weightKg * 1.6);
    const fat = Math.round((kcal * 0.3) / 9);
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, protein, carbs, fat, fiber: 30, sugar: Math.round((kcal * 0.1) / 4) };
  }

  /* ---------- Tags ---------- */
  function migrateTags() {
    if (!Array.isArray(state.tags)) state.tags = DEFAULT_TAGS.map(([name, color]) => ({ id: uid(), name, color }));
    state.recipes.forEach((r) => (r.tags ||= []));
  }
  function getTag(id) {
    return state.tags.find((t) => t.id === id) || null;
  }
  function findTagByName(name) {
    return state.tags.find((t) => N.norm(t.name) === N.norm(name)) || null;
  }
  /** Neuen Tag anlegen (oder vorhandenen gleichen Namens zurückgeben). */
  function addTag(name, color, notify = true) {
    name = name.trim();
    if (!name) return null;
    const existing = findTagByName(name);
    if (existing) return existing;
    const tag = { id: uid(), name, color: color || TAG_COLORS[state.tags.length % TAG_COLORS.length] };
    state.tags.push(tag);
    if (notify) save();
    return tag;
  }
  function updateTag(id, changes) {
    const tag = getTag(id);
    if (!tag) return;
    if (changes.name != null && changes.name.trim()) tag.name = changes.name.trim();
    if (changes.color) tag.color = changes.color;
    save();
  }
  function deleteTag(id) {
    state.tags = state.tags.filter((t) => t.id !== id);
    state.recipes.forEach((r) => (r.tags = (r.tags || []).filter((t) => t !== id)));
    save();
  }

  /* ---------- Zutaten-Nährwerte ---------- */
  function ingredientInfo(name) {
    const key = N.norm(name);
    return state.ingredients[key] || null;
  }
  function setIngredientInfo(name, info) {
    state.ingredients[N.norm(name)] = { name: name.trim(), ...info };
    save();
  }
  function knownIngredientNames() {
    const names = new Set(Object.values(state.ingredients).map((i) => i.name));
    state.recipes.forEach((r) => r.ingredients.forEach((i) => names.add(i.name)));
    window.PF_FOODS.forEach((f) => names.add(f.name));
    return [...names].sort((a, b) => a.localeCompare(b, 'de'));
  }

  /** Nährwerte eines Rezepts (gesamt), inkl. Liste der Zutaten ohne Daten. */
  function recipeTotals(recipe) {
    const t = N.emptyTotals();
    for (const ing of recipe.ingredients) {
      const info = ingredientInfo(ing.name);
      const grams = N.gramsOf(ing.amount, ing.unit, info);
      if (!info || grams == null) {
        t.missing.push(ing.name);
        continue;
      }
      N.addTo(t, info.nutrients, grams);
    }
    return t;
  }
  function recipePerServing(recipe) {
    const t = recipeTotals(recipe);
    const s = Math.max(1, recipe.servings || 1);
    const out = N.emptyTotals();
    N.mergeTotals(out, t, 1 / s);
    return out;
  }

  /* ---------- Wochen ---------- */
  function getWeek(start, create = false) {
    let w = state.weeks[start];
    if (!w && create) {
      w = state.weeks[start] = { start, slots: {}, shopping: null, archived: false };
    }
    return w || null;
  }

  function forEachSlot(week, fn) {
    for (const day of Object.keys(week.slots || {})) {
      for (const meal of Object.keys(week.slots[day])) fn(week.slots[day][meal], day, meal);
    }
  }
  function entries(week) {
    const out = [];
    if (!week) return out;
    forEachSlot(week, (list, day, meal) => list.forEach((e) => out.push({ ...e, day: Number(day), meal })));
    return out;
  }
  function slotList(week, day, meal) {
    week.slots[day] ||= {};
    week.slots[day][meal] ||= [];
    return week.slots[day][meal];
  }

  function addEntry(start, day, meal, recipeId) {
    const week = getWeek(start, true);
    if (week.archived) return;
    const recipe = getRecipe(recipeId);
    if (!recipe) return;
    slotList(week, day, meal).push({ uid: uid(), recipeId, servings: recipe.servings || 1 });
    save();
  }
  function findEntry(week, entryUid) {
    let found = null;
    forEachSlot(week, (list, day, meal) => {
      const i = list.findIndex((e) => e.uid === entryUid);
      if (i >= 0) found = { list, index: i, entry: list[i], day, meal };
    });
    return found;
  }
  function moveEntry(start, entryUid, day, meal) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    const f = findEntry(week, entryUid);
    if (!f) return;
    f.list.splice(f.index, 1);
    slotList(week, day, meal).push(f.entry);
    save();
  }
  function removeEntry(start, entryUid) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    const f = findEntry(week, entryUid);
    if (!f) return;
    f.list.splice(f.index, 1);
    save();
  }
  function setEntryServings(start, entryUid, servings) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    const f = findEntry(week, entryUid);
    if (!f) return;
    f.entry.servings = Math.max(0.5, Math.round(servings * 2) / 2);
    save();
  }

  /* ---------- Einkaufsliste ---------- */
  const itemKey = (name, unit) => N.norm(name) + '|' + unit;

  /** Benötigte Mengen aller geplanten Rezepte einer Woche. */
  function computeNeeds(week) {
    const map = new Map();
    for (const e of entries(week)) {
      const recipe = getRecipe(e.recipeId, week);
      if (!recipe) continue;
      const scale = (e.servings || recipe.servings || 1) / (recipe.servings || 1);
      for (const ing of recipe.ingredients) {
        const key = itemKey(ing.name, ing.unit);
        if (!map.has(key)) map.set(key, { key, name: ing.name.trim(), unit: ing.unit, amount: 0, recipes: [] });
        const item = map.get(key);
        item.amount += ing.amount * scale;
        if (!item.recipes.includes(recipe.name)) item.recipes.push(recipe.name);
      }
    }
    for (const item of map.values()) item.amount = roundAmount(item.amount, item.unit);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }
  function roundAmount(v, unit) {
    return unit === 'Stück' ? Math.round(v * 2) / 2 : Math.round(v);
  }

  /*
   * Die Einkaufsliste läuft automatisch mit dem Plan mit.
   * Gespeichert wird nur, wie viel je Zutat schon abgehakt (= gekauft) ist:
   *   week.shopping = { bought: { [key]: Menge }, manual: [{ key, name, checked }] }
   * Steigt der Bedarf über die gekaufte Menge, erscheint der Rest als neuer, offener Eintrag.
   */
  function shopping(week) {
    week.shopping ||= { bought: {}, manual: [] };
    week.shopping.bought ||= {};
    week.shopping.manual ||= [];
    return week.shopping;
  }

  /** Alte Listen (vor dem Auto-Sync) ins neue Format überführen. */
  function migrateShopping(week) {
    const old = week.shopping;
    if (!old || !Array.isArray(old.items)) return;
    const bought = {};
    const manual = [];
    for (const i of old.items) {
      if (i.manual) manual.push({ key: i.key, name: i.name, checked: !!i.checked });
      else if (i.checked) bought[i.key] = i.amount;
    }
    week.shopping = { bought, manual };
  }

  /** Anzeigezeilen der Einkaufsliste (abgehakter Teil + offener Rest je Zutat). */
  function shoppingItems(week) {
    if (!week) return [];
    const sh = week.shopping || { bought: {}, manual: [] };
    const rows = [];
    for (const need of computeNeeds(week)) {
      const have = Math.min(sh.bought[need.key] || 0, need.amount);
      const open = roundAmount(need.amount - have, need.unit);
      if (have > 0) rows.push({ ...need, id: need.key + '#done', amount: have, checked: true });
      if (open > 0) rows.push({ ...need, id: need.key + '#open', amount: open, checked: false, extraTo: have > 0 ? have : 0 });
    }
    for (const m of sh.manual) rows.push({ id: m.key, key: m.key, name: m.name, unit: '', amount: 0, recipes: [], checked: m.checked, manual: true });
    return rows;
  }

  function toggleItem(start, id, checked) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    const sh = shopping(week);
    const manual = sh.manual.find((m) => m.key === id);
    if (manual) manual.checked = checked;
    else {
      const key = id.replace(/#(done|open)$/, '');
      const need = computeNeeds(week).find((n) => n.key === key);
      if (checked && need) sh.bought[key] = need.amount;
      else delete sh.bought[key];
    }
    save();
  }
  function setAllItems(start, checked) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    const sh = shopping(week);
    sh.bought = {};
    if (checked) for (const n of computeNeeds(week)) sh.bought[n.key] = n.amount;
    sh.manual.forEach((m) => (m.checked = checked));
    save();
  }
  function addManualItem(start, name) {
    const week = getWeek(start, true);
    if (week.archived) return;
    shopping(week).manual.push({ key: 'manual|' + uid(), name, checked: false });
    save();
  }
  function removeItem(start, id) {
    const week = getWeek(start);
    if (!week || !week.shopping) return;
    const sh = shopping(week);
    sh.manual = sh.manual.filter((m) => m.key !== id);
    save();
  }

  /**
   * Status aller geplanten Rezepte: Die gekauften Mengen werden in zeitlicher
   * Reihenfolge (Tag, Mahlzeit) auf die Rezepte verteilt. Ein Rezept ist grün,
   * wenn alle seine Zutaten vollständig gedeckt sind.
   */
  function statusMap(week) {
    const map = new Map();
    if (!week) return map;
    const mealIdx = Object.fromEntries(MEALS.map((m, i) => [m.key, i]));
    const remaining = { ...((week.shopping && week.shopping.bought) || {}) };
    const ordered = entries(week).sort((a, b) => a.day - b.day || mealIdx[a.meal] - mealIdx[b.meal]);
    for (const e of ordered) {
      const recipe = getRecipe(e.recipeId, week);
      if (!recipe) continue;
      const scale = (e.servings || recipe.servings || 1) / (recipe.servings || 1);
      const needs = new Map();
      for (const ing of recipe.ingredients) {
        const key = itemKey(ing.name, ing.unit);
        if (!needs.has(key)) needs.set(key, { name: ing.name, amount: 0 });
        needs.get(key).amount += ing.amount * scale;
      }
      const missing = [];
      for (const [key, n] of needs) {
        const avail = remaining[key] || 0;
        // kleine Toleranz für Rundungen in der Liste
        if (avail >= n.amount - 0.51) remaining[key] = Math.max(0, avail - n.amount);
        else {
          missing.push(n.name);
          remaining[key] = 0;
        }
      }
      const total = needs.size;
      map.set(e.uid, { ok: missing.length === 0, have: total - missing.length, total, missing });
    }
    return map;
  }

  /** Status eines geplanten Rezepts: { ok, have, total, missing: [Namen] } */
  function entryStatus(week, entry) {
    return statusMap(week).get(entry.uid) || null;
  }

  /* ---------- Import ---------- */
  /**
   * Übernimmt geparste Rezepte (siehe importer.js).
   * opts.overwrite: gleichnamige Rezepte aktualisieren statt überspringen
   * opts.planWeek: Wochenstart, in den der Plan aus der Datei eingetragen wird
   */
  function importData(data, opts = {}) {
    const result = { created: 0, updated: 0, skipped: 0, planned: 0, nutrition: 0 };
    for (const n of data.nutrition) {
      state.ingredients[N.norm(n.name)] = {
        name: n.name,
        nutrients: n.nutrients,
        gramsPerPiece: (state.ingredients[N.norm(n.name)] || {}).gramsPerPiece || null,
        source: 'Excel-Import',
      };
      result.nutrition++;
    }
    const byName = new Map();
    for (const r of data.recipes) {
      const existing = state.recipes.find((x) => N.norm(x.name) === N.norm(r.name));
      if (existing && !opts.overwrite) {
        result.skipped++;
        byName.set(N.norm(r.name), existing);
        continue;
      }
      const recipe = {
        id: existing ? existing.id : uid(),
        color: existing ? existing.color : COLORS[(state.recipes.length + result.created) % COLORS.length],
        name: r.name,
        category: r.category,
        servings: r.servings,
        ingredients: r.ingredients.map((i) => ({ ...i })),
        instructions: r.instructions,
        tags: [...new Set([...(existing ? existing.tags || [] : []), ...(r.tags || []).map((n) => addTag(n, null, false)).filter(Boolean).map((t) => t.id)])],
      };
      // wie upsertRecipe, aber ohne Speichern pro Rezept
      for (const ing of recipe.ingredients) {
        const key = N.norm(ing.name);
        if (!state.ingredients[key]) {
          const hit = N.autoDetect(ing.name);
          if (hit) state.ingredients[key] = { name: ing.name, ...hit };
        }
      }
      if (existing) Object.assign(existing, recipe), result.updated++;
      else state.recipes.push(recipe), result.created++;
      byName.set(N.norm(r.name), existing || recipe);
    }
    if (opts.planWeek && data.plan.length) {
      const week = getWeek(opts.planWeek, true);
      if (!week.archived) {
        for (const p of data.plan) {
          const recipe = byName.get(N.norm(p.name));
          if (!recipe) continue;
          slotList(week, p.day, p.meal).push({ uid: uid(), recipeId: recipe.id, servings: recipe.servings || 1 });
          result.planned++;
        }
      }
    }
    save();
    return result;
  }

  /* ---------- Archiv ---------- */
  function snapshotRecipes(week) {
    const snap = {};
    for (const e of entries(week)) {
      const r = getRecipe(e.recipeId, week);
      if (r) snap[r.id] = JSON.parse(JSON.stringify(r));
    }
    return snap;
  }
  function archiveWeek(start) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    week.recipeSnapshot = snapshotRecipes(week);
    week.archived = true;
    week.archivedAt = new Date().toISOString();
    save();
  }
  function reopenWeek(start) {
    const week = getWeek(start);
    if (!week) return;
    week.archived = false;
    save();
  }
  function deleteWeek(start) {
    delete state.weeks[start];
    save();
  }
  /** Vergangene Wochen automatisch archivieren (leere werden verworfen). */
  function autoArchive() {
    const current = currentWeekStart();
    for (const [start, week] of Object.entries(state.weeks)) {
      if (start >= current || week.archived) continue;
      if (entries(week).length === 0) delete state.weeks[start];
      else {
        week.recipeSnapshot = snapshotRecipes(week);
        week.archived = true;
        week.archivedAt = new Date().toISOString();
      }
    }
  }
  function archivedWeeks() {
    return Object.values(state.weeks)
      .filter((w) => w.archived)
      .sort((a, b) => b.start.localeCompare(a.start));
  }
  /** Plan einer (archivierten) Woche in eine Zielwoche kopieren. */
  function copyWeek(fromStart, toStart) {
    const from = getWeek(fromStart);
    const to = getWeek(toStart, true);
    if (!from || to.archived) return { copied: 0, skipped: 0 };
    let copied = 0;
    let skipped = 0;
    for (const e of entries(from)) {
      let recipe = state.recipes.find((r) => r.id === e.recipeId);
      if (!recipe && from.recipeSnapshot && from.recipeSnapshot[e.recipeId]) {
        // gelöschtes Rezept aus dem Archiv wiederherstellen
        recipe = JSON.parse(JSON.stringify(from.recipeSnapshot[e.recipeId]));
        state.recipes.push(recipe);
      }
      if (!recipe) {
        skipped++;
        continue;
      }
      slotList(to, e.day, e.meal).push({ uid: uid(), recipeId: recipe.id, servings: e.servings });
      copied++;
    }
    save();
    return { copied, skipped };
  }

  /** Nährwerte pro Tag einer Woche (Index 0–6) */
  function dayTotals(week) {
    const days = Array.from({ length: 7 }, () => N.emptyTotals());
    for (const e of entries(week)) {
      const recipe = getRecipe(e.recipeId, week);
      if (!recipe) continue;
      const t = recipeTotals(recipe);
      N.mergeTotals(days[e.day], t, (e.servings || 1) / (recipe.servings || 1));
    }
    return days;
  }

  /* ---------- Beispieldaten ---------- */
  function seed() {
    const tags = DEFAULT_TAGS.map(([name, color]) => ({ id: uid(), name, color }));
    const tagIds = (...names) => names.map((n) => tags.find((t) => t.name === n).id);
    const r = (name, category, color, servings, ingredients, instructions, tagNames = []) => ({
      id: uid(),
      name,
      category,
      color,
      servings,
      ingredients: ingredients.map(([n, amount, unit]) => ({ name: n, amount, unit })),
      instructions,
      tags: tagIds(...tagNames),
    });
    const recipes = [
      r('Overnight Oats mit Beeren', 'Frühstück', COLORS[2], 1, [
        ['Haferflocken', 60, 'g'], ['Milch', 150, 'g'], ['Joghurt', 80, 'g'], ['Heidelbeeren', 80, 'g'], ['Chiasamen', 10, 'g'], ['Honig', 10, 'g'],
      ], 'Alles verrühren, über Nacht in den Kühlschrank stellen, morgens mit Beeren toppen.', ['Meal Prep', 'Schnell']),
      r('Rührei auf Vollkornbrot', 'Frühstück', COLORS[1], 1, [
        ['Ei', 2, 'Stück'], ['Vollkornbrot', 1, 'Stück'], ['Butter', 5, 'g'], ['Kirschtomaten', 5, 'Stück'],
      ], 'Eier verquirlen, in Butter stocken lassen, auf Brot mit Tomaten servieren.', ['Schnell', 'Günstig']),
      r('Spaghetti Bolognese', 'Hauptgericht', COLORS[0], 4, [
        ['Spaghetti', 400, 'g'], ['Rinderhackfleisch', 400, 'g'], ['Passierte Tomaten', 500, 'g'], ['Zwiebel', 1, 'Stück'],
        ['Knoblauch', 2, 'Stück'], ['Karotte', 1, 'Stück'], ['Olivenöl', 15, 'g'], ['Parmesan', 40, 'g'],
      ], 'Zwiebel, Knoblauch und Karotte würfeln und anbraten, Hack dazu, mit Tomaten 30 Min. köcheln. Mit Nudeln und Parmesan servieren.', ['Meal Prep']),
      r('Hähnchen-Gemüse-Pfanne', 'Hauptgericht', COLORS[4], 2, [
        ['Hähnchenbrust', 300, 'g'], ['Paprika', 1, 'Stück'], ['Zucchini', 1, 'Stück'], ['Brokkoli', 200, 'g'],
        ['Reis', 150, 'g'], ['Olivenöl', 15, 'g'], ['Ingwer', 1, 'Stück'],
      ], 'Reis kochen. Hähnchen in Streifen scharf anbraten, Gemüse dazu, mit Ingwer würzen.', ['High Protein', 'Schnell']),
      r('Rotes Linsencurry', 'Hauptgericht', COLORS[8], 3, [
        ['Rote Linsen', 200, 'g'], ['Kokosmilch', 400, 'g'], ['Passierte Tomaten', 400, 'g'], ['Zwiebel', 1, 'Stück'],
        ['Knoblauch', 2, 'Stück'], ['Spinat', 150, 'g'], ['Reis', 180, 'g'],
      ], 'Zwiebel und Knoblauch anschwitzen, Linsen, Tomaten und Kokosmilch 20 Min. köcheln, Spinat unterheben.', ['Vegan', 'Meal Prep', 'Günstig']),
      r('Ofenlachs mit Kartoffeln', 'Hauptgericht', COLORS[6], 2, [
        ['Lachs', 2, 'Stück'], ['Kartoffeln', 500, 'g'], ['Brokkoli', 300, 'g'], ['Zitrone', 1, 'Stück'], ['Olivenöl', 20, 'g'],
      ], 'Kartoffeln 20 Min. vorbacken, Lachs und Brokkoli dazu, weitere 15 Min. bei 200 °C.', ['High Protein', 'Low Carb']),
      r('Apfel mit Erdnussbutter', 'Snack', COLORS[3], 1, [
        ['Apfel', 1, 'Stück'], ['Erdnussbutter', 20, 'g'],
      ], 'Apfel in Spalten schneiden und dippen.', ['Schnell', 'Vegan']),
      r('Gemüsesticks & Hummus', 'Snack', COLORS[5], 1, [
        ['Karotte', 1, 'Stück'], ['Gurke', 0.5, 'Stück'], ['Hummus', 60, 'g'],
      ], 'Gemüse in Sticks schneiden, mit Hummus servieren.', ['Schnell', 'Vegan', 'Low Carb']),
    ];
    const ingredients = {};
    for (const rec of recipes) {
      for (const ing of rec.ingredients) {
        const hit = N.autoDetect(ing.name);
        if (hit) ingredients[N.norm(ing.name)] = { name: ing.name, ...hit };
      }
    }
    return { version: 1, recipes, tags, ingredients, weeks: {}, settings: { usdaKey: '' } };
  }

  return {
    MEALS,
    CATEGORIES,
    COLORS,
    TAG_COLORS,
    DAY_NAMES,
    uid,
    isoDate,
    parseISO,
    addDays,
    currentWeekStart,
    isoWeekNumber,
    load,
    save,
    onChange,
    onLocalChange,
    replaceFromSync,
    listBackups,
    createBackup,
    restoreBackup,
    updatedAt,
    exportJSON,
    importJSON,
    reset,
    get state() {
      return state;
    },
    getRecipe,
    upsertRecipe,
    deleteRecipe,
    deleteRecipes,
    GOAL_DEFS,
    setProfile,
    bmi,
    dailyGoal,
    weeklyGoal,
    meetsGoal,
    suggestGoals,
    ingredientInfo,
    setIngredientInfo,
    knownIngredientNames,
    recipeTotals,
    recipePerServing,
    getWeek,
    entries,
    addEntry,
    moveEntry,
    removeEntry,
    setEntryServings,
    computeNeeds,
    shoppingItems,
    toggleItem,
    setAllItems,
    addManualItem,
    removeItem,
    entryStatus,
    archiveWeek,
    reopenWeek,
    deleteWeek,
    archivedWeeks,
    copyWeek,
    importData,
    getTag,
    addTag,
    updateTag,
    deleteTag,
    dayTotals,
  };
})();
