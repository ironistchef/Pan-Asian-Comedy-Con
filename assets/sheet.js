/* Pan Asian Comedy Con — shared sheet loader.
   Reads the published Google Sheet and fills whatever sections exist on this page.

   HOW THE SHEET WORKS — one table, the Type column routes every row:
     Show / Workshop / Panel  -> events (schedule, home cards, carousel)
     Overlay1 (any "Overlay…") -> site verbiage: Name = the element to change,
                                  Description = the wording for it.
                                  Named elements: Subtitle 1, Title 1 Line 1,
                                  Title 1 Line 2, Description 1, Main Button Text,
                                  Logo Text, Button 1..5 — or any visible label
                                  matched by its current text (e.g. Name "Workshops",
                                  Description "Classes" renames that heading + nav link).
     People / Organizer       -> Organizers section (people page)
     Team / Headliner / Standup -> those sections (schedule page)
     Sponsor                  -> sponsor logo tiles (Name, Image Link = logo,
                                  Purchase link = website)
     N/A or anything else     -> ignored

   Event columns: Type, Day, T Start, T End, Venue, Name, Description, Image Link,
                  Featured (Yes/TRUE/x -> homepage carousel), Purchase link.
   A cell containing exactly "N/A" is treated as empty anywhere.

   Named sections ("People", "Overlay Tab", "Sponsors Table"…) and extra tabs
   (fill in gid numbers in TABS below) are also supported.
*/
(() => {
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQFTalMTPLQlTSHy2Zh0tF4JK9ZTJM5YxLOLBO3I98seINE4sD12rlT2Nw03jsPjLJnWjzBIcOVaAWV/pub?output=csv';

const TABS = [
  { gid: null },                       // first tab
  // { gid: '123456789', as: 'people' },   // <- fill in real gid numbers
  // { gid: '987654321', as: 'overlay' },
];

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const SECTION_NAMES = /^(schedule|people|teams|headliners|standups?|organizers|sponsors|overlay|config)(\s+(table|tab))?$/i;
const KV_SECTIONS = { overlay: 1, config: 1 };
const TRUTHY = /^(true|yes|y|x|1|\u2713)$/i;
const isUrl = u => /^https?:\/\//i.test(u || '');

// quote-aware CSV parser (descriptions contain commas)
function parseCSV(text) {
  const rows = [[]]; let field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { rows[rows.length-1].push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i+1] === '\n') i++;
      rows[rows.length-1].push(field); field = ''; rows.push([]);
    } else field += ch;
  }
  rows[rows.length-1].push(field);
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

// "N/A" anywhere means: pretend the cell is empty
const clean = c => {
  const v = (c || '').trim();
  return /^n\/a$/i.test(v) ? '' : v;
};

// duplicate header names: first occurrence wins the plain key,
// later ones become "name 2", "name 3", ... (the sheet has two Type columns)
function buildCols(cells) {
  const col = {};
  cells.forEach((h, i) => {
    if (!h) return;
    let k = h.toLowerCase();
    if (col[k] !== undefined) {
      let n = 2;
      while (col[k + ' ' + n] !== undefined) n++;
      k = k + ' ' + n;
    }
    col[k] = i;
  });
  return col;
}

// split rows into named tables (+ key/value config from kv sections and loose rows)
function segment(rows) {
  const tables = {}, config = {};
  let cur = null;
  for (const r of rows) {
    const cells = r.map(clean);
    const filled = cells.filter(Boolean);

    if (filled.length === 1 && SECTION_NAMES.test(filled[0])) {
      const name = filled[0].toLowerCase().replace(/\s+(table|tab)$/, '').trim();
      cur = name;
      if (!tables[name]) tables[name] = { col: null, rows: [], kv: !!KV_SECTIONS[name] };
      continue;
    }
    // no title row needed: a row containing both "Type" and "Name" cells
    // is recognized as the main table's header on its own
    if (!cur) {
      const low = cells.map(c => c.toLowerCase());
      if (low.indexOf('type') !== -1 && low.indexOf('name') !== -1) {
        cur = 'schedule';
        if (!tables.schedule) tables.schedule = { col: null, rows: [], kv: false };
        tables.schedule.col = buildCols(cells);
        continue;
      }
    }
    const t = cur && tables[cur];
    if (t && t.kv) {                               // overlay/config: Key | Value pairs
      if (cells[0] && cells[1]) config[cells[0]] = cells[1];
      continue;
    }
    if (t && !t.col) {                             // header row of current table
      t.col = buildCols(cells);
      continue;
    }
    if (t) {
      const nameIdx = t.col['name'], typeIdx = t.col['type'];
      const keep = (nameIdx !== undefined && cells[nameIdx]) ||
                   (typeIdx !== undefined && cells[typeIdx]);
      if (keep) { t.rows.push(cells); continue; }
    }
    // NOTE: no loose key/value fallback — verbiage comes from Overlay rows/sections only
  }
  return { tables, config };
}

const getter = t => (row, key) => t.col[key] === undefined ? '' : clean(row[t.col[key]]);

const GLYPHS = ['\u706b','\u591c','\u7d44','\u65b0','\u58f1','\u5f10','\u53c2','\u5b63'];

function imgTag(url, alt) {
  return isUrl(url)
    ? `<img src="${esc(url)}" alt="${esc(alt || '')}" loading="lazy">`
    : '';
}

function ticketLink(url, label) {
  return isUrl(url)
    ? `<a class="card-link" href="${esc(url)}" target="_blank" rel="noopener">${label} <span class="arr">\u2192</span></a>`
    : `<a class="card-link" href="index.html#passes">${label} <span class="arr">\u2192</span></a>`;
}

function eventCard(ev, tintPrefix, i) {
  const badges = [
    ev.day && `${esc(ev.day)}${ev.start ? ' \u00b7 ' + esc(ev.start) : ''}`,
    ev.venue && esc(ev.venue),
    ev.type && esc(ev.type)
  ].filter(Boolean)
   .map((b, j) => `<span class="badge${j === 0 && ev.day ? ' fill' : ''}">${b}</span>`)
   .join('');
  const img = imgTag(ev.img);
  const glyph = img ? '' : `<span class="glyph">${GLYPHS[i % GLYPHS.length]}</span>`;
  return `
    <article class="card">
      <div class="card-img ${tintPrefix}${(i % 3) + 1}">${img}${glyph}<div class="badges">${badges}</div></div>
      <div class="card-body">
        <h3>${esc(ev.name)}</h3>
        <p>${esc(ev.desc)}</p>
        ${ticketLink(ev.tick, 'Tickets')}
      </div>
    </article>`;
}

function personCard(p, i) {
  const img = imgTag(p.img, p.name);
  const glyph = img ? '' : `<span class="glyph">${GLYPHS[i % GLYPHS.length]}</span>`;
  return `
    <article class="card person">
      <div class="card-img t-work-${(i % 3) + 1}">${img}${glyph}</div>
      <div class="card-body">
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.desc)}</p>
      </div>
    </article>`;
}

function sponsorTile(s) {
  const inner = imgTag(s.img, s.name) || `<span>${esc(s.name)}</span>`;
  const tile = `<div class="sponsor">${inner}</div>`;
  return isUrl(s.link)
    ? `<a class="sponsor-link" href="${esc(s.link)}" target="_blank" rel="noopener">${tile}</a>`
    : tile;
}

function timeVal(t) {
  const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(t || '');
  if (!m) return 1e9;
  let h = (+m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + (+m[2]);
}

// Overlay pass 2: rewrite any visible label whose text matches a key
function applyOverlay(config) {
  const map = {};
  for (const k in config) map[k.trim().toLowerCase()] = config[k];
  const sels = '.nav-links a,.section-head h2,.section-head .kicker,' +
               '.hero .eyebrow,.page-hero .eyebrow,.hero p,.hero-cta,' +
               '.card-link,.sched-btn,.badge,.pill,.brand-name,' +
               '.page-hero h1,.sched-day-title,.tk-admit,.tk-tier';
  document.querySelectorAll(sels).forEach(el => {
    const arr = el.querySelector('.arr');
    const txt = arr ? (el.firstChild ? el.firstChild.nodeValue : '') : el.textContent;
    const v = map[(txt || '').trim().toLowerCase()];
    if (!v) return;
    if (arr && el.firstChild) el.firstChild.nodeValue = v + ' ';
    else el.textContent = v;
  });
}

// fetch every configured tab, concatenate rows
Promise.all(TABS.map(tab => {
  const url = SHEET_URL + (tab.gid ? `&gid=${tab.gid}&single=true` : '');
  return fetch(url)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(txt => {
      const rows = parseCSV(txt);
      // a tagged tab with no section-title row gets one synthesized
      if (tab.as && !(rows[0] && rows[0].filter(c => c.trim()).length === 1
                      && SECTION_NAMES.test(rows[0].filter(c => c.trim())[0])))
        rows.unshift([tab.as]);
      return rows;
    })
    .catch(err => { console.warn('Tab failed', tab.gid || 'main', err); return []; });
}))
.then(rowSets => {
  const rows = [].concat.apply([], rowSets);
  if (!rows.length) throw new Error('No sheet data');
  const { tables, config } = segment(rows);

  // ---- route the main table's rows by Type ----
  const events = [], passes = [];
  const typed = {
    'organizers-grid': [], 'teams-grid': [], 'headliners-grid': [],
    'standup-grid': [], 'solo-grid': [], 'standup-features-grid': [],
    thanks: [], sponsors: []
  };
  const routePerson = (p, cat) => {
    if (/sponsor/i.test(cat)) typed.sponsors.push(p);
    else if (/special/i.test(cat)) typed.thanks.push(p);
    else if (/solo/i.test(cat)) typed['solo-grid'].push(p);
    else if (/stand/i.test(cat) && /feat/i.test(cat)) typed['standup-features-grid'].push(p);
    else if (/stand/i.test(cat)) typed['standup-grid'].push(p);
    else if (/team/i.test(cat)) typed['teams-grid'].push(p);
    else if (/headlin/i.test(cat)) typed['headliners-grid'].push(p);
    else typed['organizers-grid'].push(p);
  };
  const sched = tables['schedule'];
  if (sched && sched.col && sched.rows.length) {
    const g = getter(sched);
    for (const r of sched.rows) {
      const type = g(r, 'type');
      const base = {
        name: g(r, 'name'),
        desc: g(r, 'description') || g(r, 'bio'),
        img: g(r, 'image link') || g(r, 'logo link'),
        tick: g(r, 'purchase link') || g(r, 'ticket link') || g(r, 'eventbrite') || g(r, 'link')
      };
      if (/^(show|workshop|panel)$/i.test(type)) {
        if (base.name) events.push(Object.assign(base, {
          type: type, day: g(r, 'day'), start: g(r, 't start'), end: g(r, 't end'),
          venue: g(r, 'venue'),
          feat: TRUTHY.test(g(r, 'featured') || g(r, 'is feature'))
        }));
      }
      else if (/^pass/i.test(type)) {
        if (base.name) passes.push(Object.assign(base, {
          type: 'Pass',
          feat: TRUTHY.test(g(r, 'featured') || g(r, 'is feature'))
        }));
      }
      else if (/^overlay/i.test(type)) {
        // Header Content column names the element; Description carries the wording
        const el2 = g(r, 'header content') || base.name;
        if (el2 && base.desc) config[el2] = base.desc;
      }
      else if (/^(people|organizers?|teams?|headliners?|stand.?up|sponsors?|special)/i.test(type)) {
        // category comes from the second Type column (or Category/Group/Role)
        const cat = g(r, 'category') || g(r, 'group') || g(r, 'role') || g(r, 'type 2')
                    || (/^people$/i.test(type) ? '' : type);
        if (base.name) {
          routePerson(base, cat);
          if (TRUTHY.test(g(r, 'headliner'))) typed['headliners-grid'].push(base);
        }
      }
      // anything else (blank after N/A, unknown types) is ignored
    }
  }

  // ---- hero/nav copy ----
  const setText = (sel, val) => {
    const el = document.querySelector(sel);
    if (el && val) el.textContent = val;
  };
  setText('.hero .eyebrow', config['Subtitle 1']);
  const h1 = document.querySelector('.hero h1');
  if (h1 && (config['Title 1 Line 1'] || config['Title 1 Line 2'])) {
    h1.innerHTML =
      `${esc(config['Title 1 Line 1'] || 'Pan Asian')}<br><span class="hot">${esc(config['Title 1 Line 2'] || 'Comedy Con')}</span>`;
  }
  setText('.hero p', config['Description 1']);
  setText('.hero-cta', config['Main Button Text']);
  setText('.brand-name', config['Logo Text']);
  document.querySelectorAll('.nav-links a').forEach((a, i) => {
    const v = config[`Button ${i + 1}`];
    if (v) a.textContent = v;
  });

  // ---- events -> home cards, carousel, timetable ----
  if (events.length || passes.length) {
    const carEl = document.getElementById('carousel');
    const featured = events.filter(e => e.feat).concat(passes.filter(p => p.feat));
    if (carEl && featured.length) {
      const arts = ['art-a', 'art-b', 'art-c'];
      carEl.innerHTML = featured.map((e, i) => {
        const img = imgTag(e.img);
        const badges = [
          e.day && `${esc(e.day)}${e.start ? ' \u00b7 ' + esc(e.start) : ''}`,
          e.venue && esc(e.venue),
          e.type && esc(e.type)
        ].filter(Boolean)
         .map((b, j) => `<span class="badge${j === 0 && e.day ? ' fill' : ''}">${b}</span>`)
         .join('');
        return `
        <article class="slide">
          <div class="slide-art ${arts[i % 3]}"${img ? '' : ` data-glyph="${GLYPHS[i % GLYPHS.length]}"`}>${img}</div>
          <div class="slide-body">
            <div class="badges">${badges}</div>
            <h3>${esc(e.name)}</h3>
            <p>${esc(e.desc)}</p>
            ${ticketLink(e.tick, 'Get tickets')}
          </div>
        </article>`;
      }).join('');
      carEl.scrollLeft = 0;
      const counter = document.getElementById('counter');
      if (counter) counter.textContent = '01 / ' + String(featured.length).padStart(2, '0');
    }

    const showsEl = document.getElementById('shows-grid');
    if (showsEl) {
      const shows = events.filter(e => /^show$/i.test(e.type));
      if (shows.length) showsEl.innerHTML = shows.map((e, i) => eventCard(e, 't-show-', i)).join('');
    }
    const worksEl = document.getElementById('workshops-grid');
    if (worksEl) {
      const works = events.filter(e => !/^show$/i.test(e.type));
      if (works.length) worksEl.innerHTML = works.map((e, i) => eventCard(e, 't-work-', i)).join('');
    }

    const schedEl = document.getElementById('schedule-list');
    if (schedEl && events.length) {
      const days = {};
      for (const e of events) {
        const d = e.day || 'Day TBD';
        (days[d] = days[d] || []).push(e);
      }
      schedEl.innerHTML = Object.keys(days).map(day => `
        <div class="sched-day">
          <h3 class="sched-day-title">${esc(day)}</h3>
          ${days[day].sort((a, b) => timeVal(a.start) - timeVal(b.start)).map(e => `
            <div class="sched-row">
              <div class="sched-time">${esc(e.start)}${e.end ? '\u2013' + esc(e.end) : ''}</div>
              <div class="sched-info">
                <div class="sched-name">${esc(e.name)}</div>
                <div class="sched-pills">
                  ${e.venue ? `<span class="pill">${esc(e.venue)}</span>` : ''}
                  <span class="pill">${esc(e.type)}</span>
                </div>
                <p>${esc(e.desc)}</p>
              </div>
              <div class="sched-cta">
                ${isUrl(e.tick)
                  ? `<a class="sched-btn" href="${esc(e.tick)}" target="_blank" rel="noopener">Buy on Eventbrite</a>`
                  : ''}
              </div>
            </div>`).join('')}
        </div>`).join('');
    }
  }

  // ---- Pass rows -> the tickets section ----
  const ticketsEl = document.querySelector('.tickets');
  if (ticketsEl && passes.length) {
    const tiers = ['tk-fire', 'tk-gold', 'tk-silver'];
    const tierNames = ['Fire', 'Gold', 'Silver'];
    ticketsEl.innerHTML = passes.map((p, i) => `
      <article class="ticket ${tiers[i % 3]}">
        <div class="tk-body">
          <div class="tk-top"><span class="tk-tier">${tierNames[i % 3]}</span><span class="tk-serial">\u2116 ${String(8 + i * 19).padStart(6, '0')}</span></div>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.desc)}</p>
          ${isUrl(p.tick)
            ? `<a class="tk-link" href="${esc(p.tick)}" target="_blank" rel="noopener">Buy on Eventbrite <span class="arr">\u2192</span></a>`
            : ''}
        </div>
        <div class="tk-stub">
          <span class="tk-admit">Admit All</span>
          <div class="tk-barcode" aria-hidden="true"></div>
        </div>
      </article>`).join('');
  }

  // ---- Type-routed people, sponsors, special thanks ----
  const fillGridTyped = (gridId, list) => {
    const el = document.getElementById(gridId);
    if (el && list.length) el.innerHTML = list.map((p, i) => personCard(p, i)).join('');
  };
  for (const gridId in typed) {
    if (gridId === 'thanks' || gridId === 'sponsors') continue;
    fillGridTyped(gridId, typed[gridId]);
  }
  const spTypedEl = document.getElementById('sponsors-grid');
  if (spTypedEl && typed.sponsors.length)
    spTypedEl.innerHTML = typed.sponsors.map(s => sponsorTile({ name: s.name, img: s.img, link: s.tick })).join('');
  const thanksEl = document.getElementById('special-thanks-list');
  if (thanksEl && typed.thanks.length)
    thanksEl.innerHTML = typed.thanks.map(p => `
      <div class="thanks-item">
        <span class="thanks-name">${esc(p.name)}</span>
        ${p.desc ? `<span class="thanks-desc">${esc(p.desc)}</span>` : ''}
      </div>`).join('');

  // ---- People table with Role routing (plus legacy per-group tables) ----

  const fillGrid = (gridId, list) => {
    const el = document.getElementById(gridId);
    if (el && list.length) el.innerHTML = list.map((p, i) => personCard(p, i)).join('');
  };
  const people = tables['people'];
  if (people && people.col && people.rows.length) {
    const g = getter(people);
    const groups = { 'organizers-grid': [], 'teams-grid': [], 'headliners-grid': [], 'standup-grid': [], sponsors: [] };
    for (const r of people.rows) {
      const role = g(r, 'role').toLowerCase();
      const p = { name: g(r, 'name'), desc: g(r, 'description') || g(r, 'bio'),
                  img: g(r, 'image link') || g(r, 'logo link'), link: g(r, 'website') || g(r, 'link') };
      if (/sponsor/.test(role)) groups.sponsors.push(p);
      else if (/team/.test(role)) groups['teams-grid'].push(p);
      else if (/headlin/.test(role)) groups['headliners-grid'].push(p);
      else if (/stand/.test(role)) groups['standup-grid'].push(p);
      else groups['organizers-grid'].push(p);
    }
    for (const gridId of ['organizers-grid','teams-grid','headliners-grid','standup-grid'])
      fillGrid(gridId, groups[gridId]);
    const spEl = document.getElementById('sponsors-grid');
    if (spEl && groups.sponsors.length)
      spEl.innerHTML = groups.sponsors.map(s => sponsorTile({ name: s.name, img: s.img, link: s.link })).join('');
  }
  const fillPeople = (tableName, gridId) => {
    const t = tables[tableName];
    if (!t || !t.col || !t.rows.length) return;
    const g = getter(t);
    fillGrid(gridId, t.rows.map(r => ({
      name: g(r, 'name'), desc: g(r, 'description') || g(r, 'bio'), img: g(r, 'image link')
    })));
  };
  fillPeople('teams', 'teams-grid');
  fillPeople('headliners', 'headliners-grid');
  fillPeople('standup', 'standup-grid');
  fillPeople('standups', 'standup-grid');
  fillPeople('organizers', 'organizers-grid');

  const sp = tables['sponsors'], spEl = document.getElementById('sponsors-grid');
  if (sp && sp.col && sp.rows.length && spEl) {
    const g = getter(sp);
    spEl.innerHTML = sp.rows.map(r => sponsorTile({
      name: g(r, 'name'),
      img: g(r, 'logo link') || g(r, 'image link'),
      link: g(r, 'website') || g(r, 'link')
    })).join('');
  }

  // ---- overlay text swap, after everything is rendered ----
  applyOverlay(config);
})
.catch(err => console.warn('Sheet load failed \u2014 keeping placeholder content:', err));
})();


/* ---- mobile nav toggle ---- */
(() => {
  const nav = document.querySelector('.nav');
  const btn = document.querySelector('.nav-toggle');
  if (!nav || !btn) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }));
})();
