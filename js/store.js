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
    migrateExtras();
    Object.values(state.weeks).forEach(migrateShopping);
    autoArchive();
  }

  /**
   * Speichern. Eigene Änderungen (local) bekommen einen neuen Zeitstempel und
   * werden an den Geräte-Sync gemeldet; vom Sync geholte Daten nicht.
   */
  let rev = 0; // Änderungszähler (für Zwischenspeicher wie den Rezept-Status)
  function save(notify = true, { local = true } = {}) {
    rev++;
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
  /*
   * Personen im Haushalt. Jede Person hat Körperdaten, Ziele und eine Portionsgröße
   * (1 = normale Portion). Geplante Portionen eines Eintrags werden im Verhältnis der
   * Portionsgrößen auf die Personen verteilt (bei einer Person: alles für sie).
   */
  function blankPerson(name) {
    const p = { id: uid(), name, weightKg: null, heightCm: null, age: null, sex: '', activity: 1.55, portion: 1, weightLog: [], goals: {} };
    for (const g of GOAL_DEFS) p.goals[g.key] = { value: null, period: 'day', mode: g.mode };
    return p;
  }
  function migrateProfile() {
    if (!Array.isArray(state.persons) || !state.persons.length) {
      // früheres Einzelprofil übernehmen
      const old = state.profile || {};
      state.persons = [{ ...blankPerson('Ich'), ...old, id: uid(), name: old.name || 'Ich' }];
    }
    delete state.profile;
    for (const p of state.persons) {
      p.weightKg ??= null;
      p.heightCm ??= null;
      p.age ??= null;
      p.sex ??= '';
      p.activity ??= 1.55;
      p.portion ??= 1;
      p.weightLog ||= [];
      p.goals ||= {};
      for (const g of GOAL_DEFS) p.goals[g.key] ||= { value: null, period: 'day', mode: g.mode };
    }
    if (!state.persons.some((p) => p.id === state.settings.activePerson)) state.settings.activePerson = state.persons[0].id;
  }
  function persons() {
    return state.persons;
  }
  function getPerson(id) {
    return state.persons.find((p) => p.id === id) || null;
  }
  /** Person, deren Ziele im Kalender angezeigt werden */
  function activePerson() {
    return getPerson(state.settings.activePerson) || state.persons[0];
  }
  function setActivePerson(id) {
    if (!getPerson(id)) return;
    state.settings.activePerson = id;
    save();
  }
  function addPerson(name) {
    const p = blankPerson(name || `Person ${state.persons.length + 1}`);
    state.persons.push(p);
    save();
    return p;
  }
  function removePerson(id) {
    if (state.persons.length < 2) return;
    state.persons = state.persons.filter((p) => p.id !== id);
    if (state.settings.activePerson === id) state.settings.activePerson = state.persons[0].id;
    save();
  }
  function updatePerson(id, changes) {
    const p = getPerson(id);
    if (!p) return;
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
  /** kompatibel: Profil der aktiven Person ändern */
  function setProfile(changes) {
    updatePerson(activePerson().id, changes);
  }
  /** Summe der Portionsgrößen = Portionen, die eine gemeinsame Mahlzeit braucht */
  function householdPortions() {
    return state.persons.reduce((s, p) => s + (p.portion || 1), 0);
  }
  /** Anteil einer Person an jeder geplanten Mahlzeit */
  function personShare(person = activePerson()) {
    if (state.persons.length < 2) return 1;
    return (person.portion || 1) / householdPortions();
  }
  function bmi(p = activePerson()) {
    if (!(p.weightKg > 0) || !(p.heightCm > 0)) return null;
    const v = p.weightKg / (p.heightCm / 100) ** 2;
    const cat =
      v < 18.5 ? ['Untergewicht', 'low'] : v < 25 ? ['Normalgewicht', 'ok'] : v < 30 ? ['Übergewicht', 'high'] : ['Adipositas', 'bad'];
    return { value: Math.round(v * 10) / 10, label: cat[0], level: cat[1] };
  }
  /** Tagesziel eines Nährwerts (Wochenziele werden auf 7 Tage verteilt). */
  function dailyGoal(key, person = activePerson()) {
    const g = person.goals[key];
    if (!g || !(g.value > 0)) return null;
    return { target: g.period === 'week' ? g.value / 7 : g.value, mode: g.mode };
  }
  function weeklyGoal(key, person = activePerson()) {
    const d = dailyGoal(key, person);
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
  function suggestGoals(p = activePerson()) {
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
  /** Gewicht des Gerichts: { total, perServing, missing: [Zutaten ohne bekanntes Gewicht] } */
  function recipeWeight(recipe) {
    let total = 0;
    const missing = [];
    for (const ing of recipe.ingredients) {
      if (ing.heading != null) continue; // Überschrift im Editor
      const amount = parseFloat(String(ing.amount).replace(',', '.'));
      if (!String(ing.name || '').trim() || !(amount > 0)) continue;
      const grams = N.gramsOf(amount, ing.unit, ingredientInfo(ing.name) || N.autoDetect(ing.name));
      if (grams == null) missing.push(ing.name);
      else total += grams;
    }
    return { total, perServing: total / Math.max(1, recipe.servings || 1), missing };
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
    // Haushalt mit mehreren Personen: so viele Portionen wie Personen (nach Portionsgröße)
    const servings = state.persons.length > 1 ? Math.round(householdPortions() * 2) / 2 : recipe.servings || 1;
    slotList(week, day, meal).push({ uid: uid(), recipeId, servings });
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
  // Liter werden für die Einkaufsliste in ml gerechnet, damit sich ml und l addieren
  const normUnit = (amount, unit) => (unit === 'l' ? [amount * 1000, 'ml'] : [amount, unit]);
  const itemKey = (name, unit) => N.norm(name) + '|' + (unit === 'l' ? 'ml' : unit);

  /* ---------- Gleiche Zutat, andere Schreibweise ---------- */
  // state.aliases: { 'knoblauch c': 'Knoblauch' } (manuell zusammengefasst) oder '!' (nie automatisch zusammenfassen)
  let foodIndex = null;
  function foodNameIndex() {
    if (!foodIndex) {
      foodIndex = new Map();
      for (const f of window.PF_FOODS || []) for (const n of [f.name, ...f.aliases]) if (!foodIndex.has(N.norm(n))) foodIndex.set(N.norm(n), f.name);
    }
    return foodIndex;
  }
  /** automatische Zuordnung: Synonyme der Nährwerttabelle und Einzahl/Mehrzahl („Zwiebeln“ → „Zwiebel“) */
  function autoCanonical(name) {
    const key = N.norm(name);
    const idx = foodNameIndex();
    if (idx.has(key)) return idx.get(key);
    const variants = [key.replace(/n$/, ''), key.replace(/en$/, ''), key.replace(/e$/, ''), key.replace(/s$/, ''), key + 'n', key + 'e'];
    for (const v of variants) if (v !== key && v.length > 2 && idx.has(v)) return idx.get(v);
    return null;
  }
  /** Name, unter dem eine Zutat in der Einkaufsliste geführt wird */
  function canonicalName(name) {
    let cur = String(name || '').trim();
    const seen = new Set();
    for (let step = 0; step < 5; step++) {
      const key = N.norm(cur);
      if (seen.has(key)) break;
      seen.add(key);
      const alias = state.aliases[key];
      if (alias === '!') break;
      const next = alias || autoCanonical(cur);
      if (!next || N.norm(next) === key) {
        // gleiche Schreibweise wie in der Tabelle übernehmen („tofu“ → „Tofu“)
        if (next) cur = next;
        break;
      }
      cur = next;
    }
    return cur;
  }
  /** Zutat „from“ in der Einkaufsliste mit „into“ zusammenfassen */
  function mergeIngredients(from, into) {
    const target = canonicalName(into);
    if (N.norm(from) === N.norm(target)) return;
    state.aliases[N.norm(from)] = target;
    save();
  }
  /** Zusammenfassung aufheben: die Zutat steht wieder einzeln in der Liste */
  function splitIngredient(name) {
    const key = N.norm(name);
    delete state.aliases[key];
    const auto = autoCanonical(name);
    if (auto && N.norm(auto) !== key) state.aliases[key] = '!';
    save();
  }
  /** „Nicht zusammenfassen“ für einen Vorschlag merken */
  function ignoreSimilar(a, b) {
    const pair = [N.norm(a), N.norm(b)].sort().join('|');
    if (!state.similarIgnore.includes(pair)) state.similarIgnore.push(pair);
    save();
  }
  function isIgnoredSimilar(a, b) {
    return state.similarIgnore.includes([N.norm(a), N.norm(b)].sort().join('|'));
  }

  /**
   * Alle Zutaten der geplanten Rezepte (skaliert), mit Einkaufslisten-Namen und vereinheitlichter Einheit.
   * Kommt dieselbe Zutat in verschiedenen Einheiten vor (z. B. Knoblauch in Stück und g), wird – wenn
   * das Gewicht bekannt ist – alles in die Einheit mit dem größten Anteil umgerechnet.
   */
  function weekUses(week) {
    const uses = [];
    for (const e of entries(week)) {
      const recipe = getRecipe(e.recipeId, week);
      if (!recipe) continue;
      const scale = (e.servings || recipe.servings || 1) / (recipe.servings || 1);
      for (const ing of recipe.ingredients) {
        const [amount, unit] = normUnit(ing.amount * scale, ing.unit);
        uses.push({ e, recipe, ing, canon: canonicalName(ing.name), amount, unit });
      }
    }
    const groups = new Map();
    for (const u of uses) {
      const k = N.norm(u.canon);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(u);
    }
    for (const list of groups.values()) {
      if (new Set(list.map((u) => u.unit)).size < 2) continue;
      const base = ingredientInfo(list[0].canon) || N.autoDetect(list[0].canon);
      const infoOf = (u) => (base && (u.unit !== 'Stück' || base.gramsPerPiece) ? base : ingredientInfo(u.ing.name) || N.autoDetect(u.ing.name));
      for (const u of list) u.grams = N.gramsOf(u.amount, u.unit, infoOf(u));
      const conv = list.filter((u) => u.grams != null);
      const share = {};
      for (const u of conv) share[u.unit] = (share[u.unit] || 0) + u.grams;
      if (Object.keys(share).length < 2) continue;
      let target = Object.keys(share).sort((a, b) => share[b] - share[a])[0];
      // Löffel nur als Ziel, wenn sonst nichts Abwiegbares dabei ist
      if ((target === 'EL' || target === 'TL') && (share.g || share.ml)) target = (share.g || 0) >= (share.ml || 0) ? 'g' : 'ml';
      const per = target === 'Stück' ? infoOf(conv.find((u) => u.unit === 'Stück')).gramsPerPiece : N.UNIT_GRAMS[target];
      for (const u of conv) {
        if (u.unit === target) continue;
        u.from = u.unit;
        u.amount = u.grams / per;
        u.unit = target;
      }
    }
    for (const u of uses) u.key = itemKey(u.canon, u.unit);
    return uses;
  }

  /** Benötigte Mengen aller geplanten Rezepte einer Woche. */
  function computeNeeds(week) {
    const map = new Map();
    for (const u of weekUses(week)) {
      if (!map.has(u.key)) map.set(u.key, { key: u.key, name: u.canon, unit: u.unit, amount: 0, recipes: [], parts: new Map(), merged: [], converted: false });
      const item = map.get(u.key);
      item.amount += u.amount;
      // je Rezept merken, in welchen Unterkategorien die Zutat vorkommt (z. B. „Reis“ und „Soße“)
      if (!item.parts.has(u.recipe.name)) item.parts.set(u.recipe.name, []);
      const parts = item.parts.get(u.recipe.name);
      if (u.ing.group && !parts.includes(u.ing.group)) parts.push(u.ing.group);
      // zusammengefasste Schreibweisen merken („Knoblauchzehen“ → „Knoblauch“)
      const orig = u.ing.name.trim();
      if (N.norm(orig) !== N.norm(u.canon) && !item.merged.some((m) => N.norm(m) === N.norm(orig))) item.merged.push(orig);
      if (u.from) item.converted = true;
    }
    for (const item of map.values()) {
      item.amount = roundAmount(item.amount, item.unit);
      item.recipes = [...item.parts].map(([name, parts]) => (parts.length ? `${name} (${parts.join(' + ')})` : name));
      delete item.parts;
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }
  function roundAmount(v, unit) {
    return unit === 'Stück' || unit === 'EL' || unit === 'TL' ? Math.round(v * 2) / 2 : Math.round(v);
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
    week.shopping.home ||= {}; // schon zu Hause: { [key]: Menge }
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
      // Vorratsschrank: nicht einkaufen, gilt als vorhanden
      if (inPantry(need)) {
        rows.push({ ...need, id: need.key + '#pantry', checked: true, pantry: true });
        continue;
      }
      // was schon zu Hause ist, muss nicht gekauft werden
      const home = Math.min((sh.home && sh.home[need.key]) || 0, need.amount);
      const toBuy = need.amount - home;
      const have = Math.min(sh.bought[need.key] || 0, toBuy);
      const open = roundAmount(toBuy - have, need.unit);
      const extra = { total: need.amount, home };
      if (home > 0) rows.push({ ...need, ...extra, id: need.key + '#home', amount: roundAmount(home, need.unit), checked: true, atHome: true });
      if (have > 0) rows.push({ ...need, ...extra, id: need.key + '#done', amount: roundAmount(have, need.unit), checked: true });
      if (open > 0) rows.push({ ...need, ...extra, id: need.key + '#open', amount: open, checked: false, extraTo: have > 0 ? have : 0 });
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
    else if (id.endsWith('#home')) {
      // „Zu Hause“-Eintrag abgewählt → doch nichts da
      if (!checked) delete sh.home[id.replace(/#home$/, '')];
    } else {
      const key = id.replace(/#(done|open)$/, '');
      const need = computeNeeds(week).find((n) => n.key === key);
      if (checked && need) sh.bought[key] = Math.max(0, need.amount - (sh.home[key] || 0));
      else delete sh.bought[key];
    }
    save();
  }
  /** Menge, die schon zu Hause ist (wird von der Einkaufsliste abgezogen); 0 = nichts */
  function setHomeAmount(start, key, amount) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    const sh = shopping(week);
    if (amount > 0) sh.home[key] = amount;
    else delete sh.home[key];
    // Abgehaktes darf nicht mehr sein als der Rest, der noch gekauft werden muss
    const need = computeNeeds(week).find((n) => n.key === key);
    if (need && sh.bought[key] > need.amount - (sh.home[key] || 0)) sh.bought[key] = Math.max(0, need.amount - (sh.home[key] || 0));
    save();
  }
  function setAllItems(start, checked) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    const sh = shopping(week);
    sh.bought = {};
    if (checked) for (const n of computeNeeds(week)) sh.bought[n.key] = Math.max(0, n.amount - (sh.home[n.key] || 0));
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
  const statusCache = { key: null, state: null, week: null, map: null };
  function statusMap(week) {
    const map = new Map();
    if (!week) return map;
    const cacheKey = rev + '|' + week.start;
    if (statusCache.key === cacheKey && statusCache.state === state && statusCache.week === week) return statusCache.map;
    Object.assign(statusCache, { key: cacheKey, state, week, map });
    const mealIdx = Object.fromEntries(MEALS.map((m, i) => [m.key, i]));
    const remaining = { ...((week.shopping && week.shopping.bought) || {}) };
    // was zu Hause ist, zählt wie gekauft
    for (const [k, v] of Object.entries((week.shopping && week.shopping.home) || {})) remaining[k] = (remaining[k] || 0) + v;
    for (const n of computeNeeds(week)) if (inPantry(n)) remaining[n.key] = Infinity;
    const byEntry = new Map();
    for (const u of weekUses(week)) {
      if (!byEntry.has(u.e.uid)) byEntry.set(u.e.uid, []);
      byEntry.get(u.e.uid).push(u);
    }
    const ordered = entries(week).sort((a, b) => a.day - b.day || mealIdx[a.meal] - mealIdx[b.meal]);
    for (const e of ordered) {
      if (!byEntry.has(e.uid)) continue;
      const needs = new Map();
      for (const u of byEntry.get(e.uid)) {
        if (!needs.has(u.key)) needs.set(u.key, { names: [], amount: 0 });
        const n = needs.get(u.key);
        n.amount += u.amount;
        if (!n.names.includes(u.ing.name)) n.names.push(u.ing.name);
      }
      const missing = [];
      let missed = 0;
      for (const [key, n] of needs) {
        const avail = remaining[key] || 0;
        // kleine Toleranz für Rundungen in der Liste
        if (avail >= n.amount - 0.51) remaining[key] = Math.max(0, avail - n.amount);
        else {
          missed++;
          missing.push(...n.names);
          remaining[key] = 0;
        }
      }
      const total = needs.size;
      map.set(e.uid, { ok: missed === 0, have: total - missed, total, missing });
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

  /* ---------- Vorratsschrank ---------- */
  function migrateExtras() {
    state.pantry ||= [];
    state.aisles ||= {};
    state.aliases ||= {};
    state.similarIgnore ||= [];
  }
  /** Eintrag der Einkaufsliste im Vorrat? (auch über eine zusammengefasste Schreibweise) */
  function inPantry(need) {
    return isPantry(need.name) || (need.merged || []).some(isPantry);
  }
  function isPantry(name) {
    return (state.pantry || []).includes(N.norm(name));
  }
  function setPantry(name, on) {
    const key = N.norm(name);
    state.pantry = state.pantry.filter((n) => n !== key);
    if (on) state.pantry.push(key);
    save();
  }

  /* ---------- Supermarkt-Bereiche ---------- */
  const AISLES = [
    ['Obst & Gemüse', /apfel|äpfel|banane|beere|zitrone|limette|orange|mango|ananas|kiwi|birne|pfirsich|traube|melone|kirsch|tomate|gurke|paprika|zwiebel|knoblauch|karotte|möhre|kartoffel|brokkoli|blumenkohl|spinat|zucchini|aubergine|champignon|pilz|salat|rucola|kohl|lauch|porree|sellerie|ingwer|avocado|kürbis|spargel|radieschen|rote bete|frühlingszwiebel|schalotte|kräuter|petersilie|basilikum|koriander|minze|dill|schnittlauch|chili$|chilischote|jalapeño|mais$|(^| )erbsen|grüne bohnen/],
    ['Kühlregal', /milch|joghurt|quark|käse|feta|mozzarella|parmesan|frischkäse|sahne|butter|^ei$|^eier|^ei |tofu|tempeh|seitan|hummus|skyr|kefir|schmand|creme|margarine|hafermilch|sojamilch|mandelmilch/],
    ['Fleisch & Fisch', /hähnchen|huhn|pute|rind|hack|schwein|speck|schinken|wurst|steak|lachs|thunfisch|fisch|garnele|kabeljau|lamm/],
    ['Brot & Backwaren', /brot|brötchen|toast|tortilla|wrap|bagel|baguette|croissant/],
    ['Tiefkühl', /\(tk\)|tk-|tiefkühl|gefroren/],
    ['Nudeln, Reis & Getreide', /nudel|spaghetti|pasta|penne|reis|haferflocken|hafer|müsli|granola|quinoa|couscous|bulgur|mehl|grieß|linsen|kichererbsen|bohnen|cornflakes/],
    ['Konserven & Saucen', /dose|passiert|tomatenmark|gehackte tomaten|kokosmilch|brühe|sauce|soße|senf|ketchup|mayonnaise|pesto|essig|sojasauce|tahini|mus$|erdnussbutter|marmelade|honig|sirup|oliven$/],
    ['Gewürze & Öle', /salz|pfeffer|gewürz|zimt|kurkuma|kreuzkümmel|paprikapulver|curry|oregano|thymian|rosmarin|muskat|vanille|backpulver|natron|hefe|öl$|olivenöl|rapsöl|kokosöl|sesamöl|zucker|kakao|chiliflocken|lorbeer/],
    ['Nüsse & Snacks', /nuss|nüsse|mandel|cashew|pistazie|samen|kerne|sesam|chia|leinsamen|rosinen|datteln|schokolade|riegel|chips|proteinpulver/],
    ['Getränke', /wasser|saft|kaffee|tee|wein|bier|limo|cola/],
  ];
  const AISLE_NAMES = [...AISLES.map(([n]) => n), 'Sonstiges'];
  function aisleOf(name) {
    const key = N.norm(name);
    if (state.aisles && state.aisles[key]) return state.aisles[key];
    // Tiefkühl und Konserven haben Vorrang („Spinat (TK)“, „Kokosmilch“, „Tomatenmark“)
    const priority = [AISLES[4], AISLES[6], ...AISLES.filter((_, i) => i !== 4 && i !== 6)];
    for (const [section, re] of priority) if (re.test(key)) return section;
    return 'Sonstiges';
  }
  function setAisle(name, section) {
    state.aisles[N.norm(name)] = section;
    save();
  }

  /* ---------- Favoriten & zuletzt geplant ---------- */
  function toggleFavorite(id) {
    const r = state.recipes.find((x) => x.id === id);
    if (!r) return;
    r.fav = !r.fav;
    save();
  }
  /** Datum (ISO), an dem das Rezept zuletzt im Plan stand (bis heute), sonst das nächste geplante. */
  function lastPlanned(recipeId) {
    const today = isoDate(new Date());
    let past = null;
    let next = null;
    for (const w of Object.values(state.weeks)) {
      for (const e of entries(w)) {
        if (e.recipeId !== recipeId) continue;
        const d = isoDate(addDays(parseISO(w.start), e.day));
        if (d <= today) past = !past || d > past ? d : past;
        else next = !next || d < next ? d : next;
      }
    }
    return { past, next };
  }

  /* ---------- Woche: kopieren, leeren, automatisch füllen ---------- */
  function clearWeek(start) {
    const week = getWeek(start);
    if (!week || week.archived) return 0;
    const n = entries(week).length;
    week.slots = {};
    save();
    return n;
  }
  function removeEntries(start, uids) {
    const week = getWeek(start);
    if (!week || week.archived) return;
    const set = new Set(uids);
    forEachSlot(week, (list, day, meal) => {
      week.slots[day][meal] = list.filter((e) => !set.has(e.uid));
    });
    save();
  }
  const MEAL_CATEGORY = { breakfast: 'Frühstück', lunch: 'Hauptgericht', dinner: 'Hauptgericht', snack: 'Snack' };
  /**
   * Leere Felder der Woche mit passenden Rezepten füllen.
   * opts: { meals: ['breakfast', …], tagIds: [], favoritesOnly, useGoals }
   * Abwechslung: Rezepte möglichst nicht doppelt, lange nicht geplante bevorzugt.
   * Mit useGoals wird je Tag so gewählt, dass Energie und Eiweiß möglichst nah ans Tagesziel kommen.
   */
  function fillWeek(start, opts = {}) {
    const week = getWeek(start, true);
    if (week.archived) return [];
    const meals = opts.meals || MEALS.map((m) => m.key);
    const pool = state.recipes.filter(
      (r) => (!opts.favoritesOnly || r.fav) && (!opts.tagIds || !opts.tagIds.length || opts.tagIds.every((t) => (r.tags || []).includes(t)))
    );
    const usedCount = new Map();
    entries(week).forEach((e) => usedCount.set(e.recipeId, (usedCount.get(e.recipeId) || 0) + 1));
    const lastUsed = new Map(pool.map((r) => [r.id, lastPlanned(r.id).past || '0000']));
    const person = activePerson();
    const share = personShare(person);
    const kcalGoal = opts.useGoals ? dailyGoal('kcal', person) : null;
    const proteinGoal = opts.useGoals ? dailyGoal('protein', person) : null;
    // so viele Portionen, wie der Haushalt isst (eine Person: 1 Portion)
    const portions = Math.max(0.5, Math.round(householdPortions() * 2) / 2);
    const added = [];
    const perServing = new Map(pool.map((r) => [r.id, recipePerServing(r).values]));
    for (let d = 0; d < 7; d++) {
      const dayVals = { kcal: 0, protein: 0 };
      // vorhandene Einträge des Tages einrechnen
      for (const e of entries(week).filter((x) => x.day === d)) {
        const r = getRecipe(e.recipeId, week);
        if (!r) continue;
        const v = recipePerServing(r).values;
        const f = (e.servings || 1) * share;
        dayVals.kcal += (v.kcal || 0) * f;
        dayVals.protein += (v.protein || 0) * f;
      }
      const empty = meals.filter((m) => !((week.slots[d] && week.slots[d][m]) || []).length);
      empty.forEach((meal, idx) => {
        const cat = MEAL_CATEGORY[meal];
        // nur passende Kategorie (kein Hauptgericht als Snack)
        const candidates = pool.filter((r) => (r.category || 'Sonstiges') === cat);
        if (!candidates.length) return;
        const left = empty.length - idx; // noch zu füllende Felder an diesem Tag
        const scored = candidates.map((r) => {
          const servings = portions;
          const v = perServing.get(r.id) || {};
          const kcal = (v.kcal || 0) * servings * share;
          const protein = (v.protein || 0) * servings * share;
          let score = (usedCount.get(r.id) || 0) * 3; // Wiederholungen vermeiden
          score += lastUsed.get(r.id) > isoDate(addDays(new Date(), -14)) ? 1 : 0; // kürzlich gekocht
          if (kcalGoal) score += Math.abs(kcalGoal.target - dayVals.kcal - kcal * left) / kcalGoal.target;
          if (proteinGoal) score += Math.max(0, proteinGoal.target - dayVals.protein - protein * left) / proteinGoal.target;
          score += Math.random() * 0.6; // etwas Zufall
          return { r, score, kcal, protein, servings };
        });
        scored.sort((a, b) => a.score - b.score);
        const pick = scored[0];
        const entry = { uid: uid(), recipeId: pick.r.id, servings: pick.servings };
        slotList(week, d, meal).push(entry);
        usedCount.set(pick.r.id, (usedCount.get(pick.r.id) || 0) + 1);
        dayVals.kcal += pick.kcal;
        dayVals.protein += pick.protein;
        added.push(entry.uid);
      });
    }
    save();
    return added;
  }

  /* ---------- „Was kann ich kochen?“ ---------- */
  /** Rezepte nach vorhandenen Zutaten sortieren (am wenigsten fehlend zuerst). */
  function rankByIngredients(haveNames, { usePantry = true } = {}) {
    const have = haveNames.map((n) => N.norm(n)).filter(Boolean);
    // ganze Wörter vergleichen („ei“ soll nicht in „reis“ passen), längere Begriffe auch als Teil („hafer“ ↔ „haferflocken“)
    const wordMatch = (a, b) => a === b || a.split(' ').includes(b) || (b.length >= 4 && a.includes(b));
    const typed = (ingName) => {
      const n = N.norm(ingName);
      return have.some((h) => wordMatch(n, h) || wordMatch(h, n));
    };
    return state.recipes
      .map((r) => {
        const hits = r.ingredients.filter((i) => typed(i.name)).length;
        const got = r.ingredients.filter((i) => typed(i.name) || (usePantry && isPantry(i.name))).map((i) => i.name);
        const missing = r.ingredients.filter((i) => !got.includes(i.name)).map((i) => i.name);
        return { recipe: r, got, missing, hits };
      })
      .filter((x) => x.hits) // mindestens eine der eingegebenen Zutaten
      .sort((a, b) => a.missing.length - b.missing.length || b.hits - a.hits);
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

  /** Nährwerte pro Tag einer Woche (Index 0–6) – für eine Person (ihr Anteil an jeder Mahlzeit). */
  function dayTotals(week, person = activePerson()) {
    const days = Array.from({ length: 7 }, () => N.emptyTotals());
    const share = personShare(person);
    for (const e of entries(week)) {
      const recipe = getRecipe(e.recipeId, week);
      if (!recipe) continue;
      const t = recipeTotals(recipe);
      N.mergeTotals(days[e.day], t, ((e.servings || 1) / (recipe.servings || 1)) * share);
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
    persons,
    getPerson,
    activePerson,
    setActivePerson,
    addPerson,
    removePerson,
    updatePerson,
    personShare,
    householdPortions,
    bmi,
    dailyGoal,
    weeklyGoal,
    meetsGoal,
    suggestGoals,
    ingredientInfo,
    setIngredientInfo,
    knownIngredientNames,
    recipeTotals,
    recipeWeight,
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
    setHomeAmount,
    setAllItems,
    addManualItem,
    removeItem,
    entryStatus,
    archiveWeek,
    reopenWeek,
    deleteWeek,
    archivedWeeks,
    copyWeek,
    isPantry,
    setPantry,
    canonicalName,
    mergeIngredients,
    splitIngredient,
    ignoreSimilar,
    isIgnoredSimilar,
    AISLE_NAMES,
    aisleOf,
    setAisle,
    toggleFavorite,
    lastPlanned,
    clearWeek,
    removeEntries,
    fillWeek,
    rankByIngredients,
    importData,
    getTag,
    addTag,
    updateTag,
    deleteTag,
    dayTotals,
  };
})();
