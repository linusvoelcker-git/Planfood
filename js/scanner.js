/*
 * Nährwerte per Kamera – komplett auf dem Gerät, ohne KI-Dienst und ohne Kosten:
 *  1. Barcode scannen → Produkt in Open Food Facts nachschlagen
 *  2. Foto der Nährwerttabelle → Texterkennung (Tesseract, läuft lokal) → Werte pro 100 g auslesen
 * Die Bibliotheken liegen in js/vendor und werden erst bei Bedarf geladen.
 */
window.PF_SCAN = (function () {
  const BASE = new URL('js/vendor/', document.baseURI).href;
  const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

  /* ---------- Bibliotheken nachladen ---------- */
  const loaded = {};
  function loadScript(file, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    loaded[file] ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = BASE + file;
      s.onload = () => resolve(window[globalName]);
      s.onerror = () => {
        delete loaded[file];
        reject(new Error('Bibliothek konnte nicht geladen werden'));
      };
      document.head.appendChild(s);
    });
    return loaded[file];
  }

  /* ---------- Barcode ---------- */
  let nativeDetector;
  async function getNativeDetector() {
    if (nativeDetector !== undefined) return nativeDetector;
    nativeDetector = null;
    try {
      if ('BarcodeDetector' in window) {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
        if (formats.length) nativeDetector = new window.BarcodeDetector({ formats });
      }
    } catch {
      nativeDetector = null;
    }
    return nativeDetector;
  }

  let zxingReader = null;
  async function zxingDecodeCanvas(canvas) {
    const ZXing = await loadScript('zxing.min.js', 'ZXing');
    if (!zxingReader) {
      zxingReader = new ZXing.MultiFormatReader();
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E,
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      zxingReader.setHints(hints);
    }
    try {
      const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
      return zxingReader.decode(bitmap).getText();
    } catch {
      return null; // kein Code im Bild
    }
  }

  /** Bild/Video-Frame → Barcode-Nummer oder null */
  async function detectIn(source, canvas) {
    const native = await getNativeDetector();
    if (native) {
      try {
        const codes = await native.detect(source);
        if (codes.length) return codes[0].rawValue;
      } catch {
        /* weiter mit ZXing */
      }
    }
    const w = source.videoWidth || source.width;
    const h = source.videoHeight || source.height;
    if (!w || !h) return null;
    // auf handliche Größe bringen (schneller und robuster)
    const scale = Math.min(1, 1280 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, canvas.width, canvas.height);
    return zxingDecodeCanvas(canvas);
  }

  /** Kamera starten und laufend nach Barcodes suchen. Gibt eine stop()-Funktion zurück. */
  async function startBarcodeScan(video, onCode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Kamera wird von diesem Browser nicht unterstützt');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const canvas = document.createElement('canvas');
    let running = true;
    const tick = async () => {
      if (!running) return;
      try {
        const code = await detectIn(video, canvas);
        if (code && running && isValidBarcode(code)) {
          running = false;
          stop();
          onCode(code);
          return;
        }
      } catch {
        /* nächster Versuch */
      }
      if (running) setTimeout(tick, 220);
    };
    const stop = () => {
      running = false;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
    tick();
    return stop;
  }

  /** Barcode aus einem Foto lesen */
  async function barcodeFromFile(file) {
    const img = await fileToImage(file);
    const canvas = document.createElement('canvas');
    let code = await detectIn(img, canvas);
    if (!code) {
      // zweiter Versuch mit kleinerem Ausschnitt-Maßstab
      const c2 = document.createElement('canvas');
      const scale = 800 / Math.max(img.width, img.height);
      c2.width = Math.round(img.width * scale);
      c2.height = Math.round(img.height * scale);
      c2.getContext('2d').drawImage(img, 0, 0, c2.width, c2.height);
      code = await zxingDecodeCanvas(c2);
    }
    return code && isValidBarcode(code) ? code : null;
  }

  /** Prüfziffer von EAN/UPC kontrollieren (vermeidet Fehllesungen) */
  function isValidBarcode(code) {
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
    const digits = code.split('').map(Number);
    const check = digits.pop();
    const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Bild konnte nicht gelesen werden'));
      };
      img.src = url;
    });
  }

  /* ---------- Foto der Nährwerttabelle (Texterkennung) ---------- */
  let ocrWorker = null;
  async function getOcrWorker(onProgress) {
    const Tesseract = await loadScript('tesseract/tesseract.min.js', 'Tesseract');
    if (ocrWorker) return ocrWorker;
    ocrWorker = Tesseract.createWorker('deu', 1, {
      workerPath: BASE + 'tesseract/worker.min.js',
      corePath: BASE + 'tesseract/core',
      langPath: BASE + 'tesseract/lang',
      logger: (m) => onProgress && onProgress(m),
    });
    try {
      return await ocrWorker;
    } catch (e) {
      ocrWorker = null;
      throw e;
    }
  }

  /** Bild für die Texterkennung aufbereiten: Graustufen, Kontrast, ausreichende Größe */
  function prepareImage(img) {
    const scale = Math.min(2.5, Math.max(1, 1800 / Math.max(img.width, img.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    // Graustufen + Schwellwert nach Otsu (Schwarz/Weiß hilft der Texterkennung bei Fotos)
    const gray = new Uint8ClampedArray(px.length / 4);
    const hist = new Array(256).fill(0);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      hist[gray[j]]++;
    }
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = gray.length - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
      if (between > best) {
        best = between;
        threshold = t;
      }
    }
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const v = gray[j] > threshold ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  async function nutritionFromLabelPhoto(file, onProgress) {
    const img = await fileToImage(file);
    const report = (stage, p) => onProgress && onProgress(stage, p);
    report('load', 0);
    const worker = await getOcrWorker((m) => {
      if (m.status === 'recognizing text') report('read', m.progress);
      else if (/loading|initializ/.test(m.status)) report('load', m.progress || 0);
    });
    report('read', 0);
    const { data } = await worker.recognize(prepareImage(img));
    const result = parseNutritionText(data.text);
    result.text = data.text;
    return result;
  }

  /*
   * Text einer Nährwerttabelle auswerten. Genommen wird je Zeile die erste Zahl hinter
   * der Bezeichnung – das ist auf deutschen Etiketten die Spalte „pro 100 g / 100 ml“.
   */
  const LABELS = [
    ['satFat', /(ges[äa]ttigt|fetts[äa]ure|saturat)/],
    ['sugar', /(zucker|sugar)/],
    ['fat', /(^|[^a-zäöü])(fett|fat)(?!s)/],
    ['carbs', /(kohlenhydrat|carbohydrat)/],
    ['fiber', /(ballaststoff|fibre|fiber)/],
    ['protein', /(eiwei[ßsb8]|protein)/],
    ['salt', /(salz|salt)/],
  ];

  function toNumber(s) {
    return parseFloat(
      s
        .replace(/[oO]/g, '0') // häufige Verwechslung
        .replace(/[lI|]/g, '1')
        .replace(',', '.')
    );
  }

  /** „O,13“ → „0,13“, „5O g“ → „50 g“ (Texterkennung verwechselt O und 0) */
  const fixDigits = (l) =>
    l
      .replace(/(\d)[oO]/g, '$10')
      .replace(/(\d)[oO]/g, '$10')
      .replace(/(^|[\s<(\/])[oO](?=[,.]?\d)/g, '$10');

  function parseNutritionText(text) {
    const nutrients = {};
    const warnings = [];
    const lines = String(text || '')
      .split('\n')
      .map((l) => fixDigits(l.trim()))
      .filter(Boolean);

    // Energie: erste Angabe zählt (= pro 100 g). Steht dort kJ und direkt danach die passende
    // kcal-Zahl, wird die genommen – sonst kJ umrechnen (die kcal-Zahl wird öfter verlesen).
    const all = lines.join(' ').toLowerCase();
    const energy = [...all.matchAll(/(\d+(?:[.,]\d+)?)\s*(k\s*j|k\s*ca[l1i])/g)].map((x) => ({
      v: toNumber(x[1]),
      kj: /j/.test(x[2]),
    }));
    if (energy.length) {
      const [a, b2] = energy;
      if (!a.kj) nutrients.kcal = a.v;
      else if (b2 && !b2.kj && Math.abs(b2.v - a.v / 4.184) <= a.v / 4.184 * 0.08) nutrients.kcal = b2.v;
      else nutrients.kcal = Math.round(a.v / 4.184);
    }

    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const [key, re] of LABELS) {
        if (nutrients[key] != null || !re.test(lower)) continue;
        // „gesättigte Fettsäuren“ ist nicht „Fett“ (steht der Fettwert in derselben Zeile davor, zählt er trotzdem)
        if (key === 'fat' && /(ges[äa]ttigt|s[äa]ure)/.test(lower.slice(0, lower.search(re) + 12))) continue;
        // Zahlen nach der Bezeichnung; die erste ist „pro 100 g“, „<0,5“ → 0,5
        const after = lower.slice(lower.search(re)).replace(/^[^\d<]*/, '');
        const tokens = [...after.matchAll(/(\d+(?:[.,]\d+)?)(\s*g)?/g)].map((x) => ({ raw: x[1], unit: !!x[2] }));
        if (!tokens.length) continue;
        let raw = tokens[0].raw;
        // Texterkennung liest „g“ gern als „9“: „13 g“ → „139“, „6,5g“ → „6,59“, „60 g“ → „609g“.
        // Die 9 wird abgeschnitten, wenn der Wert sonst über 100 g läge, wenn eine Dezimalzahl
        // ohne folgendes „g“ auf 9 endet oder alle Zahlen der Zeile auf 9 enden.
        const endsWith9 = (t) => /\d9$/.test(t.raw) || /[.,]\d*9$/.test(t.raw);
        const value = toNumber(raw);
        const decimals = (raw.split(/[.,]/)[1] || '').length;
        const noUnit = !tokens[0].unit; // steht direkt ein „g“ dahinter, war die 9 echt
        if (
          /9$/.test(raw) &&
          raw.length > 1 &&
          (value > 100 || (noUnit && decimals >= 2) || (noUnit && tokens.length > 1 && tokens.slice(0, 2).every(endsWith9)))
        ) {
          raw = raw.slice(0, -1).replace(/[.,]$/, '');
        }
        nutrients[key] = toNumber(raw); // mehrere Werte pro Zeile möglich („Kohlenhydrate 60 g davon Zucker 1 g“)
      }
    }

    // Plausibilität: pro 100 g kann kein Wert über 100 g liegen
    for (const k of ['fat', 'satFat', 'carbs', 'sugar', 'fiber', 'protein', 'salt']) {
      if (nutrients[k] > 100) {
        // oft fehlt das Komma: 125 → 12,5
        nutrients[k] = nutrients[k] / 10;
        warnings.push(`${k}`);
      }
    }
    if (nutrients.kcal > 900) {
      nutrients.kcal = Math.round(nutrients.kcal / 10);
      warnings.push('kcal');
    }
    // „davon …“ kann nicht größer sein als der Oberwert – meist fehlt das Komma (1,2 → 12)
    const fixPart = (part, whole) => {
      if (nutrients[part] == null || nutrients[whole] == null || nutrients[part] <= nutrients[whole]) return;
      if (nutrients[part] / 10 <= nutrients[whole]) nutrients[part] = nutrients[part] / 10;
      warnings.push(part);
    };
    fixPart('sugar', 'carbs');
    fixPart('satFat', 'fat');
    // Energie gegen Makros prüfen (4/4/9 kcal pro g)
    if (nutrients.kcal != null && nutrients.fat != null && nutrients.carbs != null && nutrients.protein != null) {
      const calc = nutrients.fat * 9 + nutrients.carbs * 4 + nutrients.protein * 4 + (nutrients.fiber || 0) * 2;
      if (Math.abs(calc - nutrients.kcal) > Math.max(40, nutrients.kcal * 0.25)) warnings.push('kcal');
    }
    return { nutrients, found: Object.keys(nutrients), warnings: [...new Set(warnings)] };
  }

  return { startBarcodeScan, barcodeFromFile, isValidBarcode, nutritionFromLabelPhoto, parseNutritionText };
})();
