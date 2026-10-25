/**
 * Tests für den E-Mail-Versand (src/lib/mail.js, src/modul/Mail.js, src/api/Mail.js) und den Postausgang.
 * Prüft: MailBau (Escaping, Header-Injection, Logo nur https), Versand aus → Fehler, Testmodus, Kontingent ohne
 * Teilversand, replyTo je Anlass, Teilfehlschlag + erneut senden, Anschreiben-Zeilen und Protokoll ohne Adressen,
 * PDF-Anhang, Minderjährige an die Vertretung, Rechte (AL/JL abgewiesen, Kassier darf Mahnung mailen),
 * Postausgang (Austritt erscheint/verschwindet, Umstellung mit Elternkonto → Rückfrage Zahler).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ladeProjekt, rein } = require('./hilfe/projekt');
const { erzeugeFakes, isoZuSerial } = require('./hilfe/gas-fakes');
const { erzeugeVerein } = require('./daten/generator');

/** Synthetischer Verein + Standardvorlagen aus der Startbelegung. */
function verein() {
  const v = erzeugeVerein({ seed: 5, mitglieder: 200 });
  const g = ladeProjekt({});
  const sb = g.Startbelegung.Vorlage;
  const kopf = v.tabs.Vorlage[0];
  sb.zeilen.forEach(z => v.tabs.Vorlage.push(kopf.map(k => { const i = sb.kopf.indexOf(k); return i < 0 ? (k === 'version' ? 1 : '') : z[i]; })));
  const k = v.tabs._Konfig, iS = k[0].indexOf('schluessel'), iW = k[0].indexOf('wert');
  const zeile = k.find(r => r[iS] === 'next_id_Vorlage');
  if (zeile) zeile[iW] = String(sb.zeilen.length + 1); else k.push(k[0].map((h, j) => j === iS ? 'next_id_Vorlage' : j === iW ? String(sb.zeilen.length + 1) : ''));
  return v;
}
const V = verein();
const MB = ladeProjekt({}).MailBau;

function heute(plus) {
  const d = new Date(); d.setDate(d.getDate() + (plus || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Kopie der Tabs mit geänderten Konfig-Werten. */
function mitKonfig(tabs, werte) {
  const t = {};
  Object.keys(tabs).forEach(n => { t[n] = tabs[n].map(z => z.slice()); });
  const k = t._Konfig, iS = k[0].indexOf('schluessel'), iW = k[0].indexOf('wert');
  Object.keys(werte).forEach(s => {
    const z = k.find(r => r[iS] === s);
    if (z) z[iW] = werte[s]; else k.push(k[0].map((h, j) => j === iS ? s : j === iW ? werte[s] : ''));
  });
  return t;
}
const AN = { mail_aktiv: 'ja', mail_antwort_an: 'verwaltung@tsv-ergoldsbach.de', mail_antwort_an_finanzen: 'kassier@tsv-ergoldsbach.de' };

function als(rolle, tabs, fakeOpt) {
  const b = V.tabs.Benutzer, kb = b[0];
  const z = b.slice(1).find(r => r[kb.indexOf('rolle')] === rolle);
  const f = erzeugeFakes(Object.assign({ tabs: tabs || V.tabs, email: z[kb.indexOf('email')] }, fakeOpt || {}));
  const g = ladeProjekt(f.globale);
  const obj = tab => { const d = f.daten(tab); return d.slice(1).map(r => Object.fromEntries(d[0].map((h, i) => [h, r[i]]))); };
  const alleTabs = () => { const t = {}; Object.keys(V.tabs).forEach(n => { t[n] = f.daten(n).map(r => r.slice()); }); return t; };
  return { f, g, obj, alleTabs };
}
const ok = a => { a = rein(a); assert.strictEqual(a.ok, true, JSON.stringify(a.fehler)); return a.daten; };
const fehler = (a, art) => { a = rein(a); assert.strictEqual(a.ok, false, 'Fehler erwartet'); if (art) assert.strictEqual(a.fehler.art, art, a.fehler.meldung); return a.fehler; };
function vorlageId(u, anlass) { return ok(u.g.apiKorrespondenzVorlagen()).vorlagen.find(v => v.anlass === anlass).vorlage_id; }

/** Erwachsene mit E-Mail-Adresse (für Mitglied-Schreiben). */
function mitEmail(u, n) {
  const jahr = new Date().getFullYear();
  return u.obj('Mitglied').filter(m => m.status === 'aktiv' && m.email && m.geburtsdatum && m.geburtsdatum < isoZuSerial((jahr - 20) + '-01-01'))
    .slice(0, n);
}

// ------------------------------------------------------------------ MailBau (rein)

test('MailBau: alles escaped, kein Skript aus Vorlage/Briefkopf; Logo nur https; Klartext mit Kopf und Fuß', () => {
  const k = { mail_briefkopf: 'TSV <b>Ergoldsbach</b>|Mitglieder', mail_fusszeile: 'Impressum & Datenschutz|www.example.de', brief_unterschrift: 'Vorstand',
    mail_logo_url: 'javascript:alert(1)' };
  const b = { betreff: 'Hallo <script>alert(1)</script>', text: 'Absatz 1 <img src=x onerror=alert(1)>\n\nAbsatz "2" & \'3\'' };
  const h = MB.html(b, k);
  assert.ok(!/<script/i.test(h), 'script-Tag im HTML');
  assert.ok(!/<img src=x/i.test(h) && !/<b>/.test(h));
  assert.ok(h.includes('&lt;script&gt;') && h.includes('&lt;b&gt;Ergoldsbach&lt;/b&gt;') && h.includes('Impressum &amp; Datenschutz'));
  assert.ok(!/javascript:/.test(h), 'Logo darf nur https sein');
  assert.ok(/max-width:640px/.test(h));
  const mitLogo = MB.html(b, Object.assign({}, k, { mail_logo_url: 'https://www.example.de/logo.png' }));
  assert.ok(mitLogo.includes('<img src="https://www.example.de/logo.png"'));
  assert.ok(!MB.html(b, Object.assign({}, k, { mail_logo_url: 'http://www.example.de/logo.png' })).includes('<img'));
  const t = MB.text(b, k);
  assert.match(t, /^TSV <b>Ergoldsbach<\/b>\nMitglieder\n/);   // Klartext bleibt Text
  assert.match(t, /Vorstand\n\n--\nImpressum & Datenschutz\nwww\.example\.de$/);
});

test('MailBau: Header-Injection – Betreff ohne Umbrüche, genau eine Adresse', () => {
  assert.strictEqual(MB.betreff('Hallo\r\nBcc: x@evil.de'), 'Hallo Bcc: x@evil.de');
  assert.ok(!/[\r\n]/.test(MB.betreff('a\nb\u0000c')));
  ['a@b.de', 'vorname.nachname+tsv@example.co.uk'].forEach(a => assert.ok(MB.adresseOk(a), a));
  ['', 'a@b', 'a@b.de, c@d.de', 'a@b.de;c@d.de', 'a@b.de\nBcc: c@d.de', 'Name <a@b.de>', 'a b@c.de', 'a@@b.de'].forEach(a => assert.ok(!MB.adresseOk(a), a));
  const k = { mail_antwort_an: 'verwaltung@x.de', mail_antwort_an_finanzen: 'kasse@x.de' };
  assert.strictEqual(MB.antwortAn('Mahnung', k), 'kasse@x.de');
  assert.strictEqual(MB.antwortAn('Rückfrage Zahler', k), 'kasse@x.de');
  assert.strictEqual(MB.antwortAn('Austrittsbestätigung', k), 'verwaltung@x.de');
  assert.strictEqual(MB.antwortAn('Mahnung', { mail_antwort_an: 'verwaltung@x.de' }), 'verwaltung@x.de');
  assert.strictEqual(MB.antwortAn('Allgemein', { mail_antwort_an: 'a@b.de, c@d.de' }), null);
});

// ------------------------------------------------------------------ Versand

test('Versand ausgeschaltet → klare Meldung, nichts gespeichert', () => {
  const u = als('Mitgliederverwalter');
  const ids = mitEmail(u, 2).map(m => m.mitglied_id);
  const f = fehler(u.g.apiMailSenden(vorlageId(u, 'Austrittsbestätigung'), { mitglied_ids: ids }, {}), 'fachlich');
  assert.match(f.meldung, /E-Mail-Versand ist ausgeschaltet \(Verwaltung → Einstellungen\)/);
  assert.strictEqual(u.f.mails.length, 0);
  assert.strictEqual(u.obj('Anschreiben').length, 0);
  const s = ok(u.g.apiMailStatus());
  assert.strictEqual(s.aktiv, false);
  assert.strictEqual(s.testmodus, false);
});

test('Testmodus: alle Mails an die Testadresse, Betreff [TEST], Status testmodus, email_an = eigentlicher Empfänger', () => {
  const u = als('Mitgliederverwalter', mitKonfig(V.tabs, { mail_test_an: 'test@tsv-ergoldsbach.de' }));
  const ms = mitEmail(u, 3);
  const vid = vorlageId(u, 'Austrittsbestätigung');
  const r = ok(u.g.apiMailSenden(vid, { mitglied_ids: ms.map(m => m.mitglied_id) }, {}));
  assert.strictEqual(r.testmodus, true);
  assert.strictEqual(r.gesendet, 3);
  assert.strictEqual(u.f.mails.length, 3);
  assert.ok(u.f.mails.every(m => m.to === 'test@tsv-ergoldsbach.de' && /^\[TEST\] /.test(m.subject)));
  assert.ok(u.f.mails.every(m => m.htmlBody.includes('TSV Ergoldsbach e. V.') && m.body.includes('Impressum')), 'Briefkopf/Fußzeile');
  const zeilen = u.obj('Anschreiben');
  assert.strictEqual(zeilen.length, 3);
  assert.ok(zeilen.every(z => z.mail_status === 'testmodus' && z.versandart === 'E-Mail' && z.gesendet_am));
  assert.deepStrictEqual(zeilen.map(z => z.email_an).sort(), ms.map(m => m.email).sort());
});

test('Kontingent zu klein → Meldung ohne Teilversand; mail_max_je_lauf begrenzt', () => {
  const u = als('Mitgliederverwalter', mitKonfig(V.tabs, AN), { mailKontingent: 2 });
  const ids = mitEmail(u, 3).map(m => m.mitglied_id);
  const vid = vorlageId(u, 'Austrittsbestätigung');
  const f = fehler(u.g.apiMailSenden(vid, { mitglied_ids: ids }, {}), 'fachlich');
  assert.match(f.meldung, /nur noch 2 E-Mails/);
  assert.strictEqual(u.f.mails.length, 0);
  assert.strictEqual(u.obj('Anschreiben').length, 0, 'keine Entwürfe bei abgelehntem Versand');
  const u2 = als('Mitgliederverwalter', mitKonfig(V.tabs, Object.assign({ mail_max_je_lauf: '2' }, AN)));
  assert.match(fehler(u2.g.apiMailSenden(vid, { mitglied_ids: ids }, {}), 'fachlich').meldung, /Höchstens 2 E-Mails/);
});

test('Echter Versand: Absendername, replyTo je Anlass, PDF-Anhang bei Bestätigungen, Protokoll ohne Adressen/Inhalte', () => {
  const u = als('Mitgliederverwalter', mitKonfig(V.tabs, AN));
  const ms = mitEmail(u, 2);
  const r = ok(u.g.apiMailSenden(vorlageId(u, 'Austrittsbestätigung'), { mitglied_ids: ms.map(m => m.mitglied_id) }, {}));
  assert.strictEqual(r.testmodus, false);
  assert.strictEqual(u.f.mails.length, 2);
  const m0 = u.f.mails[0];
  assert.strictEqual(m0.name, 'TSV Ergoldsbach e. V. – Mitgliederverwaltung');
  assert.strictEqual(m0.replyTo, 'verwaltung@tsv-ergoldsbach.de');
  assert.ok(!/\[TEST\]/.test(m0.subject));
  assert.strictEqual(m0.attachments.length, 1);
  assert.match(m0.attachments[0].getName(), /^Austrittsbestätigung_.*\.pdf$/);
  assert.strictEqual(m0.attachments[0].getContentType(), 'application/pdf');
  const zeilen = u.obj('Anschreiben');
  assert.ok(zeilen.every(z => z.mail_status === 'gesendet'));
  const prot = u.obj('_Protokoll').filter(p => p.tabelle === 'E-Mail');
  assert.strictEqual(prot.length, 1);
  assert.strictEqual(prot[0].aktion, 'exportiert');
  assert.match(prot[0].kommentar, /Austrittsbestätigung: 2 gesendet/);
  const txt = JSON.stringify(u.obj('_Protokoll'));
  ms.forEach(m => assert.ok(!txt.includes(m.email), 'Adresse im Protokoll'));
  assert.ok(!txt.includes('Kündigung'), 'Inhalt im Protokoll');
  // Rechnung → Antwort an die Kasse, kein PDF
  const u2 = als('Mitgliederverwalter', mitKonfig(V.tabs, AN));
  const kontoMitInhaber = u2.obj('Beitragskonto').find(k => {
    const inh = u2.obj('Mitglied').find(m => m.mitglied_id === k.kontoinhaber_mitglied_id);
    return inh && inh.email;
  });
  ok(u2.g.apiMailSenden(vorlageId(u2, 'Rechnung'), { beitragskonto_ids: [kontoMitInhaber.beitragskonto_id] }, {}));
  assert.strictEqual(u2.f.mails[0].replyTo, 'kassier@tsv-ergoldsbach.de');
  assert.ok(!u2.f.mails[0].attachments);
});

test('PDF-Umwandlung scheitert → Mail ohne Anhang mit Hinweis', () => {
  const u = als('Mitgliederverwalter', mitKonfig(V.tabs, AN), { pdfFehler: true });
  const ms = mitEmail(u, 1);
  const r = ok(u.g.apiMailSenden(vorlageId(u, 'Austrittsbestätigung'), { mitglied_ids: ms.map(m => m.mitglied_id) }, {}));
  assert.strictEqual(r.gesendet, 1);
  assert.ok(!u.f.mails[0].attachments);
  assert.match(r.bericht[0].hinweis, /PDF-Anhang/);
});

test('Teilfehlschlag: andere werden gesendet, fehlgeschlagene erneut senden; ohne Adresse im Bericht', () => {
  const u0 = als('Mitgliederverwalter', mitKonfig(V.tabs, AN));
  const ms = mitEmail(u0, 3);
  const ohne = u0.obj('Mitglied').find(m => m.status === 'aktiv' && !m.email && m.geburtsdatum && m.geburtsdatum < isoZuSerial('1990-01-01'));
  const u = als('Mitgliederverwalter', mitKonfig(V.tabs, AN), { mailFehlerAn: [ms[1].email] });
  const r = ok(u.g.apiMailSenden(vorlageId(u, 'Austrittsbestätigung'), { mitglied_ids: ms.map(m => m.mitglied_id).concat([ohne.mitglied_id]) }, {}));
  assert.strictEqual(r.gesendet, 2);
  assert.strictEqual(r.fehlgeschlagen, 1);
  assert.strictEqual(r.bericht.filter(b => b.status === 'ohne Adresse').length, 1);
  assert.ok(!JSON.stringify(r).includes('Invalid email'), 'technische Fehlermeldung an den Browser');
  const fehl = u.obj('Anschreiben').filter(z => z.mail_status === 'fehlgeschlagen');
  assert.strictEqual(fehl.length, 1);
  assert.strictEqual(fehl[0].email_an, ms[1].email);
  assert.match(u.obj('_Protokoll').find(p => p.tabelle === 'E-Mail').kommentar, /2 gesendet, 1 fehlgeschlagen/);
  // bereits gesendete dürfen nicht erneut gesendet werden
  const gesendet = u.obj('Anschreiben').find(z => z.mail_status === 'gesendet');
  fehler(u.g.apiMailErneutSenden([gesendet.anschreiben_id]), 'fachlich');
  // neuer Lauf ohne Störung
  const u2 = als('Mitgliederverwalter', u.alleTabs());
  const r2 = ok(u2.g.apiMailErneutSenden([fehl[0].anschreiben_id]));
  assert.strictEqual(r2.gesendet, 1);
  assert.strictEqual(u2.f.mails[0].to, ms[1].email);
  assert.match(u2.f.mails[0].body, /Kündigung/);
  assert.strictEqual(u2.obj('Anschreiben').find(z => z.anschreiben_id === fehl[0].anschreiben_id).mail_status, 'gesendet');
});

test('Minderjährige: E-Mail an die Vertretung (vertreter_kontakt bzw. Vertretungs-Mitglied)', () => {
  const t = mitKonfig(V.tabs, AN);
  const kopf = t.Mitglied[0], i = n => kopf.indexOf(n);
  const jahr = new Date().getFullYear();
  const kinder = t.Mitglied.slice(1).filter(r => r[i('status')] === 'aktiv' && r[i('geburtsdatum')] > isoZuSerial((jahr - 12) + '-01-01'));
  assert.ok(kinder.length >= 2);
  const eltern = t.Mitglied.slice(1).find(r => r[i('email')] && r[i('geburtsdatum')] < isoZuSerial('1990-01-01'));
  kinder[0][i('email')] = 'kind@example.de';
  kinder[0][i('vertreter_kontakt')] = 'eltern.kind@example.de';
  kinder[1][i('email')] = '';
  kinder[1][i('vertreter_kontakt')] = '0170 1234567';
  kinder[1][i('vertreter_mitglied_id')] = eltern[i('mitglied_id')];
  const u = als('Mitgliederverwalter', t);
  const v = ok(u.g.apiKorrespondenzVorschau(vorlageId(u, 'Aufnahmebestätigung'), { mitglied_ids: [kinder[0][i('mitglied_id')], kinder[1][i('mitglied_id')]] }, {}));
  assert.strictEqual(v.briefe[0].email, 'eltern.kind@example.de');
  assert.strictEqual(v.briefe[1].email, eltern[i('email')]);
  assert.ok(v.briefe.every(b => /Vertretung/.test(b.kanal_hinweis)));
});

test('Rechte: Abteilungs-/Jugendleiter abgewiesen, Kassier darf Mahnung mailen (an den Kontoinhaber)', () => {
  const t = mitKonfig(V.tabs, AN);
  ['Abteilungsleiter', 'Jugendleiter'].forEach(r => {
    const u = als(r, t);
    fehler(u.g.apiMailSenden(1, { mitglied_ids: [1] }, {}), 'zugriff');
    fehler(u.g.apiMailErneutSenden([1]), 'zugriff');
    fehler(u.g.apiMailVorschlaege(), 'zugriff');
    assert.strictEqual(u.f.mails.length, 0);
  });
  const k = als('Kassier', t);
  const soll = k.obj('Sollstellung').find(s => {
    const konto = k.obj('Beitragskonto').find(x => x.beitragskonto_id === s.beitragskonto_id);
    const inh = konto && k.obj('Mitglied').find(m => m.mitglied_id === konto.kontoinhaber_mitglied_id);
    return inh && inh.email;
  });
  const konto = k.obj('Beitragskonto').find(x => x.beitragskonto_id === soll.beitragskonto_id);
  const inh = k.obj('Mitglied').find(m => m.mitglied_id === konto.kontoinhaber_mitglied_id);
  const r = ok(k.g.apiMailSenden(vorlageId(k, 'Mahnung'), { sollstellung_ids: [soll.sollstellung_id] }, { mahnstufe: 1 }));
  assert.strictEqual(r.gesendet, 1);
  assert.strictEqual(k.f.mails[0].to, inh.email);
  assert.strictEqual(k.f.mails[0].replyTo, 'kassier@tsv-ergoldsbach.de');
  assert.ok(!/DE\d{20}/.test(k.f.mails[0].body), 'IBAN-Klartext in der Mail');
});

// ------------------------------------------------------------------ Postausgang

test('Postausgang: Austritt ohne Bestätigung erscheint und verschwindet nach dem Versand', () => {
  const t = mitKonfig(V.tabs, AN);
  const mk = t.Mitglied[0], im = n => mk.indexOf(n);
  const zk = t.Mitgliedschaftszeitraum[0], iz = n => zk.indexOf(n);
  const person = t.Mitglied.slice(1).find(r => r[im('status')] === 'aktiv' && r[im('email')] && r[im('geburtsdatum')] < isoZuSerial('1990-01-01'));
  const id = person[im('mitglied_id')];
  const zr = t.Mitgliedschaftszeitraum.slice(1).filter(r => r[iz('mitglied_id')] === id).pop();
  zr[iz('kuendigung_eingang')] = isoZuSerial(heute(-3));
  zr[iz('austrittsdatum')] = isoZuSerial((new Date().getFullYear()) + '-12-31');
  zr[iz('austritt_wirksam')] = isoZuSerial((new Date().getFullYear()) + '-12-31');
  const u = als('Mitgliederverwalter', t);
  const v = ok(u.g.apiMailVorschlaege());
  const g = v.gruppen.find(x => x.id === 'austritt');
  assert.ok(g, 'Gruppe Austritt fehlt');
  assert.ok(g.auswahl.mitglied_ids.includes(id));
  assert.strictEqual(g.anlass, 'Austrittsbestätigung');
  assert.ok(ok(u.g.apiMailVorschlaegeAnzahl()).anzahl >= 1);
  ok(u.g.apiMailSenden(vorlageId(u, 'Austrittsbestätigung'), { mitglied_ids: [id] }, {}));
  const v2 = ok(u.g.apiMailVorschlaege());
  const g2 = v2.gruppen.find(x => x.id === 'austritt');
  assert.ok(!g2 || !g2.auswahl.mitglied_ids.includes(id), 'nach dem Versand nicht mehr vorgeschlagen');
  assert.strictEqual(v2.anzahl, v.anzahl - 1);
});

test('Postausgang: Umstellung auf Einzelbeitrag mit Elternkonto → Rückfrage Zahler; Versand an den Kontoinhaber', () => {
  const t = mitKonfig(V.tabs, AN);
  const o = tab => t[tab].slice(1).map(r => Object.fromEntries(t[tab][0].map((h, i) => [h, r[i]])));
  const konten = Object.fromEntries(o('Beitragskonto').map(k => [k.beitragskonto_id, k]));
  const mitglieder = Object.fromEntries(o('Mitglied').map(m => [m.mitglied_id, m]));
  const kind = o('Mitglied').find(m => m.status === 'aktiv' && m.beitragsgemeinschaft_id && konten[m.beitragskonto_id] &&
    konten[m.beitragskonto_id].kontoinhaber_mitglied_id && konten[m.beitragskonto_id].kontoinhaber_mitglied_id !== m.mitglied_id &&
    (mitglieder[konten[m.beitragskonto_id].kontoinhaber_mitglied_id] || {}).email);
  assert.ok(kind, 'Testdaten: Kind über Elternkonto');
  const inhaber = mitglieder[konten[kind.beitragskonto_id].kontoinhaber_mitglied_id];
  const mk = t.Mitglied[0];
  const zeile = t.Mitglied.find(r => r[mk.indexOf('mitglied_id')] === kind.mitglied_id);
  zeile[mk.indexOf('beitragsgemeinschaft_id')] = '';
  zeile[mk.indexOf('beitragsart_id')] = o('Beitragsart')[0].beitragsart_id;
  const pk = t._Protokoll[0];
  t._Protokoll.push(pk.map(h => ({ protokoll_id: t._Protokoll.length, zeitpunkt: isoZuSerial(heute(-2) + 'T10:00:00'), benutzer_email: 'mv@tsv-ergoldsbach.de',
    aktion: 'geändert', tabelle: 'Mitglied', datensatz_id: String(kind.mitglied_id), feld: 'beitragsgemeinschaft_id', alt_wert: String(kind.beitragsgemeinschaft_id),
    neu_wert: '', kommentar: 'Umstellung auf Einzelbeitrag zum ' + (new Date().getFullYear() + 1) + '-01-01', bereinigt_am: '' })[h]));
  const u = als('Mitgliederverwalter', t);
  const v = ok(u.g.apiMailVorschlaege());
  const g = v.gruppen.find(x => x.id === 'rueckfrage');
  assert.ok(g && g.auswahl.mitglied_ids.includes(kind.mitglied_id), 'Rückfrage-Vorschlag fehlt');
  assert.strictEqual(g.anlass, 'Rückfrage Zahler');
  assert.strictEqual(g.zusatz.wirksam, (new Date().getFullYear() + 1) + '-01-01');
  // eigenes Konto → kein Vorschlag
  assert.ok(!(v.gruppen.find(x => x.id === 'rueckfrage').auswahl.mitglied_ids.some(id => {
    const m = mitglieder[id]; return konten[m.beitragskonto_id].kontoinhaber_mitglied_id === id;
  })));
  const vid = vorlageId(u, 'Rückfrage Zahler');
  const vs = ok(u.g.apiKorrespondenzVorschau(vid, { mitglied_ids: [kind.mitglied_id] }, g.zusatz));
  assert.deepStrictEqual(vs.unbekannt, []);
  assert.strictEqual(vs.briefe[0].email, String(inhaber.email));
  assert.match(vs.briefe[0].text, /ab 01\.01\.\d{4}/);
  assert.match(vs.briefe[0].text, /Bitte antworten Sie bis zum \d\d\.\d\d\.\d{4}/);
  const r = ok(u.g.apiMailSenden(vid, { mitglied_ids: [kind.mitglied_id] }, g.zusatz));
  assert.strictEqual(u.f.mails[0].to, String(inhaber.email));
  assert.strictEqual(u.f.mails[0].replyTo, 'kassier@tsv-ergoldsbach.de');
  const notizModul = typeof u.g.Notizen !== 'undefined' && u.g.Notizen && u.g.Notizen.rueckfrageAnlegen;
  if (notizModul) {
    const n = u.obj('Notiz').filter(x => x.mitglied_id === kind.mitglied_id && x.art === 'Rückfrage');
    assert.strictEqual(n.length, 1, 'Wiedervorlage angelegt');
    assert.strictEqual(n[0].anschreiben_id, r.bericht[0].anschreiben_id);
  } else {
    assert.ok(r.hinweise.some(h => /Wiedervorlage/.test(h)));
  }
  const g2 = ok(u.g.apiMailVorschlaege()).gruppen.find(x => x.id === 'rueckfrage');
  assert.ok(!g2 || !g2.auswahl.mitglied_ids.includes(kind.mitglied_id));
});
