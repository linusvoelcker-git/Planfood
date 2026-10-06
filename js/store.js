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
  const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  let state = null;
  const listeners = new Set();

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
    state.ingredients ||= {};
    state.weeks ||= {};
    state.settings ||= { usdaKey: '' };
    autoArchive();
    save(false);
    return state;
  }

  function save(notify = true) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Speichern fehlgeschlagen', e);
    }
    if (notify) listeners.forEach((fn) => fn());
  }

  function onChange(fn) {
    listeners.add(fn);
  }

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }
  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.recipes) || typeof data.weeks !== 'object') {
      throw new Error('Keine gültige Planfood-Datei');
    }
    state = data;
    state.ingredients ||= {};
    state.settings ||= { usdaKey: '' };
    autoArchive();
    save();
  }
  function reset() {
    state = seed();
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
  function needsSignature(items) {
    return items.map((i) => `${i.key}=${i.amount}`).join(';');
  }

  function generateShoppingList(start) {
    const week = getWeek(start, true);
    const needs = computeNeeds(week);
    const prev = week.shopping ? week.shopping.items : [];
    const prevByKey = new Map(prev.map((i) => [i.key, i]));
    const items = needs.map((n) => {
      const old = prevByKey.get(n.key);
      // Abgehakt bleibt abgehakt, solange die Menge nicht gestiegen ist
      const checked = !!(old && old.checked && !old.manual && old.amount >= n.amount);
      return { ...n, checked };
    });
    for (const old of prev) if (old.manual) items.push(old);
    week.shopping = { items, generatedAt: new Date().toISOString(), signature: needsSignature(needs) };
    save();
    return week.shopping;
  }

  function isShoppingStale(week) {
    if (!week || !week.shopping) return false;
    return needsSignature(computeNeeds(week)) !== week.shopping.signature;
  }

  function toggleItem(start, key, checked) {
    const week = getWeek(start);
    if (!week || !week.shopping) return;
    const item = week.shopping.items.find((i) => i.key === key);
    if (item) item.checked = checked;
    save();
  }
  function setAllItems(start, checked) {
    const week = getWeek(start);
    if (!week || !week.shopping) return;
    week.shopping.items.forEach((i) => (i.checked = checked));
    save();
  }
  function addManualItem(start, name) {
    const week = getWeek(start, true);
    week.shopping ||= { items: [], generatedAt: new Date().toISOString(), signature: needsSignature(computeNeeds(week)) };
    week.shopping.items.push({ key: 'manual|' + uid(), name, unit: '', amount: 0, recipes: [], checked: false, manual: true });
    save();
  }
  function removeItem(start, key) {
    const week = getWeek(start);
    if (!week || !week.shopping) return;
    week.shopping.items = week.shopping.items.filter((i) => i.key !== key);
    save();
  }

  /**
   * Status eines geplanten Rezepts anhand der Einkaufsliste:
   * null = keine Liste, sonst { ok, have, total, missing: [Namen] }
   */
  function entryStatus(week, entry) {
    if (!week || !week.shopping) return null;
    const recipe = getRecipe(entry.recipeId, week);
    if (!recipe) return null;
    const byKey = new Map(week.shopping.items.map((i) => [i.key, i]));
    const missing = [];
    for (const ing of recipe.ingredients) {
      const item = byKey.get(itemKey(ing.name, ing.unit));
      if (!item || !item.checked) missing.push(ing.name);
    }
    const total = recipe.ingredients.length;
    return { ok: missing.length === 0, have: total - missing.length, total, missing };
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
    const r = (name, category, color, servings, ingredients, instructions) => ({
      id: uid(),
      name,
      category,
      color,
      servings,
      ingredients: ingredients.map(([n, amount, unit]) => ({ name: n, amount, unit })),
      instructions,
    });
    const recipes = [
      r('Overnight Oats mit Beeren', 'Frühstück', COLORS[2], 1, [
        ['Haferflocken', 60, 'g'], ['Milch', 150, 'g'], ['Joghurt', 80, 'g'], ['Heidelbeeren', 80, 'g'], ['Chiasamen', 10, 'g'], ['Honig', 10, 'g'],
      ], 'Alles verrühren, über Nacht in den Kühlschrank stellen, morgens mit Beeren toppen.'),
      r('Rührei auf Vollkornbrot', 'Frühstück', COLORS[1], 1, [
        ['Ei', 2, 'Stück'], ['Vollkornbrot', 1, 'Stück'], ['Butter', 5, 'g'], ['Kirschtomaten', 5, 'Stück'],
      ], 'Eier verquirlen, in Butter stocken lassen, auf Brot mit Tomaten servieren.'),
      r('Spaghetti Bolognese', 'Hauptgericht', COLORS[0], 4, [
        ['Spaghetti', 400, 'g'], ['Rinderhackfleisch', 400, 'g'], ['Passierte Tomaten', 500, 'g'], ['Zwiebel', 1, 'Stück'],
        ['Knoblauch', 2, 'Stück'], ['Karotte', 1, 'Stück'], ['Olivenöl', 15, 'g'], ['Parmesan', 40, 'g'],
      ], 'Zwiebel, Knoblauch und Karotte würfeln und anbraten, Hack dazu, mit Tomaten 30 Min. köcheln. Mit Nudeln und Parmesan servieren.'),
      r('Hähnchen-Gemüse-Pfanne', 'Hauptgericht', COLORS[4], 2, [
        ['Hähnchenbrust', 300, 'g'], ['Paprika', 1, 'Stück'], ['Zucchini', 1, 'Stück'], ['Brokkoli', 200, 'g'],
        ['Reis', 150, 'g'], ['Olivenöl', 15, 'g'], ['Ingwer', 1, 'Stück'],
      ], 'Reis kochen. Hähnchen in Streifen scharf anbraten, Gemüse dazu, mit Ingwer würzen.'),
      r('Rotes Linsencurry', 'Hauptgericht', COLORS[8], 3, [
        ['Rote Linsen', 200, 'g'], ['Kokosmilch', 400, 'g'], ['Passierte Tomaten', 400, 'g'], ['Zwiebel', 1, 'Stück'],
        ['Knoblauch', 2, 'Stück'], ['Spinat', 150, 'g'], ['Reis', 180, 'g'],
      ], 'Zwiebel und Knoblauch anschwitzen, Linsen, Tomaten und Kokosmilch 20 Min. köcheln, Spinat unterheben.'),
      r('Ofenlachs mit Kartoffeln', 'Hauptgericht', COLORS[6], 2, [
        ['Lachs', 2, 'Stück'], ['Kartoffeln', 500, 'g'], ['Brokkoli', 300, 'g'], ['Zitrone', 1, 'Stück'], ['Olivenöl', 20, 'g'],
      ], 'Kartoffeln 20 Min. vorbacken, Lachs und Brokkoli dazu, weitere 15 Min. bei 200 °C.'),
      r('Apfel mit Erdnussbutter', 'Snack', COLORS[3], 1, [
        ['Apfel', 1, 'Stück'], ['Erdnussbutter', 20, 'g'],
      ], 'Apfel in Spalten schneiden und dippen.'),
      r('Gemüsesticks & Hummus', 'Snack', COLORS[5], 1, [
        ['Karotte', 1, 'Stück'], ['Gurke', 0.5, 'Stück'], ['Hummus', 60, 'g'],
      ], 'Gemüse in Sticks schneiden, mit Hummus servieren.'),
    ];
    const ingredients = {};
    for (const rec of recipes) {
      for (const ing of rec.ingredients) {
        const hit = N.autoDetect(ing.name);
        if (hit) ingredients[N.norm(ing.name)] = { name: ing.name, ...hit };
      }
    }
    return { version: 1, recipes, ingredients, weeks: {}, settings: { usdaKey: '' } };
  }

  return {
    MEALS,
    CATEGORIES,
    COLORS,
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
    exportJSON,
    importJSON,
    reset,
    get state() {
      return state;
    },
    getRecipe,
    upsertRecipe,
    deleteRecipe,
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
    generateShoppingList,
    isShoppingStale,
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
    dayTotals,
  };
})();
