/*
 * Excel-/CSV-Import: liest Tabellen mit Rezepten (eine Zeile pro Zutat) und
 * optional ein Nährwert-Blatt (Werte pro 100 g) und formt daraus einzelne Rezepte.
 * Die Spalten werden anhand der Überschriften erkannt, die Reihenfolge ist egal.
 */
window.PF_IMPORT = (function () {
  const N = window.PF_NUTRITION;
  const LIB_SRC = 'js/vendor/xlsx.full.min.js';

  let libPromise = null;
  /** SheetJS erst laden, wenn wirklich importiert wird (~900 KB). */
  function loadLib() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    libPromise ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB_SRC;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => {
        libPromise = null;
        reject(new Error('Excel-Bibliothek konnte nicht geladen werden'));
      };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // Spaltenerkennung über die Überschrift
  const COLUMNS = {
    name: /^(gericht|rezept|rezeptname|speise|name)\b/,
    ing: /^zutat/,
    amount: /^menge/,
    unit: /^einheit/,
    day: /^(tag|wochentag)$/,
    meal: /^mahlzeit/,
    servings: /^portion/,
    category: /^kategorie/,
    tags: /^(tags?|schlagw|labels?)\b/,
    instructions: /zubereitung|anleitung|anweisung|beschreibung/,
    kcal: /kcal|energie|kalorien/,
    protein: /protein|eiweiß|eiweiss/,
    fat: /^fett/,
    carbs: /kh|kohlenhydrat/,
    fiber: /ballast/,
    sugar: /^zucker/,
  };
  const NUTRI_KEYS = ['kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar'];

  const MEAL_MAP = [
    [/früh|frueh|breakfast/, 'breakfast'],
    [/mittag|lunch/, 'lunch'],
    [/abend|dinner/, 'dinner'],
    [/snack|zwischen/, 'snack'],
  ];
  const DAY_PREFIX = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

  /** Warnsymbole/Emojis aus Namen entfernen (z. B. „Rucola ⚠“). */
  function cleanName(v) {
    return String(v ?? '')
      .replace(/[☀-➿\u{1F300}-\u{1FAFF}️]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function num(v) {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  /** Einheit → { unit: 'g'|'Stück', factor, warn } */
  function convertUnit(raw) {
    const u = String(raw ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (!u || u === 'g' || u === 'gramm' || u === 'gr') return { unit: 'g', factor: 1 };
    if (u === 'kg') return { unit: 'g', factor: 1000 };
    if (u === 'ml') return { unit: 'g', factor: 1, warn: 'ml wurde 1:1 als g übernommen' };
    if (u === 'l' || u === 'liter') return { unit: 'g', factor: 1000, warn: 'Liter wurde als 1000 g übernommen' };
    if (/^(stück|stueck|stk|st|x|pck|packung|zehe|zehen|scheibe|scheiben)$/.test(u)) return { unit: 'Stück', factor: 1 };
    if (u === 'el') return { unit: 'g', factor: 15, warn: 'EL wurde als 15 g übernommen' };
    if (u === 'tl') return { unit: 'g', factor: 5, warn: 'TL wurde als 5 g übernommen' };
    return null;
  }

  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const cols = {};
      rows[r].forEach((cell, c) => {
        const h = String(cell ?? '').trim().toLowerCase();
        if (!h) return;
        for (const [key, re] of Object.entries(COLUMNS)) {
          if (cols[key] == null && re.test(h)) {
            cols[key] = c;
            break;
          }
        }
      });
      if (cols.ing != null) return { row: r, cols };
    }
    return null;
  }

  /** Arbeitsmappe → { recipes, nutrition, plan, warnings } */
  function parseWorkbook(XLSX, wb) {
    const recipes = new Map(); // Name -> Rezept (erstes Vorkommen gewinnt)
    const nutrition = new Map(); // Zutat -> Nährwerte pro 100 g (aus Nährwert-Blatt)
    const derived = new Map(); // Zutat -> aus Rezeptzeilen errechnete Nährwerte
    const plan = [];
    const warnings = new Set();

    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
      const head = findHeader(rows);
      if (!head) continue;
      const { cols } = head;
      const get = (row, key) => (cols[key] == null ? null : row[cols[key]]);

      // Nährwert-Tabelle: Zutat + kcal, aber kein Gericht/Menge
      if (cols.name == null && cols.amount == null) {
        if (cols.kcal == null && cols.protein == null) continue;
        for (const row of rows.slice(head.row + 1)) {
          const name = cleanName(get(row, 'ing'));
          if (!name) continue;
          const nutrients = {};
          for (const k of NUTRI_KEYS) {
            const v = num(get(row, k));
            if (v != null) nutrients[k] = v;
          }
          if (Object.keys(nutrients).length) nutrition.set(N.norm(name), { name, nutrients });
        }
        continue;
      }
      if (cols.name == null || cols.amount == null) continue;

      // Rezept-Tabelle: eine Zeile pro Zutat, zusammenhängende Zeilen = ein Gericht
      let block = null;
      const finishBlock = () => {
        if (!block) return;
        if (block.ingredients.length) {
          const key = N.norm(block.name);
          if (!recipes.has(key)) {
            recipes.set(key, {
              name: block.name,
              category: block.category || categoryFor(block.meal),
              servings: block.servings || 1,
              ingredients: block.ingredients,
              instructions: block.instructions || '',
              tags: block.tags || [],
            });
          }
          if (block.day != null && block.meal) plan.push({ day: block.day, meal: block.meal, name: block.name });
        }
        block = null;
      };

      for (const row of rows.slice(head.row + 1)) {
        const rawName = cleanName(get(row, 'name'));
        const ingName = cleanName(get(row, 'ing'));
        if (!ingName) {
          finishBlock(); // Summen- oder Leerzeile beendet ein Gericht
          continue;
        }
        const day = dayIndex(get(row, 'day'));
        const meal = mealKey(get(row, 'meal'));
        const name = rawName || (block && block.name);
        if (!name) continue;
        if (!block || N.norm(block.name) !== N.norm(name) || (day != null && day !== block.day) || (meal && meal !== block.meal)) {
          finishBlock();
          block = { name, day, meal, ingredients: [], instructions: '', servings: null, category: null, tags: null };
        }
        const instr = get(row, 'instructions');
        if (instr && !block.instructions) block.instructions = String(instr).trim();
        const servings = num(get(row, 'servings'));
        if (servings && !block.servings) block.servings = Math.max(1, Math.round(servings));
        const tags = get(row, 'tags');
        if (tags && !block.tags) block.tags = String(tags).split(/[,;|]/).map(cleanName).filter(Boolean);
        const category = get(row, 'category');
        if (category && !block.category) block.category = matchCategory(category);

        const amount = num(get(row, 'amount'));
        if (!(amount > 0)) {
          warnings.add(`„${ingName}“ in „${name}“ ohne Menge – übersprungen`);
          continue;
        }
        const conv = convertUnit(get(row, 'unit'));
        if (!conv) {
          warnings.add(`Einheit „${get(row, 'unit')}“ bei „${ingName}“ unbekannt – übersprungen`);
          continue;
        }
        if (conv.warn) warnings.add(conv.warn);
        const qty = Math.round(amount * conv.factor * 100) / 100;
        block.ingredients.push({ name: ingName, amount: qty, unit: conv.unit });

        // Nährwerte der Zeile (absolut) → pro 100 g zurückrechnen, falls kein Nährwert-Blatt
        if (conv.unit === 'g' && !derived.has(N.norm(ingName))) {
          const nutrients = {};
          for (const k of NUTRI_KEYS) {
            const v = num(get(row, k));
            if (v != null) nutrients[k] = N.round((v / qty) * 100);
          }
          if (nutrients.kcal != null) derived.set(N.norm(ingName), { name: ingName, nutrients });
        }
      }
      finishBlock();
    }

    for (const [key, val] of derived) if (!nutrition.has(key)) nutrition.set(key, val);

    return { recipes: [...recipes.values()], nutrition: [...nutrition.values()], plan, warnings: [...warnings] };
  }

  function dayIndex(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return null;
    const i = DAY_PREFIX.indexOf(s.slice(0, 2));
    return i >= 0 ? i : null;
  }
  function mealKey(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return null;
    const hit = MEAL_MAP.find(([re]) => re.test(s));
    return hit ? hit[1] : null;
  }
  function categoryFor(meal) {
    return { breakfast: 'Frühstück', snack: 'Snack' }[meal] || 'Hauptgericht';
  }
  function matchCategory(v) {
    const s = String(v).toLowerCase();
    if (/früh|frueh/.test(s)) return 'Frühstück';
    if (/snack/.test(s)) return 'Snack';
    if (/haupt|mittag|abend/.test(s)) return 'Hauptgericht';
    return 'Sonstiges';
  }

  async function parseFile(file) {
    const XLSX = await loadLib();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return parseWorkbook(XLSX, wb);
  }

  /** Leere Vorlage zum Ausfüllen herunterladen. */
  async function downloadTemplate() {
    const XLSX = await loadLib();
    const wb = XLSX.utils.book_new();
    const recipes = XLSX.utils.aoa_to_sheet([
      ['Gericht', 'Kategorie', 'Tags', 'Portionen', 'Zutat', 'Menge', 'Einheit', 'Zubereitung'],
      ['Overnight Oats', 'Frühstück', 'Schnell, Meal Prep', 1, 'Haferflocken', 60, 'g', 'Alles verrühren und über Nacht kühlen.'],
      ['Overnight Oats', 'Frühstück', '', 1, 'Milch', 150, 'g', ''],
      ['Overnight Oats', 'Frühstück', '', 1, 'Banane', 1, 'Stück', ''],
      [],
      ['Linsencurry', 'Hauptgericht', 'Vegan, Günstig', 3, 'Rote Linsen', 200, 'g', 'Zwiebel anschwitzen, Linsen und Kokosmilch 20 Min. köcheln.'],
      ['Linsencurry', 'Hauptgericht', '', 3, 'Kokosmilch', 400, 'ml', ''],
      ['Linsencurry', 'Hauptgericht', '', 3, 'Zwiebel', 1, 'Stück', ''],
    ]);
    const nutri = XLSX.utils.aoa_to_sheet([
      ['Zutat', 'kcal', 'Protein', 'Fett', 'Kohlenhydrate', 'Ballaststoffe'],
      ['Haferflocken', 370, 13.5, 7, 58.7, 10],
    ]);
    XLSX.utils.book_append_sheet(wb, recipes, 'Rezepte');
    XLSX.utils.book_append_sheet(wb, nutri, 'Nährwerte');
    XLSX.writeFile(wb, 'Planfood-Vorlage.xlsx');
  }

  return { parseFile, parseWorkbook, downloadTemplate, loadLib };
})();
