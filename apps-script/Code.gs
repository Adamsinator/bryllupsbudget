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
 *  - State    : hele planlægningen som JSON i A1 (det appen læser/skriver)
 *  - Poster   : læsbar kopi af budgetposterne
 *  - Gæster   : læsbar kopi af gæstelisten inkl. bord
 *  - Opgaver  : tidsplanens opgaver og dagens program
 *  - Noter    : noterne
 *  - Praktisk : steder, leverandører, taler/indslag og gaver
 *  - Historik : én række pr. ændring af totalerne (pris/betalt/buffer over tid)
 */
const ACCESS_CODE = 'SKIFT-MIG';
const API_VERSION = 3;

function doGet() { return out({ ok: true, v: API_VERSION }); }

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad-json', v: API_VERSION }); }
  if (body.code !== ACCESS_CODE) return out({ ok: false, error: 'bad-code', v: API_VERSION });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const current = readState();
    if (body.action === 'get') return out({ ok: true, state: current, v: API_VERSION });
    if (body.action === 'set') {
      const inc = body.state;
      if (!inc || !Array.isArray(inc.items)) return out({ ok: false, error: 'bad-state', v: API_VERSION });
      // Sidste skriver vinder – men en ældre klient må ikke overskrive nyere data.
      if (current && (current.updatedAt || 0) > (inc.updatedAt || 0)) return out({ ok: true, stale: true, state: current, v: API_VERSION });
      writeState(inc);
      try { mirrorItems(inc); mirrorGuests(inc); mirrorTasks(inc); mirrorNotes(inc); mirrorMore(inc); } catch (err) { /* spejling må aldrig blokere et gem */ }
      logHistory(inc);
      return out({ ok: true, state: inc, v: API_VERSION });
    }
    return out({ ok: false, error: 'bad-action', v: API_VERSION });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readState() {
  const raw = sheet('State').getRange('A1').getValue();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function writeState(state) {
  sheet('State').getRange('A1').setValue(JSON.stringify(state));
}

function plannedOf(item, guests) {
  return item.perGuest != null ? Math.round(item.perGuest * (guests || 0)) : (Number(item.planned) || 0);
}

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
    const p = plannedOf(i, s.guests), paid = Number(i.paid) || 0;
    rows.push([i.name, ownerName(i.owner, s), p, i.perGuest != null ? i.perGuest : '', paid, Math.max(0, p - paid), p > 0 && paid >= p ? 'Ja' : '', i.supplier || '', i.note || '']);
  });
  const planned = (s.items || []).reduce((a, i) => a + plannedOf(i, s.guests), 0);
  const paid = (s.items || []).reduce((a, i) => a + (Number(i.paid) || 0), 0);
  rows.push([]);
  rows.push(['I alt', '', planned, '', paid, Math.max(0, planned - paid)]);
  rows.push(['Ramme', '', Number(s.budget) || 0]);
  rows.push(['Buffer', '', (Number(s.budget) || 0) - planned]);
  rows.push(['Gæster (budget)', '', Number(s.guests) || 0]);
  rows.push(['Dato', '', s.date || '']);
  writeRows('Poster', rows);
}

function mirrorGuests(s) {
  const seat = {};
  (s.tables || []).forEach(t => (t.seatMap || t.guests || []).forEach((id, i) => { if (id) seat[id] = t.name + (t.seatMap ? ' (plads ' + (i + 1) + ')' : ''); }));
  const rows = [['Navn', 'Side', 'Relation', 'Svar', 'Barn', 'Overnatning', 'Kost / allergi', 'Bord', 'Note']];
  (s.guests_list || []).forEach(g => rows.push([g.name, sideName(g.side, s), g.rel || '', RSVP[g.rsvp] || g.rsvp, g.child ? 'Ja' : '', g.stay ? 'Ja' : '', g.diet || '', seat[g.id] || '', g.note || '']));
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
  writeRows('Praktisk', rows);
}

function logHistory(s) {
  const sh = sheet('Historik');
  if (sh.getLastRow() === 0) sh.appendRow(['Tidspunkt', 'Budget', 'Planlagt', 'Betalt', 'Buffer', 'Poster']);
  const planned = s.items.reduce((a, i) => a + plannedOf(i, s.guests), 0);
  const paid = s.items.reduce((a, i) => a + (Number(i.paid) || 0), 0);
  const row = [new Date(), Number(s.budget) || 0, planned, paid, (Number(s.budget) || 0) - planned, s.items.length];
  const last = sh.getLastRow();
  if (last > 1) {
    const prev = sh.getRange(last, 2, 1, 5).getValues()[0];
    if (prev.every((v, k) => Number(v) === row[k + 1])) return; // intet ændret i totalerne
  }
  sh.appendRow(row);
}
