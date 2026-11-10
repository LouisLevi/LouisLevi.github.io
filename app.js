(function () {
'use strict';

/* Meine Fixkosten - eigenstaendige App.
   Alle Daten bleiben nur auf diesem Geraet (localStorage). Keine externen Aufrufe. */

const CATEGORIES = [
    { name: 'Miete', color: '#7ea6ff' },
    { name: 'Strom', color: '#f5c044' },
    { name: 'Heizung', color: '#f08c4a' },
    { name: 'Internet', color: '#9b8cff' },
    { name: 'Versicherung', color: '#73a89a' },
    { name: 'Abo', color: '#f27ba7' },
    { name: 'Sonstiges', color: '#9aa0a6' },
];
const colorOf = (category) => (CATEGORIES.find(c => c.name === category) || {}).color || '#9aa0a6';

const RHYTHMS = [
    { value: 'monatlich', label: 'Monatlich', factor: 1 },
    { value: 'vierteljaehrlich', label: 'Vierteljährlich', factor: 1 / 3 },
    { value: 'halbjaehrlich', label: 'Halbjährlich', factor: 1 / 6 },
    { value: 'jaehrlich', label: 'Jährlich', factor: 1 / 12 },
];

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const fmt = (value) => euro.format(value);

function monthlyOf(entry) {
    if (entry.amount === null) return 0;
    const rhythm = RHYTHMS.find(r => r.value === entry.rhythm) || RHYTHMS[0];
    return entry.amount * rhythm.factor;
}

function parseAmount(text) {
    let t = text.trim().replace(/\s/g, '').replace(/€/g, '');
    if (!t) return null;
    if (t.includes('.') && t.includes(',')) t = t.replace(/\./g, '');
    t = t.replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    const value = parseFloat(t);
    return value > 0 && value < 1000000 ? value : null;
}

function parseDate(text) {
    const m = text.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[1]) return null;
    return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}

function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function noticeDateOf(entry) {
    if (!entry.contractEnd || !entry.noticeMonths) return null;
    const d = new Date(entry.contractEnd + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - entry.noticeMonths);
    return d;
}

function startOfToday() {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function deadlineNote(entry) {
    const today = startOfToday();
    const notice = noticeDateOf(entry);
    if (notice) {
        const iso = notice.toISOString().slice(0, 10);
        const days = Math.round((notice.getTime() - today.getTime()) / 86400000);
        if (days < 0) return { text: 'Kündigungsfrist laut deiner Eingabe am ' + fmtDate(iso) + ' abgelaufen', danger: true };
        if (days <= 30) return { text: 'Kündigen laut deiner Frist spätestens bis ' + fmtDate(iso) + ' (noch ' + days + ' Tage)', danger: true };
        return { text: 'Kündigen laut deiner Frist spätestens bis ' + fmtDate(iso), danger: false };
    }
    if (entry.contractEnd) {
        const end = new Date(entry.contractEnd + 'T00:00:00Z');
        const days = Math.round((end.getTime() - today.getTime()) / 86400000);
        if (days >= 0 && days <= 60) return { text: 'Vertrag endet in ' + days + ' Tagen - Frist im Vertrag prüfen', danger: false };
    }
    return null;
}

function isEntry(value) {
    if (typeof value !== 'object' || value === null) return false;
    const e = value;
    return typeof e.id === 'string' && typeof e.name === 'string' && typeof e.category === 'string'
        && (e.amount === null || (typeof e.amount === 'number' && e.amount > 0))
        && RHYTHMS.some(r => r.value === e.rhythm)
        && (e.contractEnd === undefined || typeof e.contractEnd === 'string')
        && (e.noticeMonths === undefined || e.noticeMonths === null || typeof e.noticeMonths === 'number')
        && (e.note === undefined || typeof e.note === 'string');
}

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- Zustand ---- */
const STORAGE_KEY = 'fixkosten-eintraege.v1';

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter(isEntry) : [];
    } catch (err) {
        return [];
    }
}

function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch (err) { /* Speicher voll o.ae. */ }
}

let entries = load();
let showForm = false;
let showData = false;
let openCategory = null;
let openEntry = null;
let confirmRemove = null;
let formError = '';
let importMessage = '';
let copied = false;

const form = { name: '', category: 'Miete', amount: '', rhythm: 'monatlich', end: '', notice: 'none' };
let importText = '';

/* ---- Render ---- */
const root = document.getElementById('app');

function donutSvg(parts, total) {
    const size = 176, stroke = 26, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const visible = parts.filter(p => p.value > 0);
    let offset = 0;
    let circles = '';
    if (visible.length === 0) {
        circles = '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="' + stroke + '"/>';
    }
    for (const p of visible) {
        const frac = total > 0 ? p.value / total : 0;
        const gap = visible.length > 1 ? Math.min(3, c * 0.01) : 0;
        const len = Math.max(frac * c - gap, 0.5);
        circles += '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="' + stroke + '" stroke-dasharray="' + len + ' ' + (c - len) + '" stroke-dashoffset="' + (-offset) + '"/>';
        offset += frac * c;
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Kreisdiagramm der monatlichen Kosten"><g transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')">' + circles + '</g></svg>';
}

function render() {
    const monthlyTotal = entries.reduce((sum, e) => sum + monthlyOf(e), 0);
    const yearlyTotal = monthlyTotal * 12;
    const openCount = entries.filter(e => e.amount === null).length;

    const map = new Map();
    for (const e of entries) {
        if (!map.has(e.category)) map.set(e.category, []);
        map.get(e.category).push(e);
    }
    const byCategory = CATEGORIES
        .filter(c => map.has(c.name))
        .map(c => {
            const list = map.get(c.name).slice().sort((a, b) => monthlyOf(b) - monthlyOf(a));
            const sum = list.reduce((s, e) => s + monthlyOf(e), 0);
            return { name: c.name, color: c.color, list, sum };
        })
        .sort((a, b) => b.sum - a.sum);

    const donutParts = byCategory.map(c => ({ label: c.name, value: c.sum, color: c.color }));
    const urgent = entries.map(e => ({ entry: e, note: deadlineNote(e) })).filter(x => x.note && x.note.danger);

    let html = '<header class="app-header"><h1>Meine Fixkosten</h1></header>';

    html += '<div class="tr-panel">';
    html += '<div class="donut-wrap">' + donutSvg(donutParts, monthlyTotal)
        + '<div class="donut-center"><div class="donut-total">' + fmt(monthlyTotal) + '</div><div class="donut-per">pro Monat</div></div></div>';
    html += '<div class="tr-year">' + fmt(yearlyTotal) + ' pro Jahr</div>';
    if (openCount > 0) {
        html += '<div class="tr-open-count">Erfasste Kosten - ' + (openCount === 1 ? '1 Posten' : openCount + ' Posten') + ' mit offenem Betrag nicht enthalten.</div>';
    }
    if (!showForm) {
        html += '<div class="tr-add-in-panel"><button type="button" class="tr-add-btn" id="btn-show-form">Posten hinzufügen</button></div>';
    }
    if (byCategory.length > 0) {
        html += '<div class="tr-cats">';
        for (const c of byCategory) {
            const share = monthlyTotal > 0 ? Math.round((c.sum / monthlyTotal) * 100) : 0;
            const open = openCategory === c.name;
            html += '<div class="tr-cat-block">';
            html += '<button type="button" class="tr-cat" data-cat="' + esc(c.name) + '" aria-expanded="' + open + '">'
                + '<span class="tr-dot" style="background:' + c.color + '"></span>'
                + '<span class="tr-cat-name">' + esc(c.name) + '</span>'
                + '<span class="tr-cat-values"><span class="tr-cat-sum">' + fmt(c.sum) + '</span><span class="tr-cat-share">' + share + ' %</span></span></button>';
            if (open) {
                html += '<div class="tr-entries">';
                for (const e of c.list) {
                    const note = deadlineNote(e);
                    const rhythmLabel = (RHYTHMS.find(r => r.value === e.rhythm) || {}).label || '';
                    const details = [
                        e.amount === null ? 'Betrag offen' : fmt(e.amount) + ' ' + rhythmLabel.toLowerCase(),
                        e.contractEnd ? 'Vertrag bis ' + fmtDate(e.contractEnd) : null,
                    ].filter(Boolean).join(' · ');
                    html += '<div class="tr-entry">';
                    html += '<div class="tr-entry-main">'
                        + '<div class="tr-entry-name">' + esc(e.name) + '</div>'
                        + '<div class="tr-entry-detail">' + esc(details) + '</div>';
                    if (note) html += '<div class="' + (note.danger ? 'tr-entry-note tr-entry-danger' : 'tr-entry-note') + '">' + esc(note.text) + '</div>';
                    if (e.note && openEntry === e.id) html += '<div class="tr-entry-detail tr-entry-subnote">' + esc(e.note) + '</div>';
                    html += '</div>';
                    html += '<div class="tr-entry-side">';
                    if (e.amount === null) {
                        html += '<div class="tr-entry-value tr-entry-offen">offen</div>';
                    } else {
                        html += '<div class="tr-entry-value">' + fmt(monthlyOf(e)) + '<span class="tr-entry-per"> /Monat</span></div>';
                    }
                    html += '<div class="tr-entry-actions">';
                    if (e.note) html += '<button type="button" class="tr-remove" data-details="' + esc(e.id) + '">' + (openEntry === e.id ? 'Weniger' : 'Details') + '</button>';
                    html += '<button type="button" class="tr-remove" data-remove="' + esc(e.id) + '">Entfernen</button>';
                    html += '</div></div>';
                    if (confirmRemove === e.id) {
                        html += '<div class="tr-confirm" role="alert">'
                            + '<div class="tr-confirm-text">„' + esc(e.name) + '“ wirklich entfernen?</div>'
                            + '<div class="tr-confirm-actions">'
                            + '<button type="button" class="tr-confirm-yes" data-remove-yes="' + esc(e.id) + '">Ja, entfernen</button>'
                            + '<button type="button" class="tr-confirm-no" data-remove-no>Behalten</button>'
                            + '</div></div>';
                    }
                    html += '</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
    }
    if (byCategory.length === 0) {
        html += '<div class="tr-empty">Noch nichts eingetragen. Tippe auf Posten hinzufügen, zum Beispiel für deine Miete.</div>';
    }
    html += '</div>'; /* tr-panel */

    if (urgent.length > 0) {
        html += '<div class="tr-warning" role="alert">'
            + urgent.map(x => esc(x.entry.name + ': ' + x.note.text)).join(' · ')
            + '<span class="tr-warning-note">Aus deinen Angaben gerechnet, maßgeblich ist dein Vertrag.</span></div>';
    }

    if (showForm) {
        html += '<section class="card"><h2>Neuer Posten</h2>';
        html += '<label class="field"><span class="field-label">Bezeichnung</span><input type="text" id="f-name" autocomplete="off" value="' + esc(form.name) + '"></label>';
        html += choiceField('Kategorie', 'f-cat', CATEGORIES.map(c => ({ value: c.name, label: c.name })), form.category);
        html += '<label class="field"><span class="field-label">Betrag in Euro pro Zahlung</span><input type="text" inputmode="decimal" id="f-amount" autocomplete="off" value="' + esc(form.amount) + '"></label>';
        html += choiceField('Zahlungsrhythmus', 'f-rhythm', RHYTHMS.map(r => ({ value: r.value, label: r.label })), form.rhythm);
        html += '<label class="field"><span class="field-label">Vertragsende (optional, TT.MM.JJJJ)</span><input type="text" inputmode="numeric" id="f-end" autocomplete="off" placeholder="31.12.2027" value="' + esc(form.end) + '"></label>';
        html += choiceField('Kündigungsfrist', 'f-notice', [
            { value: 'none', label: 'Keine Angabe' },
            { value: '1', label: '1 Monat' },
            { value: '3', label: '3 Monate' },
            { value: '6', label: '6 Monate' },
        ], form.notice);
        html += '<div class="tr-form-actions"><button type="button" class="btn primary" id="f-add">Hinzufügen</button>'
            + '<button type="button" class="btn ghost" id="f-cancel">Abbrechen</button></div>';
        if (formError) html += '<p class="caption">' + esc(formError) + '</p>';
        html += '</section>';
    }

    if (!showData) {
        html += '<div class="tr-data-row"><button type="button" class="tr-data-link" id="btn-show-data">Daten und Backup</button></div>';
    } else {
        html += '<section class="card"><h2>Daten und Sicherung</h2>'
            + '<p class="paragraph">Deine Einträge bleiben nur auf diesem Gerät in dieser App. Es gibt keine Synchronisation zwischen Geräten. Wenn du die App vom Home-Bildschirm entfernst oder die Website-Daten löschst, sind die Einträge weg. Kopiere deshalb nach größeren Änderungen ein Backup, zum Beispiel in eine Notiz.</p>'
            + '<div class="tr-form-actions"><button type="button" class="btn secondary" id="btn-copy">' + (copied ? 'Kopiert' : 'Backup kopieren') + '</button></div>'
            + '<label class="field"><span class="field-label">Backup einfügen und wiederherstellen</span><textarea id="f-import" rows="4">' + esc(importText) + '</textarea></label>'
            + '<div class="tr-form-actions"><button type="button" class="btn secondary compact" id="btn-restore"' + (importText.trim().length === 0 ? ' disabled' : '') + '>Wiederherstellen (ersetzt alle Posten)</button>'
            + '<button type="button" class="btn ghost compact" id="btn-close-data">Schließen</button></div>';
        if (importMessage) html += '<p class="caption">' + esc(importMessage) + '</p>';
        html += '</section>';
    }

    html += '<footer class="closing">Alle Zahlen und Fristen stammen aus deinen eigenen Einträgen. Fristen sind aus deinen Angaben gerechnet, nicht aus dem Vertrag gelesen. Tippe eine Kategorie an, um ihre Posten zu sehen.</footer>';

    root.innerHTML = html;
    bind();
}

function choiceField(label, id, options, current) {
    let html = '<div class="field"><span class="field-label">' + esc(label) + '</span><div class="choices" id="' + id + '">';
    for (const o of options) {
        html += '<button type="button" class="choice' + (o.value === current ? ' active' : '') + '" data-value="' + esc(o.value) + '">' + esc(o.label) + '</button>';
    }
    html += '</div></div>';
    return html;
}

function bind() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };

    on('btn-show-form', () => { showForm = true; formError = ''; render(); const el = document.getElementById('f-name'); if (el) el.focus(); });
    on('f-cancel', () => { showForm = false; formError = ''; render(); });
    on('f-add', addEntry);
    on('btn-show-data', () => { showData = true; importMessage = ''; render(); });
    on('btn-close-data', () => { showData = false; render(); });
    on('btn-copy', copyBackup);
    on('btn-restore', restoreBackup);

    document.querySelectorAll('.tr-cat[data-cat]').forEach(el => {
        el.addEventListener('click', () => {
            const name = el.getAttribute('data-cat');
            openCategory = openCategory === name ? null : name;
            confirmRemove = null;
            render();
        });
    });
    document.querySelectorAll('[data-details]').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.getAttribute('data-details');
            openEntry = openEntry === id ? null : id;
            render();
        });
    });
    document.querySelectorAll('[data-remove]').forEach(el => {
        el.addEventListener('click', () => { confirmRemove = el.getAttribute('data-remove'); render(); });
    });
    document.querySelectorAll('[data-remove-yes]').forEach(el => {
        el.addEventListener('click', () => {
            entries = entries.filter(e => e.id !== el.getAttribute('data-remove-yes'));
            confirmRemove = null;
            save();
            render();
        });
    });
    document.querySelectorAll('[data-remove-no]').forEach(el => {
        el.addEventListener('click', () => { confirmRemove = null; render(); });
    });

    bindChoices('f-cat', v => { form.category = v; });
    bindChoices('f-rhythm', v => { form.rhythm = v; });
    bindChoices('f-notice', v => { form.notice = v; });

    const sync = (id, key) => { const el = document.getElementById(id); if (el) el.addEventListener('input', () => { form[key] = el.value; }); };
    sync('f-name', 'name');
    sync('f-amount', 'amount');
    sync('f-end', 'end');
    const imp = document.getElementById('f-import');
    if (imp) imp.addEventListener('input', () => { importText = imp.value; });
}

function bindChoices(id, set) {
    const box = document.getElementById(id);
    if (!box) return;
    box.querySelectorAll('.choice').forEach(el => {
        el.addEventListener('click', () => {
            set(el.getAttribute('data-value'));
            box.querySelectorAll('.choice').forEach(x => x.classList.toggle('active', x === el));
        });
    });
}

function addEntry() {
    const amount = parseAmount(form.amount);
    const endIso = form.end.trim() ? parseDate(form.end) : '';
    if (!form.name.trim()) { formError = 'Bitte eine Bezeichnung eintragen.'; render(); return; }
    if (amount === null) { formError = 'Bitte einen gültigen Betrag eintragen, zum Beispiel 49,90.'; render(); return; }
    if (endIso === null) { formError = 'Vertragsende bitte als TT.MM.JJJJ eintragen, zum Beispiel 31.12.2027, oder das Feld leer lassen.'; render(); return; }
    const entry = {
        id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        name: form.name.trim(),
        category: form.category,
        amount: amount,
        rhythm: form.rhythm,
        contractEnd: endIso || undefined,
        noticeMonths: form.notice === 'none' ? null : Number(form.notice),
    };
    entries = entries.concat([entry]);
    save();
    form.name = ''; form.amount = ''; form.end = ''; form.notice = 'none';
    formError = '';
    showForm = false;
    openCategory = entry.category;
    render();
}

function backupJson() {
    return JSON.stringify({ version: 1, app: 'fixkosten', entries: entries }, null, 2);
}

function copyBackup() {
    const text = backupJson();
    const done = () => { copied = true; render(); setTimeout(() => { copied = false; render(); }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
        fallbackCopy(text, done);
    }
}

function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (err) { /* ignoriert */ }
    document.body.removeChild(ta);
    done();
}

function restoreBackup() {
    try {
        const parsed = JSON.parse(importText);
        const list = Array.isArray(parsed) ? parsed : (parsed && parsed.entries);
        if (!Array.isArray(list) || !list.every(isEntry)) {
            importMessage = 'Das sieht nicht nach einem Backup dieser App aus. Nichts geändert.';
            render();
            return;
        }
        entries = list;
        save();
        importText = '';
        importMessage = 'Wiederhergestellt: ' + list.length + ' Posten.';
        confirmRemove = null;
        openEntry = null;
        render();
    } catch (err) {
        importMessage = 'Das Backup lässt sich nicht lesen. Bitte den kopierten Text vollständig einfügen. Nichts geändert.';
        render();
    }
}

/* Dauerhaften Speicher anfragen (iOS waehlt das fuer Home-Screen-Apps bevorzugt). */
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
}

/* Offline-Faehigkeit */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

render();
})();
