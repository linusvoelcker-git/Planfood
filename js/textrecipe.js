/*
 * Rezept aus Text erkennen – z. B. aus der Beschreibung eines YouTube-Videos oder der
 * Bildunterschrift eines Instagram-/TikTok-Posts. Läuft komplett im Browser, ohne Server.
 * Ergebnis ist ein Entwurf, der im Rezept-Editor geprüft und gespeichert wird.
 */
window.PF_TEXTRECIPE = (function () {
  // Einheit → [Zieleinheit, Faktor]. Löffel/Tassen sind Näherungen (1 ml ≈ 1 g).
  const UNITS = [
    [/^(kg|kilo(gramm)?)$/, 'g', 1000],
    [/^(g|gr|gramm)$/, 'g', 1],
    [/^mg$/, 'g', 0.001],
    [/^(l|liter)$/, 'g', 1000],
    [/^(ml|milliliter)$/, 'g', 1],
    [/^cl$/, 'g', 10],
    [/^dl$/, 'g', 100],
    [/^(el|essl[öo]ffel|tbsp|tablespoons?)$/, 'g', 15],
    [/^(tl|teel[öo]ffel|tsp|teaspoons?)$/, 'g', 5],
    [/^(tassen?|cups?|becher)$/, 'g', 240],
    [/^(prisen?|msp|messerspitzen?)$/, 'g', 1],
    [/^(handvoll|hand voll)$/, 'g', 30],
    [/^(dosen?|can|cans)$/, 'g', 400],
    [/^(oz|ounces?)$/, 'g', 28],
    [/^(lb|lbs|pounds?)$/, 'g', 454],
    [/^(stück|stk|st|pcs|pieces?|x)$/, 'Stück', 1],
    [/^(zehen?|scheiben?|bund|packungen?|pck|päckchen|pkg|beutel|zweige?|stangen?|blätter|blatt|knollen?|köpfe?|kopf)$/, 'Stück', 1],
  ];
  const NUMBER_WORDS = {
    ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, one: 1, a: 1, an: 1,
    zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fünf: 5, five: 5, sechs: 6, six: 6,
    halbe: 0.5, halber: 0.5, halbes: 0.5, halb: 0.5, half: 0.5,
  };
  const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
  const ADJECTIVES =
    /^(reife[rns]?|frische[rns]?|kleine[rns]?|große[rns]?|grosse[rns]?|mittelgroße[rns]?|gehackte[rns]?|gefrorene[rns]?|geriebene[rns]?|gekochte[rns]?|ungesüßte[rns]?|zimmerwarme[rns]?|weiche[rns]?|fresh|large|small|medium|ripe|chopped)\s+/i;

  // „200 Grad“, „10 Minuten“, „35 g Protein“ … sind keine Zutaten
  const NOT_FOOD =
    /^(grad|°|minuten|min|mins?|minutes?|sek(unden)?|stunden?|std|hours?|portionen|personen|servings?|protein|eiweiß|eiweiss|carbs|kohlenhydrate|kh|fett|fat|ballaststoffe|fiber|zucker|sugar)\b/i;
  const HEAD_INGREDIENTS = /^(zutaten|ingredients|du brauchst|was du brauchst|ihr braucht|einkaufsliste|zutatenliste)\b/i;
  const HEAD_STEPS = /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|und so geht'?s|instructions|method|directions|steps|schritte|how to)\b/i;
  const SPAM = /(https?:\/\/|www\.|link in (der )?bio|folg(e|t) (mir|uns)|follow|abonnier|subscribe|werbung|anzeige|rabattcode|discount|code\s*:)/i;
  const MACROS = /kcal|kalorien|calories|makros|macros|nährwerte/i;

  // Schlagwörter im Titel → Tags
  const TAG_WORDS = [
    [/vegan|pflanzlich/i, 'Vegan'],
    [/high.?protein|proteinreich|protein/i, 'High Protein'],
    [/meal.?prep/i, 'Meal Prep'],
    [/low.?carb|keto/i, 'Low Carb'],
    [/schnell|quick|blitz|\b\d+\s*min/i, 'Schnell'],
    [/günstig|budget|billig|cheap/i, 'Günstig'],
  ];
  const TAG_HASHTAGS = [
    [/#(vegan|plantbased|pflanzlich)/i, 'Vegan'],
    [/#(high ?protein|proteinreich|protein)\b/i, 'High Protein'],
    [/#(mealprep|meal_prep)/i, 'Meal Prep'],
    [/#(lowcarb|low_carb|keto)/i, 'Low Carb'],
    [/#(schnell|quick|easy|einfach|\d+min(uten)?|\d+minuterecipes?)/i, 'Schnell'],
    [/#(günstig|guenstig|budget|cheap|sparen)/i, 'Günstig'],
  ];

  const stripEmoji = (s) =>
    s
      .replace(/[☀-➿\u{1F000}-\u{1FAFF}️‍]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function platformOf(url) {
    if (!url) return null;
    if (/youtu\.?be/i.test(url)) return 'YouTube';
    if (/instagram\.com/i.test(url)) return 'Instagram';
    if (/tiktok\.com/i.test(url)) return 'TikTok';
    return 'Web';
  }

  /** Zahl am Anfang lesen: 200 | 1,5 | 1/2 | 1 1/2 | ½ | 1½ | 2-3 | ein */
  function readQuantity(s) {
    let m = s.match(/^(\d+)\s*([½¼¾⅓⅔⅛])/);
    if (m) return { qty: Number(m[1]) + FRACTIONS[m[2]], rest: s.slice(m[0].length) };
    m = s.match(/^([½¼¾⅓⅔⅛])/);
    if (m) return { qty: FRACTIONS[m[1]], rest: s.slice(m[0].length) };
    m = s.match(/^(\d+)\s+(\d+)\/(\d+)/);
    if (m) return { qty: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: s.slice(m[0].length) };
    m = s.match(/^(\d+)\/(\d+)/);
    if (m) return { qty: Number(m[1]) / Number(m[2]), rest: s.slice(m[0].length) };
    m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:-|–|bis|to)\s*(\d+(?:[.,]\d+)?)/);
    if (m) return { qty: (parseFloat(m[1].replace(',', '.')) + parseFloat(m[2].replace(',', '.'))) / 2, rest: s.slice(m[0].length) };
    m = s.match(/^(\d+(?:[.,]\d+)?)/);
    if (m) return { qty: parseFloat(m[1].replace(',', '.')), rest: s.slice(m[0].length) };
    m = s.match(/^([a-zäöü]+)\s+/i);
    if (m && NUMBER_WORDS[m[1].toLowerCase()] != null) return { qty: NUMBER_WORDS[m[1].toLowerCase()], rest: s.slice(m[0].length), word: true };
    return null;
  }

  /** Einheit am Anfang von rest lesen */
  function readUnit(rest) {
    const m = rest.match(/^\s*([a-zäöüß]+)\.?(?=\s|$|[,(])/i);
    if (!m) return null;
    const word = m[1].toLowerCase();
    for (const [re, unit, factor] of UNITS) if (re.test(word)) return { unit, factor, rest: rest.slice(m[0].length) };
    return null;
  }

  function cleanName(name) {
    let n = name
      .replace(/\([^)]*\)/g, ' ') // Klammern (Hinweise)
      .replace(/^\s*(von|vom|der|die|das|of)\s+/i, '')
      .replace(/\b(ca\.?|etwa|circa|nach (belieben|geschmack)|optional|to taste)\b/gi, ' ')
      .split(/,|;| – | - /)[0] // „Zwiebel, gewürfelt“ → „Zwiebel“
      .replace(/[:.*]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    n = n.replace(ADJECTIVES, '');
    return capitalize(n);
  }

  /** Eine Zeile als Zutat lesen → { name, amount, unit } oder null */
  function parseIngredient(line) {
    const s = stripEmoji(line)
      .replace(/^[-–•*·▪►▶✓✔☑︎>+]+\s*/, '')
      .trim();
    if (!s || s.length > 90) return null;
    if (/^\(?\d+[.)]\s/.test(s)) return null; // „1. Ofen vorheizen“ = Arbeitsschritt
    if (/kcal|kalorien|calories|makros|macros|nährwerte/i.test(s)) return null; // Nährwertangaben

    // Grammangabe in Klammern hat Vorrang: „1 Dose Kichererbsen (400 g)“
    const paren = s.match(/\((?:ca\.?\s*)?(\d+(?:[.,]\d+)?)\s*(g|gr|gramm|ml|kg)\b[^)]*\)/i);

    let qty;
    let unit = null;
    let name;
    const q = readQuantity(s);
    if (q) {
      qty = q.qty;
      const u = readUnit(q.rest);
      if (u) {
        unit = u;
        name = u.rest;
      } else {
        if (q.word && !/^\s*[A-ZÄÖÜ]/.test(q.rest)) return null; // „eine gute Idee …“
        name = q.rest;
      }
    } else if (readUnit(s) && /^(handvoll|hand voll|prisen?|dosen?|bund|packung|pck|päckchen|scheibe|zehe|tasse|becher)\b/i.test(s)) {
      // „Handvoll Erdbeeren“, „Prise Salz“ → Menge 1
      qty = 1;
      unit = readUnit(s);
      name = unit.rest;
    } else {
      // „Haferflocken: 60 g“ / „Haferflocken – 60g“
      const m = s.match(/^(.{2,50}?)\s*[:\-–]\s*(.+)$/);
      if (!m) return null;
      const q2 = readQuantity(m[2].trim());
      if (!q2) return null;
      qty = q2.qty;
      unit = readUnit(q2.rest);
      if (!unit && q2.rest.trim().length > 0 && !/^\s*(stück)?\s*$/i.test(q2.rest)) return null;
      name = m[1];
    }
    if (paren) {
      const v = parseFloat(paren[1].replace(',', '.'));
      unit = { unit: 'g', factor: /kg/i.test(paren[2]) ? 1000 : 1 };
      qty = v;
    }
    name = cleanName(name || '');
    if (!name || name.length < 2 || !(qty > 0)) return null;
    if (NOT_FOOD.test(name)) return null;
    if (/^\d/.test(name)) return null;

    const target = unit ? unit.unit : 'Stück';
    let amount = qty * (unit ? unit.factor : 1);
    amount = target === 'Stück' ? Math.max(0.5, Math.round(amount * 2) / 2) : Math.round(amount * 10) / 10;
    return { name, amount, unit: target };
  }

  function guessCategory(text) {
    const t = text.toLowerCase();
    if (/frühstück|breakfast|porridge|overnight|oats|pancake|pfannkuchen|müsli|granola|smoothie bowl|french toast|rührei/.test(t)) return 'Frühstück';
    if (/snack|riegel|bars?\b|bites|balls|energy|kekse|cookies|muffin|dip\b/.test(t)) return 'Snack';
    return 'Hauptgericht';
  }

  /**
   * Haupteinstieg.
   * @param {string} text  Beschreibung/Bildunterschrift
   * @param {{url?: string, title?: string}} opts
   */
  function parse(text, opts = {}) {
    const raw = String(text || '').replace(/\r/g, '');
    const url = opts.url || (raw.match(/https?:\/\/\S+/) || [])[0] || '';
    const lines = raw.split('\n').map((l) => l.trim());

    const ingredients = [];
    const steps = [];
    const skipped = [];
    let mode = null; // 'ing' | 'steps' | null
    let name = opts.title ? stripEmoji(opts.title) : '';
    let servings = null;

    for (const line of lines) {
      if (!line) continue;
      const plain = stripEmoji(line)
        .replace(/^[-–•*·▪►▶]+\s*/, '')
        .replace(/#[\p{L}\p{N}_]+/gu, '') // Hashtags
        .replace(/\s+/g, ' ')
        .trim();
      if (!plain) continue;
      const lower = plain.toLowerCase();

      const sv = lower.match(/(?:für|for|ergibt|makes|serves)\s*(\d+)\s*(portionen|personen|servings|people|stück|portion)?/) || lower.match(/(\d+)\s*(portionen|personen|servings)/);
      if (sv && !servings) servings = Math.max(1, Math.min(20, Number(sv[1])));

      if (HEAD_INGREDIENTS.test(plain)) {
        mode = 'ing';
        continue;
      }
      if (HEAD_STEPS.test(plain)) {
        mode = 'steps';
        continue;
      }
      if (sv && plain.length < 40 && !/^\d/.test(plain)) continue; // „Für 2 Portionen:“
      if (SPAM.test(plain) || MACROS.test(plain)) continue;

      if (mode !== 'steps') {
        const ing = parseIngredient(line);
        if (ing) {
          ingredients.push(ing);
          continue;
        }
      }
      // Zwischenüberschrift wie „Für die Sauce:“
      if (/:$/.test(plain) && plain.length < 40) continue;

      if (!name && plain.length >= 3 && plain.length <= 90) {
        name = plain.split(/\s[|•·]\s/)[0].replace(/[:!]+$/, '').trim();
        continue;
      }
      if (mode === 'ing' && plain.length < 50) {
        skipped.push(plain); // z. B. „Salz & Pfeffer“ ohne Menge
        continue;
      }
      if (mode === 'steps' || plain.length >= 25 || /^\d+[.)]/.test(plain)) {
        steps.push(plain);
        continue;
      }
      if (ingredients.length) skipped.push(plain);
    }

    const tags = [];
    for (const [re, tag] of TAG_HASHTAGS) if (re.test(raw) && !tags.includes(tag)) tags.push(tag);
    const firstLine = (lines.find((l) => l) || '') + ' ' + (opts.title || '');
    for (const [re, tag] of TAG_WORDS) if ((re.test(name) || re.test(firstLine)) && !tags.includes(tag)) tags.push(tag);

    // gleiche Zutat + Einheit zusammenfassen
    const merged = [];
    for (const ing of ingredients) {
      const same = merged.find((m) => m.name.toLowerCase() === ing.name.toLowerCase() && m.unit === ing.unit);
      if (same) same.amount = Math.round((same.amount + ing.amount) * 10) / 10;
      else merged.push({ ...ing });
    }

    return {
      name: name ? capitalize(name.slice(0, 80)) : '',
      servings: servings || 1,
      category: guessCategory(name + ' ' + raw.slice(0, 300)),
      ingredients: merged,
      instructions: steps.join('\n'),
      tags,
      skipped,
      sourceUrl: url,
      platform: platformOf(url),
    };
  }

  return { parse, parseIngredient, platformOf };
})();
