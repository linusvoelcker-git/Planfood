/*
 * Zutaten automatisch von Englisch nach Deutsch übersetzen – über ein eingebautes
 * Wörterbuch (kein Übersetzungsdienst, funktioniert offline). Unbekannte Namen bleiben unverändert.
 */
window.PF_TRANSLATE = (function () {
  // Englisch (Singular, klein) → Deutsch. Mehrwortbegriffe zuerst sinnvoll, Einzelwörter danach.
  const DICT = {
    // Milchprodukte & Eier
    egg: 'Ei', 'egg white': 'Eiweiß', 'egg yolk': 'Eigelb', milk: 'Milch', 'whole milk': 'Vollmilch', 'skim milk': 'Magermilch',
    'oat milk': 'Hafermilch', 'almond milk': 'Mandelmilch', 'soy milk': 'Sojamilch', 'coconut milk': 'Kokosmilch',
    butter: 'Butter', cream: 'Sahne', 'heavy cream': 'Sahne', 'whipping cream': 'Schlagsahne', 'sour cream': 'Saure Sahne',
    'cream cheese': 'Frischkäse', yogurt: 'Joghurt', yoghurt: 'Joghurt', 'greek yogurt': 'Griechischer Joghurt',
    'plain yogurt': 'Joghurt', 'cottage cheese': 'Hüttenkäse', quark: 'Magerquark', cheese: 'Käse', 'cheddar cheese': 'Cheddar',
    cheddar: 'Cheddar', parmesan: 'Parmesan', 'parmesan cheese': 'Parmesan', mozzarella: 'Mozzarella', feta: 'Feta',
    'feta cheese': 'Feta', ricotta: 'Ricotta', 'goat cheese': 'Ziegenkäse', 'whey protein': 'Proteinpulver',
    'protein powder': 'Proteinpulver', 'vegan protein powder': 'Veganes Proteinpulver',
    // Getreide, Brot, Backen
    oat: 'Haferflocken', oats: 'Haferflocken', 'rolled oat': 'Haferflocken', 'oat flake': 'Haferflocken', oatmeal: 'Haferflocken',
    'quick oat': 'Haferflocken', rice: 'Reis', 'brown rice': 'Naturreis', 'basmati rice': 'Basmatireis', 'jasmine rice': 'Jasminreis',
    spaghetti: 'Spaghetti', noodle: 'Nudeln', 'whole wheat pasta': 'Vollkornnudeln', quinoa: 'Quinoa',
    couscous: 'Couscous', bulgur: 'Bulgur', flour: 'Mehl', 'all purpose flour': 'Weizenmehl', 'all-purpose flour': 'Weizenmehl',
    'whole wheat flour': 'Vollkornmehl', 'almond flour': 'Mandelmehl', 'coconut flour': 'Kokosmehl', cornstarch: 'Speisestärke',
    'corn starch': 'Speisestärke', bread: 'Brot', 'whole grain bread': 'Vollkornbrot', 'whole wheat bread': 'Vollkornbrot',
    tortilla: 'Tortilla', 'baking powder': 'Backpulver',
    'baking soda': 'Natron', yeast: 'Hefe', sugar: 'Zucker', 'brown sugar': 'Brauner Zucker', 'powdered sugar': 'Puderzucker',
    honey: 'Honig', 'maple syrup': 'Ahornsirup', 'agave syrup': 'Agavendicksaft', 'vanilla extract': 'Vanilleextrakt',
    vanilla: 'Vanille', 'cocoa powder': 'Kakaopulver', cocoa: 'Kakaopulver', 'dark chocolate': 'Zartbitterschokolade',
    chocolate: 'Schokolade', 'chocolate chip': 'Schokotropfen', cereal: 'Müsli', muesli: 'Müsli',
    // Gemüse
    onion: 'Zwiebel', 'red onion': 'Rote Zwiebel', 'spring onion': 'Frühlingszwiebeln', 'green onion': 'Frühlingszwiebeln',
    scallion: 'Frühlingszwiebeln', shallot: 'Schalotte', garlic: 'Knoblauch', 'garlic clove': 'Knoblauch',
    tomato: 'Tomate', 'cherry tomato': 'Kirschtomaten', 'canned tomato': 'Gehackte Tomaten', 'crushed tomato': 'Gehackte Tomaten',
    'diced tomato': 'Gehackte Tomaten', 'tomato paste': 'Tomatenmark', 'tomato sauce': 'Passierte Tomaten', passata: 'Passierte Tomaten',
    potato: 'Kartoffeln', 'sweet potato': 'Süßkartoffel', carrot: 'Karotte', 'bell pepper': 'Paprika', pepper: 'Pfeffer',
    'red pepper': 'Paprika', 'green pepper': 'Paprika', 'chili pepper': 'Chili', chili: 'Chili', jalapeno: 'Jalapeño',
    cucumber: 'Gurke', zucchini: 'Zucchini', courgette: 'Zucchini', eggplant: 'Aubergine', aubergine: 'Aubergine',
    broccoli: 'Brokkoli', cauliflower: 'Blumenkohl', spinach: 'Spinat', 'baby spinach': 'Spinat', kale: 'Grünkohl',
    lettuce: 'Salat', 'romaine lettuce': 'Römersalat', arugula: 'Rucola', rocket: 'Rucola', cabbage: 'Weißkohl',
    'red cabbage': 'Rotkohl', mushroom: 'Champignons', 'button mushroom': 'Champignons', leek: 'Lauch', celery: 'Staudensellerie',
    corn: 'Mais', 'sweet corn': 'Mais', pea: 'Erbsen', 'green bean': 'Grüne Bohnen', asparagus: 'Spargel', avocado: 'Avocado',
    pumpkin: 'Kürbis', 'butternut squash': 'Butternutkürbis', beetroot: 'Rote Bete', beet: 'Rote Bete', radish: 'Radieschen',
    ginger: 'Ingwer', 'fresh ginger': 'Ingwer', olive: 'Oliven', 'sun-dried tomato': 'Getrocknete Tomaten',
    // Obst
    apple: 'Apfel', banana: 'Banane', orange: 'Orange', lemon: 'Zitrone', lime: 'Limette', 'lemon juice': 'Zitronensaft',
    'lime juice': 'Limettensaft', strawberry: 'Erdbeeren', blueberry: 'Heidelbeeren', raspberry: 'Himbeeren',
    blackberry: 'Brombeeren', berry: 'Beeren', 'mixed berry': 'Beeren', 'frozen berry': 'Beeren', cherry: 'Kirschen',
    grape: 'Weintrauben', pear: 'Birne', peach: 'Pfirsich', mango: 'Mango', pineapple: 'Ananas', kiwi: 'Kiwi',
    watermelon: 'Wassermelone', melon: 'Melone', date: 'Datteln', raisin: 'Rosinen', 'dried cranberry': 'Getrocknete Cranberries',
    coconut: 'Kokos', 'shredded coconut': 'Kokosraspeln', 'desiccated coconut': 'Kokosraspeln',
    // Hülsenfrüchte, Tofu
    chickpea: 'Kichererbsen', 'garbanzo bean': 'Kichererbsen', lentil: 'Linsen', 'red lentil': 'Rote Linsen',
    'black bean': 'Schwarze Bohnen', 'kidney bean': 'Kidneybohnen', 'white bean': 'Weiße Bohnen', bean: 'Bohnen',
    edamame: 'Edamame', tofu: 'Tofu', 'firm tofu': 'Tofu', 'silken tofu': 'Seidentofu', tempeh: 'Tempeh', seitan: 'Seitan',
    hummus: 'Hummus',
    // Fleisch & Fisch
    'chicken breast': 'Hähnchenbrust', chicken: 'Hähnchen', 'chicken thigh': 'Hähnchenschenkel', 'ground beef': 'Rinderhackfleisch',
    'minced beef': 'Rinderhackfleisch', beef: 'Rindfleisch', steak: 'Steak', pork: 'Schweinefleisch', bacon: 'Speck', ham: 'Schinken',
    turkey: 'Pute', 'turkey breast': 'Putenbrust', 'ground turkey': 'Putenhackfleisch', sausage: 'Wurst', salmon: 'Lachs',
    'salmon fillet': 'Lachs', tuna: 'Thunfisch', 'canned tuna': 'Thunfisch', shrimp: 'Garnelen', prawn: 'Garnelen', cod: 'Kabeljau',
    fish: 'Fisch',
    // Nüsse & Samen
    almond: 'Mandeln', walnut: 'Walnüsse', cashew: 'Cashewkerne', peanut: 'Erdnüsse', hazelnut: 'Haselnüsse', pecan: 'Pekannüsse',
    pistachio: 'Pistazien', 'brazil nut': 'Paranüsse', 'peanut butter': 'Erdnussbutter', 'almond butter': 'Mandelmus',
    'chia seed': 'Chiasamen', chia: 'Chiasamen', 'flax seed': 'Leinsamen', flaxseed: 'Leinsamen', 'sunflower seed': 'Sonnenblumenkerne',
    'pumpkin seed': 'Kürbiskerne', 'sesame seed': 'Sesam', sesame: 'Sesam', tahini: 'Tahini', 'hemp seed': 'Hanfsamen',
    // Öle, Saucen, Gewürze
    'olive oil': 'Olivenöl', 'extra virgin olive oil': 'Olivenöl', oil: 'Öl', 'vegetable oil': 'Pflanzenöl', 'coconut oil': 'Kokosöl',
    'sesame oil': 'Sesamöl', 'rapeseed oil': 'Rapsöl', 'canola oil': 'Rapsöl', vinegar: 'Essig', 'balsamic vinegar': 'Balsamico',
    'apple cider vinegar': 'Apfelessig', 'soy sauce': 'Sojasauce', 'tamari': 'Tamari', mustard: 'Senf', ketchup: 'Ketchup',
    mayonnaise: 'Mayonnaise', mayo: 'Mayonnaise', pesto: 'Pesto', 'vegetable broth': 'Gemüsebrühe', 'vegetable stock': 'Gemüsebrühe',
    'chicken broth': 'Hühnerbrühe', 'chicken stock': 'Hühnerbrühe', broth: 'Brühe', stock: 'Brühe', salt: 'Salz',
    'sea salt': 'Salz', 'black pepper': 'Pfeffer', paprika: 'Paprikapulver', 'smoked paprika': 'Geräuchertes Paprikapulver',
    cumin: 'Kreuzkümmel', turmeric: 'Kurkuma', cinnamon: 'Zimt', oregano: 'Oregano', basil: 'Basilikum', parsley: 'Petersilie',
    cilantro: 'Koriander', coriander: 'Koriander', thyme: 'Thymian', rosemary: 'Rosmarin', dill: 'Dill', mint: 'Minze',
    chive: 'Schnittlauch', nutmeg: 'Muskat', 'chili flake': 'Chiliflocken', 'red pepper flake': 'Chiliflocken',
    'curry powder': 'Currypulver', 'garam masala': 'Garam Masala', 'nutritional yeast': 'Hefeflocken', 'garlic powder': 'Knoblauchpulver',
    'onion powder': 'Zwiebelpulver', 'bay leaf': 'Lorbeerblatt',
    // Getränke & Sonstiges
    water: 'Wasser', coffee: 'Kaffee', 'orange juice': 'Orangensaft', juice: 'Saft', wine: 'Wein', 'white wine': 'Weißwein',
    'red wine': 'Rotwein', 'ice cube': 'Eiswürfel',
  };

  // Wörter, die vor der Suche weggelassen werden dürfen
  const FILLERS =
    /^(fresh|large|small|medium|big|ripe|chopped|diced|minced|sliced|grated|shredded|frozen|canned|tinned|cooked|raw|organic|boneless|skinless|unsalted|salted|whole|extra|virgin|finely|roughly|thinly|plain|light|low-fat|lowfat|dried|crushed|ground|toasted|roasted|peeled|halved|cubed|softened|melted|cold|warm|hot|lean|natural|unsweetened|sweetened|of)\s+/;

  function singular(w) {
    if (/ies$/.test(w)) return w.replace(/ies$/, 'y');
    if (/(tomato|potato|mango)es$/.test(w)) return w.replace(/es$/, '');
    if (/(ch|sh|x|ss)es$/.test(w)) return w.replace(/es$/, '');
    if (/[^s]s$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function lookup(phrase) {
    if (DICT[phrase]) return DICT[phrase];
    const words = phrase.split(' ');
    const last = singular(words[words.length - 1]);
    const sing = [...words.slice(0, -1), last].join(' ');
    return DICT[sing] || null;
  }

  /** Englischen Zutatennamen übersetzen; null, wenn nicht bekannt (oder schon deutsch). */
  function toGerman(name) {
    let p = String(name || '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z\s'-]/g, ' ') // Umlaute u. Ä. → ist vermutlich schon deutsch
      .replace(/\s+/g, ' ')
      .trim();
    if (!p || /[äöüß]/i.test(name)) return null;
    let hit = lookup(p);
    // Füllwörter vorne schrittweise entfernen („fresh baby spinach“ → „baby spinach“ → …)
    while (!hit && FILLERS.test(p)) {
      p = p.replace(FILLERS, '');
      hit = lookup(p);
    }
    if (!hit) return null;
    return hit.toLowerCase() === String(name).trim().toLowerCase() ? null : hit;
  }

  return { toGerman };
})();
