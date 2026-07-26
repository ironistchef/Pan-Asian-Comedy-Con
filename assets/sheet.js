/* Pan Asian Comedy Con — shared sheet loader.
   Reads the published Google Sheet and fills whatever sections exist on this page.

   Sheet format: tables are marked by a row whose only filled cell is
   "<Name> Table" (e.g. "Schedule Table", "Teams Table"), followed by a
   header row, then data rows. A data row needs its Name cell filled.
   Loose "Key | Value" rows anywhere become site copy config.

   Recognized tables and their columns (order doesn't matter):
     Schedule Table:   Type, Day, T Start, T End, Venue, Name, Description, Image Link,
                       Featured, Purchase link
                       (Featured: TRUE / yes / x toggles the event into the homepage carousel;
                        Purchase link: Eventbrite URL for that event's buy button.
                        Also accepted: "Is Feature", "Ticket Link", "Eventbrite", "Link")
     Teams Table:      Name, Description, Image Link
     Headliners Table: Name, Description, Image Link
     Standup Table:    Name, Description, Image Link
     Organizers Table: Name, Bio (or Description), Image Link
     Sponsors Table:   Name, Logo Link, Website
*/
(() => {
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQFTalMTPLQlTSHy2Zh0tF4JK9ZTJM5YxLOLBO3I98seINE4sD12rlT2Nw03jsPjLJnWjzBIcOVaAWV/pub?output=csv';

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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

// split rows into named tables + loose key/value config
function segment(rows) {
  const tables = {}, config = {};
  let cur = null;
  for (const r of rows) {
    const cells = r.map(c => (c || '').trim());
    const filled = cells.filter(Boolean);

    if (filled.length === 1 && /table$/i.test(filled[0])) {
      const name = filled[0].toLowerCase().replace(/\s*table$/, '').trim();
      cur = name;
      tables[name] = { col: null, rows: [] };
      continue;
    }
    if (cur && !tables[cur].col) {           // header row of current table
      const col = {};
      cells.forEach((h, i) => { if (h) col[h.toLowerCase()] = i; });
      tables[cur].col = col;
      continue;
    }
    if (cur) {
      const t = tables[cur];
      const nameIdx = t.col['name'];
      if (nameIdx !== undefined && cells[nameIdx]) { t.rows.push(cells); continue; }
    }
    if (cells[0] && cells[1] && !cells[2]) config[cells[0]] = cells[1];
  }
  return { tables, config };
}

const getter = t => (row, key) => t.col[key] === undefined ? '' : (row[t.col[key]] || '').trim();

const GLYPHS = ['火','夜','組','新','壱','弐','参','季'];

function imgTag(url, alt) {
  return url && /^https?:\/\//i.test(url)
    ? `<img src="${esc(url)}" alt="${esc(alt || '')}" loading="lazy">`
    : '';
}

function eventCard(ev, tintPrefix, i) {
  const badges = [
    ev.day && `${esc(ev.day)}${ev.start ? ' · ' + esc(ev.start) : ''}`,
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

function ticketLink(url, label) {
  return url && /^https?:\/\//i.test(url)
    ? `<a class="card-link" href="${esc(url)}" target="_blank" rel="noopener">${label} <span class="arr">\u2192</span></a>`
    : `<a class="card-link" href="index.html#passes">${label} <span class="arr">\u2192</span></a>`;
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
  return s.link && /^https?:\/\//i.test(s.link)
    ? `<a class="sponsor-link" href="${esc(s.link)}" target="_blank" rel="noopener">${tile}</a>`
    : tile;
}

function timeVal(t) { // "2:00 PM" -> minutes since midnight, unparseable last
  const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(t || '');
  if (!m) return 1e9;
  let h = (+m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + (+m[2]);
}

fetch(SHEET_URL)
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
  .then(csv => {
    const { tables, config } = segment(parseCSV(csv));

    // ---- site copy from config rows (only elements present on this page) ----
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

    // ---- schedule table drives home cards + full timetable ----
    const sched = tables['schedule'];
    if (sched && sched.col && sched.rows.length) {
      const g = getter(sched);
      const events = sched.rows.map(r => ({
        type: g(r, 'type'), day: g(r, 'day'),
        start: g(r, 't start'), end: g(r, 't end'),
        venue: g(r, 'venue'), name: g(r, 'name'),
        desc: g(r, 'description'), img: g(r, 'image link'),
        feat: /^(true|yes|y|x|1|\u2713)$/i.test(g(r, 'featured') || g(r, 'is feature')),
        tick: g(r, 'purchase link') || g(r, 'ticket link') || g(r, 'eventbrite') || g(r, 'link')
      })).filter(e => /^(show|workshop|panel)$/i.test(e.type));

      // ---- featured carousel from "Is Feature" column ----
      const carEl = document.getElementById('carousel');
      const featured = events.filter(e => e.feat);
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
                  ${e.tick && /^https?:\/\//i.test(e.tick)
                    ? `<a class="sched-btn" href="${esc(e.tick)}" target="_blank" rel="noopener">Buy on Eventbrite</a>`
                    : ''}
                </div>
              </div>`).join('')}
          </div>`).join('');
      }
    }

    // ---- person-style tables ----
    const fillPeople = (tableName, gridId) => {
      const t = tables[tableName], el = document.getElementById(gridId);
      if (!t || !t.col || !t.rows.length || !el) return;
      const g = getter(t);
      el.innerHTML = t.rows.map((r, i) => personCard({
        name: g(r, 'name'),
        desc: g(r, 'description') || g(r, 'bio'),
        img: g(r, 'image link')
      }, i)).join('');
    };
    fillPeople('teams', 'teams-grid');
    fillPeople('headliners', 'headliners-grid');
    fillPeople('standup', 'standup-grid');
    fillPeople('standups', 'standup-grid');
    fillPeople('organizers', 'organizers-grid');

    // ---- sponsors ----
    const sp = tables['sponsors'], spEl = document.getElementById('sponsors-grid');
    if (sp && sp.col && sp.rows.length && spEl) {
      const g = getter(sp);
      spEl.innerHTML = sp.rows.map(r => sponsorTile({
        name: g(r, 'name'),
        img: g(r, 'logo link') || g(r, 'image link'),
        link: g(r, 'website') || g(r, 'link')
      })).join('');
    }
  })
  .catch(err => console.warn('Sheet load failed \u2014 keeping placeholder content:', err));
})();
