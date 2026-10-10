/*
 * Nährwert-Erkennung: eingebaute Tabelle, Open Food Facts und USDA FoodData Central.
 * Alle Werte werden auf "pro 100 g" normalisiert.
 */
window.PF_NUTRITION = (function () {
  // Reihenfolge = Anzeige-Reihenfolge
  const NUTRIENTS = [
    { key: 'kcal', label: 'Energie', unit: 'kcal', macro: true },
    { key: 'protein', label: 'Eiweiß', unit: 'g', macro: true },
    { key: 'carbs', label: 'Kohlenhydrate', unit: 'g', macro: true },
    { key: 'fat', label: 'Fett', unit: 'g', macro: true },
    { key: 'fiber', label: 'Ballaststoffe', unit: 'g', macro: true },
    { key: 'sugar', label: 'Zucker', unit: 'g' },
    { key: 'satFat', label: 'ges. Fettsäuren', unit: 'g' },
    { key: 'salt', label: 'Salz', unit: 'g' },
    { key: 'vitA', label: 'Vitamin A', unit: 'µg' },
    { key: 'vitC', label: 'Vitamin C', unit: 'mg' },
    { key: 'vitD', label: 'Vitamin D', unit: 'µg' },
    { key: 'vitB12', label: 'Vitamin B12', unit: 'µg' },
    { key: 'folate', label: 'Folat', unit: 'µg' },
    { key: 'calcium', label: 'Calcium', unit: 'mg' },
    { key: 'iron', label: 'Eisen', unit: 'mg' },
    { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
    { key: 'potassium', label: 'Kalium', unit: 'mg' },
    { key: 'zinc', label: 'Zink', unit: 'mg' },
  ];

  const norm = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

  /* ---------- eingebaute Tabelle ---------- */
  function localMatches(query) {
    const q = norm(query);
    if (!q) return [];
    const scored = [];
    for (const f of window.PF_FOODS) {
      const names = [f.name, ...f.aliases].map(norm);
      let score = 0;
      if (names.includes(q)) score = 3;
      else if (names.some((n) => n.startsWith(q) || q.startsWith(n))) score = 2;
      else if (names.some((n) => n.includes(q) || q.includes(n))) score = 1;
      if (score) scored.push({ score, f });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ f }) => ({
      source: 'Eingebaut',
      name: f.name,
      nutrients: { ...f.nutrients },
      gramsPerPiece: f.gramsPerPiece,
    }));
  }

  /** Beste automatische Zuordnung (nur bei eindeutigem Treffer). */
  function autoDetect(name) {
    const q = norm(name);
    if (!q) return null;
    for (const f of window.PF_FOODS) {
      if ([f.name, ...f.aliases].map(norm).includes(q)) {
        return { source: 'Eingebaut', name: f.name, nutrients: { ...f.nutrients }, gramsPerPiece: f.gramsPerPiece };
      }
    }
    return null;
  }

  /* ---------- Open Food Facts ---------- */
  const OFF_MAP = {
    kcal: ['energy-kcal_100g', 1],
    protein: ['proteins_100g', 1],
    carbs: ['carbohydrates_100g', 1],
    fat: ['fat_100g', 1],
    fiber: ['fiber_100g', 1],
    sugar: ['sugars_100g', 1],
    satFat: ['saturated-fat_100g', 1],
    salt: ['salt_100g', 1],
    // OFF speichert Mikronährstoffe in g/100 g
    vitA: ['vitamin-a_100g', 1e6],
    vitC: ['vitamin-c_100g', 1e3],
    vitD: ['vitamin-d_100g', 1e6],
    vitB12: ['vitamin-b12_100g', 1e6],
    folate: ['vitamin-b9_100g', 1e6],
    calcium: ['calcium_100g', 1e3],
    iron: ['iron_100g', 1e3],
    magnesium: ['magnesium_100g', 1e3],
    potassium: ['potassium_100g', 1e3],
    zinc: ['zinc_100g', 1e3],
  };

  function mapOffNutriments(n = {}) {
    const nutrients = {};
    for (const [key, [field, factor]] of Object.entries(OFF_MAP)) {
      const v = parseFloat(n[field]);
      if (!isNaN(v)) nutrients[key] = round(v * factor);
    }
    if (nutrients.kcal == null && n['energy_100g'] != null) nutrients.kcal = round(parseFloat(n['energy_100g']) / 4.184);
    return nutrients;
  }

  /** Produkt per Barcode (EAN) nachschlagen → { name, nutrients, ref } oder null */
  async function fetchOffProduct(code) {
    const url =
      'https://world.openfoodfacts.org/api/v2/product/' +
      encodeURIComponent(code) +
      '.json?fields=code,product_name,product_name_de,brands,nutriments';
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Open Food Facts: HTTP ' + res.status);
    const data = await res.json();
    if (!data || data.status !== 1 || !data.product) return null;
    const p = data.product;
    const name = p.product_name_de || p.product_name || '';
    return {
      source: 'Open Food Facts',
      name: name ? (p.brands ? `${name} · ${p.brands.split(',')[0]}` : name) : `Produkt ${code}`,
      nutrients: mapOffNutriments(p.nutriments),
      ref: code,
    };
  }

  async function searchOpenFoodFacts(query) {
    const url =
      'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=12&lc=de' +
      '&fields=code,product_name,product_name_de,brands,nutriments&search_terms=' +
      encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open Food Facts: HTTP ' + res.status);
    const data = await res.json();
    return (data.products || [])
      .map((p) => {
        const nutrients = mapOffNutriments(p.nutriments);
        const name = p.product_name_de || p.product_name || '(ohne Namen)';
        return {
          source: 'Open Food Facts',
          name: p.brands ? `${name} · ${p.brands.split(',')[0]}` : name,
          nutrients,
          gramsPerPiece: null,
          ref: p.code,
        };
      })
      .filter((r) => r.nutrients.kcal != null);
  }

  /* ---------- USDA FoodData Central ---------- */
  const FDC_MAP = {
    '208': 'kcal',
    '203': 'protein',
    '205': 'carbs',
    '204': 'fat',
    '291': 'fiber',
    '269': 'sugar',
    '606': 'satFat',
    '307': 'sodium',
    '320': 'vitA',
    '401': 'vitC',
    '328': 'vitD',
    '418': 'vitB12',
    '435': 'folate',
    '301': 'calcium',
    '303': 'iron',
    '304': 'magnesium',
    '306': 'potassium',
    '309': 'zinc',
  };

  async function searchUSDA(query, apiKey) {
    const url =
      'https://api.nal.usda.gov/fdc/v1/foods/search?pageSize=12&dataType=Foundation,SR%20Legacy&api_key=' +
      encodeURIComponent(apiKey || 'DEMO_KEY') +
      '&query=' +
      encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error('USDA: HTTP ' + res.status);
    const data = await res.json();
    return (data.foods || []).map((f) => {
      const raw = {};
      let atwater = null;
      for (const fn of f.foodNutrients || []) {
        const num = String(fn.nutrientNumber || '');
        if (FDC_MAP[num] && fn.value != null) raw[FDC_MAP[num]] = fn.value;
        if ((num === '957' || num === '958') && fn.value != null && atwater == null) atwater = fn.value;
      }
      if (raw.kcal == null && atwater != null) raw.kcal = atwater;
      // USDA-Kohlenhydrate enthalten Ballaststoffe -> auf EU-Konvention umrechnen
      if (raw.carbs != null && raw.fiber != null) raw.carbs = Math.max(0, raw.carbs - raw.fiber);
      if (raw.sodium != null) raw.salt = (raw.sodium * 2.5) / 1000;
      delete raw.sodium;
      const nutrients = {};
      for (const [k, v] of Object.entries(raw)) nutrients[k] = round(v);
      return { source: 'USDA', name: f.description, nutrients, gramsPerPiece: null, ref: f.fdcId };
    });
  }

  /* ---------- Rechnen ---------- */
  function round(v) {
    if (v == null || isNaN(v)) return v;
    return Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  }

  /** Gramm einer Zutat (Stück -> Gramm über gramsPerPiece). null = unbekannt. */
  // Einheiten im Rezept. Für die Nährwerte wird in Gramm umgerechnet:
  // ml ≈ g (Dichte von Wasser), TL/EL = durchschnittliche Löffelmengen.
  const UNITS = ['g', 'ml', 'l', 'EL', 'TL', 'Stück'];
  const UNIT_GRAMS = { g: 1, ml: 1, l: 1000, EL: 15, TL: 5 };

  function gramsOf(amount, unit, info) {
    if (UNIT_GRAMS[unit]) return amount * UNIT_GRAMS[unit];
    if (info && info.gramsPerPiece) return amount * info.gramsPerPiece;
    return null;
  }

  function emptyTotals() {
    return { values: {}, missing: [] };
  }

  /** Addiert Nährwerte einer Zutatenmenge (grams) in totals. */
  function addTo(totals, nutrients, grams) {
    for (const [k, v] of Object.entries(nutrients || {})) {
      if (v == null || isNaN(v)) continue;
      totals.values[k] = (totals.values[k] || 0) + (v * grams) / 100;
    }
  }

  function mergeTotals(target, src, factor = 1) {
    for (const [k, v] of Object.entries(src.values)) target.values[k] = (target.values[k] || 0) + v * factor;
    for (const m of src.missing) if (!target.missing.includes(m)) target.missing.push(m);
  }

  function format(key, value) {
    const def = NUTRIENTS.find((n) => n.key === key);
    if (value == null || isNaN(value)) return '–';
    const digits = value >= 100 || key === 'kcal' ? 0 : 1;
    return value.toLocaleString('de-DE', { maximumFractionDigits: digits }) + ' ' + (def ? def.unit : '');
  }

  return {
    NUTRIENTS,
    norm,
    localMatches,
    autoDetect,
    searchOpenFoodFacts,
    fetchOffProduct,
    searchUSDA,
    gramsOf,
    UNITS,
    UNIT_GRAMS,
    emptyTotals,
    addTo,
    mergeTotals,
    format,
    round,
  };
})();
