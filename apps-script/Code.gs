/**
 * Bryllupsbudget – delt lagring via Google Apps Script.
 *
 * Opsætning (én gang):
 *  1. Opret et nyt Google Sheet (fx "Bryllupsbudget") – det behøver ikke deles med nogen.
 *  2. Udvidelser → Apps Script. Slet indholdet og indsæt denne fil.
 *  3. Skift ACCESS_CODE herunder til jeres egen kode (den I begge indtaster i appen).
 *  4. Deploy → New deployment → Type: Web app.
 *       Execute as: Me   ·   Who has access: Anyone
 *     Kopiér web-app-URL'en ind i config.js (API_URL).
 *  5. Ret senere i scriptet? Deploy → Manage deployments → ✏️ → New version
 *     (så beholder URL'en sig – lav IKKE en ny deployment).
 *
 * Arket får disse faner (alle genskrives ved hvert gem, undtagen Historik):
 *  - State    : hele planlægningen som JSON i kolonne A (delt i bidder à 40.000 tegn – rør ikke)
 *  - Poster   : læsbar kopi af budgetposterne
 *  - Gæster   : læsbar kopi af gæstelisten inkl. bord
 *  - Opgaver  : tidsplanens opgaver og dagens program
 *  - Noter    : noterne
 *  - Praktisk : steder, leverandører, taler/indslag og gaver
 *  - Backup   : de seneste 50 versioner af State (nyeste øverst), højst én hvert 5. minut
 *  - Historik : én række pr. ændring af totalerne (pris/betalt/buffer over tid)
 */
const ACCESS_CODE = 'SKIFT-MIG';
const API_VERSION = 5;
const CHUNK = 40000;          // en celle kan max rumme 50.000 tegn – State deles i bidder i kolonne A
const MIRROR_EVERY_MS = 60000; // de læsbare faner genskrives højst hvert minut (gem skal være hurtigt)
const BACKUP_EVERY_MS = 5 * 60000;
const BACKUPS = 50; // antal gem der gemmes i Backup-fanen

function doGet() { return out({ ok: true, v: API_VERSION }); }

function doPost(e) {
  try {
    return handle(e);
  } catch (err) {
    // Altid JSON tilbage – aldrig Googles HTML-fejlside (så appen kan vise hvad der gik galt)
    return out({ ok: false, error: 'server', message: String(err && err.message || err), v: API_VERSION });
  }
}

function handle(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad-json', v: API_VERSION }); }
  if (body.code !== ACCESS_CODE) return out({ ok: false, error: 'bad-code', v: API_VERSION });

  if (body.action === 'get') return out({ ok: true, state: readState(), v: API_VERSION });
  if (body.action !== 'set') return out({ ok: false, error: 'bad-action', v: API_VERSION });

  const inc = body.state;
  if (!inc || !Array.isArray(inc.items)) return out({ ok: false, error: 'bad-state', v: API_VERSION });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return out({ ok: false, error: 'busy', message: 'Serveren var optaget – prøver igen', v: API_VERSION });
  try {
    const current = readState();
    // Sidste skriver vinder – men en ældre klient må ikke overskrive nyere data.
    if (current && (current.updatedAt || 0) > (inc.updatedAt || 0)) return out({ ok: true, stale: true, state: current, v: API_VERSION });
    writeState(inc);
    // De tunge ting (spejlfaner, backup, historik) kører kun af og til, så et gem tager under et sekund
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const lastMirror = Number(props.getProperty('lastMirror') || 0);
    if (now - lastMirror > MIRROR_EVERY_MS) {
      props.setProperty('lastMirror', String(now));
      try { mirrorItems(inc); mirrorGuests(inc); mirrorTasks(inc); mirrorNotes(inc); mirrorMore(inc); logHistory(inc); } catch (err) { /* spejling må aldrig blokere et gem */ }
    }
    const lastBackup = Number(props.getProperty('lastBackup') || 0);
    if (now - lastBackup > BACKUP_EVERY_MS) { props.setProperty('lastBackup', String(now)); try { backup(inc); } catch (err) {} }
    return out({ ok: true, updatedAt: inc.updatedAt, v: API_VERSION });
  } finally {
    lock.releaseLock();
  }
}

// Kald denne manuelt fra editoren (Kør ▶), hvis du vil have spejlfanerne opdateret nu
function refreshMirrors() { const s = readState(); if (s) { mirrorItems(s); mirrorGuests(s); mirrorTasks(s); mirrorNotes(s); mirrorMore(s); logHistory(s); backup(s); } }

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readState() {
  const sh = sheet('State');
  const last = Math.max(1, sh.getLastRow());
  const cells = sh.getRange(1, 1, last, 1).getValues().map(r => String(r[0] || ''));
  const raw = cells.join('');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function writeState(state) {
  const json = JSON.stringify(state);
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push([json.slice(i, i + CHUNK)]);
  const sh = sheet('State');
  sh.clearContents();
  sh.getRange(1, 1, parts.length, 1).setValues(parts);
}

function plannedOf(item, guests) {
  return item.perGuest != null ? Math.round(item.perGuest * (guests || 0)) : (Number(item.planned) || 0);
}
function guestsOf(s) { return Number(s.guestsEffective != null ? s.guestsEffective : s.guests) || 0; }

function ownerName(o, s) { return o === 'A' ? s.nameA : o === 'B' ? s.nameB : o === 'AB' ? 'Begge' : ''; }
function sideName(o, s) { return o === 'A' ? s.nameA + 's' : o === 'B' ? s.nameB + 's' : 'Fælles'; }
const RSVP = { yes: 'Ja', maybe: 'Afventer', no: 'Nej' };

function writeRows(name, rows) {
  const sh = sheet(name);
  sh.clearContents();
  const width = Math.max.apply(null, rows.map(r => r.length));
  sh.getRange(1, 1, rows.length, width).setValues(rows.map(r => { r = r.slice(); while (r.length < width) r.push(''); return r; }));
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
}

function mirrorItems(s) {
  const rows = [['Post', 'Hvem ordner', 'Pris', 'Pris pr. gæst', 'Betalt', 'Mangler', 'Betalt?', 'Leverandør', 'Note']];
  (s.items || []).forEach(i => {
    const p = plannedOf(i, guestsOf(s)), paid = Number(i.paid) || 0;
    rows.push([i.name, ownerName(i.owner, s), p, i.perGuest != null ? i.perGuest : '', paid, Math.max(0, p - paid), p > 0 && paid >= p ? 'Ja' : '', i.supplier || '', i.note || '']);
  });
  const planned = (s.items || []).reduce((a, i) => a + plannedOf(i, guestsOf(s)), 0);
  const paid = (s.items || []).reduce((a, i) => a + (Number(i.paid) || 0), 0);
  rows.push([]);
  rows.push(['I alt', '', planned, '', paid, Math.max(0, planned - paid)]);
  rows.push(['Ramme', '', Number(s.budget) || 0]);
  rows.push(['Buffer', '', (Number(s.budget) || 0) - planned]);
  rows.push(['Gæster (budget)', '', guestsOf(s)]);
  rows.push(['Dato', '', s.date || '']);
  writeRows('Poster', rows);
}

function mirrorGuests(s) {
  const seat = {};
  (s.tables || []).forEach(t => (t.seatMap || t.guests || []).forEach((id, i) => { if (id) seat[id] = t.name + (t.seatMap ? ' (plads ' + (i + 1) + ')' : ''); }));
  const rows = [['Navn', 'Side', 'Køn', 'Relation', 'Svar', 'Barn', 'Overnatning', 'Kost / allergi', 'Bord', 'Note']];
  (s.guests_list || []).forEach(g => rows.push([g.name, sideName(g.side, s), g.sex === 'f' ? 'Kvinde' : g.sex === 'm' ? 'Mand' : '', g.rel || '', RSVP[g.rsvp] || g.rsvp, g.child ? 'Ja' : '', g.stay ? 'Ja' : '', g.diet || '', seat[g.id] || '', g.note || '']));
  const yes = (s.guests_list || []).filter(g => g.rsvp === 'yes').length;
  rows.push([]);
  rows.push(['Inviteret', (s.guests_list || []).length]);
  rows.push(['Ja', yes]);
  rows.push(['Afventer', (s.guests_list || []).filter(g => g.rsvp === 'maybe').length]);
  rows.push(['Nej', (s.guests_list || []).filter(g => g.rsvp === 'no').length]);
  writeRows('Gæster', rows);
}

function mirrorTasks(s) {
  const rows = [['Opgave', 'Deadline', 'Hvem', 'Klaret']];
  (s.tasks || []).slice().sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1).forEach(t => rows.push([t.title, t.due || '', ownerName(t.owner, s), t.done ? 'Ja' : '']));
  rows.push([]);
  rows.push(['Dagens program']);
  rows.push(['Tid', 'Punkt', 'Detaljer']);
  (s.program || []).slice().sort((a, b) => a.time.localeCompare(b.time)).forEach(p => rows.push([p.time, p.title, p.desc || '']));
  writeRows('Opgaver', rows);
}

function mirrorNotes(s) {
  const rows = [['Titel', 'Hvem', 'Fastgjort', 'Opdateret', 'Indhold']];
  (s.notes || []).forEach(n => rows.push([n.title, ownerName(n.who, s), n.pin ? 'Ja' : '', new Date(n.updated || 0), n.body || '']));
  writeRows('Noter', rows);
}

function mirrorMore(s) {
  const rows = [['Steder'], ['Navn', 'Rolle', 'Adresse', 'Tid', 'Kontakt', 'Telefon', 'Note']];
  (s.places || []).forEach(p => rows.push([p.name, p.role, p.address, p.time, p.contact, p.phone, p.note]));
  rows.push([]); rows.push(['Leverandører']); rows.push(['Navn', 'Kategori', 'Status', 'Kontakt', 'Telefon', 'E-mail', 'Aftalt', 'Mangler', 'Note']);
  const VS = { idea: 'Ikke kontaktet', contacted: 'I dialog', booked: 'Booket' };
  (s.vendors || []).forEach(v => rows.push([v.name, v.cat, VS[v.status] || v.status, v.contact, v.phone, v.email, v.agreed, v.missing, v.note]));
  rows.push([]); rows.push(['Taler og indslag']); rows.push(['Hvem', 'Hvad', 'Hvornår', 'Minutter', 'Aftalt', 'Note']);
  (s.speeches || []).forEach(x => rows.push([x.who, x.what, x.when, x.minutes, x.done ? 'Ja' : '', x.note]));
  rows.push([]); rows.push(['Gaver']); rows.push(['Fra', 'Gave', 'Takkekort sendt', 'Note']);
  (s.gifts || []).forEach(g => rows.push([g.from, g.gift, g.thanked ? 'Ja' : '', g.note]));
  rows.push([]); rows.push(['Ønskeseddel']); rows.push(['Ønske', 'Hvor / link', 'Ca. pris', 'Reserveret af', 'Note']);
  (s.wishes || []).forEach(w => rows.push([w.text, w.link, w.price || '', w.by, w.note]));
  writeRows('Praktisk', rows);
}

// Gemmer de seneste BACKUPS versioner, så et uheld kan rulles tilbage:
// Gendan: kopiér JSON-bidderne fra en Backup-række (kolonne D, E, …) sammen til én fil og importér den i appen –
// eller kald restoreBackup(rækkenummer) herfra i editoren.
function backup(s) {
  const sh = sheet('Backup');
  if (sh.getLastRow() === 0) sh.appendRow(['Tidspunkt', 'Poster', 'Gæster', 'JSON (bidder)']);
  sh.insertRowAfter(1);
  const json = JSON.stringify(s); const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
  sh.getRange(2, 1, 1, 3 + parts.length).setValues([[new Date(), (s.items || []).length, (s.guests_list || []).length].concat(parts)]);
  const last = sh.getLastRow();
  if (last > BACKUPS + 1) sh.deleteRows(BACKUPS + 2, last - BACKUPS - 1);
}

function restoreBackup(row) {
  const sh = sheet('Backup');
  const vals = sh.getRange(row, 4, 1, Math.max(1, sh.getLastColumn() - 3)).getValues()[0].map(v => String(v || '')).join('');
  const s = JSON.parse(vals); s.updatedAt = Date.now();
  writeState(s);
  Logger.log('Gendannet fra række ' + row + ' (' + (s.items || []).length + ' poster, ' + (s.guests_list || []).length + ' gæster)');
}

function logHistory(s) {
  const sh = sheet('Historik');
  if (sh.getLastRow() === 0) sh.appendRow(['Tidspunkt', 'Budget', 'Planlagt', 'Betalt', 'Buffer', 'Poster']);
  const planned = s.items.reduce((a, i) => a + plannedOf(i, guestsOf(s)), 0);
  const paid = s.items.reduce((a, i) => a + (Number(i.paid) || 0), 0);
  const row = [new Date(), Number(s.budget) || 0, planned, paid, (Number(s.budget) || 0) - planned, s.items.length];
  const last = sh.getLastRow();
  if (last > 1) {
    const prev = sh.getRange(last, 2, 1, 5).getValues()[0];
    if (prev.every((v, k) => Number(v) === row[k + 1])) return; // intet ændret i totalerne
  }
  sh.appendRow(row);
}
