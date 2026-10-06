/*
 * Planfood – Oberfläche: Kalender, Rezeptkartei, Einkaufsliste, Editor, Archiv.
 */
(function () {
  const S = window.PF_STORE;
  const N = window.PF_NUTRITION;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ui = {
    viewStart: S.currentWeekStart(),
    tab: 'cards',
    search: '',
    detail: null, // { recipeId, entryUid }
    tagFilter: new Set(), // aktive Tag-Filter (UND-verknüpft)
    drag: null, // { type: 'recipe'|'entry', id }
  };

  /* ================= Hilfsfunktionen ================= */
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const SHORT_DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  function weekLabel(start) {
    const a = S.parseISO(start);
    const b = S.addDays(a, 6);
    const range =
      a.getMonth() === b.getMonth()
        ? `${a.getDate()}.–${b.getDate()}. ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
        : `${a.getDate()}. ${MONTHS[a.getMonth()]} – ${b.getDate()}. ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
    return { kw: `KW ${S.isoWeekNumber(a)}`, range };
  }

  function fmtNum(v, digits = 0) {
    return Number(v).toLocaleString('de-DE', { maximumFractionDigits: digits });
  }

  function fmtAmount(amount, unit) {
    if (!unit) return '';
    if (unit === 'g') return amount >= 1000 ? `${fmtNum(amount / 1000, 2)} kg` : `${fmtNum(amount)} g`;
    const whole = Math.floor(amount);
    const half = Math.abs(amount - whole - 0.5) < 0.01;
    const text = half ? `${whole || ''}½` : fmtNum(amount, 2);
    return `${text} Stück`;
  }

  function macroLine(values) {
    const g = (k) => fmtNum(values[k] || 0);
    return `E ${g('protein')} g · KH ${g('carbs')} g · F ${g('fat')} g`;
  }

  function tagsOf(recipe) {
    return (recipe.tags || []).map(S.getTag).filter(Boolean);
  }
  function tagPill(tag, extra = '') {
    return `<span class="tag ${extra}" style="--t:${tag.color}">${esc(tag.name)}</span>`;
  }

  function infoFor(name) {
    return S.ingredientInfo(name) || N.autoDetect(name);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function openDialog(dlg) {
    if (!dlg.open) dlg.showModal();
  }

  function currentWeek() {
    return S.getWeek(ui.viewStart);
  }
  function isReadOnly() {
    const w = currentWeek();
    return !!(w && w.archived);
  }

  /* ================= Kopfzeile ================= */
  function renderHeader() {
    const { kw, range } = weekLabel(ui.viewStart);
    $('#weekTitle').textContent = kw;
    $('#weekRange').textContent = range;
    $('#todayBtn').disabled = ui.viewStart === S.currentWeekStart();

    const banner = $('#weekBanner');
    const w = currentWeek();
    if (w && w.archived) {
      banner.hidden = false;
      banner.innerHTML = `🗂 Diese Woche ist archiviert und nur zur Ansicht.
        <button class="btn btn-sm" data-act="reopen">Wieder öffnen</button>
        <button class="btn btn-sm" data-act="copy-to-current">In aktuelle Woche übernehmen</button>`;
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }

  /* ================= Kalender ================= */
  function renderCalendar() {
    const cal = $('#calendar');
    const week = currentWeek();
    const ro = isReadOnly();
    const start = S.parseISO(ui.viewStart);
    const todayISO = S.isoDate(new Date());
    const totals = week ? S.dayTotals(week) : null;

    let html = '<div class="cal-corner"></div>';
    for (let d = 0; d < 7; d++) {
      const date = S.addDays(start, d);
      const isToday = S.isoDate(date) === todayISO;
      html += `<div class="cal-day${isToday ? ' today' : ''}">
        <span class="dname">${S.DAY_NAMES[d]}</span>
        <span class="ddate">${date.getDate()}.${date.getMonth() + 1}.</span>
      </div>`;
    }

    for (const meal of S.MEALS) {
      html += `<div class="cal-meal"><span>${meal.label}</span></div>`;
      for (let d = 0; d < 7; d++) {
        const list = (week && week.slots[d] && week.slots[d][meal.key]) || [];
        html += `<div class="slot${ro ? ' readonly' : ''}" data-day="${d}" data-meal="${meal.key}">`;
        for (const e of list) html += entryHTML(week, e, ro);
        if (!list.length && !ro) html += '<span class="slot-empty">＋</span>';
        html += '</div>';
      }
    }

    html += '<div class="cal-meal cal-total-label"><span>Tagessumme</span></div>';
    for (let d = 0; d < 7; d++) {
      const t = totals && totals[d];
      const kcal = t && t.values.kcal;
      html += `<div class="day-total">${
        kcal ? `<strong>${fmtNum(kcal)} kcal</strong><span>${macroLine(t.values)}</span>` : '<span class="muted">–</span>'
      }</div>`;
    }
    cal.innerHTML = html;
  }

  function entryHTML(week, e, ro) {
    const recipe = S.getRecipe(e.recipeId, week);
    if (!recipe) return '';
    const st = S.entryStatus(week, e);
    const cls = st ? (st.ok ? ' status-ok' : ' status-missing') : '';
    const title = st
      ? st.ok
        ? 'Alle Zutaten vorhanden'
        : 'Es fehlen noch: ' + st.missing.join(', ')
      : '';
    return `<div class="entry${cls}" ${ro ? '' : 'draggable="true"'} data-uid="${e.uid}" style="--c:${recipe.color}" title="${esc(title)}" tabindex="0">
      <span class="entry-name">${esc(recipe.name)}</span>
      <span class="entry-meta">
        ${
          ro
            ? `<span>${fmtNum(e.servings, 1)} P.</span>`
            : `<button class="mini" data-act="minus" aria-label="Weniger Portionen">−</button><span>${fmtNum(e.servings, 1)} P.</span><button class="mini" data-act="plus" aria-label="Mehr Portionen">+</button>`
        }
        ${st ? `<span class="entry-status">${st.ok ? '✓' : '✗'} ${st.have}/${st.total}</span>` : ''}
      </span>
      ${ro ? '' : '<button class="entry-remove" data-act="remove" aria-label="Aus Plan entfernen">×</button>'}
    </div>`;
  }

  /* ================= Wochen-Nährwerte ================= */
  function renderSummary() {
    const week = currentWeek();
    const quick = $('#summaryQuick');
    const body = $('#summaryBody');
    const days = week ? S.dayTotals(week) : [];
    const activeDays = days.filter((d) => d.values.kcal);
    if (!activeDays.length) {
      quick.textContent = 'Noch nichts geplant';
      body.innerHTML = '<p class="muted pad">Ziehe Rezepte aus der Kartei in den Kalender, dann erscheinen hier die Nährwerte.</p>';
      return;
    }
    const total = N.emptyTotals();
    days.forEach((d) => N.mergeTotals(total, d));
    const n = activeDays.length;
    quick.textContent = `Ø ${fmtNum(total.values.kcal / n)} kcal/Tag · ${macroLine(
      Object.fromEntries(Object.entries(total.values).map(([k, v]) => [k, v / n]))
    )}`;

    let rows = '';
    for (const def of N.NUTRIENTS) {
      const v = total.values[def.key];
      if (v == null && !def.macro) continue;
      rows += `<tr><th>${def.label}</th><td>${N.format(def.key, v || 0)}</td><td>${N.format(def.key, (v || 0) / n)}</td></tr>`;
    }
    const missing = total.missing.length
      ? `<p class="warn">⚠ Ohne Nährwerte (nicht mitgezählt): ${total.missing
          .map((m) => `<button class="link" data-act="lookup" data-name="${esc(m)}">${esc(m)}</button>`)
          .join(', ')}</p>`
      : '';
    body.innerHTML = `<table class="nutri-table">
        <thead><tr><th></th><th>Woche gesamt</th><th>Ø pro Tag (${n} ${n === 1 ? 'Tag' : 'Tage'})</th></tr></thead>
        <tbody>${rows}</tbody></table>
      ${missing}
      <p class="muted small">Mikronährstoffe erscheinen, sobald Zutaten Werte aus Open Food Facts oder USDA haben.</p>`;
  }

  /* ================= Rezeptkartei ================= */
  function renderCards() {
    const inner = $('#cardboxInner');
    const q = N.norm(ui.search);
    // gelöschte Tags aus dem Filter werfen
    for (const id of ui.tagFilter) if (!S.getTag(id)) ui.tagFilter.delete(id);
    const matchesSearch = (r) => !q || N.norm(r.name).includes(q) || r.ingredients.some((i) => N.norm(i.name).includes(q));
    const matchesTags = (r) => [...ui.tagFilter].every((id) => (r.tags || []).includes(id));
    const recipes = S.state.recipes.filter((r) => matchesSearch(r) && matchesTags(r));
    renderTagFilter(S.state.recipes.filter(matchesSearch), recipes.length);
    if (!recipes.length) {
      const filtered = q || ui.tagFilter.size;
      inner.innerHTML = `<div class="cardbox-empty">${filtered ? 'Kein Rezept passt zu Suche/Filter.' : 'Noch keine Rezepte – leg dein erstes an!'}</div>`;
      return;
    }
    let html = '';
    let i = 0;
    for (const cat of S.CATEGORIES) {
      const list = recipes.filter((r) => (r.category || 'Sonstiges') === cat).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      if (!list.length) continue;
      html += `<div class="divider"><span class="divider-tab">${esc(cat)}</span></div>`;
      list.forEach((r, k) => {
        const per = S.recipePerServing(r);
        const kcal = per.values.kcal;
        html += `<article class="rcard" draggable="true" tabindex="0" data-id="${r.id}" style="--c:${r.color};--tab:${(k % 3) * 27}%;--i:${i++}">
          <div class="rcard-tab"><span>${esc(r.name)}</span></div>
          <div class="rcard-body">
            <div class="rcard-meta">
              <span>${r.servings} ${r.servings === 1 ? 'Portion' : 'Portionen'}</span>
              <span class="rcard-dots">${tagsOf(r)
                .map((t) => `<i style="--t:${t.color}" title="${esc(t.name)}"></i>`)
                .join('')}</span>
              ${kcal ? `<span class="kcal">${fmtNum(kcal)} kcal</span>` : ''}
            </div>
            <div class="rcard-tags">${tagsOf(r).map((t) => tagPill(t, 'small')).join('')}</div>
            <ul class="rcard-ings">${r.ingredients
              .slice(0, 4)
              .map((ing) => `<li><span>${esc(ing.name)}</span><span>${fmtAmount(ing.amount, ing.unit)}</span></li>`)
              .join('')}${r.ingredients.length > 4 ? `<li class="more">+ ${r.ingredients.length - 4} weitere</li>` : ''}</ul>
            ${kcal ? `<div class="rcard-macros">pro Portion: ${macroLine(per.values)}</div>` : ''}
          </div>
        </article>`;
      });
    }
    inner.innerHTML = html;
  }

  /** Filterleiste über der Kartei: Tags als farbige Chips mit Trefferanzahl. */
  function renderTagFilter(pool, shown) {
    const bar = $('#tagFilter');
    if (!S.state.tags.length) {
      bar.innerHTML = '';
      return;
    }
    bar.innerHTML =
      S.state.tags
        .map((t) => {
          const on = ui.tagFilter.has(t.id);
          const count = pool.filter((r) => (r.tags || []).includes(t.id)).length;
          return `<button class="tag filter${on ? ' active' : ''}" data-tag="${t.id}" style="--t:${t.color}" aria-pressed="${on}">${esc(t.name)}<span class="tag-count">${count}</span></button>`;
        })
        .join('') +
      (ui.tagFilter.size
        ? `<button class="tag-reset" data-tag-reset>✕ Filter (${shown})</button>`
        : '');
  }

  /* ================= Einkaufsliste ================= */
  // läuft automatisch mit dem Kalender mit – kein extra Knopf nötig
  function renderShopping() {
    const panel = $('#shoppingPanel');
    const week = currentWeek();
    const ro = isReadOnly();
    const badge = $('#shoppingBadge');
    const { kw } = weekLabel(ui.viewStart);
    const items = S.shoppingItems(week);
    const done = items.filter((i) => i.checked).length;
    const open = items.length - done;

    badge.hidden = !items.length;
    badge.textContent = `${done}/${items.length}`;
    // kleiner Hüpfer, wenn neue Einträge dazukommen
    if (ui.lastOpen != null && ui.lastWeek === ui.viewStart && open > ui.lastOpen) {
      badge.classList.remove('bump');
      void badge.offsetWidth;
      badge.classList.add('bump');
    }
    ui.lastOpen = open;
    ui.lastWeek = ui.viewStart;

    const addForm = ro
      ? ''
      : `<form class="add-item" data-act="add-item">
          <input name="item" placeholder="Weiteres hinzufügen (z. B. Spülmittel)" aria-label="Eigener Eintrag" />
          <button class="btn btn-sm">＋</button>
        </form>`;

    if (!items.length) {
      panel.innerHTML = `<div class="empty-state">
        <div class="empty-icon">🧺</div>
        <h3>Einkaufsliste · ${kw}</h3>
        <p class="muted">Zieh Rezepte in den Kalender – ihre Zutaten landen automatisch hier.</p>
      </div>${addForm}`;
      return;
    }

    const sorted = [...items].sort((a, b) => a.checked - b.checked || a.name.localeCompare(b.name, 'de'));
    const pct = Math.round((done / items.length) * 100);
    const sub = (i) => {
      if (i.extraTo) return `<span class="sitem-sub extra">＋ zusätzlich (${fmtAmount(i.extraTo, i.unit)} schon abgehakt)</span>`;
      return i.recipes && i.recipes.length ? `<span class="sitem-sub">${esc(i.recipes.join(', '))}</span>` : '';
    };

    panel.innerHTML = `<div class="shop-head">
        <div>
          <h3>Einkaufsliste · ${kw}</h3>
          <p class="muted small">Aktualisiert sich automatisch mit dem Plan</p>
        </div>
        <span class="shop-count">${done} / ${items.length}</span>
      </div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      ${pct === 100 ? '<div class="all-done">🎉 Alles da – guten Appetit!</div>' : ''}
      <ul class="shop-list">
        ${sorted
          .map(
            (i) => `<li class="sitem${i.checked ? ' checked' : ''}${i.extraTo ? ' extra' : ''}">
            <label>
              <input type="checkbox" data-key="${esc(i.id)}" ${i.checked ? 'checked' : ''} ${ro ? 'disabled' : ''} />
              <span class="check" aria-hidden="true"></span>
              <span class="sitem-text">
                <span class="sitem-main">${i.unit ? `<span class="amt">${fmtAmount(i.amount, i.unit)}</span> ` : ''}${esc(i.name)}</span>
                ${sub(i)}
              </span>
            </label>
            ${i.manual && !ro ? `<button class="mini" data-act="remove-item" data-key="${esc(i.id)}" aria-label="Entfernen">×</button>` : ''}
          </li>`
          )
          .join('')}
      </ul>
      ${addForm}
      ${
        ro
          ? ''
          : `<div class="shop-actions">
          <button class="btn btn-sm" data-act="check-all">Alle abhaken</button>
          <button class="btn btn-sm" data-act="uncheck-all">Alle zurücksetzen</button>
          <button class="btn btn-sm" data-act="copy-list">📋 Als Text kopieren</button>
        </div>`
      }`;
  }

  function setTab(tab) {
    ui.tab = tab;
    $$('.side-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    $('#panel-cards').hidden = tab !== 'cards';
    $('#panel-shopping').hidden = tab !== 'shopping';
  }

  /* ================= Rezept-Detail ================= */
  function renderDetail() {
    const dlg = $('#detailDialog');
    if (!ui.detail) return;
    const week = currentWeek();
    const recipe = S.getRecipe(ui.detail.recipeId, week);
    if (!recipe) {
      dlg.close();
      return;
    }
    let entry = null;
    if (ui.detail.entryUid && week) {
      entry = S.entries(week).find((e) => e.uid === ui.detail.entryUid) || null;
    }
    const ro = isReadOnly();
    const scale = entry ? entry.servings / recipe.servings : 1;
    const st = entry ? S.entryStatus(week, entry) : null;
    const per = S.recipePerServing(recipe);

    const ingRows = recipe.ingredients
      .map((ing) => {
        const info = S.ingredientInfo(ing.name);
        const hasNutri = info && N.gramsOf(1, ing.unit, info) != null;
        const have = st ? !st.missing.includes(ing.name) : null;
        return `<li>
          ${st ? `<span class="have ${have ? 'yes' : 'no'}">${have ? '✓' : '✗'}</span>` : ''}
          <span class="ing-amt">${fmtAmount(Math.round(ing.amount * scale * 10) / 10, ing.unit)}</span>
          <span class="ing-name">${esc(ing.name)}</span>
          <button class="nutri-dot ${hasNutri ? 'ok' : 'missing'}" data-act="lookup" data-name="${esc(ing.name)}"
            title="${hasNutri ? 'Nährwerte vorhanden (' + esc(info.source || '') + ') – bearbeiten' : 'Nährwerte fehlen – jetzt ergänzen'}">
            ${hasNutri ? '●' : '＋ Nährwerte'}</button>
        </li>`;
      })
      .join('');

    const micros = N.NUTRIENTS.filter((d) => !d.macro && per.values[d.key] != null)
      .map((d) => `<tr><th>${d.label}</th><td>${N.format(d.key, per.values[d.key])}</td></tr>`)
      .join('');

    const entryInfo = entry
      ? `<div class="detail-entry">
          <span>Geplant: <strong>${S.DAY_NAMES[entry.day]}, ${S.MEALS.find((m) => m.key === entry.meal).label}</strong></span>
          ${
            ro
              ? `<span>${fmtNum(entry.servings, 1)} Portionen</span>`
              : `<span class="stepper"><button class="mini" data-act="d-minus">−</button>${fmtNum(entry.servings, 1)} Portionen<button class="mini" data-act="d-plus">+</button></span>`
          }
          ${
            st
              ? `<span class="pill ${st.ok ? 'ok' : 'missing'}">${st.ok ? 'Alle Zutaten da' : `${st.missing.length} Zutat(en) fehlen`}</span>`
              : '<span class="pill">Noch keine Einkaufsliste</span>'
          }
        </div>`
      : '';

    dlg.innerHTML = `<div class="detail" style="--c:${recipe.color}">
      <header class="dialog-head detail-head">
        <div>
          <span class="detail-cat">${esc(recipe.category || 'Sonstiges')}</span>
          <h2>${esc(recipe.name)}</h2>
          ${tagsOf(recipe).length ? `<div class="detail-tags">${tagsOf(recipe).map((t) => tagPill(t)).join('')}</div>` : ''}
          <span class="muted">Rezept für ${recipe.servings} ${recipe.servings === 1 ? 'Portion' : 'Portionen'}</span>
        </div>
        <button class="icon-btn" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="dialog-body">
        ${entryInfo}
        <div class="detail-grid">
          <section>
            <h3>Zutaten${entry && scale !== 1 ? ` <small>(für ${fmtNum(entry.servings, 1)} Portionen)</small>` : ''}</h3>
            <ul class="detail-ings">${ingRows}</ul>
            ${recipe.instructions ? `<h3>Zubereitung</h3><p class="instructions">${esc(recipe.instructions)}</p>` : ''}
          </section>
          <section>
            <h3>Nährwerte pro Portion</h3>
            <div class="macro-tiles">
              ${['kcal', 'protein', 'carbs', 'fat', 'fiber']
                .map((k) => {
                  const d = N.NUTRIENTS.find((n) => n.key === k);
                  return `<div class="tile"><span class="tile-v">${N.format(k, per.values[k] || 0)}</span><span class="tile-l">${d.label}</span></div>`;
                })
                .join('')}
            </div>
            ${micros ? `<table class="nutri-table compact"><tbody>${micros}</tbody></table>` : '<p class="muted small">Keine Mikronährstoffdaten – über „●“ bei den Zutaten online nachschlagen.</p>'}
            ${per.missing.length ? `<p class="warn">⚠ Ohne Nährwerte: ${esc(per.missing.join(', '))}</p>` : ''}
          </section>
        </div>
      </div>
      <footer class="dialog-foot">
        ${
          entry && !ro
            ? '<button class="btn btn-danger" data-act="d-remove">Aus Plan entfernen</button>'
            : `<button class="btn btn-danger" data-act="d-delete">Rezept löschen</button>`
        }
        <span class="spacer"></span>
        <button class="btn" data-act="d-duplicate">Duplizieren</button>
        <button class="btn" data-act="d-edit">Bearbeiten</button>
        ${!entry && !ro ? '<button class="btn btn-primary" data-act="d-plan">Einplanen …</button>' : ''}
      </footer>
    </div>`;
  }

  function openDetail(recipeId, entryUid = null) {
    ui.detail = { recipeId, entryUid };
    renderDetail();
    openDialog($('#detailDialog'));
  }

  $('#detailDialog').addEventListener('close', () => (ui.detail = null));

  $('#detailDialog').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn || !ui.detail) return;
    const { recipeId, entryUid } = ui.detail;
    const recipe = S.getRecipe(recipeId, currentWeek());
    switch (btn.dataset.act) {
      case 'd-minus':
      case 'd-plus': {
        const e = S.entries(currentWeek()).find((x) => x.uid === entryUid);
        if (e) S.setEntryServings(ui.viewStart, entryUid, e.servings + (btn.dataset.act === 'd-plus' ? 0.5 : -0.5));
        break;
      }
      case 'd-remove':
        S.removeEntry(ui.viewStart, entryUid);
        $('#detailDialog').close();
        break;
      case 'd-delete':
        if (confirm(`Rezept „${recipe.name}“ wirklich löschen? Es wird auch aus offenen Wochen entfernt (archivierte Wochen behalten es).`)) {
          S.deleteRecipe(recipeId);
          $('#detailDialog').close();
          toast('Rezept gelöscht');
        }
        break;
      case 'd-duplicate': {
        const copy = JSON.parse(JSON.stringify(S.state.recipes.find((r) => r.id === recipeId) || recipe));
        copy.id = S.uid();
        copy.name += ' (Kopie)';
        $('#detailDialog').close();
        openEditor(copy, true);
        break;
      }
      case 'd-edit': {
        const live = S.state.recipes.find((r) => r.id === recipeId);
        $('#detailDialog').close();
        if (live) openEditor(live);
        else toast('Dieses Rezept existiert nur noch im Archiv – über „Duplizieren“ wiederherstellen.');
        break;
      }
      case 'd-plan':
        $('#detailDialog').close();
        openPlanDialog(recipeId);
        break;
      case 'lookup':
        openLookup(btn.dataset.name, () => renderAll());
        break;
    }
  });

  /* ================= Einplanen-Dialog (ohne Drag & Drop) ================= */
  function openPlanDialog(recipeId) {
    const dlg = $('#planDialog');
    const recipe = S.getRecipe(recipeId);
    const start = S.parseISO(ui.viewStart);
    const todayIdx = ui.viewStart === S.currentWeekStart() ? (new Date().getDay() + 6) % 7 : 0;
    dlg.innerHTML = `<form method="dialog" class="plan-form">
      <header class="dialog-head"><h2>„${esc(recipe.name)}“ einplanen</h2>
        <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></header>
      <div class="dialog-body">
        <label class="field"><span>Tag</span><select name="day">${S.DAY_NAMES.map((d, i) => {
          const date = S.addDays(start, i);
          return `<option value="${i}" ${i === todayIdx ? 'selected' : ''}>${d}, ${date.getDate()}.${date.getMonth() + 1}.</option>`;
        }).join('')}</select></label>
        <label class="field"><span>Mahlzeit</span><select name="meal">${S.MEALS.map(
          (m) => `<option value="${m.key}" ${categoryMeal(recipe) === m.key ? 'selected' : ''}>${m.label}</option>`
        ).join('')}</select></label>
      </div>
      <footer class="dialog-foot"><button type="button" class="btn" data-close>Abbrechen</button>
        <button class="btn btn-primary" value="ok">Einplanen</button></footer>
    </form>`;
    const form = $('form', dlg);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      S.addEntry(ui.viewStart, Number(form.day.value), form.meal.value, recipeId);
      dlg.close();
      toast(`${recipe.name} eingeplant`);
    });
    openDialog(dlg);
  }

  function categoryMeal(recipe) {
    return { Frühstück: 'breakfast', Snack: 'snack' }[recipe.category] || 'dinner';
  }

  /* ================= Rezept-Editor ================= */
  const editor = { recipe: null, isNew: true };

  function openEditor(recipe = null, forceNew = false) {
    const dlg = $('#editorDialog');
    const form = $('#editorForm');
    editor.isNew = !recipe || forceNew;
    editor.recipe = recipe
      ? JSON.parse(JSON.stringify(recipe))
      : {
          id: S.uid(),
          name: '',
          category: 'Hauptgericht',
          color: S.COLORS[Math.floor(Math.random() * S.COLORS.length)],
          servings: 2,
          ingredients: [{ name: '', amount: '', unit: 'g' }],
          instructions: '',
          tags: [],
        };
    editor.recipe.tags ||= [];
    $('#editorTitle').textContent = editor.isNew ? 'Neues Rezept' : 'Rezept bearbeiten';
    form.name.value = editor.recipe.name;
    form.category.innerHTML = S.CATEGORIES.map((c) => `<option ${c === editor.recipe.category ? 'selected' : ''}>${c}</option>`).join('');
    form.servings.value = editor.recipe.servings;
    form.instructions.value = editor.recipe.instructions || '';
    $('#ingredientNames').innerHTML = S.knownIngredientNames().map((n) => `<option value="${esc(n)}">`).join('');
    renderSwatches();
    renderTagPicker();
    renderIngTable();
    renderEditorNutri();
    openDialog(dlg);
    setTimeout(() => form.name.focus(), 50);
  }

  function renderSwatches() {
    $('#colorSwatches').innerHTML = S.COLORS.map(
      (c) =>
        `<button type="button" class="swatch${c === editor.recipe.color ? ' active' : ''}" data-color="${c}" style="--c:${c}" aria-label="Farbe ${c}"></button>`
    ).join('');
  }

  function renderTagPicker() {
    const sel = editor.recipe.tags;
    $('#tagPicker').innerHTML =
      S.state.tags
        .map(
          (t) =>
            `<button type="button" class="tag pick${sel.includes(t.id) ? ' active' : ''}" data-tag="${t.id}" style="--t:${t.color}" aria-pressed="${sel.includes(t.id)}">${
              sel.includes(t.id) ? '✓ ' : ''
            }${esc(t.name)}</button>`
        )
        .join('') +
      `<input class="tag-new" placeholder="＋ neuer Tag" aria-label="Neuen Tag anlegen" maxlength="24" />`;
  }

  function ingStatus(ing) {
    if (!ing.name.trim()) return { cls: '', label: '' };
    const info = infoFor(ing.name);
    if (!info) return { cls: 'missing', label: '＋ Nährwerte', title: 'Keine Nährwerte gefunden – klicken zum Suchen' };
    if (ing.unit === 'Stück' && !info.gramsPerPiece)
      return { cls: 'warn', label: '⚠ g/Stück', title: 'Gewicht pro Stück fehlt – klicken zum Ergänzen' };
    return { cls: 'ok', label: '✓ erkannt', title: `Nährwerte: ${info.source || 'manuell'} – klicken zum Bearbeiten` };
  }

  function renderIngTable() {
    $('#ingTable').innerHTML = editor.recipe.ingredients
      .map((ing, i) => {
        const st = ingStatus(ing);
        return `<div class="ing-row" data-i="${i}">
          <input class="ing-name" list="ingredientNames" placeholder="Zutat" value="${esc(ing.name)}" data-f="name" aria-label="Zutat" />
          <input class="ing-amount" type="number" min="0" step="any" placeholder="Menge" value="${esc(ing.amount)}" data-f="amount" aria-label="Menge" />
          <select data-f="unit" aria-label="Einheit">
            <option value="g" ${ing.unit === 'g' ? 'selected' : ''}>g</option>
            <option value="Stück" ${ing.unit === 'Stück' ? 'selected' : ''}>Stück</option>
          </select>
          <button type="button" class="ing-status ${st.cls}" data-act="ing-lookup" title="${esc(st.title || '')}" ${st.label ? '' : 'disabled'}>${st.label}</button>
          <button type="button" class="icon-btn small" data-act="ing-remove" aria-label="Zutat entfernen">✕</button>
        </div>`;
      })
      .join('');
  }

  function updateIngStatus(row, i) {
    const st = ingStatus(editor.recipe.ingredients[i]);
    const b = $('.ing-status', row);
    b.className = `ing-status ${st.cls}`;
    b.textContent = st.label;
    b.title = st.title || '';
    b.disabled = !st.label;
  }

  function renderEditorNutri() {
    const r = editor.recipe;
    const t = N.emptyTotals();
    for (const ing of r.ingredients) {
      const amount = parseFloat(ing.amount);
      if (!ing.name.trim() || !(amount > 0)) continue;
      const info = infoFor(ing.name);
      const grams = N.gramsOf(amount, ing.unit, info);
      if (!info || grams == null) t.missing.push(ing.name);
      else N.addTo(t, info.nutrients, grams);
    }
    const s = Math.max(1, parseInt($('#editorForm').servings.value, 10) || 1);
    const v = t.values;
    if (!v.kcal && !t.missing.length) {
      $('#editorNutri').innerHTML = '<span class="muted">Nährwerte werden automatisch berechnet, sobald du Zutaten einträgst.</span>';
      return;
    }
    $('#editorNutri').innerHTML = `<strong>Pro Portion:</strong> ${fmtNum((v.kcal || 0) / s)} kcal · ${macroLine(
      Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x / s]))
    )}${t.missing.length ? `<br><span class="warn-inline">Ohne Nährwerte: ${esc(t.missing.join(', '))}</span>` : ''}`;
  }

  $('#editorForm').addEventListener('input', (ev) => {
    const row = ev.target.closest('.ing-row');
    if (row) {
      const i = Number(row.dataset.i);
      const f = ev.target.dataset.f;
      editor.recipe.ingredients[i][f] = ev.target.value;
      if (f !== 'amount') updateIngStatus(row, i);
    }
    renderEditorNutri();
  });
  $('#editorForm').addEventListener('change', (ev) => {
    const row = ev.target.closest('.ing-row');
    if (row && ev.target.dataset.f === 'unit') updateIngStatus(row, Number(row.dataset.i));
  });

  $('#editorForm').addEventListener('click', (ev) => {
    const tagBtn = ev.target.closest('.tag.pick');
    if (tagBtn) {
      const id = tagBtn.dataset.tag;
      const tags = editor.recipe.tags;
      editor.recipe.tags = tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id];
      renderTagPicker();
      return;
    }
    const sw = ev.target.closest('.swatch');
    if (sw) {
      editor.recipe.color = sw.dataset.color;
      renderSwatches();
      return;
    }
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.ing-row');
    const i = row ? Number(row.dataset.i) : -1;
    if (btn.dataset.act === 'ing-remove') {
      editor.recipe.ingredients.splice(i, 1);
      if (!editor.recipe.ingredients.length) editor.recipe.ingredients.push({ name: '', amount: '', unit: 'g' });
      renderIngTable();
      renderEditorNutri();
    } else if (btn.dataset.act === 'ing-lookup') {
      const ing = editor.recipe.ingredients[i];
      openLookup(ing.name, () => {
        renderIngTable();
        renderEditorNutri();
      }, ing.unit);
    }
  });

  // neuen Tag direkt im Editor anlegen (Enter)
  $('#editorForm').addEventListener('keydown', (ev) => {
    if (!ev.target.matches('.tag-new') || ev.key !== 'Enter') return;
    ev.preventDefault();
    const tag = S.addTag(ev.target.value);
    if (tag && !editor.recipe.tags.includes(tag.id)) editor.recipe.tags.push(tag.id);
    renderTagPicker();
    $('#tagPicker .tag-new').focus();
  });

  $('#addIngBtn').addEventListener('click', () => {
    editor.recipe.ingredients.push({ name: '', amount: '', unit: 'g' });
    renderIngTable();
    const rows = $$('.ing-row');
    $('.ing-name', rows[rows.length - 1]).focus();
  });

  $('#editorForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const r = editor.recipe;
    r.name = form.name.value.trim();
    r.category = form.category.value;
    r.servings = Math.max(1, parseInt(form.servings.value, 10) || 1);
    r.instructions = form.instructions.value.trim();
    r.ingredients = r.ingredients
      .map((i) => ({ name: i.name.trim(), amount: parseFloat(String(i.amount).replace(',', '.')), unit: i.unit }))
      .filter((i) => i.name && i.amount > 0);
    if (!r.name) return;
    if (!r.ingredients.length) {
      toast('Bitte mindestens eine Zutat mit Menge angeben');
      return;
    }
    S.upsertRecipe(r);
    $('#editorDialog').close();
    toast(editor.isNew ? 'Rezept angelegt – zieh es in den Kalender!' : 'Rezept gespeichert');
  });

  /* ================= Nährwert-Suche ================= */
  function openLookup(name, onDone, unit) {
    const dlg = $('#lookupDialog');
    const existing = S.ingredientInfo(name) || N.autoDetect(name) || { nutrients: {}, gramsPerPiece: null, source: 'Manuell' };
    const formFields = N.NUTRIENTS.map(
      (d) => `<label class="field small"><span>${d.label} <small>${d.unit}</small></span>
        <input type="number" step="any" min="0" name="${d.key}" value="${existing.nutrients[d.key] ?? ''}" /></label>`
    ).join('');

    dlg.innerHTML = `<form method="dialog" class="lookup">
      <header class="dialog-head">
        <div><h2>Nährwerte für „${esc(name)}“</h2><span class="muted">Alle Angaben pro 100 g</span></div>
        <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="dialog-body">
        <div class="lookup-search">
          <input type="search" name="q" value="${esc(name)}" aria-label="Suchbegriff" />
          <button type="button" class="btn btn-primary" data-act="search">Suchen</button>
        </div>
        <p class="muted small">Durchsucht die eingebaute Tabelle, <b>Open Food Facts</b> (Produktdatenbank, deutsch) und <b>USDA FoodData Central</b> (Grundnahrungsmittel mit vielen Mikronährstoffen – englische Begriffe, z. B. „lentils“). Treffer anklicken übernimmt die Werte unten.</p>
        <div class="lookup-results" id="lookupResults"></div>
        <h3>Werte <small class="muted" id="lookupSource">Quelle: ${esc(existing.source || 'Manuell')}</small></h3>
        <div class="lookup-form">
          ${formFields}
          <label class="field small highlight"><span>Gewicht pro Stück <small>g</small></span>
            <input type="number" step="any" min="0" name="gramsPerPiece" value="${existing.gramsPerPiece ?? ''}" ${unit === 'Stück' ? 'required' : ''} /></label>
        </div>
      </div>
      <footer class="dialog-foot">
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button class="btn btn-primary">Speichern</button>
      </footer>
    </form>`;

    const form = $('form', dlg);
    let source = existing.source || 'Manuell';
    let results = [];

    const showResults = (groups) => {
      results = [];
      $('#lookupResults').innerHTML = groups
        .map((g) => {
          let inner;
          if (g.loading) inner = '<div class="muted small pad">Suche läuft …</div>';
          else if (g.error) inner = `<div class="warn small pad">${esc(g.error)}</div>`;
          else if (!g.items.length) inner = '<div class="muted small pad">Keine Treffer</div>';
          else
            inner = g.items
              .slice(0, 8)
              .map((r) => {
                const idx = results.push(r) - 1;
                const v = r.nutrients;
                return `<button type="button" class="result" data-idx="${idx}">
                  <span class="result-name">${esc(r.name)}</span>
                  <span class="result-vals">${fmtNum(v.kcal || 0)} kcal · E ${fmtNum(v.protein || 0, 1)} · KH ${fmtNum(v.carbs || 0, 1)} · F ${fmtNum(
                  v.fat || 0,
                  1
                )}${Object.keys(v).length > 8 ? ' · <b>+ Mikros</b>' : ''}</span>
                </button>`;
              })
              .join('');
          return `<div class="result-group"><h4>${g.title}</h4>${inner}</div>`;
        })
        .join('');
    };

    const doSearch = async () => {
      const q = form.q.value.trim();
      if (!q) return;
      const groups = [
        { title: 'Eingebaut', items: N.localMatches(q) },
        { title: 'Open Food Facts', loading: true, items: [] },
        { title: 'USDA FoodData Central', loading: true, items: [] },
      ];
      showResults(groups);
      const run = (i, p) =>
        p
          .then((items) => (groups[i] = { title: groups[i].title, items }))
          .catch((e) => (groups[i] = { title: groups[i].title, items: [], error: 'Nicht erreichbar: ' + e.message }))
          .finally(() => showResults(groups));
      run(1, N.searchOpenFoodFacts(q));
      run(2, N.searchUSDA(q, S.state.settings.usdaKey));
    };

    dlg.onclick = (ev) => {
      if (ev.target.closest('[data-act="search"]')) doSearch();
      const r = ev.target.closest('.result');
      if (r) {
        const res = results[Number(r.dataset.idx)];
        for (const d of N.NUTRIENTS) form[d.key].value = res.nutrients[d.key] ?? '';
        if (res.gramsPerPiece) form.gramsPerPiece.value = res.gramsPerPiece;
        source = `${res.source}: ${res.name}`;
        $('#lookupSource').textContent = 'Quelle: ' + source;
        $$('.result', dlg).forEach((b) => b.classList.toggle('selected', b === r));
      }
    };
    form.q.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        doSearch();
      }
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const nutrients = {};
      for (const d of N.NUTRIENTS) {
        const v = parseFloat(form[d.key].value);
        if (!isNaN(v)) nutrients[d.key] = v;
      }
      const gpp = parseFloat(form.gramsPerPiece.value);
      S.setIngredientInfo(name, { nutrients, gramsPerPiece: gpp > 0 ? gpp : null, source });
      dlg.close();
      toast(`Nährwerte für ${name} gespeichert`);
      onDone && onDone();
    });

    showResults([{ title: 'Eingebaut', items: N.localMatches(name) }]);
    openDialog(dlg);
  }

  /* ================= Archiv ================= */
  function renderArchive() {
    const dlg = $('#archiveDialog');
    const weeks = S.archivedWeeks();
    const view = currentWeek();
    const canClose = view && !view.archived && S.entries(view).length > 0;
    const { kw } = weekLabel(ui.viewStart);

    const list = weeks
      .map((w) => {
        const { kw: wkw, range } = weekLabel(w.start);
        const es = S.entries(w);
        const days = S.dayTotals(w).filter((d) => d.values.kcal);
        const avg = days.length ? days.reduce((s, d) => s + d.values.kcal, 0) / days.length : 0;
        const names = [...new Set(es.map((e) => (S.getRecipe(e.recipeId, w) || {}).name).filter(Boolean))];
        const items = S.shoppingItems(w);
        const shop = items.length ? `${items.filter((i) => i.checked).length}/${items.length} eingekauft` : 'keine Einkäufe';
        return `<li class="arch-item">
          <div class="arch-main">
            <strong>${wkw}</strong> <span class="muted">${range}</span>
            <div class="arch-stats">${es.length} Mahlzeiten · Ø ${fmtNum(avg)} kcal/Tag · ${shop}</div>
            <div class="chips">${names.slice(0, 8).map((n) => `<span class="chip">${esc(n)}</span>`).join('')}${
          names.length > 8 ? `<span class="chip">+${names.length - 8}</span>` : ''
        }</div>
          </div>
          <div class="arch-actions">
            <button class="btn btn-sm" data-act="a-view" data-start="${w.start}">Ansehen</button>
            <button class="btn btn-sm" data-act="a-copy" data-start="${w.start}">Als Vorlage nutzen</button>
            <button class="btn btn-sm btn-ghost" data-act="a-reopen" data-start="${w.start}">Wieder öffnen</button>
            <button class="btn btn-sm btn-ghost danger" data-act="a-delete" data-start="${w.start}" aria-label="Löschen">🗑</button>
          </div>
        </li>`;
      })
      .join('');

    dlg.innerHTML = `<header class="dialog-head"><div><h2>🗂 Archiv</h2>
        <span class="muted">Vergangene Wochen werden automatisch archiviert, sobald sie vorbei sind.</span></div>
        <button class="icon-btn" data-close aria-label="Schließen">✕</button></header>
      <div class="dialog-body">
        ${
          canClose
            ? `<div class="arch-close"><span>Mit ${kw} schon fertig?</span>
                <button class="btn btn-primary btn-sm" data-act="a-close">${kw} jetzt abschließen & archivieren</button></div>`
            : ''
        }
        ${weeks.length ? `<ul class="arch-list">${list}</ul>` : '<p class="muted pad">Noch keine archivierten Wochen.</p>'}
      </div>`;
  }

  $('#archiveDialog').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const start = btn.dataset.start;
    switch (btn.dataset.act) {
      case 'a-view':
        ui.viewStart = start;
        $('#archiveDialog').close();
        renderAll();
        break;
      case 'a-copy': {
        const target = S.currentWeekStart() > ui.viewStart || isReadOnly() ? nextOpenWeek() : ui.viewStart;
        const res = S.copyWeek(start, target);
        ui.viewStart = target;
        $('#archiveDialog').close();
        toast(`${res.copied} Mahlzeiten in ${weekLabel(target).kw} übernommen${res.skipped ? ` (${res.skipped} übersprungen)` : ''}`);
        break;
      }
      case 'a-reopen':
        S.reopenWeek(start);
        ui.viewStart = start;
        $('#archiveDialog').close();
        toast('Woche wieder geöffnet – sie wird beim nächsten Laden erneut archiviert, wenn sie vorbei ist.');
        break;
      case 'a-delete':
        if (confirm('Diese Woche endgültig aus dem Archiv löschen?')) S.deleteWeek(start);
        break;
      case 'a-close': {
        const closed = ui.viewStart;
        S.archiveWeek(closed);
        ui.viewStart = S.isoDate(S.addDays(S.parseISO(closed), 7));
        toast(`${weekLabel(closed).kw} archiviert`);
        break;
      }
    }
    renderAll();
    if ($('#archiveDialog').open) renderArchive();
  });

  /** Erste nicht archivierte Woche ab der aktuellen. */
  function nextOpenWeek() {
    let start = S.currentWeekStart();
    for (let i = 0; i < 52; i++) {
      const w = S.getWeek(start);
      if (!w || !w.archived) return start;
      start = S.isoDate(S.addDays(S.parseISO(start), 7));
    }
    return start;
  }

  /* ================= Excel-Import ================= */
  function openImport() {
    const dlg = $('#importDialog');
    let parsed = null;
    const target = isReadOnly() ? nextOpenWeek() : ui.viewStart;

    const renderStart = (msg = '') => {
      dlg.innerHTML = `<header class="dialog-head"><div><h2>📥 Rezepte aus Excel importieren</h2>
          <span class="muted">.xlsx, .xls, .ods oder .csv – wird nur in deinem Browser gelesen</span></div>
          <button class="icon-btn" data-close aria-label="Schließen">✕</button></header>
        <div class="dialog-body">
          <label class="dropzone" id="importDrop">
            <input type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv" hidden data-act="file" />
            <span class="dropzone-icon">📄</span>
            <strong>Datei auswählen oder hierher ziehen</strong>
            <span class="muted small">${msg ? esc(msg) : 'Mehrere Blätter werden automatisch erkannt.'}</span>
          </label>
          <h3>So muss die Tabelle aussehen</h3>
          <p class="small">Eine Zeile pro Zutat, Überschriften in einer Zeile (Reihenfolge egal):</p>
          <table class="nutri-table import-format">
            <thead><tr><th>Gericht</th><th>Zutat</th><th>Menge</th><th>Einheit</th><th class="muted">Zubereitung</th></tr></thead>
            <tbody>
              <tr><td>Linsencurry</td><td>Rote Linsen</td><td>200</td><td>g</td><td class="muted">Zwiebel anschwitzen …</td></tr>
              <tr><td>Linsencurry</td><td>Zwiebel</td><td>1</td><td>Stück</td><td></td></tr>
            </tbody>
          </table>
          <p class="muted small">Optional erkannt: <b>Tag</b> &amp; <b>Mahlzeit</b> (→ Wochenplan), <b>Portionen</b>, <b>Kategorie</b>,
            Nährwert-Spalten (kcal, Protein, Fett, KH) sowie ein eigenes Blatt mit <b>Zutat + Nährwerten pro 100 g</b>.
            Einheiten: g, kg, Stück; ml/l werden 1:1 als g, EL/TL als 15/5 g übernommen.</p>
          <button class="btn btn-sm" data-act="template">⬇ Vorlage herunterladen</button>
        </div>`;
    };

    const renderPreview = () => {
      const { recipes, nutrition, plan, warnings } = parsed;
      const nutriMap = new Map(nutrition.map((n) => [N.norm(n.name), n]));
      const kcalOf = (r) => {
        let kcal = 0;
        for (const ing of r.ingredients) {
          const info = nutriMap.get(N.norm(ing.name)) || infoFor(ing.name);
          const g = info && N.gramsOf(ing.amount, ing.unit, info);
          if (g != null && info.nutrients.kcal != null) kcal += (info.nutrients.kcal * g) / 100;
        }
        return kcal / (r.servings || 1);
      };
      const exists = (r) => S.state.recipes.some((x) => N.norm(x.name) === N.norm(r.name));
      const dupes = recipes.filter(exists).length;
      dlg.innerHTML = `<form method="dialog">
        <header class="dialog-head"><div><h2>📥 Import-Vorschau</h2>
          <span class="muted">${recipes.length} Rezepte · ${nutrition.length} Zutaten mit Nährwerten${plan.length ? ` · ${plan.length} geplante Mahlzeiten` : ''}</span></div>
          <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></header>
        <div class="dialog-body">
          ${warnings.length ? `<ul class="import-warn">${warnings.map((w) => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>` : ''}
          <ul class="import-list">
            ${recipes
              .map(
                (r) => `<li>
                <div><strong>${esc(r.name)}</strong>${exists(r) ? ' <span class="chip">schon vorhanden</span>' : ''}
                  ${r.tags && r.tags.length ? `<div class="detail-tags">${r.tags.map((n) => tagPill(S.state.tags.find((t) => N.norm(t.name) === N.norm(n)) || { name: n, color: 'var(--muted)' }, 'small')).join('')}</div>` : ''}
                  <div class="muted small">${esc(r.category)} · ${r.ingredients.length} Zutaten · ${r.servings} ${r.servings === 1 ? 'Portion' : 'Portionen'}${r.instructions ? ' · mit Zubereitung' : ''}</div></div>
                <span class="import-kcal">${fmtNum(kcalOf(r))} kcal</span>
              </li>`
              )
              .join('')}
          </ul>
          ${
            dupes
              ? `<label class="check-row"><input type="checkbox" name="overwrite" checked /> ${dupes} schon vorhandene Rezepte mit den Daten aus der Datei aktualisieren</label>`
              : ''
          }
          ${
            plan.length
              ? `<label class="check-row"><input type="checkbox" name="plan" /> Wochenplan aus der Datei in <b>${weekLabel(target).kw}</b> (${weekLabel(target).range}) eintragen</label>`
              : ''
          }
        </div>
        <footer class="dialog-foot">
          <button type="button" class="btn" data-act="back">Andere Datei</button>
          <button class="btn btn-primary" ${recipes.length ? '' : 'disabled'}>${recipes.length} Rezepte importieren</button>
        </footer>
      </form>`;
      $('form', dlg).addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = ev.target;
        const res = S.importData(parsed, {
          overwrite: f.overwrite ? f.overwrite.checked : false,
          planWeek: f.plan && f.plan.checked ? target : null,
        });
        dlg.close();
        if (res.planned) ui.viewStart = target;
        renderAll();
        toast(
          `${res.created} neu, ${res.updated} aktualisiert${res.skipped ? `, ${res.skipped} übersprungen` : ''}` +
            (res.planned ? ` · ${res.planned} Mahlzeiten eingeplant` : '')
        );
      });
    };

    const handleFile = async (file) => {
      if (!file) return;
      renderStart('Lese ' + file.name + ' …');
      try {
        parsed = await window.PF_IMPORT.parseFile(file);
        if (!parsed.recipes.length) {
          renderStart('Keine Rezepte gefunden – gibt es Spalten „Gericht“, „Zutat“ und „Menge“?');
          return;
        }
        renderPreview();
      } catch (e) {
        renderStart('Fehler: ' + e.message);
      }
    };

    dlg.onchange = (ev) => {
      if (ev.target.matches('[data-act="file"]')) handleFile(ev.target.files[0]);
    };
    dlg.onclick = async (ev) => {
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'back') renderStart();
      if (act.dataset.act === 'template') {
        try {
          await window.PF_IMPORT.downloadTemplate();
        } catch (e) {
          toast(e.message);
        }
      }
    };
    dlg.ondragover = (ev) => {
      ev.preventDefault();
      const z = $('#importDrop', dlg);
      if (z) z.classList.add('over');
    };
    dlg.ondragleave = () => {
      const z = $('#importDrop', dlg);
      if (z) z.classList.remove('over');
    };
    dlg.ondrop = (ev) => {
      ev.preventDefault();
      handleFile(ev.dataTransfer.files[0]);
    };

    renderStart();
    openDialog(dlg);
    window.PF_IMPORT.loadLib().catch(() => {}); // schon mal vorladen
  }

  /* ================= Einstellungen ================= */
  function openSettings() {
    const dlg = $('#settingsDialog');
    dlg.innerHTML = `<form method="dialog">
      <header class="dialog-head"><h2>⚙︎ Einstellungen &amp; Daten</h2>
        <button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></header>
      <div class="dialog-body">
        <label class="field"><span>USDA FoodData Central API-Key <small>(optional)</small></span>
          <input name="usdaKey" value="${esc(S.state.settings.usdaKey || '')}" placeholder="leer = DEMO_KEY (stark limitiert)" />
          <small class="muted">Kostenlos unter <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov/api-key-signup</a>. Wird nur in deinem Browser gespeichert.</small>
        </label>
        <div class="field"><span>Tags verwalten</span>
          <p class="muted small">Farbe antippen zum Ändern, Name direkt bearbeiten. Löschen entfernt den Tag auch aus allen Rezepten.</p>
          <div class="tag-manager" id="tagManager"></div>
        </div>
        <div class="field"><span>Daten</span>
          <p class="muted small">Alle Daten liegen lokal in diesem Browser. Für Backup oder Umzug auf ein anderes Gerät exportieren/importieren.</p>
          <div class="row-btns">
            <button type="button" class="btn" data-act="export">⬇ Export (JSON)</button>
            <label class="btn">⬆ Import<input type="file" accept="application/json,.json" hidden data-act="import" /></label>
            <button type="button" class="btn" data-act="excel">📥 Rezepte aus Excel</button>
            <button type="button" class="btn btn-ghost danger" data-act="reset">Alles zurücksetzen</button>
          </div>
        </div>
      </div>
      <footer class="dialog-foot"><button type="button" class="btn" data-close>Abbrechen</button><button class="btn btn-primary">Speichern</button></footer>
    </form>`;
    const renderTagManager = () => {
      $('#tagManager', dlg).innerHTML =
        S.state.tags
          .map(
            (t) => `<div class="tm-row" data-id="${t.id}">
              <input type="color" value="${t.color}" data-tm="color" aria-label="Farbe von ${esc(t.name)}" />
              <input value="${esc(t.name)}" data-tm="name" aria-label="Name" maxlength="24" />
              <span class="muted small">${S.state.recipes.filter((r) => (r.tags || []).includes(t.id)).length} Rezepte</span>
              <button type="button" class="icon-btn small" data-tm="delete" aria-label="Tag löschen">✕</button>
            </div>`
          )
          .join('') +
        `<div class="tm-row"><input class="tag-new" data-tm="new" placeholder="＋ neuer Tag, Enter" maxlength="24" /></div>`;
    };
    const form = $('form', dlg);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      S.state.settings.usdaKey = form.usdaKey.value.trim();
      S.save();
      dlg.close();
      toast('Einstellungen gespeichert');
    });
    dlg.onclick = (ev) => {
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'export') {
        const blob = new Blob([S.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `planfood-${S.isoDate(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (act.dataset.act === 'excel') {
        dlg.close();
        openImport();
      } else if (act.dataset.act === 'reset') {
        if (confirm('Wirklich alle Rezepte, Pläne und das Archiv löschen und mit Beispieldaten neu starten?')) {
          S.reset();
          dlg.close();
          toast('Zurückgesetzt');
        }
      }
    };
    const tm = $('#tagManager', dlg);
    tm.addEventListener('change', (ev) => {
      const row = ev.target.closest('[data-id]');
      if (!row) return;
      if (ev.target.dataset.tm === 'color') S.updateTag(row.dataset.id, { color: ev.target.value });
      if (ev.target.dataset.tm === 'name') S.updateTag(row.dataset.id, { name: ev.target.value });
    });
    tm.addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-tm="delete"]');
      if (!del) return;
      const id = del.closest('[data-id]').dataset.id;
      const tag = S.getTag(id);
      if (confirm(`Tag „${tag.name}“ löschen?`)) {
        S.deleteTag(id);
        renderTagManager();
      }
    });
    tm.addEventListener('keydown', (ev) => {
      if (ev.target.dataset.tm !== 'new' || ev.key !== 'Enter') return;
      ev.preventDefault();
      if (S.addTag(ev.target.value)) renderTagManager();
      $('[data-tm="new"]', dlg).focus();
    });
    renderTagManager();
    $('[data-act="import"]', dlg).addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        S.importJSON(await file.text());
        dlg.close();
        toast('Daten importiert');
      } catch (e) {
        alert('Import fehlgeschlagen: ' + e.message);
      }
    });
    openDialog(dlg);
  }

  /* ================= Drag & Drop ================= */
  function setupDnD() {
    document.addEventListener('dragstart', (ev) => {
      const card = ev.target.closest && ev.target.closest('.rcard');
      const entry = ev.target.closest && ev.target.closest('.entry');
      if (card) {
        ui.drag = { type: 'recipe', id: card.dataset.id };
        card.classList.add('dragging');
      } else if (entry) {
        ui.drag = { type: 'entry', id: entry.dataset.uid };
        entry.classList.add('dragging');
        $('#cardbox').classList.add('drop-remove');
      } else return;
      ev.dataTransfer.effectAllowed = ui.drag.type === 'recipe' ? 'copy' : 'move';
      ev.dataTransfer.setData('text/plain', ui.drag.id);
      document.body.classList.add('is-dragging');
    });

    document.addEventListener('dragend', () => {
      ui.drag = null;
      if (ui.releaseCard) ui.releaseCard();
      $$('.dragging').forEach((el) => el.classList.remove('dragging'));
      $$('.slot.over').forEach((el) => el.classList.remove('over'));
      $('#cardbox').classList.remove('drop-remove', 'over');
      document.body.classList.remove('is-dragging');
    });

    const cal = $('#calendar');
    cal.addEventListener('dragover', (ev) => {
      const slot = ev.target.closest('.slot');
      if (!slot || !ui.drag || slot.classList.contains('readonly')) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = ui.drag.type === 'recipe' ? 'copy' : 'move';
      if (!slot.classList.contains('over')) {
        $$('.slot.over').forEach((el) => el.classList.remove('over'));
        slot.classList.add('over');
      }
    });
    cal.addEventListener('dragleave', (ev) => {
      const slot = ev.target.closest('.slot');
      if (slot && !slot.contains(ev.relatedTarget)) slot.classList.remove('over');
    });
    cal.addEventListener('drop', (ev) => {
      const slot = ev.target.closest('.slot');
      if (!slot || !ui.drag || slot.classList.contains('readonly')) return;
      ev.preventDefault();
      const day = Number(slot.dataset.day);
      const meal = slot.dataset.meal;
      if (ui.drag.type === 'recipe') S.addEntry(ui.viewStart, day, meal, ui.drag.id);
      else S.moveEntry(ui.viewStart, ui.drag.id, day, meal);
    });

    const box = $('#cardbox');
    box.addEventListener('dragover', (ev) => {
      if (ui.drag && ui.drag.type === 'entry') {
        ev.preventDefault();
        box.classList.add('over');
      }
    });
    box.addEventListener('dragleave', (ev) => {
      if (!box.contains(ev.relatedTarget)) box.classList.remove('over');
    });
    box.addEventListener('drop', (ev) => {
      if (ui.drag && ui.drag.type === 'entry') {
        ev.preventDefault();
        S.removeEntry(ui.viewStart, ui.drag.id);
        toast('Aus dem Plan entfernt');
      }
    });
  }

  /* ================= Ereignisse ================= */
  function setupEvents() {
    $('#prevWeek').addEventListener('click', () => shiftWeek(-1));
    $('#nextWeek').addEventListener('click', () => shiftWeek(1));
    $('#todayBtn').addEventListener('click', () => {
      ui.viewStart = S.currentWeekStart();
      renderAll();
    });
    $('#generateListBtn').addEventListener('click', showShopping);
    $('#archiveBtn').addEventListener('click', () => {
      renderArchive();
      openDialog($('#archiveDialog'));
    });
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#newRecipeBtn').addEventListener('click', () => openEditor());
    $('#importBtn').addEventListener('click', openImport);
    $('#tagFilter').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-tag]');
      if (b) {
        const id = b.dataset.tag;
        ui.tagFilter.has(id) ? ui.tagFilter.delete(id) : ui.tagFilter.add(id);
      } else if (ev.target.closest('[data-tag-reset]')) ui.tagFilter.clear();
      else return;
      renderCards();
    });
    $('#recipeSearch').addEventListener('input', (ev) => {
      ui.search = ev.target.value;
      renderCards();
    });
    $$('.side-tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

    $('#weekBanner').addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'reopen') S.reopenWeek(ui.viewStart);
      if (act.dataset.act === 'copy-to-current') {
        const from = ui.viewStart;
        const target = nextOpenWeek();
        const res = S.copyWeek(from, target);
        ui.viewStart = target;
        renderAll();
        toast(`${res.copied} Mahlzeiten in ${weekLabel(target).kw} übernommen`);
      }
    });

    // Kartei: Klick / Enter öffnet das Rezept
    $('#cardboxInner').addEventListener('click', (ev) => {
      const card = ev.target.closest('.rcard');
      if (card) openDetail(card.dataset.id);
    });
    // Karte nur so weit herausziehen, wie oben im Kasten Platz ist (sonst wird der Reiter abgeschnitten)
    const setLift = (card) => {
      // offsetTop ignoriert Transformationen → Position der Karte im Ruhezustand
      const inner = $('#cardboxInner');
      const avail = card.offsetTop - inner.offsetTop - inner.scrollTop - 26;
      card.style.setProperty('--lift', Math.max(0, Math.min(118, avail)) + 'px');
    };

    // „Mit der Hand durch die Kartei gehen“: erst antippen (peek), nach kurzem Verweilen herausziehen (pulled)
    const PULL_DELAY = 160;
    const hand = { card: null, timer: null };
    const releaseCard = () => {
      clearTimeout(hand.timer);
      if (hand.card) hand.card.classList.remove('peek', 'pulled');
      $$('#cardboxInner .nudge-prev, #cardboxInner .nudge-next').forEach((el) => el.classList.remove('nudge-prev', 'nudge-next'));
      hand.card = null;
    };
    const touchCard = (card) => {
      if (card === hand.card) return;
      releaseCard();
      hand.card = card;
      setLift(card);
      card.classList.add('peek');
      const prev = card.previousElementSibling;
      const next = card.nextElementSibling;
      if (prev && prev.classList.contains('rcard')) prev.classList.add('nudge-prev');
      if (next) next.classList.add('nudge-next');
      hand.timer = setTimeout(() => card.classList.add('pulled'), PULL_DELAY);
    };
    $('#cardboxInner').addEventListener('pointerover', (ev) => {
      if (ev.pointerType === 'touch' || ui.drag) return;
      const card = ev.target.closest('.rcard');
      if (card) touchCard(card);
      else if (ev.target.closest('.divider')) releaseCard();
    });
    $('#cardboxInner').addEventListener('pointerleave', () => {
      if (!ui.drag) releaseCard();
    });
    $('#cardboxInner').addEventListener('dragstart', () => clearTimeout(hand.timer));
    ui.releaseCard = releaseCard;
    $('#cardboxInner').addEventListener('focusin', (ev) => {
      const card = ev.target.closest('.rcard');
      if (card) setLift(card);
    });
    $('#cardboxInner').addEventListener('keydown', (ev) => {
      const card = ev.target.closest('.rcard');
      if (card && ev.key === 'Enter') openDetail(card.dataset.id);
    });

    // Kalender: Einträge
    $('#calendar').addEventListener('click', (ev) => {
      const entry = ev.target.closest('.entry');
      if (!entry) return;
      const uid = entry.dataset.uid;
      const act = ev.target.closest('[data-act]');
      const week = currentWeek();
      const e = S.entries(week).find((x) => x.uid === uid);
      if (!e) return;
      if (act) {
        ev.stopPropagation();
        if (act.dataset.act === 'remove') S.removeEntry(ui.viewStart, uid);
        if (act.dataset.act === 'plus') S.setEntryServings(ui.viewStart, uid, e.servings + 0.5);
        if (act.dataset.act === 'minus') S.setEntryServings(ui.viewStart, uid, e.servings - 0.5);
        return;
      }
      openDetail(e.recipeId, uid);
    });
    $('#calendar').addEventListener('keydown', (ev) => {
      const entry = ev.target.closest('.entry');
      if (!entry) return;
      const e = S.entries(currentWeek()).find((x) => x.uid === entry.dataset.uid);
      if (!e) return;
      if (ev.key === 'Enter') openDetail(e.recipeId, e.uid);
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && !isReadOnly()) S.removeEntry(ui.viewStart, e.uid);
    });

    // Wochen-Nährwerte: fehlende Zutaten ergänzen
    $('#summaryBody').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act="lookup"]');
      if (b) openLookup(b.dataset.name, () => renderAll());
    });

    // Einkaufsliste
    const shop = $('#shoppingPanel');
    shop.addEventListener('change', (ev) => {
      const cb = ev.target.closest('input[type=checkbox][data-key]');
      if (cb) S.toggleItem(ui.viewStart, cb.dataset.key, cb.checked);
    });
    shop.addEventListener('click', async (ev) => {
      const act = ev.target.closest('[data-act]');
      if (!act || act.tagName === 'FORM') return;
      switch (act.dataset.act) {
        case 'check-all':
          S.setAllItems(ui.viewStart, true);
          break;
        case 'uncheck-all':
          S.setAllItems(ui.viewStart, false);
          break;
        case 'remove-item':
          S.removeItem(ui.viewStart, act.dataset.key);
          break;
        case 'copy-list': {
          const w = currentWeek();
          const text =
            `Einkaufsliste ${weekLabel(ui.viewStart).kw}\n` +
            S.shoppingItems(w)
              .filter((i) => !i.checked)
              .map((i) => `☐ ${i.unit ? fmtAmount(i.amount, i.unit) + ' ' : ''}${i.name}`)
              .join('\n');
          try {
            await navigator.clipboard.writeText(text);
            toast('Offene Einträge kopiert');
          } catch {
            prompt('Zum Kopieren:', text);
          }
          break;
        }
      }
    });
    shop.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const input = ev.target.item;
      const v = input.value.trim();
      if (v) S.addManualItem(ui.viewStart, v);
    });

    // Dialoge: Schließen-Buttons & Klick auf Hintergrund
    $$('dialog').forEach((dlg) => {
      dlg.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-close]') || ev.target === dlg) dlg.close();
      });
    });

    // Tastatur: Pfeile wechseln die Woche (wenn kein Eingabefeld aktiv)
    document.addEventListener('keydown', (ev) => {
      if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (ev.altKey && ev.key === 'ArrowLeft') shiftWeek(-1);
      if (ev.altKey && ev.key === 'ArrowRight') shiftWeek(1);
    });
  }

  function shiftWeek(delta) {
    ui.viewStart = S.isoDate(S.addDays(S.parseISO(ui.viewStart), delta * 7));
    renderAll();
  }

  function showShopping() {
    setTab('shopping');
    // auf schmalen Bildschirmen liegt die Liste unter dem Kalender
    if (window.matchMedia('(max-width: 1100px)').matches) $('.side').scrollIntoView({ behavior: 'smooth' });
  }

  /* ================= Start ================= */
  function renderAll() {
    renderHeader();
    renderCalendar();
    renderSummary();
    renderCards();
    renderShopping();
    if (ui.detail && $('#detailDialog').open) renderDetail();
  }

  S.load();
  S.onChange(renderAll);
  setupEvents();
  setupDnD();
  renderAll();
})();
