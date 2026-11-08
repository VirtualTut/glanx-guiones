/* Glanx Guiones — del guion al rodaje.
   Todo se guarda en este navegador (localStorage + IndexedDB para imágenes).
   Sin servidor, sin dependencias. */
'use strict';
const APP_V = '202611072038';

/* ================= Utilidades ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const slug = s => (s || 'guion').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'guion';
const app = $('#app');

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function download(name, data, mime = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function pickFiles(accept, multiple = false) {
  return new Promise(res => {
    // el input va dentro de la página: si queda suelto, algunos navegadores lo descartan y no avisan al elegir el archivo
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.style.cssText = 'position:fixed;left:-9999px;opacity:0'; document.body.appendChild(i);
    const done = files => { i.remove(); res(files); };
    i.addEventListener('change', () => done([...i.files]));
    i.addEventListener('cancel', () => done([]));
    i.click();
  });
}
const fmtDate = t => new Date(t).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ================= Constantes ================= */
// orden = atajo (Ctrl+0 … Ctrl+8) y orden del Tab
const TYPES = [['act', 'Acto'], ['scene', 'Título de escena'], ['action', 'Acción'], ['character', 'Personaje'], ['dialogue', 'Diálogo'], ['paren', 'Entre paréntesis'], ['transition', 'Transición'], ['shot', 'Toma'], ['text', 'Texto']];
const TYPE_KEYS = TYPES.map(t => t[0]);
const TYPE_LABEL = Object.fromEntries(TYPES);
const NEXT = { act: 'scene', scene: 'action', action: 'action', character: 'dialogue', paren: 'dialogue', dialogue: 'action', transition: 'scene', shot: 'action', text: 'text' };
const LINES_PER_PAGE = 55;
const BD_CATS = [
  ['cast', 'Reparto', '#ef5b5b'], ['extras', 'Extras', '#f5a524'], ['props', 'Utilería', '#a970ff'],
  ['wardrobe', 'Vestuario', '#3e9bff'], ['makeup', 'Maquillaje y peluquería', '#ff6fae'], ['art', 'Arte y escenografía', '#c08457'],
  ['sfx', 'Efectos especiales', '#40c4aa'], ['vfx', 'VFX / posproducción', '#22c3ee'], ['vehicles', 'Vehículos', '#ff8a3d'],
  ['animals', 'Animales', '#9bd149'], ['sound', 'Sonido y música', '#f0d146'], ['equip', 'Equipo especial', '#8b9bb4']
];
const SIZES = ['Gran plano general', 'Plano general', 'Plano conjunto', 'Plano americano', 'Plano medio', 'Plano medio corto', 'Primer plano', 'Primerísimo primer plano', 'Plano detalle', 'Insert', 'POV', 'Sobre el hombro', 'Cenital'];
const MOVES = ['Fijo', 'Paneo', 'Tilt', 'Cámara en mano', 'Gimbal / steadicam', 'Dolly / travelling', 'Dolly in', 'Dolly out', 'Seguimiento', 'Grúa', 'Dron', 'Zoom', 'Rampa de velocidad'];
const DEFAULT_DEPTS = ['Desarrollo y guion', 'Producción', 'Dirección', 'Talento / reparto', 'Cámara', 'Luces y grip', 'Sonido', 'Arte y escenografía', 'Vestuario y maquillaje', 'Locaciones', 'Transporte', 'Alimentación', 'Posproducción', 'Música y derechos', 'Seguros y permisos'];
const CURRENCIES = { COP: 'es-CO', USD: 'en-US', EUR: 'es-ES', MXN: 'es-MX' };

/* ================= Almacenamiento ================= */
const IDX = 'glanx.index', PKEY = id => 'glanx.p.' + id;
const loadIndex = () => { try { return JSON.parse(localStorage.getItem(IDX)) || []; } catch { return []; } };
const saveIndex = l => localStorage.setItem(IDX, JSON.stringify(l));
function loadProject(id) { try { return normalizeProject(JSON.parse(localStorage.getItem(PKEY(id)))); } catch { return null; } }
function writeProject(p) {
  localStorage.setItem(PKEY(p.id), JSON.stringify(p));
  const l = loadIndex().filter(x => x.id !== p.id);
  l.unshift({ id: p.id, title: p.title, updated: p.updated, cloud: !!p.cloud });
  saveIndex(l);
}
let P = null, saveTimer = null;
function setSaved(txt, bad) { const s = $('#saveState'); if (s) { s.textContent = txt; s.classList.toggle('bad', !!bad); } }
function persist() {
  saveTimer = null; if (!P) return;
  P.updated = Date.now();
  try { writeProject(P); setSaved(P.cloud ? 'Guardado' : 'Guardado en este navegador'); cloudAfterSave(); }
  catch (e) { setSaved('No se pudo guardar', true); toast('No se pudo guardar: el navegador está lleno. Exporta un respaldo.'); }
}
function save() { if (isRO()) { roWarn(); return; } setSaved('Guardando…'); clearTimeout(saveTimer); saveTimer = setTimeout(persist, 450); }
function flushSave() { if (saveTimer) { clearTimeout(saveTimer); persist(); } }

/* Imágenes en IndexedDB */
let _db;
const DB = () => _db ||= new Promise((res, rej) => {
  const r = indexedDB.open('glanx-guiones', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('img');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function idb(mode, fn) {
  const db = await DB();
  return new Promise((res, rej) => {
    const tx = db.transaction('img', mode); const st = tx.objectStore('img'); let out;
    const r = fn(st); if (r) r.onsuccess = () => out = r.result;
    tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error);
  });
}
const imgPut = (id, data) => idb('readwrite', s => s.put(data, id));
const imgDel = id => idb('readwrite', s => s.delete(id));
const imgCache = new Map();
async function imgGet(id) {
  if (!id) return null;
  if (imgCache.has(id)) return imgCache.get(id);
  let d = null; try { d = await idb('readonly', s => s.get(id)); } catch {}
  if (!d && P?.cloud && CL.user) { d = await cloudGetImg(P.id, id).catch(() => null); if (d) imgPut(id, d).catch(() => {}); }
  if (d) imgCache.set(id, d); return d || null;
}
function hydrate(root = app) {
  $$('img[data-img]', root).forEach(async im => { const d = await imgGet(im.dataset.img); if (d) im.src = d; });
}
function fileToDataUrl(file, max = 1600) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', .85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No es una imagen')); };
    im.src = url;
  });
}
async function storeImage(file) {
  const d = await fileToDataUrl(file); const id = 'i' + uid(); await imgPut(id, d); imgCache.set(id, d);
  if (P?.cloud && CL.editing) cloudPutImg(P.id, id, d).catch(() => {});
  return id;
}

/* ================= Modelo ================= */
function normalizeProject(p) {
  if (!p || !p.id) return null;
  p.title ||= 'Guion sin título'; p.author ??= 'Glanx Studio'; p.contact ??= ''; p.logline ??= '';
  if (!Array.isArray(p.blocks) || !p.blocks.length) p.blocks = [{ id: uid(), t: 'action', x: '' }];
  p.scenes ||= {}; p.days ||= []; p.boards ||= {};
  p.budget ||= { currency: 'COP', contingency: 10, depts: DEFAULT_DEPTS.map(n => ({ id: uid(), name: n, items: [] })) };
  return p;
}
function newProject(title = 'Guion sin título') {
  return normalizeProject({ id: uid(), title, created: Date.now(), updated: Date.now(),
    blocks: [{ id: uid(), t: 'scene', x: 'INT. LUGAR - DÍA' }, { id: uid(), t: 'action', x: '' }] });
}
const meta = sid => P.scenes[sid] ||= { bd: {}, shots: [], notes: '' };
const cleanChar = x => x.toUpperCase().replace(/\(.*?\)/g, '').replace(/[\^:]+$/, '').trim();
const wrapL = (t, w) => (t || '').split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / w)), 0);
function blockLines(b) {
  switch (b.t) {
    case 'scene': return 2; case 'action': return wrapL(b.x, 61) + 1; case 'character': return 2;
    case 'paren': return wrapL(b.x, 25); case 'dialogue': return wrapL(b.x, 35); case 'transition': return 2;
    case 'act': return 3; case 'shot': return 2; case 'text': return wrapL(b.x, 61) + 1;
  } return 1;
}
function parseHeading(h) {
  const m = h.match(/^(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INTERIOR|EXTERIOR|INT\.?|EXT\.?)\s*(.*)$/i);
  let ie = '', rest = h;
  if (m) { ie = m[1].includes('/') ? 'INT/EXT' : m[1].toUpperCase().startsWith('INT') ? 'INT' : 'EXT'; rest = m[2]; }
  let parts = rest.replace(/^[\s.]*[-–—]\s*/, '').split(/\s+[-–—]\s*|\s*[–—]\s+/);
  if (!m) { // «INSERTO – INTERIOR – COCINA – NOCHE»
    const k = parts.findIndex(x => /^(INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|INTERIOR|EXTERIOR|INT|EXT)\.?$/i.test(x.trim()));
    if (k >= 0) { const t = parts[k].toUpperCase(); ie = t.includes('/') ? 'INT/EXT' : t.startsWith('INT') ? 'INT' : 'EXT'; parts = parts.slice(k + 1); }
  }
  const loc = parts.shift()?.replace(/^[.\s]+/, '').trim() || '—';
  const time = parts.join(' - ').trim();
  const night = /NOCHE|NIGHT|MADRUGADA|ANOCHECER/i.test(time);
  return { ie, loc, time, night };
}
function getScenes() {
  const out = []; let cur = null;
  for (const b of P.blocks) {
    if (b.t === 'scene') { cur = { id: b.id, heading: b.x.toUpperCase().trim(), blocks: [], lines: 2, chars: new Set() }; out.push(cur); continue; }
    if (!cur) continue;
    cur.blocks.push(b); cur.lines += blockLines(b);
    if (b.t === 'character') { const n = cleanChar(b.x); if (n) cur.chars.add(n); }
  }
  out.forEach((s, i) => {
    s.num = i + 1; Object.assign(s, parseHeading(s.heading));
    s.eighths = Math.max(1, Math.round(s.lines / LINES_PER_PAGE * 8)); s.chars = [...s.chars];
  });
  return out;
}
function fmtE(e) { const p = Math.floor(e / 8), r = e % 8; return (p ? String(p) : '') + (r ? (p ? ' ' : '') + r + '/8' : '') || '0'; }
function totalPages() { return Math.max(1, Math.ceil(P.blocks.reduce((a, b) => a + blockLines(b), 0) / LINES_PER_PAGE)); }

/* ================= Parsers (Fountain / texto / FDX) ================= */
const isCaps = s => /[A-ZÁÉÍÓÚÑÜ]/.test(s) && s === s.toUpperCase();
const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E|INTERIOR|EXTERIOR)[.\s\/]/i;
// número de escena delante o detrás: «1. INT CASA – DÍA», «12A INT. …», «INT. CASA - NOCHE 12»
const stripSceneNum = s => s.replace(/^\d+[A-Z]?[.)\-]?\s+/, '').replace(/\s+\d+[A-Z]?\.?$/, '');
const IE_TOKEN = /(^|[\s–—-])(INT|EXT|INTERIOR|EXTERIOR)\.?([\s–—-]|$)/;
const isSceneLine = s => SCENE_RE.test(stripSceneNum(s)) || (/^\d+[A-Z]?[.)]\s/.test(s) && s.length < 90 && isCaps(s) && IE_TOKEN.test(s));
// transiciones en español e inglés: «CORTE A:», «Corte a negro.», «FUNDIDO A NEGRO», «CUT TO:»
const TRANS_RE = /^(CORTE|CORTA|FUNDIDO|FUNDE|DISOLVENCIA|DISUELVE|ENCADENADO|FADE|CUT|SMASH CUT|MATCH CUT|DISSOLVE)\b.{0,25}$/i;
const isTransition = s => s.length <= 35 && (TRANS_RE.test(s) || (isCaps(s) && /(TO:|A:)$/.test(s)));
function parseScript(text) {
  const L = text.replace(/\r/g, '').replace(/\t/g, '    ').split('\n');
  const out = []; let inDia = false, i = 0;
  // portada Fountain (Title: ..., Author: ...)
  if (/^(title|título|credit|author|autor|draft date|contact)\s*:/i.test((L[0] || '').trim())) { while (i < L.length && L[i].trim()) i++; }
  for (; i < L.length; i++) {
    const s = L[i].trim(); const next = (L[i + 1] || '').trim();
    if (!s) { inDia = false; continue; }
    if (/^#+\s*\S/.test(s) || (/^(ACTO|ACT)\s+\S+\.?$/.test(s) && s.length < 30)) { out.push({ t: 'act', x: s.replace(/^#+\s*/, '') }); inDia = false; continue; }
    if (isSceneLine(s) || /^\.[^.]/.test(s)) { out.push({ t: 'scene', x: isSceneLine(s) ? stripSceneNum(s) : s.replace(/^\./, '') }); inDia = false; continue; }
    if (inDia) { out.push({ t: /^\(.*\)$/.test(s) ? 'paren' : 'dialogue', x: s }); continue; }
    if (/^>/.test(s) && !/<$/.test(s)) { out.push({ t: 'transition', x: s.replace(/^>\s*/, '') }); continue; }
    if (isTransition(s) || (isCaps(s) && /(FUNDE A NEGRO\.?|FADE OUT\.?)$/.test(s) && s.length < 40)) { out.push({ t: 'transition', x: s }); continue; }
    if ((/^@/.test(s) || (isCaps(s) && s.length < 45 && !/[.!?…]$/.test(s.replace(/\(.*\)$/, '').trim()))) && next) {
      out.push({ t: 'character', x: s.replace(/^@/, '') }); inDia = true; continue;
    }
    out.push({ t: 'action', x: s.replace(/^!/, '') });
  }
  return out.map(b => ({ id: uid(), ...b }));
}
function parseFDX(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const map = { 'Scene Heading': 'scene', 'Action': 'action', 'Character': 'character', 'Parenthetical': 'paren', 'Dialogue': 'dialogue', 'Transition': 'transition', 'Shot': 'shot', 'General': 'text', 'New Act': 'act', 'End of Act': 'act' };
  return $$('FinalDraft > Content > Paragraph', doc).map(p => ({ id: uid(), t: map[p.getAttribute('Type')] || 'action', x: $$('Text', p).map(t => t.textContent).join('') }))
    .filter(b => b.x.trim());
}
/* ================= Importar PDF / Word (.docx) ================= */
const LIBS = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  zip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
};
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('No se pudo cargar el lector de archivos (revisa la conexión a internet).'));
    document.head.appendChild(s);
  });
}
const cleanTxt = s => String(s || '').replace(/[​‌‍﻿]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const modeOf = arr => { const m = new Map(); let best = null, n = 0; arr.forEach(v => { const c = (m.get(v) || 0) + 1; m.set(v, c); if (c > n) { n = c; best = v; } }); return best; };
const NUM_RE = /^\s*\d+[A-Z]?\.?\s*$/;
const CONT_RE = /^\(?(CONTINUED|CONTINÚA|CONTINUA|CONTINÚA:|MORE|MÁS|MAS|CONT'D|CONT\.|SIGUE)\)?:?$/i;

function joinItems(items) {
  items = items.slice().sort((a, b) => a.x - b.x);
  let text = '', end = null, x = null;
  for (const it of items) {
    if (x === null && it.s.trim()) x = it.x;
    if (end !== null && it.x - end > 1.5 && !/\s$/.test(text) && !/^\s/.test(it.s)) text += ' ';
    text += it.s; end = it.x + it.w;
  }
  return { text, x: x ?? items[0]?.x ?? 0, xEnd: end ?? 0 };
}
async function pdfLines(buf, onPage) {
  await loadScript(LIBS.pdf);
  pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let pn = 1; pn <= doc.numPages; pn++) {
    onPage?.(pn, doc.numPages);
    const page = await doc.getPage(pn);
    try { await page.getOperatorList(); } catch { } // carga las fuentes para saber cuáles son negrita
    const tc = await page.getTextContent();
    const boldCache = {};
    const isBold = fn => {
      if (fn in boldCache) return boldCache[fn];
      let b = false; try { const f = page.commonObjs.get(fn); b = !!(f && (f.bold || /bold|black|heavy|semibold|demi/i.test(f.name || ''))); } catch { }
      return boldCache[fn] = b;
    };
    const rows = [];
    for (const it of tc.items) {
      if (!('str' in it) || !cleanTxt(it.str)) continue;
      const [a, b, c, d, x, y] = it.transform; const size = Math.hypot(c, d) || it.height || 12;
      let row = rows.find(r => Math.abs(r.y - y) < Math.max(2, size * .3));
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width, s: it.str, size, bold: isBold(it.fontName) });
    }
    rows.sort((a, b) => b.y - a.y).forEach(r => {
      const tot = r.items.reduce((s, it) => s + cleanTxt(it.s).length, 0) || 1;
      lines.push({ page: pn, y: r.y, items: r.items,
        size: r.items.reduce((s, it) => s + it.size * cleanTxt(it.s).length, 0) / tot,
        bold: r.items.filter(it => it.bold).reduce((s, it) => s + cleanTxt(it.s).length, 0) >= tot * .8 });
    });
    page.cleanup();
  }
  return lines;
}
/* Líneas del PDF → párrafos con sangría (en pulgadas desde el margen izquierdo) */
function pdfParas(lines) {
  const pre = lines.map(l => ({ ...l, ...joinItems(l.items) }));
  const margin = modeOf(pre.filter(l => cleanTxt(l.text).length > 25).map(l => Math.round(l.x))) ?? Math.min(...pre.map(l => l.x));
  // dónde acaba el texto a la derecha (sin contar números de escena ni de página)
  const textEnd = l => { const its = l.items.filter(it => cleanTxt(it.s)).sort((a, b) => a.x - b.x); while (its.length > 1 && NUM_RE.test(its[its.length - 1].s)) its.pop(); const z = its[its.length - 1]; return z ? z.x + z.w : 0; };
  const ends = pre.filter(l => cleanTxt(l.text).length > 25).map(textEnd).sort((a, b) => a - b);
  const right = ends[Math.floor(ends.length * .95)] || Math.max(...pre.map(l => l.xEnd));
  const gaps = []; pre.forEach((l, i) => { const q = pre[i - 1]; if (q && q.page === l.page && q.y - l.y > 0) gaps.push(Math.round((q.y - l.y) * 2) / 2); });
  const lineGap = modeOf(gaps) || 14;
  const out = []; let prev = null;
  for (const l of pre) {
    // números de escena en los márgenes y números de página
    const sortedIt = l.items.slice().sort((a, b) => a.x - b.x);
    const items = sortedIt.filter((it, i) => {
      if (!NUM_RE.test(it.s)) return true;
      const prevIt = sortedIt.slice(0, i).reverse().find(o => o.s.trim());
      const isolated = !prevIt || it.x - (prevIt.x + prevIt.w) > 18;
      return !((it.x < margin - 8 && sortedIt.length > 1) || (it.x > margin + 5.3 * 72 && isolated));
    });
    if (!items.length) continue;
    const j = joinItems(items); const text = cleanTxt(j.text);
    if (!text || NUM_RE.test(text) || CONT_RE.test(text)) continue;
    const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity;
    const blank = gap > l.size * 1.55;
    // para guiones de cine: «línea en blanco» relativa al interlineado del documento (1.5, doble…)
    const blankR = gap > Math.max(l.size * 1.55, lineGap * 1.4);
    const wrap = !blank && prev && prev.xEnd > right - 50 && !/[​]\s*$/.test(prev.raw);
    const long = j.xEnd > margin + .85 * (right - margin);
    // ¿es continuación de la línea anterior? Sí, si su primera palabra no cabía al final de esa línea
    const firstWord = (text.match(/^\S+/) || [''])[0];
    const fits = !!prev && prev.xEnd + (firstWord.length + 1) * l.size * .55 > right - 2 && !/[​]\s*$/.test(prev.raw);
    const cont = !blank && fits, contR = !blankR && fits;
    const p = { text, raw: j.text, ind: (j.x - margin) / 72, size: l.size, bold: l.bold, blank, blankR, wrap: wrap || cont, cont, contR, gap, long, page: l.page, y: l.y, xEnd: j.xEnd };
    out.push(p); prev = p;
  }
  return out;
}
/* Word .docx (también lo que descarga Google Docs) */
async function docxParas(buf) {
  await loadScript(LIBS.zip);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('No parece un archivo .docx válido.');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const kids = (el, name) => el ? [...el.childNodes].filter(n => n.localName === name) : [];
  const kid = (el, name) => kids(el, name)[0];
  const val = (el, a = 'val') => el?.getAttributeNS(W, a) ?? el?.getAttribute('w:' + a) ?? null;
  const onOff = el => el ? !['0', 'false', 'off'].includes(String(val(el)).toLowerCase()) : null;
  const styles = {};
  const sx = await zip.file('word/styles.xml')?.async('string');
  if (sx) {
    const sd = new DOMParser().parseFromString(sx, 'application/xml');
    for (const st of sd.getElementsByTagNameNS(W, 'style')) {
      const pPr = kid(st, 'pPr'), rPr = kid(st, 'rPr'), ind = kid(pPr, 'ind');
      styles[val(st, 'styleId')] = {
        name: val(kid(st, 'name')) || '', based: val(kid(st, 'basedOn')),
        left: ind ? +(val(ind, 'left') ?? val(ind, 'start') ?? 0) : null, jc: val(kid(pPr, 'jc')),
        sz: kid(rPr, 'sz') ? +val(kid(rPr, 'sz')) : null, bold: onOff(kid(rPr, 'b')), caps: onOff(kid(rPr, 'caps'))
      };
    }
  }
  const sv = (id, k) => { for (let i = 0; id && styles[id] && i < 10; i++) { if (styles[id][k] != null) return styles[id][k]; id = styles[id].based; } return null; };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    const pPr = kid(p, 'pPr'); const sid = val(kid(pPr, 'pStyle'));
    const ind = kid(pPr, 'ind');
    let left = ind ? +(val(ind, 'left') ?? val(ind, 'start') ?? 0) : (sv(sid, 'left') ?? 0);
    const jc = val(kid(pPr, 'jc')) || sv(sid, 'jc');
    let text = '', boldChars = 0, chars = 0, szSum = 0;
    for (const r of p.getElementsByTagNameNS(W, 'r')) {
      const rPr = kid(r, 'rPr'); const rs = val(kid(rPr, 'rStyle'));
      const b = onOff(kid(rPr, 'b')) ?? sv(rs, 'bold') ?? sv(sid, 'bold') ?? false;
      const caps = onOff(kid(rPr, 'caps')) ?? sv(rs, 'caps') ?? sv(sid, 'caps') ?? false;
      const sz = (kid(rPr, 'sz') ? +val(kid(rPr, 'sz')) : null) ?? sv(rs, 'sz') ?? sv(sid, 'sz') ?? 22;
      for (const n of r.childNodes) {
        let t = '';
        if (n.localName === 't') t = n.textContent; else if (n.localName === 'tab') t = '\t'; else if (n.localName === 'br' || n.localName === 'cr') t = ' ';
        if (caps) t = t.toUpperCase();
        text += t; const c = t.replace(/\s/g, '').length; chars += c; if (b) boldChars += c; szSum += sz * c;
      }
    }
    const lead = text.match(/^[\t ]*/)[0];
    const tabs = (lead.match(/\t/g) || []).length, spaces = (lead.match(/ /g) || []).length;
    const clean = cleanTxt(text); if (!clean) continue;
    const name = (styles[sid]?.name || sid || '').toLowerCase();
    const hm = name.match(/^(?:heading|título|titulo|encabezado)\s*(\d)/);
    const level = name === 'title' || name === 'título' || name === 'titulo' ? 0 : hm ? +hm[1] : null;
    let indIn = left / 1440 + tabs * .5 + spaces * .1;
    const caps = isCaps(clean) && clean.length < 40;
    if (jc === 'center') indIn = caps ? 2.2 : Math.max(indIn, 1);
    if (jc === 'right' || jc === 'end') indIn = 4.5;
    // estilos de guion (plantillas de Word, abcguionistas, exportación de Final Draft/Celtx)
    const sn = (styles[sid]?.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const stype = /^(new act|end of act)|\bacto\b/.test(sn) ? 'act' : /\bshot\b|\btoma\b/.test(sn) ? 'shot' : /encabezado|scene ?heading|slug/.test(sn) ? 'scene' : /personaje|character/.test(sn) ? 'character'
      : /acotacion|parenthetical|parentesis/.test(sn) ? 'paren' : /dialogo|dialogue/.test(sn) ? 'dialogue'
      : /transicion|transition/.test(sn) ? 'transition' : /descripcion|^action|accion/.test(sn) ? 'action' : null;
    out.push({ text: clean, ind: indIn, size: chars ? szSum / chars / 2 : 11, bold: chars > 0 && boldChars >= chars * .8, level, stype, blank: true });
  }
  // la sangría se mide desde la acción (hay plantillas que dejan margen extra a todo)
  const act = out.filter(p => p.stype === 'action' || (!p.stype && p.text.length > 50 && p.ind < 1.2)).map(p => Math.round(p.ind * 20) / 20);
  const base = act.length ? modeOf(act) : 0;
  out.forEach(p => p.ind = Math.max(0, p.ind - base));
  return out;
}
/* ¿Tiene formato de guion de cine (personajes y diálogos con sangría)? */
/* Sangrías (pulgadas desde el margen de la acción). Las plantillas varían: Final Draft pone el diálogo a 1",
   la de abcguionistas a 0,6"; el personaje va entre 1,4" y 3". */
const IND = { dia: .35, char: 1.4, trans: 3.3 };
const isCharLine = p => p.ind >= IND.char && p.ind < IND.trans && isCaps(p.text) && p.text.length < 45 && !/^\(/.test(p.text) && !isTransition(p.text);
function looksLikeScreenplay(paras) {
  if (paras.some(p => p.stype === 'scene' || p.stype === 'character')) return true;
  const scenes = paras.filter(p => p.ind < IND.dia && isSceneLine(p.text)).length;
  const chars = paras.filter(isCharLine).length;
  const dia = paras.filter(p => p.ind >= IND.dia && p.ind < IND.char).length;
  return (scenes >= 1 && (chars >= 1 || scenes >= 2)) || (chars >= 3 && dia >= 3);
}
function screenplayFromParas(paras) {
  const out = []; let title = '';
  // portada: lo que hay antes de la primera escena, si está en su propia página o son pocas líneas sin diálogos
  const fi = paras.findIndex(p => p.stype === 'scene' || (p.ind < IND.dia && isSceneLine(p.text)));
  if (fi > 0) {
    const pre = paras.slice(0, fi), fs = paras[fi];
    const ownPage = fs.page > 1 && pre.every(p => p.page < fs.page);
    if (ownPage || (pre.length <= 8 && !pre.some(isCharLine))) {
      title = cleanTxt(pre.filter(p => !/^(guion|guión|escrito por|written by|de|by|por)$/i.test(p.text) && !/@|\bwww\.|\d{6,}/.test(p.text)
        && !/^\d+(\.\d+)*\.?\s/.test(p.text) && !/^gui[oó]n\s+(literario|t[eé]cnico)$/i.test(p.text)).slice(0, 1).map(p => p.text).join(' '));
      paras = paras.slice(fi);
    }
  }
  let prevP = null;
  for (const p of paras) {
    let s = p.text, t;
    const lastP = prevP; prevP = p;
    if (p.stype) { t = p.stype === 'action' && isTransition(s) ? 'transition' : p.stype; if (t === 'scene') s = stripSceneNum(s); }
    else if (p.ind < IND.dia && isSceneLine(s)) { t = 'scene'; s = stripSceneNum(s); }
    else if (isTransition(s) || (p.ind >= 2.5 && /:$/.test(s) && isCaps(s)) || (p.ind >= IND.trans + .6 && isCaps(s) && s.length < 30 && !isCharLine(p))) t = 'transition';
    else if (p.ind >= IND.char) t = /^\(/.test(s) ? 'paren' : isCaps(s) && s.length < 45 ? 'character' : 'dialogue';
    else if (p.ind >= IND.dia) t = /^\(/.test(s) ? 'paren' : 'dialogue';
    else t = 'action';
    const prev = out[out.length - 1];
    if (prev && prev.t === 'paren' && !/\)\s*$/.test(prev.x) && t !== 'scene' && t !== 'character') { prev.x += ' ' + s; continue; }
    // «ELENA (CAMBIA DE PRONTO DE ACTITUD Y SE» + «ANIMA)»
    if (prev && prev.t === 'character' && (prev.x.match(/\(/g) || []).length > (prev.x.match(/\)/g) || []).length) { prev.x += ' ' + s; continue; }
    // «3. CONTINUACIÓN … – CONSULTORIO –» + «DÍA»
    if (prev && prev.t === 'scene' && (/[-–—]\s*$/.test(prev.x) || /^\([^)]*\)$/.test(s)) && isCaps(s) && s.length < 30 && (!(p.blankR ?? p.blank) || /^\(/.test(s))) { prev.x += ' ' + s; continue; }
    // líneas cortadas: el diálogo siempre se une; la acción solo si la línea anterior llegaba al margen derecho
    const pBlank = p.blankR ?? p.blank, pCont = p.contR ?? p.cont ?? true;
    if (prev && !pBlank && prev.t === t && (t === 'dialogue' || (t === 'action' && pCont))) { prev.x += ' ' + s; continue; }
    out.push({ t, x: s });
  }
  return { blocks: out, title };
}
/* Guiones de reel / anuncio: títulos, [acotaciones] y texto hablado */
function docFromParas(paras, title) {
  const body = modeOf(paras.flatMap(p => Array(Math.min(50, Math.ceil(p.text.length / 10))).fill(Math.round(p.size * 2) / 2))) || 11;
  const big = p => p.size > body * 1.15;
  const SECTION_RE = /^(HOOKS?|MEAT|CTA|CUERPO|DESARROLLO|CIERRE|INTRO|OUTRO|GANCHO|REMATE|ESCENA|PARTE|BLOQUE|ACTO|SECUENCIA|CONTEXTO|GUI[OÓ]N|SCRIPT|LOCUCI[OÓ]N)\b/i;
  const isLabel = p => /:$/.test(p.text) && p.text.length < 45 && !big(p) && p.level == null;
  const sentence = p => /[.?!…,;:”"»]$/.test(p.text) || !/^[\p{Lu}\d¿¡]/u.test(p.text);
  const isHead = p => !isLabel(p) && !/^\[.*\]$/.test(p.text) && !/https?:\/\//.test(p.text) && p.text.length <= 120 &&
    (p.level != null || (SECTION_RE.test(p.text) && p.text.length <= 90 && !/[?!]$/.test(p.text)) ||
     (!sentence(p) && ((big(p) && p.text.length <= 90) || (p.bold && p.text.length <= 90))));
  // unir líneas cortadas del PDF (también títulos largos que ocupan dos líneas)
  const P2 = [];
  for (const p of paras) {
    const prev = P2[P2.length - 1];
    const same = prev && prev.bold === p.bold && Math.abs(prev.size - p.size) < 1;
    if (same && (p.wrap || (big(prev) && prev.long && p.gap < p.size * 2.1 && !SECTION_RE.test(p.text)))) { prev.text += ' ' + p.text; prev.xEnd = p.xEnd; prev.long = p.long; continue; }
    P2.push({ ...p });
  }
  paras = P2.filter(p => p.text);
  // ¿varios guiones en un archivo? (los títulos más grandes y los que empiezan igual: «Batch…», «Guion…»)
  const heads = paras.filter(isHead);
  let splitIdx = [];
  if (heads.length) {
    const levels = heads.filter(h => h.level != null).map(h => h.level);
    const minL = levels.length ? Math.min(...levels) : null;
    const maxS = Math.max(...heads.map(h => h.size));
    const top = h => minL != null ? h.level === minL : h.size >= maxS - .5 && big(h);
    let tops = heads.filter(top);
    const word = h => (h.text.match(/^[^\s:\d]+/) || [''])[0].toLowerCase();
    const w = modeOf(tops.map(word));
    if (w && w.length > 2 && tops.filter(h => word(h) === w).length >= Math.max(2, tops.length * .6))
      tops = heads.filter(h => word(h) === w && (big(h) || h.bold || h.level != null));
    if (tops.length >= 2) splitIdx = tops.map(h => paras.indexOf(h));
  }
  // en cada sección: el texto normal es voz en off si la sección es HOOK/MEAT/CTA… o tiene 2+ acotaciones entre [corchetes]
  const vo = new Array(paras.length).fill(false);
  let start = 0;
  const mark = (a, b) => {
    const n = paras.slice(a, b).filter(p => /^\[.*\]$/.test(p.text)).length;
    const spoken = n >= 2 || (isHead(paras[a]) && SECTION_RE.test(paras[a].text) && !/^CONTEXTO/i.test(paras[a].text));
    for (let k = a; k < b; k++) vo[k] = spoken;
  };
  paras.forEach((p, k) => { if (k > start && isHead(p)) { mark(start, k); start = k; } }); mark(start, paras.length);
  const classify = (from, to) => {
    const out = [];
    const last = () => out[out.length - 1]?.t;
    const dia = x => { if (!['character', 'paren', 'dialogue'].includes(last())) out.push({ t: 'character', x: 'VOZ EN OFF' }); out.push({ t: 'dialogue', x }); };
    for (let k = from; k < to; k++) {
      const p = paras[k], s = p.text; let m;
      if (isSceneLine(s)) { out.push({ t: 'scene', x: stripSceneNum(s) }); continue; }
      if (isTransition(s)) { out.push({ t: 'transition', x: s }); continue; }
      if (isHead(p)) { out.push({ t: 'scene', x: s }); continue; }
      if (isLabel(p)) { out.push({ t: 'action', x: s }); continue; }
      if (/^\[.*\]$/.test(s)) { out.push({ t: 'action', x: s.slice(1, -1).trim() }); continue; }
      if ((m = s.match(/^(VISUAL|VIDEO|V[IÍ]DEO|IMAGEN|PLANO|B-?ROLL|TEXTO EN PANTALLA|TEXTO|SUPER|GR[AÁ]FICO)\s*:\s*(.+)$/i))) { out.push({ t: 'action', x: s }); continue; }
      if ((m = s.match(/^(AUDIO|VO|V\.O\.|VOZ EN OFF|VOZ|LOCUCI[OÓ]N|NARRADOR|NARRACI[OÓ]N)\s*:\s*(.+)$/i))) { out.push({ t: 'character', x: 'VOZ EN OFF' }); out.push({ t: 'dialogue', x: m[2] }); continue; }
      if ((m = s.match(/^([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9 .'-]{0,28}?)\s*(\([^)]*\))?\s*:\s*(.+)$/)) && !isSceneLine(s)) {
        out.push({ t: 'character', x: m[1].trim() }); if (m[2]) out.push({ t: 'paren', x: m[2] }); out.push({ t: 'dialogue', x: m[3] }); continue;
      }
      if (last() === 'character') { out.push({ t: /^\(.*\)$/.test(s) ? 'paren' : 'dialogue', x: s }); continue; }
      if (last() === 'paren') { out.push({ t: 'dialogue', x: s }); continue; }
      const next = paras[k + 1];
      if (isCaps(s) && /(TO:|A:)$/.test(s) && s.length < 40) { out.push({ t: 'transition', x: s }); continue; }
      if (isCaps(s) && s.length < 40 && !/[.!?…:]$/.test(s.replace(/\(.*\)$/, '').trim()) && next && k + 1 < to && !isHead(next) && !isSceneLine(next.text) && !isSceneLine(s)) { out.push({ t: 'character', x: s }); continue; }
      if (/^[“"«¨]/.test(s) && !/[”"»]\s*$/.test(s)) { // cita que sigue en las líneas siguientes
        let x = s, j = k;
        while (j + 1 < to && j - k < 6 && !isHead(paras[j + 1]) && !/[”"»]/.test(x.slice(1))) { j++; x += ' ' + paras[j].text; }
        if (/[”"»]/.test(x.slice(1))) { dia(x); k = j; continue; }
      }
      if (/^[“"«].*[”"»]$/.test(s) || vo[k]) { dia(s); continue; }
      out.push({ t: 'action', x: s });
    }
    return out;
  };
  if (splitIdx.length >= 2) {
    const sets = [];
    splitIdx.forEach((at, i) => {
      const from = i === 0 ? 0 : at; const end = splitIdx[i + 1] ?? paras.length;
      const blocks = classify(i === 0 ? 0 : at + 1, end).filter(b => !(i === 0 && b.x === paras[at].text && b.t === 'scene'));
      sets.push({ title: paras[at].text.replace(/[:.\s]+$/, ''), blocks });
    });
    return { sets, all: { title, blocks: classify(0, paras.length) } };
  }
  return { sets: [{ title, blocks: classify(0, paras.length) }] };
}
/* Texto plano con sangrías (guion exportado a .txt desde Final Draft, etc.) */
// páginas con diálogos (nombre en mayúsculas sangrado + texto debajo): ahí está el guion
function guessScriptPages(paras) {
  const cues = new Map();
  paras.forEach((p, i) => { if (p.ind >= IND.char - .3 && isCaps(p.text) && p.text.length < 40 && !isTransition(p.text) && paras[i + 1] && !isCaps(paras[i + 1].text)) cues.set(p.page, (cues.get(p.page) || 0) + 1); });
  const pg = [...cues].filter(([, n]) => n >= 2).map(([k]) => k).sort((a, b) => a - b);
  if (!pg.length) return null;
  let best = [pg[0], pg[0]], cur = [pg[0], pg[0]];
  for (const k of pg.slice(1)) { if (k - cur[1] <= 2) cur[1] = k; else cur = [k, k]; if (cur[1] - cur[0] > best[1] - best[0]) best = [...cur]; }
  // si la primera página con diálogos no abre con una escena, el guion empezó en la anterior
  const onFirst = paras.filter(p => p.page === best[0]);
  const sceneIdx = onFirst.findIndex(p => isSceneLine(p.text)), cueIdx = onFirst.findIndex(p => p.ind >= IND.char - .3 && isCaps(p.text));
  if (sceneIdx < 0 || (cueIdx >= 0 && cueIdx < sceneIdx)) { const back = paras.filter(p => p.page === best[0] - 1 && isSceneLine(p.text)).pop(); if (back) best[0] = back.page; }
  // y sigue mientras haya diálogos o escenas en las páginas siguientes
  const has = k => (cues.get(k) || 0) > 0 || paras.some(p => p.page === k && isSceneLine(p.text));
  while (has(best[1] + 1)) best[1]++;
  return best;
}
function askPages(total, guess) {
  return new Promise(res => {
    const d = $('#dialog');
    d.innerHTML = `<div class="dialog"><h3>¿Qué páginas importar?</h3>
      <p class="muted" style="margin:0 0 8px">Este PDF tiene <b>${total} páginas</b>. Si es una tesis, libro o dossier, importa solo las del guion para que no se mezcle con el resto.</p>
      ${guess ? `<p style="margin:0 0 8px">Parece que el guion está en las páginas <b>${guess[0]}–${guess[1]}</b>.</p>` : ''}
      <div class="row" style="margin:0;justify-content:flex-start"><label style="margin:0">Desde</label><input class="inp" id="pgA" type="number" min="1" max="${total}" value="${guess ? guess[0] : 1}" style="width:90px">
        <label style="margin:0">hasta</label><input class="inp" id="pgB" type="number" min="1" max="${total}" value="${guess ? guess[1] : total}" style="width:90px"></div>
      <div class="row"><button class="btn" data-x>Cancelar</button><button class="btn" data-all>Todo el PDF</button><button class="btn pri" data-ok>Importar esas páginas</button></div></div>`;
    d.hidden = false;
    const done = v => { d.hidden = true; d.onclick = null; res(v); };
    d.onclick = e => {
      if (e.target === d || e.target.closest('[data-x]')) return done(null);
      if (e.target.closest('[data-all]')) return done([1, total]);
      if (e.target.closest('[data-ok]')) { let a = Math.max(1, +$('#pgA').value || 1), b = Math.min(total, +$('#pgB').value || total); if (a > b) [a, b] = [b, a]; done([a, b]); }
    };
  });
}
function txtParas(text) {
  const out = []; let blank = true;
  for (let raw of text.replace(/\r/g, '').split('\n')) {
    raw = raw.replace(/[\f\v\u200b\ufeff]/g, '');
    if (!raw.trim()) { blank = true; continue; }
    if (/^\s{12,}\d{1,3}\.?\s*$/.test(raw)) continue; // número de página a la derecha
    const lead = raw.match(/^[\t ]*/)[0];
    out.push({ text: cleanTxt(raw), ind: (lead.match(/\t/g) || []).length * .5 + (lead.match(/ /g) || []).length * .1, blank, size: 12, bold: false });
    blank = false;
  }
  // la sangría de la acción puede no ser 0
  const base = Math.min(...out.map(p => p.ind)); out.forEach(p => p.ind -= base);
  return out;
}

const upT = b =>['scene', 'character', 'transition', 'act', 'shot'].includes(b.t) ? b.x.toUpperCase() : b.x;
// formato dentro de un elemento: se guarda en b.h (solo <b>, <i> y <u>); b.x es siempre el texto plano
const INLINE = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u' };
function cleanInline(node) {
  let s = '';
  node.childNodes.forEach(n => {
    if (n.nodeType === 3) { s += esc(n.textContent.replace(/\u00a0/g, ' ').replace(/\n/g, ' ')); return; }
    if (n.nodeType !== 1 || n.nodeName === 'BR') return;
    const tags = []; if (INLINE[n.nodeName]) tags.push(INLINE[n.nodeName]);
    const st = n.style;
    if (st) { if (/bold|[6-9]00/.test(st.fontWeight)) tags.push('b'); if (st.fontStyle === 'italic') tags.push('i'); if (/underline/.test(st.textDecoration || st.textDecorationLine || '')) tags.push('u'); }
    const inner = cleanInline(n);
    s += inner ? [...new Set(tags)].reduce((a, t) => `<${t}>${a}</${t}>`, inner) : '';
  });
  return s;
}
const tplOf = h => { const t = document.createElement('template'); t.innerHTML = h; return t.content; };
const fmtHTML = b => b.h ? cleanInline(tplOf(b.h)) : esc(b.x);
function runsOf(b) { // [{s, b, i, u}] para exportar
  if (!b.h) return [{ s: upT(b) }];
  const out = []; const up = upT(b) !== b.x;
  const walk = (node, f) => node.childNodes.forEach(n => {
    if (n.nodeType === 3) { if (n.textContent) out.push({ s: up ? n.textContent.toUpperCase() : n.textContent, ...f }); }
    else if (n.nodeType === 1) walk(n, { ...f, [INLINE[n.nodeName] || '_']: true });
  });
  walk(tplOf(b.h), {}); return out;
}
const fountainText = b => runsOf(b).map(r => { let t = r.s; if (r.u) t = `_${t}_`; if (r.b && r.i) t = `***${t}***`; else if (r.b) t = `**${t}**`; else if (r.i) t = `*${t}*`; return t; }).join('');
function toFountain() {
  let s = `Title: ${P.title}\nAuthor: ${P.author}\n${P.contact ? 'Contact: ' + P.contact + '\n' : ''}\n`;
  let prev = '';
  for (const b of P.blocks) {
    if (!b.x.trim()) continue; const x = b.h ? fountainText(b).trim() : upT(b).trim();
    if (b.t === 'scene') s += `\n${SCENE_RE.test(x) ? '' : '.'}${x}\n`;
    else if (b.t === 'act') s += `\n# ${x}\n`;
    else if (b.t === 'shot') s += `\n!${x}\n`;
    else if (b.t === 'action' || b.t === 'text') s += `\n${isCaps(x) ? '!' : ''}${x}\n`;
    else if (b.t === 'character') s += `\n${x}\n`;
    else if (b.t === 'paren') s += `${/^\(/.test(x) ? x : '(' + x + ')'}\n`;
    else if (b.t === 'dialogue') s += `${x}\n`;
    else if (b.t === 'transition') s += `\n> ${x}\n`;
    prev = b.t;
  }
  return s;
}
function toFDX() {
  const rev = { scene: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', act: 'New Act', shot: 'Shot', text: 'General' };
  const style = r => [r.b && 'Bold', r.i && 'Italic', r.u && 'Underline'].filter(Boolean).join('+');
  const x = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">\n<Content>\n` +
    P.blocks.filter(b => b.x.trim()).map(b => `<Paragraph Type="${rev[b.t]}">${runsOf(b).map(r => `<Text${style(r) ? ` Style="${style(r)}"` : ''}>${x(r.s)}</Text>`).join('')}</Paragraph>`).join('\n') +
    `\n</Content>\n<TitlePage><Content><Paragraph Alignment="Center"><Text>${x(P.title.toUpperCase())}</Text></Paragraph><Paragraph Alignment="Center"><Text>${x(P.author)}</Text></Paragraph></Content></TitlePage>\n</FinalDraft>`;
}

/* ================= Router ================= */
const VIEWS = { guion: renderGuion, desglose: renderDesglose, planos: renderPlanos, rodaje: renderRodaje, presupuesto: renderPresupuesto, moodboard: renderMoodboard };
const UI = { view: 'guion', sid: null, bdAll: false, shotsAll: false };
function go(view) { if (P) location.hash = `#/p/${P.id}/${view}`; }
function route() {
  syncNow(); flushSave();
  const m = location.hash.match(/^#\/p\/([^/]+)(?:\/(\w+))?/);
  if (m) {
    if (!P || P.id !== m[1]) {
      if (CL.pid && CL.pid !== m[1]) cloudLeave();
      P = loadProject(m[1]); UI.sid = null;
      if ((!P || P.cloud) && CL.pid !== m[1]) {
        cloudOpen(m[1]);
        if (!P) { document.body.classList.add('in-project'); app.innerHTML = '<p class="muted pad">Abriendo el guion de la nube…</p>'; return; }
      }
    }
    if (!P) { location.hash = '#/'; return; }
    UI.view = VIEWS[m[2]] ? m[2] : 'guion';
  } else { P = null; cloudLeave(); }
  render();
}
function render() {
  hideTagpop();
  document.body.classList.toggle('in-project', !!P);
  if (!P) { document.title = 'Glanx Guiones'; renderHome(); return; }
  document.title = `${P.title} · Glanx Guiones`;
  $('#projTitle').value = P.title;
  $$('#tabs a').forEach(a => { a.classList.toggle('on', a.dataset.view === UI.view); a.href = `#/p/${P.id}/${a.dataset.view}`; });
  setSaved(P.cloud ? (CL.editing ? 'Guardado en la nube' : '') : P.updated ? 'Guardado en este navegador' : '');
  document.body.classList.toggle('ro', isRO()); $('#projTitle').readOnly = isRO();
  VIEWS[UI.view]();
  cloudBar(); markCommented(); if (CL.open) cmtRender();
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => { syncNow(); flushSave(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { syncNow(); flushSave(); } });

/* ================= Inicio ================= */
function renderHome() {
  const list = loadIndex().filter(x => !x.cloud);
  setTimeout(cloudHome, 0);
  app.innerHTML = `<div class="home">
    <div class="hero">
      <h1>Del guion <span>al rodaje.</span></h1>
      <p>El espacio de Glanx Studio para escribir guiones y preparar la producción: todo sale del mismo guion, desde el desglose hasta el plan de rodaje y el presupuesto.</p>
      <div class="row">
        <button class="btn pri" data-home="new">+ Nuevo guion</button>
        <button class="btn" data-home="import">Importar archivo</button>
        <button class="btn ghost" data-home="sample">Abrir un guion de ejemplo</button>
      </div>
    </div>
    <div class="feat">
      <div><b>Guion</b><span>Formato automático, Enter y Tab como en Final Draft</span></div>
      <div><b>Desglose</b><span>Reparto, utilería, vestuario… seleccionando texto</span></div>
      <div><b>Planos</b><span>Tamaño, lente, movimiento y referencia</span></div>
      <div><b>Plan de rodaje</b><span>Tiras por escena, arrastra a cada día</span></div>
      <div><b>Presupuesto</b><span>Previsto contra real por departamento</span></div>
      <div><b>Moodboard</b><span>Referencias de Flow, Higgsfield o Pinterest</span></div>
    </div>
    <div class="row"><h2 style="margin:0;font-size:18px">En la nube (equipo)</h2><span class="muted" id="cloudCount"></span></div>
    <div id="cloudBox" style="margin-bottom:30px"><p class="muted">Conectando…</p></div>
    <div class="row"><h2 style="margin:0;font-size:18px">Guiones en este navegador</h2><span class="muted">${list.length}</span></div>
    <div class="plist">${list.map(p => `
      <div class="pcard" data-open="${p.id}">
        <h3>${esc(p.title)}</h3>
        <div class="meta">Editado ${fmtDate(p.updated)}</div>
        <div class="acts">
          <button class="btn sm" data-up="${p.id}" hidden>Subir a la nube</button>
          <button class="btn sm" data-dup="${p.id}">Duplicar</button>
          <button class="btn sm danger" data-del="${p.id}">Borrar</button>
        </div>
      </div>`).join('') || '<p class="muted">Todavía no hay guiones. Crea uno nuevo o importa uno.</p>'}
    </div>
    <div class="note" id="dropHome"><b>Importar:</b> PDF, Word (.docx), Final Draft (.fdx), Fountain, .txt o un respaldo .json. Puedes arrastrar el archivo aquí.<br>
      ¿Está en <b>Google Docs</b>? Ábrelo y ve a <b>Archivo › Descargar › Microsoft Word (.docx)</b> o <b>PDF</b>, y luego impórtalo.</div>
    <div class="note"><b>Dónde se guarda:</b> los guiones de «En la nube» se guardan en internet y los ven tus socios. Los de «En este navegador» viven solo en este equipo. Para pasarlos a otra persona o guardar una copia, usa <b>Exportar › Respaldo completo (.json)</b> y súbelo a Drive; la otra persona lo abre con <b>Importar archivo</b>.</div>
  </div>`;
}
app.addEventListener('click', async e => {
  if (P) return;
  const t = e.target.closest('[data-home],[data-open],[data-dup],[data-del]'); if (!t) return;
  e.stopPropagation();
  if (t.dataset.home === 'new') {
    const p = newProject(); writeProject(p); askPersist(); location.hash = `#/p/${p.id}/guion`;
  } else if (t.dataset.home === 'import') {
    const [f] = await pickFiles('.pdf,.docx,.doc,.fountain,.fdx,.txt,.json'); if (f) importFile(f);
  } else if (t.dataset.home === 'sample') {
    const p = sampleProject(); writeProject(p); location.hash = `#/p/${p.id}/guion`;
  } else if (t.dataset.dup) {
    const src = loadProject(t.dataset.dup); if (!src) return;
    const p = await cloneProject(src, src.title + ' (copia)'); writeProject(p); renderHome(); toast('Guion duplicado');
  } else if (t.dataset.del) {
    const src = loadProject(t.dataset.del);
    if (!confirm(`¿Borrar "${src?.title}" de este navegador? No se puede deshacer (salvo que tengas un respaldo .json).`)) return;
    if (src) for (const id of imageIds(src)) imgDel(id).catch(() => {});
    localStorage.removeItem(PKEY(t.dataset.del)); saveIndex(loadIndex().filter(x => x.id !== t.dataset.del)); renderHome();
  } else if (t.dataset.open) location.hash = `#/p/${t.dataset.open}/guion`;
});
app.addEventListener('dragover', e => { if (!P && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
app.addEventListener('drop', e => { if (P) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) importFile(f); });
function askPersist() { try { navigator.storage?.persist?.(); } catch {} }

/* Imágenes de un proyecto (para respaldo, copia y borrado) */
function imageRefs(p) {
  const refs = [];
  Object.values(p.boards || {}).forEach(arr => arr.forEach(it => it.img && refs.push(it)));
  Object.values(p.canvas || {}).forEach(cv => (cv.items || []).forEach(it => it.img && refs.push(it)));
  Object.values(p.scenes || {}).forEach(m => (m.shots || []).forEach(s => s.img && refs.push(s)));
  return refs;
}
const imageIds = p => [...new Set(imageRefs(p).map(r => r.img))];
async function cloneProject(src, title) {
  const p = normalizeProject(JSON.parse(JSON.stringify(src))); p.id = uid(); p.title = title; p.updated = Date.now(); delete p.cloud;
  const map = {};
  for (const r of imageRefs(p)) {
    if (!map[r.img]) { const d = await imgGet(r.img); map[r.img] = d ? 'i' + uid() : null; if (d) await imgPut(map[r.img], d); }
    r.img = map[r.img];
  }
  return p;
}
async function importFile(f) {
  const name = f.name.replace(/(\.(pdf|docx?|txt|fdx|fountain|json))+$/i, '') || f.name;
  toast(`Importando «${f.name}»…`);
  try {
    if (/\.doc$/i.test(f.name)) throw new Error('Los .doc antiguos de Word no se pueden leer. Ábrelo en Word o Google Docs y guárdalo como .docx o PDF.');
    if (/\.(pdf|docx)$/i.test(f.name)) {
      const isPdf = /\.pdf$/i.test(f.name);
      const buf = await f.arrayBuffer();
      toast(isPdf ? 'Leyendo PDF…' : 'Leyendo documento de Word…');
      let paras;
      if (isPdf) {
        const lines = await pdfLines(buf, (n, t) => { if (t > 3) toast(`Leyendo PDF: página ${n} de ${t}…`); });
        if (!lines.length) throw new Error('Este PDF no tiene texto (parece escaneado o una imagen). Hace falta un PDF exportado desde Word, Google Docs o Final Draft.');
        paras = pdfParas(lines);
        const pages = Math.max(...paras.map(x => x.page || 1));
        const guess = pages > 20 ? guessScriptPages(paras) : null;
        if (guess && guess[1] - guess[0] + 1 < pages * .8) {
          const rng = await askPages(pages, guess);
          if (!rng) { toast('Importación cancelada'); return; }
          paras = paras.filter(x => x.page >= rng[0] && x.page <= rng[1]);
        }
      } else paras = await docxParas(buf);
      if (!paras.length) throw new Error('No se encontró texto en el archivo.');
      let sets;
      if (looksLikeScreenplay(paras)) { const r = screenplayFromParas(paras); sets = [{ title: r.title || name, blocks: r.blocks }]; }
      else {
        const r = docFromParas(paras, name);
        sets = r.sets;
        if (r.all && !confirm(`Este archivo trae ${r.sets.length} guiones:\n\n${r.sets.slice(0, 12).map(s => '• ' + s.title).join('\n')}${r.sets.length > 12 ? '\n…' : ''}\n\nAceptar = un guion por cada uno\nCancelar = todo en un solo guion`)) sets = [r.all];
      }
      sets = sets.filter(s => s.blocks.length);
      if (!sets.length) throw new Error('No se encontró texto en el archivo.');
      const made = sets.map(s => { const p = newProject(s.title || name); p.blocks = s.blocks.map(b => ({ id: uid(), ...b })); writeProject(p); return p; });
      askPersist();
      if (made.length === 1) location.hash = `#/p/${made[0].id}/guion`; else renderHome();
      toast(made.length === 1 ? `Importado: ${made[0].blocks.filter(b => b.t === 'scene').length} escenas` : `Importados ${made.length} guiones`);
      return;
    }
    const text = await f.text();
    if (/\.json$/i.test(f.name)) {
      const data = JSON.parse(text); if (!data.project) throw new Error('No es un respaldo de Glanx Guiones');
      let p = normalizeProject(data.project); if (p) delete p.cloud;
      for (const [id, d] of Object.entries(data.images || {})) { await imgPut(id, d); imgCache.set(id, d); }
      if (loadIndex().some(x => x.id === p.id) && !confirm(`"${p.title}" ya existe en este navegador.\n\nAceptar = reemplazarlo con el respaldo\nCancelar = importarlo como copia`)) p = await cloneProject(p, p.title + ' (importado)');
      writeProject(p); location.hash = `#/p/${p.id}/guion`; toast('Respaldo importado');
      return;
    }
    let blocks;
    if (/\.fdx$/i.test(f.name)) blocks = parseFDX(text);
    else if (/\.txt$/i.test(f.name) && looksLikeScreenplay(txtParas(text))) blocks = screenplayFromParas(txtParas(text)).blocks.map(b => ({ id: uid(), ...b }));
    else blocks = parseScript(text);
    if (!blocks.length) throw new Error('El archivo está vacío');
    const p = newProject(name); p.blocks = blocks; writeProject(p); askPersist();
    location.hash = `#/p/${p.id}/guion`; toast(`Importado: ${blocks.filter(b => b.t === 'scene').length} escenas`);
  } catch (err) { alert('No se pudo importar: ' + err.message); }
}

/* ================= Cabecera ================= */
$('#projTitle').addEventListener('input', e => { if (!P) return; P.title = e.target.value || 'Guion sin título'; document.title = `${P.title} · Glanx Guiones`; save(); });
$('#menuBtn').addEventListener('click', e => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; });
document.addEventListener('click', e => { if (!e.target.closest('.menu')) $('#menu').hidden = true; });
$('#menu').addEventListener('click', async e => {
  const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
  $('#menu').hidden = true; syncNow(); flushSave();
  if (a === 'export') exportDialog();
  else if (a === 'pdf') printScript();
  else if (a === 'printview') printView();
  else if (a === 'fountain') download(slug(P.title) + '.fountain', toFountain());
  else if (a === 'fdx') download(slug(P.title) + '.fdx', toFDX(), 'application/xml');
  else if (a === 'json') {
    download(`${slug(P.title)}-${new Date().toISOString().slice(0, 10)}.glanx.json`, await backupJSON(), 'application/json');
    toast('Respaldo descargado: súbelo a Drive');
  } else if (a === 'info') infoDialog();
});
function infoDialog() {
  const d = $('#dialog');
  d.innerHTML = `<div class="dialog"><h3>Datos del guion</h3>
    <label>Título</label><input class="inp" id="dTitle" value="${esc(P.title)}">
    <label>Escrito por</label><input class="inp" id="dAuthor" value="${esc(P.author)}">
    <label>Contacto (sale en la portada del PDF)</label><input class="inp" id="dContact" value="${esc(P.contact)}">
    <label>Logline</label><textarea class="inp" id="dLog">${esc(P.logline)}</textarea>
    <div class="row"><button class="btn" data-x>Cancelar</button><button class="btn pri" data-ok>Guardar</button></div></div>`;
  d.hidden = false;
  d.onclick = e => {
    if (e.target === d || e.target.closest('[data-x]')) d.hidden = true;
    if (e.target.closest('[data-ok]')) {
      P.title = $('#dTitle').value.trim() || 'Guion sin título'; P.author = $('#dAuthor').value.trim();
      P.contact = $('#dContact').value.trim(); P.logline = $('#dLog').value.trim();
      d.hidden = true; save(); render();
    }
  };
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (P) { syncNow(); flushSave(); toast('Guardado'); } }
  if (e.key === 'Escape') { $('#lightbox').hidden = true; $('#dialog').hidden = true; hideTagpop(); }
});

async function backupJSON() {
  const images = {}; for (const id of imageIds(P)) { const d = await imgGet(id); if (d) images[id] = d; }
  return JSON.stringify({ app: 'glanx-guiones', version: 1, exported: Date.now(), project: P, images });
}

/* ================= Exportar (todo o por secciones) ================= */
const EXP = [['guion', 'Guion (con portada)'], ['desglose', 'Desglose'], ['planos', 'Lista de planos'], ['rodaje', 'Plan de rodaje'], ['presupuesto', 'Presupuesto'], ['moodboard', 'Moodboard']];
const mbBoards = () => { const ids = new Set(getScenes().map(s => s.id)); ids.add('general'); return Object.entries(P.canvas || {}).filter(([sid, cv]) => ids.has(sid) && cv.items?.some(i => i.type !== 'slot')); };
function expInfo(k) {
  const sc = getScenes();
  if (k === 'guion') return `≈ ${totalPages()} pág.`;
  if (k === 'desglose') return `${bdElements().length} elementos`;
  if (k === 'planos') return `${sc.reduce((a, s) => a + meta(s.id).shots.length, 0)} planos`;
  if (k === 'rodaje') return `${P.days.length} días`;
  if (k === 'presupuesto') return money(budgetTotals().total);
  if (k === 'moodboard') return `${mbBoards().length} tableros`;
}
function exportDialog() {
  UI.exp ||= new Set(EXP.map(e => e[0]));
  const d = $('#dialog');
  d.innerHTML = `<div class="dialog"><h3>Exportar</h3>
    <div class="row" style="margin:0 0 4px"><span class="muted" style="font-size:12px">Qué incluir</span><span class="spacer"></span><button class="btn sm" data-all>Todo</button><button class="btn sm" data-none>Nada</button></div>
    <div class="chk-list">${EXP.map(([k, l]) => `<label class="chk"><input type="checkbox" data-s="${k}" ${UI.exp.has(k) ? 'checked' : ''}><span>${l}</span><span class="muted">${expInfo(k)}</span></label>`).join('')}</div>
    <label class="chk" style="margin-top:10px"><input type="checkbox" data-json checked><span>Respaldo .json dentro del .zip</span><span class="muted">para volver a abrirlo aquí</span></label>
    <p class="muted" style="font-size:12px;margin:10px 0 0"><b>PDF:</b> un solo documento con lo marcado (en la ventana de imprimir, elige «Guardar como PDF»).<br><b>Archivos .zip:</b> guion en Fountain y Final Draft, tablas .csv que abre Excel, imágenes de los planos, moodboards en PNG y el respaldo.</p>
    <div class="row"><button class="btn" data-x>Cancelar</button><button class="btn" data-zip>Archivos (.zip)</button><button class="btn pri" data-pdf>PDF</button></div></div>`;
  d.hidden = false;
  const secs = () => EXP.map(e => e[0]).filter(k => $(`[data-s="${k}"]`, d).checked);
  d.onclick = e => {
    if (e.target === d || e.target.closest('[data-x]')) { d.hidden = true; return; }
    if (e.target.closest('[data-all]') || e.target.closest('[data-none]')) { const on = !!e.target.closest('[data-all]'); $$('[data-s]', d).forEach(x => x.checked = on); return; }
    const pdf = e.target.closest('[data-pdf]'), zip = e.target.closest('[data-zip]'); if (!pdf && !zip) return;
    const S = secs(); if (!S.length) return toast('Marca al menos una sección');
    UI.exp = new Set(S); d.hidden = true;
    if (pdf) exportPDF(S); else exportZip(S, $('[data-json]', d).checked);
  };
}
const prHead = t => `<header class="pr-h"><span>${esc(P.title)}</span><h1>${t}</h1></header>`;
function prDesglose(scenes) {
  const rows = scenes.map(s => {
    const m = meta(s.id);
    const cats = BD_CATS.map(([k, l, c]) => { const v = [...new Set([...(k === 'cast' ? s.chars : []), ...(m.bd[k] || [])])]; return v.length ? `<tr><td style="color:${c};font-weight:700;width:170px">${l}</td><td>${esc(v.join(', '))}</td></tr>` : ''; }).join('');
    if (!cats && !m.notes) return '';
    return `<div class="pr-block"><h3>${s.num}. ${esc(s.heading)} <small>${fmtE(s.eighths)} pág.</small></h3><table class="pr-table">${cats}${m.notes ? `<tr><td style="width:170px;font-weight:700">Notas</td><td>${esc(m.notes)}</td></tr>` : ''}</table></div>`;
  }).join('');
  return rows || '<p>Aún no hay nada desglosado.</p>';
}
function prPlanos(scenes) {
  const out = scenes.filter(s => meta(s.id).shots.length).map(s => `<div class="pr-block"><h3>${s.num}. ${esc(s.heading)}</h3><table class="pr-table"><thead><tr><th>Plano</th><th>Tamaño</th><th>Lente</th><th>Movimiento</th><th>Descripción</th><th>Dur.</th><th>Ref.</th></tr></thead><tbody>
    ${meta(s.id).shots.map((sh, i) => `<tr><td><b>${shotCode(s, i)}</b></td><td>${esc(sh.size)}</td><td>${esc(sh.lens)}</td><td>${esc(sh.move)}</td><td>${esc(sh.desc)}${shotParts(sh, Object.fromEntries(s.blocks.map(b => [b.id, b]))).map(p => `<div class="pr-q">«${esc(p.q)}»</div>`).join('')}</td><td>${sh.dur ? esc(sh.dur) + ' s' : ''}</td><td>${sh.img ? `<img class="pr-thumb" data-img="${sh.img}" alt="">` : ''}</td></tr>`).join('')}</tbody></table></div>`).join('');
  return out || '<p>Aún no hay planos.</p>';
}
function prRodaje(scenes) {
  const byId = Object.fromEntries(scenes.map(s => [s.id, s]));
  const table = ids => `<table class="pr-table"><thead><tr><th>Esc.</th><th>I/E</th><th>Locación</th><th>Momento</th><th>Pág.</th><th>Personajes</th><th>Planos</th></tr></thead><tbody>
    ${ids.map(id => byId[id]).filter(Boolean).map(s => `<tr><td class="pr-strip ${stripClass(s)}"><b>${s.num}</b></td><td>${s.ie || '—'}</td><td>${esc(s.loc)}</td><td>${esc(s.time) || '—'}</td><td>${fmtE(s.eighths)}</td><td>${esc(s.chars.join(', '))}</td>
      <td>${meta(s.id).shots.map((sh, i) => `<div><b>${shotCode(s, i)}</b> ${esc([sh.size, sh.desc].filter(Boolean).join(' — '))}</div>`).join('')}</td></tr>`).join('')}</tbody></table>`;
  const assigned = new Set(P.days.flatMap(d => d.scenes)); const pool = scenes.filter(s => !assigned.has(s.id)).map(s => s.id);
  const pg = ids => fmtE(ids.reduce((a, id) => a + (byId[id]?.eighths || 0), 0));
  return P.days.map((d, i) => `<div class="pr-block"><h3>Día ${i + 1}${d.date ? ' · ' + new Date(d.date + 'T12:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}${d.note ? ' · ' + esc(d.note) : ''} <small>${d.scenes.length} esc. · ${pg(d.scenes)} pág.</small></h3>${d.scenes.length ? table(d.scenes) : '<p>Sin escenas.</p>'}</div>`).join('')
    + (pool.length ? `<div class="pr-block"><h3>Sin asignar <small>${pool.length} esc.</small></h3>${table(pool)}</div>` : '') || '<p>Aún no hay plan de rodaje.</p>';
}
function prPresupuesto() {
  const B = P.budget, T = budgetTotals(), f = fitInfo(T);
  return `<table class="pr-table pr-kpi"><tr><td>Presupuesto inicial</td><td class="num">${num(B.target) ? money(num(B.target)) : '—'}</td></tr>
    <tr><td>Previsto</td><td class="num">${money(T.plan)}</td></tr><tr><td>Imprevistos (${num(B.contingency)} %)</td><td class="num">${money(T.cont)}</td></tr>
    <tr><td><b>Total</b></td><td class="num"><b>${money(T.total)}</b></td></tr>${num(B.target) ? `<tr><td>${f.l}</td><td class="num">${f.v}</td></tr>` : ''}
    <tr><td>Gastado real</td><td class="num">${money(T.act)}</td></tr>${P.days.length ? `<tr><td>Por día de rodaje (${P.days.length})</td><td class="num">${money(T.total / P.days.length)}</td></tr>` : ''}</table>
    ${B.depts.map((d, i) => d.items.length ? `<div class="pr-block"><h3>${esc(d.name)} <small>${money(T.depts[i].p)}</small></h3><table class="pr-table"><thead><tr><th>Concepto</th><th class="num">Cant.</th><th>Unidad</th><th class="num">Valor unitario</th><th class="num">Previsto</th><th class="num">Real</th></tr></thead><tbody>
      ${d.items.map(it => `<tr><td>${esc(it.name)}</td><td class="num">${esc(it.qty)}</td><td>${esc(it.unit)}</td><td class="num">${money(num(it.cost))}</td><td class="num">${money(num(it.qty) * num(it.cost))}</td><td class="num">${num(it.actual) ? money(num(it.actual)) : ''}</td></tr>`).join('')}</tbody></table></div>` : '').join('')}`;
}
async function prMoodboard(scenes) {
  const out = [];
  for (const [sid, cv] of mbBoards()) {
    const sc = scenes.find(s => s.id === sid);
    const c = await mbRenderCanvas(cv, null, 1);
    out.push(`<div class="pr-block pr-mb"><h3>${sc ? `${sc.num}. ${esc(sc.heading)}` : 'General'}</h3><img src="${c.toDataURL('image/jpeg', .9)}" alt=""></div>`);
  }
  return out.join('') || '<p>Aún no hay moodboards.</p>';
}
const titlePageHTML = () => `<div class="title-page"><h1>${esc(P.title.toUpperCase())}</h1>
    ${P.logline ? `<p style="max-width:4.5in;font-style:italic">${esc(P.logline)}</p>` : ''}
    <p>Escrito por</p><p>${esc(P.author || 'Glanx Studio')}</p>
    <div class="tp-foot">${esc(P.contact || 'Glanx Studio')}<br>${new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>`;
async function exportPDF(secs) {
  syncNow(); flushSave(); toast('Preparando el PDF…');
  const scenes = getScenes(), parts = [];
  if (secs.includes('guion')) parts.push(`<div class="pr-script">${titlePageHTML()}<div class="script">${P.blocks.filter(b => b.x.trim()).map(b => `<div class="el" data-t="${b.t}">${fmtHTML(b)}</div>`).join('')}</div></div>`);
  else parts.push(`<section class="pr-sec pr-cover"><h1>${esc(P.title)}</h1><p>${secs.map(k => EXP.find(e => e[0] === k)[1]).join(' · ')}</p><p>${esc(P.author || 'Glanx Studio')} · ${new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}</p></section>`);
  if (secs.includes('desglose')) parts.push(`<section class="pr-sec">${prHead('Desglose')}${prDesglose(scenes)}</section>`);
  if (secs.includes('planos')) parts.push(`<section class="pr-sec">${prHead('Lista de planos')}${prPlanos(scenes)}</section>`);
  if (secs.includes('rodaje')) parts.push(`<section class="pr-sec">${prHead('Plan de rodaje')}${prRodaje(scenes)}</section>`);
  if (secs.includes('presupuesto')) parts.push(`<section class="pr-sec">${prHead('Presupuesto')}${prPresupuesto()}</section>`);
  if (secs.includes('moodboard')) parts.push(`<section class="pr-sec">${prHead('Moodboard')}${await prMoodboard(scenes)}</section>`);
  const pr = $('#print'); pr.innerHTML = parts.join('');
  await Promise.all($$('img', pr).map(async im => { if (im.dataset.img) { const d = await imgGet(im.dataset.img); if (d) im.src = d; } try { await im.decode(); } catch {} }));
  document.body.classList.add('printing-script');
  setTimeout(() => window.print(), 60);
}
async function exportZip(secs, withJson) {
  syncNow(); flushSave(); toast('Preparando los archivos…');
  try { await loadScript(LIBS.zip); } catch (e) { toast(e.message); return; }
  const z = new JSZip(), base = slug(P.title), scenes = getScenes();
  const cell = v => { v = String(v ?? ''); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = rows => '\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  const nf = v => String(num(v)).replace('.', ',');
  const dataPart = d => d.split(',')[1], extOf = d => (/^data:image\/(\w+)/.exec(d)?.[1] || 'jpg').replace('jpeg', 'jpg');
  if (secs.includes('guion')) { z.file(base + '.fountain', toFountain()); z.file(base + '.fdx', toFDX()); }
  if (secs.includes('desglose')) {
    const rows = [['Escena', 'Encabezado', 'Categoría', 'Elemento']];
    scenes.forEach(s => { const m = meta(s.id); BD_CATS.forEach(([k, l]) => [...new Set([...(k === 'cast' ? s.chars : []), ...(m.bd[k] || [])])].forEach(v => rows.push([s.num, s.heading, l, v]))); if (m.notes) rows.push([s.num, s.heading, 'Notas', m.notes]); });
    z.file('desglose.csv', csv(rows));
  }
  if (secs.includes('planos')) {
    const rows = [['Plano', 'Escena', 'Encabezado', 'Tamaño', 'Lente', 'Movimiento', 'Descripción', 'Partes del guion', 'Duración (s)', 'Imagen']];
    for (const s of scenes) for (const [i, sh] of meta(s.id).shots.entries()) {
      let file = '';
      if (sh.img) { const d = await imgGet(sh.img); if (d) { file = `planos/${shotCode(s, i)}.${extOf(d)}`; z.file(file, dataPart(d), { base64: true }); } }
      rows.push([shotCode(s, i), s.num, s.heading, sh.size, sh.lens, sh.move, sh.desc, shotParts(sh, Object.fromEntries(s.blocks.map(b => [b.id, b]))).map(p => p.q).join(' … '), sh.dur ? nf(sh.dur) : '', file]);
    }
    z.file('planos.csv', csv(rows));
  }
  if (secs.includes('rodaje')) {
    const byId = Object.fromEntries(scenes.map(s => [s.id, s]));
    const rows = [['Día', 'Fecha', 'Notas del día', 'Escena', 'I/E', 'Locación', 'Momento', 'Páginas', 'Personajes', 'Planos']];
    P.days.forEach((d, i) => d.scenes.map(id => byId[id]).filter(Boolean).forEach(s => rows.push([i + 1, d.date || '', d.note || '', s.num, s.ie, s.loc, s.time, nf(Math.round(s.eighths / 8 * 1000) / 1000), s.chars.join(', '), meta(s.id).shots.map((sh, j) => shotCode(s, j)).join(' ')])));
    z.file('plan-de-rodaje.csv', csv(rows));
  }
  if (secs.includes('presupuesto')) {
    const B = P.budget, T = budgetTotals();
    const rows = [['Departamento', 'Concepto', 'Cantidad', 'Unidad', 'Valor unitario', 'Previsto', 'Real']];
    B.depts.forEach(d => d.items.forEach(it => rows.push([d.name, it.name, nf(it.qty), it.unit, nf(it.cost), nf(num(it.qty) * num(it.cost)), nf(it.actual)])));
    rows.push([], ['', 'Previsto', '', '', '', nf(T.plan), nf(T.act)], ['', `Imprevistos (${num(B.contingency)} %)`, '', '', '', nf(T.cont)], ['', 'Total', '', '', '', nf(T.total)], ['', 'Presupuesto inicial', '', '', '', nf(B.target)], ['', 'Moneda: ' + B.currency]);
    z.file('presupuesto.csv', csv(rows));
  }
  if (secs.includes('moodboard')) for (const [sid, cv] of mbBoards()) {
    const sc = scenes.find(s => s.id === sid);
    const c = await mbRenderCanvas(cv, null, 2);
    z.file(`moodboard/${sc ? 'escena-' + sc.num : 'general'}.png`, await new Promise(r => c.toBlob(r, 'image/png')));
  }
  if (withJson) z.file(base + '.glanx.json', await backupJSON());
  const blob = await z.generateAsync({ type: 'blob' });
  download(`${base}-${new Date().toISOString().slice(0, 10)}.zip`, blob); toast('Archivos descargados');
}

/* ================= Impresión ================= */
function printScript() { exportPDF(['guion']); }
function printView() { $$('details.dept').forEach(d => d.open = true); window.print(); }
window.addEventListener('afterprint', () => { document.body.classList.remove('printing-script'); $('#print').innerHTML = ''; });

/* ================= Lista lateral de escenas ================= */
function sceneList(scenes, { general = false, right } = {}) {
  return `<div class="side-head">Escenas <span>${scenes.length}</span></div><div class="scene-list">
    ${general ? `<button class="sc ${UI.sid === 'general' ? 'on' : ''}" data-sid="general"><b>★</b><span>General (todo el proyecto)</span><i>${(P.boards.general || []).length || ''}</i></button>` : ''}
    ${scenes.map(s => `<button class="sc ${UI.sid === s.id ? 'on' : ''}" data-sid="${s.id}"><b>${s.num}</b><span>${esc(s.heading || '(sin encabezado)')}</span><i>${right ? right(s) : fmtE(s.eighths)}</i></button>`).join('')
    || '<p class="muted pad">Aún no hay escenas. En el guion, escribe un encabezado como <b>INT. CASA - NOCHE</b>.</p>'}</div>`;
}
function ensureSid(scenes, allowGeneral) {
  if (allowGeneral && UI.sid === 'general') return;
  if (!scenes.some(s => s.id === UI.sid)) UI.sid = scenes[0]?.id || (allowGeneral ? 'general' : null);
}
function bindSide(onPick) {
  $('.side')?.addEventListener('click', e => { const b = e.target.closest('[data-sid]'); if (b) onPick(b.dataset.sid); });
}

/* ================= GUION (editor) ================= */
let syncTimer = null;
function blockHTML(b) { return `<div class="el" data-t="${b.t}" data-id="${b.id}">${b.x ? fmtHTML(b) : '<br>'}</div>`; }
function mkBlock(b) { const t = document.createElement('template'); t.innerHTML = blockHTML(b); return t.content.firstChild; }
function setText(el, t) { if (t) el.textContent = t; else el.innerHTML = '<br>'; }

function renderGuion() {
  app.innerHTML = `<div class="layout">
    <aside class="side" id="gSide"></aside>
    <section class="editor-wrap">
      <div class="toolbar">
        <div class="tsel"><button class="type-btn" data-typebtn title="Tipo de elemento"><span id="typeLbl">Acción</span><i>▾</i></button>
          <div class="type-menu" id="typeMenu" hidden><div class="tm-h">TAB para cambiar</div>
          ${TYPES.map(([t, l], i) => `<button data-type="${t}"><span>${l}</span><kbd>Ctrl+${i}</kbd></button>`).join('')}</div></div>
        <span class="tsep"></span>
        <button class="fmt" data-fmt="bold" title="Negrita (Ctrl+B)"><b>B</b></button><button class="fmt" data-fmt="italic" title="Cursiva (Ctrl+I)"><i>I</i></button><button class="fmt" data-fmt="underline" title="Subrayado (Ctrl+U)"><u>U</u></button>
        <span class="hint">Enter: siguiente · Tab: cambiar tipo · Ctrl+0…8: tipo directo</span><span class="info" id="pageInfo"></span></div>
      <div class="paper-scroll"><div class="paper"><div id="ed" class="script" contenteditable="true" spellcheck="true" lang="es"></div></div></div>
    </section></div>`;
  const ed = $('#ed');
  ed.innerHTML = P.blocks.map(blockHTML).join('');
  if (isRO()) ed.contentEditable = 'false';
  refreshSide();
  bindSide(sid => {
    const el = ed.querySelector(`[data-id="${sid}"]`); if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' }); ed.focus(); setCaret(el, el.textContent.length); markCur();
  });
  try { document.execCommand('styleWithCSS', false, false); } catch {}
  $('.toolbar').addEventListener('mousedown', e => {
    if (e.target.closest('[data-typebtn]')) { e.preventDefault(); $('#typeMenu').hidden = !$('#typeMenu').hidden; return; }
    const f = e.target.closest('[data-fmt]');
    if (f) { e.preventDefault(); if (!caretInfo()) return; document.execCommand(f.dataset.fmt); scheduleSync(true); markCur(); return; }
    const b = e.target.closest('[data-type]'); if (!b) return; e.preventDefault(); $('#typeMenu').hidden = true;
    const c = caretInfo(); if (c) setType(c.el, b.dataset.type); else if (ed.lastElementChild) setType(ed.lastElementChild, b.dataset.type);
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('.tsel')) $('#typeMenu') && ($('#typeMenu').hidden = true); });
  ed.addEventListener('blur', () => acClose());
  $('.paper-scroll').addEventListener('scroll', () => acClose(), { passive: true });
  ed.addEventListener('keydown', onEdKey);
  ed.addEventListener('paste', onEdPaste);
  ed.addEventListener('input', () => {
    const c = caretInfo();
    if (c && c.el.dataset.t === 'action' && SCENE_RE.test(c.el.textContent)) setType(c.el, 'scene', true);
    scheduleSync(); acUpdate();
  });
  ed.addEventListener('drop', e => e.preventDefault());
  if (P.blocks.length <= 2 && !P.blocks.some(b => b.x && b.x !== 'INT. LUGAR - DÍA')) { ed.focus(); setCaret(ed.firstElementChild, ed.firstElementChild.textContent.length); }
}
document.addEventListener('selectionchange', () => { if ($('#ed')) markCur(); });
function markCur() {
  const c = caretInfo(); const cur = c?.el;
  $$('#ed .el.cur').forEach(x => x !== cur && x.classList.remove('cur'));
  if (cur) cur.classList.add('cur');
  $$('.toolbar [data-type]').forEach(b => b.classList.toggle('on', !!cur && b.dataset.type === cur.dataset.t));
  if ($('#typeLbl')) $('#typeLbl').textContent = cur ? TYPE_LABEL[cur.dataset.t] || 'Acción' : '—';
  $$('.toolbar [data-fmt]').forEach(b => { let on = false; try { on = !!cur && document.queryCommandState(b.dataset.fmt); } catch {} b.classList.toggle('on', on); });
  acUpdate();
}
function caretInfo() {
  const ed = $('#ed'); const sel = getSelection(); if (!ed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0); if (!ed.contains(r.startContainer)) return null;
  let el;
  if (r.startContainer === ed) el = ed.children[Math.min(r.startOffset, ed.children.length - 1)];
  else el = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('.el');
  if (!el) return null;
  const pre = document.createRange(); pre.selectNodeContents(el);
  try { pre.setEnd(r.startContainer, r.startOffset); } catch { return { el, off: 0, collapsed: r.collapsed }; }
  return { el, off: r.startContainer === ed ? 0 : pre.toString().length, collapsed: r.collapsed };
}
function setCaret(el, off) {
  const sel = getSelection(); const r = document.createRange();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, rem = off;
  while ((n = w.nextNode())) { if (rem <= n.length) { r.setStart(n, rem); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return; } rem -= n.length; }
  r.setStart(el, el.textContent.length ? el.childNodes.length : 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
}
function setType(el, t, keepCaret) {
  if (el.dataset.t === t) return;
  const c = keepCaret ? caretInfo() : null;
  el.dataset.t = t; markCur(); scheduleSync(true);
  if (c) setCaret(el, c.off);
}
function onEdKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (acKey(e)) return;
  const dig = /^Digit([0-8])$/.exec(e.code)?.[1] ?? (/^[0-8]$/.test(e.key) ? e.key : null);
  if (mod && !e.altKey && dig != null) { e.preventDefault(); const c = caretInfo(); if (c) setType(c.el, TYPE_KEYS[+dig]); return; }
  if (e.key === 'Tab') {
    e.preventDefault(); const c = caretInfo(); if (!c) return;
    const i = TYPE_KEYS.indexOf(c.el.dataset.t), n = TYPE_KEYS.length;
    setType(c.el, TYPE_KEYS[(i + (e.shiftKey ? n - 1 : 1)) % n]); return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    let c = caretInfo(); if (!c) return;
    if (!c.collapsed) { document.execCommand('delete'); c = caretInfo(); if (!c) return; }
    const el = c.el, txt = el.textContent, before = txt.slice(0, c.off), after = txt.slice(c.off);
    let t = el.dataset.t;
    if (!txt.trim() && t !== 'action') { setType(el, 'action'); return; } // Enter en vacío: vuelve a Acción
    if (c.off === 0 && txt) { // Enter al inicio: línea vacía antes
      el.before(mkBlock({ id: uid(), t: 'action', x: '' })); scheduleSync(true); return;
    }
    if (t === 'action' && !after) {
      const s = before.trim();
      if (SCENE_RE.test(s)) el.dataset.t = t = 'scene';
      else if (isCaps(s) && /(TO:|A:)$/.test(s) && s.length < 40) el.dataset.t = t = 'transition';
    }
    const nb = mkBlock({ id: uid(), t: after ? t : NEXT[t], x: '' });
    if (after) { const s0 = getSelection().getRangeAt(0), r = document.createRange(); r.setStart(s0.startContainer, s0.startOffset); r.setEnd(el, el.childNodes.length); nb.innerHTML = ''; nb.appendChild(r.extractContents()); }
    if (!el.textContent) el.innerHTML = '<br>';
    el.after(nb); setCaret(nb, 0);
    nb.scrollIntoView({ block: 'nearest' }); scheduleSync(true); markCur();
    return;
  }
  if (e.key === 'Backspace') {
    const c = caretInfo(); if (!c || !c.collapsed || c.off !== 0) return;
    const prev = c.el.previousElementSibling;
    e.preventDefault();
    if (!prev) { if (c.el.dataset.t !== 'action') setType(c.el, 'action'); return; }
    if (!c.el.textContent && c.el.dataset.t !== 'action' && c.el.dataset.t !== NEXT[prev.dataset.t]) { setType(c.el, NEXT[prev.dataset.t] || 'action'); return; }
    const pl = prev.textContent.length; joinEl(prev, c.el);
    c.el.remove(); setCaret(prev, pl); scheduleSync(true); markCur(); return;
  }
  if (e.key === 'Delete') {
    const c = caretInfo(); if (!c || !c.collapsed || c.off !== c.el.textContent.length) return;
    const next = c.el.nextElementSibling; if (!next) return;
    e.preventDefault(); const l = c.el.textContent.length;
    joinEl(c.el, next); next.remove(); setCaret(c.el, l); scheduleSync(true);
  }
}
// une dos elementos sin perder negritas, cursivas ni subrayados
function joinEl(a, b) {
  $$(':scope > br', a).forEach(x => x.remove());
  [...b.childNodes].forEach(n => { if (n.nodeName !== 'BR') a.appendChild(n); });
  if (!a.textContent) a.innerHTML = '<br>';
}

/* ---------- Autocompletar: INT./EXT., locaciones, momentos del día, personajes, transiciones ---------- */
const AC = { el: null, items: [], i: 0, from: 0, nav: false, key: '', shut: '' };
const AC_TIMES = ['DÍA', 'NOCHE', 'ATARDECER', 'AMANECER', 'MAÑANA', 'TARDE', 'CONTINUO', 'MÁS TARDE', 'MOMENTOS DESPUÉS', 'MISMO MOMENTO'];
const AC_TRANS = ['CORTE A:', 'FUNDIDO A NEGRO.', 'FUNDIDO DE ENTRADA:', 'DISOLVENCIA A:', 'CORTE A NEGRO.', 'CORTE ABRUPTO A:', 'FUNDE A NEGRO.'];
const AC_ACTS = ['ACTO UNO', 'ACTO DOS', 'ACTO TRES', 'ACTO CUATRO', 'ACTO CINCO', 'PRÓLOGO', 'EPÍLOGO'];
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const edTexts = (t, except) => $$(`#ed > .el[data-t="${t}"]`).filter(e => e !== except).map(e => e.textContent.trim()).filter(Boolean);
function acCompute(el, txt) {
  const t = el.dataset.t;
  const pick = (list, q, from, suffix = '') => {
    const seen = new Set(), items = [];
    for (const v of list) { const k = fold(v); if (!k || seen.has(k)) continue; seen.add(k); if (k.startsWith(fold(q)) && k !== fold(q)) items.push({ label: v.toUpperCase(), ins: v.toUpperCase() + suffix }); }
    return { from, items: items.slice(0, 8) };
  };
  if (t === 'scene') {
    const m = txt.match(/^(\s*)(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INTERIOR|EXTERIOR|INT\.?|EXT\.?)\s+/i);
    if (!m) return pick(['INT.', 'EXT.', 'INT./EXT.'], txt, 0, ' ');
    const rest = txt.slice(m[0].length), heads = edTexts('scene', el).map(parseHeading);
    const dash = [...rest.matchAll(/\s[-–—]\s*/g)].pop();
    if (!dash) return pick(heads.map(h => h.loc).filter(l => l !== '—'), rest, m[0].length, ' - ');
    const from = m[0].length + dash.index + dash[0].length;
    return pick([...AC_TIMES, ...heads.map(h => h.time).filter(Boolean)], txt.slice(from), from);
  }
  if (t === 'character') {
    const p = txt.lastIndexOf('(');
    if (p >= 0) return pick(['V.O.)', 'O.S.)', 'CONT.)', 'OFF)'], txt.slice(p + 1), p + 1);
    return pick(edTexts('character', el).map(cleanChar), txt, 0);
  }
  if (t === 'transition') return pick([...AC_TRANS, ...edTexts('transition', el)], txt, 0);
  if (t === 'shot') return pick([...edTexts('shot', el), ...SIZES], txt, 0);
  if (t === 'act') return pick([...AC_ACTS, ...edTexts('act', el)], txt, 0);
  return null;
}
function acPop() { let p = $('#acpop'); if (!p) { p = document.createElement('div'); p.id = 'acpop'; p.className = 'acpop'; p.hidden = true; document.body.appendChild(p);
  p.addEventListener('mousedown', e => { e.preventDefault(); const b = e.target.closest('[data-ac]'); if (b) acAccept(+b.dataset.ac); }); } return p; }
function acClose() { AC.items = []; const p = $('#acpop'); if (p) p.hidden = true; }
function acUpdate() {
  const ed = $('#ed'); if (!ed || document.activeElement !== ed) return acClose();
  const c = caretInfo();
  if (!c || !c.collapsed || c.off !== c.el.textContent.length) return acClose();
  const txt = c.el.textContent.replace(/\u00a0/g, ' '), key = c.el.dataset.id + '|' + c.el.dataset.t + '|' + txt;
  if (AC.shut === key) return acClose();
  const r = acCompute(c.el, txt);
  if (!r || !r.items.length) return acClose();
  if (AC.key !== key) { AC.i = 0; AC.nav = false; }
  Object.assign(AC, { el: c.el, items: r.items, from: r.from, key });
  const p = acPop();
  p.innerHTML = `<div class="ac-h">Tab o Enter para completar · Esc para cerrar</div>` + AC.items.map((it, i) => `<button data-ac="${i}" class="${i === AC.i ? 'on' : ''}">${esc(it.label)}</button>`).join('');
  p.hidden = false;
  const sel = getSelection(); let rc = sel.rangeCount ? sel.getRangeAt(0).getClientRects()[0] : null;
  if (!rc || (!rc.left && !rc.top)) { const b = c.el.getBoundingClientRect(); rc = { left: b.left, bottom: b.bottom }; }
  const h = p.offsetHeight, w = p.offsetWidth;
  p.style.left = Math.max(8, Math.min(innerWidth - w - 8, rc.left)) + 'px';
  p.style.top = (rc.bottom + 6 + h > innerHeight ? Math.max(8, rc.bottom - h - 30) : rc.bottom + 6) + 'px';
}
function acAccept(i) {
  const it = AC.items[i], el = AC.el; if (!it || !el) return;
  let head = el.textContent.replace(/\u00a0/g, ' ').slice(0, AC.from);
  if (/[-–—]$/.test(head)) head += ' ';
  setText(el, head + it.ins); setCaret(el, el.textContent.length);
  AC.key = ''; scheduleSync(true); acUpdate();
}
function acKey(e) {
  if (!AC.items.length || $('#acpop')?.hidden) return false;
  const n = AC.items.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); AC.i = (AC.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; AC.nav = true; $$('#acpop [data-ac]').forEach((b, j) => b.classList.toggle('on', j === AC.i)); return true; }
  if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'Enter' && (AC.nav || AC.el.textContent.trim()))) { e.preventDefault(); acAccept(AC.i); return true; }
  if (e.key === 'Escape') { e.preventDefault(); AC.shut = AC.key; acClose(); return true; }
  return false;
}
function onEdPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain'); if (!text) return;
  let c = caretInfo(); if (c && !c.collapsed) { document.execCommand('delete'); c = caretInfo(); }
  if (!c) return;
  if (!/\n/.test(text.trim())) { document.execCommand('insertText', false, text.replace(/\s+/g, ' ')); return; }
  const blocks = parseScript(text); if (!blocks.length) return;
  const el = c.el, txt = el.textContent, before = txt.slice(0, c.off), after = txt.slice(c.off);
  if (!before.trim()) el.dataset.t = blocks[0].t;
  setText(el, before + blocks[0].x);
  let last = el;
  for (const b of blocks.slice(1)) { const d = mkBlock(b); last.after(d); last = d; }
  const endLen = last.textContent.length; setText(last, last.textContent + after); setCaret(last, endLen);
  scheduleSync(true); toast(`Pegado: ${blocks.length} elementos`);
}
function scheduleSync(fast) { if (CL.comments.length) requestAnimationFrame(placeMarks); clearTimeout(syncTimer); setSaved('Guardando…'); syncTimer = setTimeout(syncNow, fast ? 60 : 350); }
function syncNow() {
  clearTimeout(syncTimer); syncTimer = null;
  const ed = $('#ed'); if (!ed || !P) return;
  normalizeEditor(ed);
  const nb = $$(':scope > .el', ed).map(d => {
    const b = { id: d.dataset.id, t: d.dataset.t, x: d.textContent.replace(/\u00a0/g, ' ').replace(/\n/g, ' ') };
    if (b.x.trim() && d.querySelector('b,strong,i,em,u,span,font')) { const h = cleanInline(d); if (/<[biu]>/.test(h)) b.h = h; }
    return b;
  });
  const changed = JSON.stringify(nb) !== JSON.stringify(P.blocks);
  if (changed) { P.blocks = nb; save(); } else setSaved('Guardado en este navegador');
  refreshSide();
}
function normalizeEditor(ed) {
  [...ed.childNodes].forEach(n => {
    if (n.nodeType === 1 && n.classList.contains('el')) {
      // el navegador a veces anida bloques al borrar/pegar: aplanar
      $$('.el', n).forEach(inner => { n.after(inner); });
      return;
    }
    if (n.nodeType === 3 && !n.textContent.trim()) { n.remove(); return; }
    if (n.nodeName === 'BR') { n.remove(); return; }
    const d = mkBlock({ id: uid(), t: 'action', x: '' }); d.innerHTML = ''; ed.insertBefore(d, n); d.appendChild(n);
  });
  const seen = new Set();
  $$(':scope > .el', ed).forEach(d => {
    if (!d.dataset.id || seen.has(d.dataset.id)) d.dataset.id = uid();
    seen.add(d.dataset.id);
    if (!TYPE_KEYS.includes(d.dataset.t)) d.dataset.t = 'action';
  });
  if (!ed.children.length) ed.appendChild(mkBlock({ id: uid(), t: 'action', x: '' }));
}
function refreshSide() {
  const side = $('#gSide'); if (!side) return;
  const scenes = getScenes();
  const st = side.scrollTop; side.innerHTML = sceneList(scenes); side.scrollTop = st;
  const words = P.blocks.reduce((a, b) => a + (b.x.trim() ? b.x.trim().split(/\s+/).length : 0), 0);
  $('#pageInfo').textContent = `≈ ${totalPages()} pág. · ${scenes.length} escenas · ${words} palabras`;
}

/* ================= DESGLOSE ================= */
function renderDesglose() {
  const scenes = getScenes(); ensureSid(scenes);
  const s = scenes.find(x => x.id === UI.sid);
  let body;
  if (UI.bdAll) body = bdSummary(scenes);
  else if (!s) body = `<p class="muted">Escribe al menos una escena en la pestaña Guion.</p>`;
  else {
    const m = meta(s.id);
    const terms = [];
    BD_CATS.forEach(([k, , c]) => [...(m.bd[k] || []), ...(k === 'cast' ? s.chars : [])].forEach(t => t && t.length > 1 && terms.push({ term: t, color: c })));
    terms.sort((a, b) => b.term.length - a.term.length);
    body = `<div class="scene-head"><span class="num">${s.num}</span><h2>${esc(s.heading)}</h2>
        ${s.ie ? `<span class="pill">${s.ie}</span>` : ''}${s.time ? `<span class="pill ${s.night ? 'night' : 'day'}">${esc(s.time)}</span>` : ''}
        <span class="pill">${fmtE(s.eighths)} pág.</span></div>
      <p class="sub">Selecciona palabras en el texto de la escena para etiquetarlas, o escríbelas en cada categoría y pulsa Enter.</p>
      <div class="excerpt script mini" id="excerpt">${s.blocks.length ? s.blocks.filter(b => b.x.trim()).map(b => `<div class="el" data-t="${b.t}">${highlight(upT(b), terms)}</div>`).join('') : '<span style="color:#888">(Escena sin texto)</span>'}</div>
      <div class="bd-grid">${BD_CATS.map(([k, l, c]) => {
        const items = m.bd[k] || [];
        const auto = k === 'cast' ? s.chars.filter(n => !items.some(i => i.toUpperCase() === n)) : [];
        return `<div class="bd-cat" style="--c:${c}"><h4>${l}</h4><div class="chips">
          ${auto.map(n => `<span class="chip auto" title="Sale del guion">${esc(n)}</span>`).join('')}
          ${items.map((v, i) => `<span class="chip">${esc(v)}<button data-rm="${k}" data-i="${i}" title="Quitar">×</button></span>`).join('')}
          </div><input data-add="${k}" placeholder="Añadir ${l.toLowerCase()}…"></div>`;
      }).join('')}
        <div class="bd-cat" style="--c:#8e909b;grid-column:1/-1"><h4>Notas de producción</h4><textarea class="inp" data-notes rows="3" placeholder="Permisos, riesgos, horarios, ideas de dirección…">${esc(m.notes)}</textarea></div>
      </div>`;
  }
  app.innerHTML = `<div class="layout"><aside class="side">${sceneList(scenes, { right: x => { const n = Object.values(meta(x.id).bd).reduce((a, v) => a + v.length, 0) + x.chars.length; return n || ''; } })}</aside>
    <section class="main"><div class="main-narrow">
      <div class="row" style="margin-bottom:14px"><h1 class="vt">Desglose</h1><span class="spacer"></span>
        <button class="btn sm" data-tobudget title="Añade reparto, utilería, vestuario… como conceptos del presupuesto">Pasar al presupuesto →</button>
        <button class="btn ${UI.bdAll ? '' : 'pri'} sm" data-mode="0">Por escena</button><button class="btn ${UI.bdAll ? 'pri' : ''} sm" data-mode="1">Resumen de todo el guion</button></div>
      ${body}</div></section></div>`;
  bindSide(sid => { UI.sid = sid; UI.bdAll = false; renderDesglose(); });
  const main = $('.main');
  main.addEventListener('click', e => {
    const md = e.target.closest('[data-mode]'); if (md) { UI.bdAll = md.dataset.mode === '1'; renderDesglose(); return; }
    if (e.target.closest('[data-tobudget]')) { bdBudgetDialog(); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { meta(UI.sid).bd[rm.dataset.rm].splice(+rm.dataset.i, 1); save(); keepScroll(renderDesglose); }
  });
  main.addEventListener('keydown', e => {
    const inp = e.target.closest('[data-add]'); if (!inp || e.key !== 'Enter') return;
    e.preventDefault(); const v = inp.value.trim(); if (!v) return;
    addTag(UI.sid, inp.dataset.add, v);
    keepScroll(renderDesglose); $(`[data-add="${inp.dataset.add}"]`)?.focus();
  });
  main.addEventListener('input', e => { if (e.target.matches('[data-notes]')) { meta(UI.sid).notes = e.target.value; save(); } });
  $('#excerpt')?.addEventListener('mouseup', () => setTimeout(showTagpop, 0));
}
function addTag(sid, cat, v) {
  const m = meta(sid); const arr = m.bd[cat] ||= [];
  v.split(/\s*,\s*/).filter(Boolean).forEach(x => { if (!arr.some(a => a.toLowerCase() === x.toLowerCase())) arr.push(x); });
  save();
}
function keepScroll(fn) { const st = $('.main')?.scrollTop; fn(); if ($('.main')) $('.main').scrollTop = st; }
function highlight(text, terms) {
  if (!terms.length) return esc(text);
  const re = new RegExp('(' + terms.map(t => reEsc(t.term)).join('|') + ')', 'gi');
  let out = '', last = 0;
  text.replace(re, (m, _g, i) => {
    out += esc(text.slice(last, i));
    const t = terms.find(x => x.term.toLowerCase() === m.toLowerCase());
    out += `<mark style="--c:${t ? t.color : '#999'}">${esc(m)}</mark>`; last = i + m.length; return m;
  });
  return out + esc(text.slice(last));
}
function showTagpop() {
  if (isRO()) return hideTagpop();
  const sel = getSelection(); const txt = sel.toString().trim().replace(/\s+/g, ' ');
  const pop = $('#tagpop');
  if (!txt || txt.length > 60 || !sel.rangeCount) { hideTagpop(); return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  pop.innerHTML = `<b>Etiquetar «${esc(txt)}» como:</b>` + BD_CATS.map(([k, l, c]) => `<button style="--c:${c}" data-tag="${k}">${l}</button>`).join('');
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = (r.top - h - 8 < 60 ? r.bottom + 8 : r.top - h - 8) + 'px';
  pop.onmousedown = e => e.preventDefault();
  pop.onclick = e => {
    const b = e.target.closest('[data-tag]'); if (!b) return;
    addTag(UI.sid, b.dataset.tag, txt); hideTagpop(); getSelection().removeAllRanges(); keepScroll(renderDesglose);
    toast(`Añadido a ${BD_CATS.find(c => c[0] === b.dataset.tag)[1]}`);
  };
}
function hideTagpop() { const p = $('#tagpop'); if (p) p.hidden = true; }
document.addEventListener('mousedown', e => { if (!e.target.closest('#tagpop') && !e.target.closest('#excerpt')) hideTagpop(); });
function bdSummary(scenes) {
  const rows = BD_CATS.map(([k, l, c]) => {
    const map = new Map();
    scenes.forEach(s => {
      const items = [...(meta(s.id).bd[k] || []), ...(k === 'cast' ? s.chars : [])];
      items.forEach(it => { const key = it.toUpperCase(); if (!map.has(key)) map.set(key, { name: it, sc: new Set() }); map.get(key).sc.add(s.num); });
    });
    return { l, c, items: [...map.values()].sort((a, b) => b.sc.size - a.sc.size) };
  }).filter(r => r.items.length);
  if (!rows.length) return '<p class="muted">Aún no hay nada desglosado.</p>';
  return `<div class="card"><table class="sum"><thead><tr><th style="width:190px">Categoría</th><th>Elemento</th><th style="width:220px">Escenas</th></tr></thead><tbody>
    ${rows.map(r => r.items.map((it, i) => `<tr>${i === 0 ? `<td rowspan="${r.items.length}" style="color:${r.c};font-weight:700">${r.l} <span class="muted">(${r.items.length})</span></td>` : ''}<td>${esc(it.name)}</td><td class="muted">${[...it.sc].join(', ')}</td></tr>`).join('')).join('')}
    </tbody></table></div>`;
}

/* Del desglose al presupuesto: cada elemento es un concepto en su departamento */
const BD_BUDGET = { cast: ['Talento / reparto', 'day'], extras: ['Talento / reparto', 'day'], props: ['Arte y escenografía', 'unit'], wardrobe: ['Vestuario y maquillaje', 'unit'],
  makeup: ['Vestuario y maquillaje', 'day'], art: ['Arte y escenografía', 'unit'], sfx: ['Efectos especiales', 'unit'], vfx: ['Posproducción', 'unit'],
  vehicles: ['Transporte', 'day'], animals: ['Producción', 'day'], sound: ['Sonido', 'unit'], equip: ['Cámara', 'day'] };
function bdElements() {
  const map = new Map();
  getScenes().forEach(s => BD_CATS.forEach(([k]) => [...(meta(s.id).bd[k] || []), ...(k === 'cast' ? s.chars : [])].forEach(n => {
    const key = k + ':' + fold(n); if (!fold(n)) return;
    if (!map.has(key)) map.set(key, { cat: k, name: n, key, sids: new Set() });
    map.get(key).sids.add(s.id);
  })));
  return [...map.values()];
}
function bdBudgetDialog() {
  const els = bdElements(); if (!els.length) return toast('Aún no hay nada en el desglose');
  const have = new Set(P.budget.depts.flatMap(d => d.items).map(i => i.src).filter(Boolean));
  const d = $('#dialog');
  d.innerHTML = `<div class="dialog"><h3>Pasar el desglose al presupuesto</h3>
    <p class="muted" style="margin:0 0 8px">Cada elemento entra como concepto en su departamento, con valor 0 para que le pongas precio. Lo que ya estaba no se duplica: solo se actualizan las jornadas.</p>
    <div class="chk-list">${BD_CATS.map(([k, l, c]) => {
      const n = els.filter(e => e.cat === k); if (!n.length) return '';
      const nw = n.filter(e => !have.has('bd:' + e.key)).length;
      return `<label class="chk"><input type="checkbox" data-c="${k}" checked><b style="color:${c}">${l}</b><span class="muted">${n.length} ${nw ? `(${nw} nuevos)` : '(ya están)'} → ${BD_BUDGET[k][0]}</span></label>`;
    }).join('')}</div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">Reparto, extras, maquillaje, vehículos, animales y equipo se cuentan por jornada: los días salen del plan de rodaje (si la escena aún no tiene día, cuenta 1).</p>
    <div class="row"><button class="btn" data-x>Cancelar</button><button class="btn pri" data-ok>Añadir al presupuesto</button></div></div>`;
  d.hidden = false;
  d.onclick = e => {
    if (e.target === d || e.target.closest('[data-x]')) { d.hidden = true; return; }
    if (!e.target.closest('[data-ok]')) return;
    const cats = $$('[data-c]', d).filter(x => x.checked).map(x => x.dataset.c);
    d.hidden = true; if (!cats.length) return;
    const r = bdToBudget(cats);
    toast(`${r.added} conceptos nuevos${r.upd ? `, ${r.upd} actualizados` : ''} en el presupuesto`);
    go('presupuesto');
  };
}
function bdToBudget(cats) {
  const B = P.budget; let added = 0, upd = 0;
  const open = renderPresupuesto.open ||= new Set();
  for (const el of bdElements().filter(e => cats.includes(e.cat))) {
    const [dname, mode] = BD_BUDGET[el.cat];
    let d = B.depts.find(x => fold(x.name) === fold(dname));
    if (!d) { d = { id: uid(), name: dname, items: [] }; B.depts.push(d); }
    const days = P.days.filter(dy => dy.scenes.some(id => el.sids.has(id))).length;
    const qty = mode === 'day' ? Math.max(1, days) : 1, src = 'bd:' + el.key;
    const it = B.depts.flatMap(x => x.items).find(i => i.src === src);
    if (it) { if (mode === 'day' && num(it.qty) !== qty) { it.qty = qty; upd++; } continue; }
    d.items.push({ id: uid(), name: fold(BD_CATS.find(c => c[0] === el.cat)[1]) === fold(dname) ? el.name : `${BD_CATS.find(c => c[0] === el.cat)[1]}: ${el.name}`, qty, unit: mode === 'day' ? 'jornada' : 'unidad', cost: 0, actual: 0, src });
    added++; open.add(d.id);
  }
  save(); return { added, upd };
}

/* ================= PLANOS ================= */
const shotCode = (s, i) => s.num + (i < 26 ? String.fromCharCode(65 + i) : 'Z' + (i - 25));
function renderPlanos() {
  const scenes = getScenes(); ensureSid(scenes);
  const s = scenes.find(x => x.id === UI.sid);
  let body;
  if (UI.shotsAll) {
    const all = scenes.flatMap(sc => (meta(sc.id).shots).map((sh, i) => ({ sc, sh, i })));
    const dur = all.reduce((a, x) => a + num(x.sh.dur), 0);
    body = all.length ? `<div class="shots-wrap"><table class="shots"><thead><tr><th>Plano</th><th>Escena</th><th>Tamaño</th><th>Lente</th><th>Movimiento</th><th>Descripción</th><th>Dur.</th><th>Ref.</th></tr></thead><tbody>
      ${all.map(({ sc, sh, i }) => `<tr><td>${shotCode(sc, i)}</td><td class="muted" style="font-family:var(--mono);font-size:12px">${esc(sc.loc)}</td><td>${esc(sh.size)}</td><td>${esc(sh.lens)}</td><td>${esc(sh.move)}</td><td>${esc(sh.desc)}</td><td>${sh.dur ? esc(sh.dur) + ' s' : ''}</td><td>${sh.img ? `<div class="thumb"><img data-img="${sh.img}" alt=""></div>` : ''}</td></tr>`).join('')}
      </tbody></table></div><div class="tot"><span><b>${all.length}</b> planos</span><span><b>${fmtDur(dur)}</b> en pantalla</span></div>` : '<p class="muted">Aún no hay planos.</p>';
  } else if (!s) body = `<p class="muted">Escribe al menos una escena en la pestaña Guion.</p>`;
  else {
    const shots = meta(s.id).shots;
    const dur = shots.reduce((a, x) => a + num(x.dur), 0);
    const byId = Object.fromEntries(s.blocks.map(b => [b.id, b]));
    body = `<div class="scene-head"><span class="num">${s.num}</span><h2>${esc(s.heading)}</h2>${s.time ? `<span class="pill ${s.night ? 'night' : 'day'}">${esc(s.time)}</span>` : ''}</div>
      <p class="sub" style="margin:-6px 0 8px">${isRO() ? 'Las partes marcadas muestran qué cubre cada plano.' : 'Selecciona texto de la escena y elige a qué plano va (o crea uno nuevo con eso).'}</p>
      <div class="excerpt script mini shot-ex" id="shotEx">${shotExcerpt(s)}</div>
      <div class="shots-wrap"><table class="shots"><thead><tr><th>Plano</th><th>Tamaño</th><th>Lente</th><th>Movimiento</th><th>Descripción</th><th>Dur. (s)</th><th>Ref.</th><th></th></tr></thead><tbody>
      ${shots.map((sh, i) => `<tr data-i="${i}" style="--c:${shotColor(i)}"><td class="shcode">${shotCode(s, i)}</td>
        <td style="width:170px"><select class="inp" data-f="size"><option value=""></option>${SIZES.map(o => `<option ${sh.size === o ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
        <td style="width:90px"><input class="inp" data-f="lens" value="${esc(sh.lens)}" placeholder="35mm" list="lenses"></td>
        <td style="width:160px"><select class="inp" data-f="move"><option value=""></option>${MOVES.map(o => `<option ${sh.move === o ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
        <td style="min-width:220px"><input class="inp" data-f="desc" value="${esc(sh.desc)}" placeholder="Qué se ve, quién, acción…">
          ${shotParts(sh, byId).length ? `<div class="sh-parts">${shotParts(sh, byId).map((pt, k) => `<span class="sh-part" title="${esc(pt.q)}">«${esc(pt.q.length > 60 ? pt.q.slice(0, 60) + '…' : pt.q)}»<button data-rmpart="${k}" title="Quitar del plano">×</button></span>`).join('')}</div>` : ''}</td>
        <td style="width:80px"><input class="inp" type="number" min="0" data-f="dur" value="${esc(sh.dur)}"></td>
        <td><div class="thumbw">${sh.img ? `<div class="thumb" data-view="${sh.img}" title="Ver en grande"><img data-img="${sh.img}" alt=""></div><span class="thumb-acts"><button class="iconbtn" data-pick title="Cambiar imagen">✎</button><button class="iconbtn" data-rmimg title="Quitar imagen">×</button></span>` : '<div class="thumb" data-pick title="Añadir imagen de referencia">+</div>'}</div></td>
        <td><button class="iconbtn" data-mv="-1" title="Subir">↑</button><button class="iconbtn" data-mv="1" title="Bajar">↓</button><button class="iconbtn" data-dup title="Duplicar">⧉</button><button class="iconbtn" data-x title="Borrar">×</button></td></tr>`).join('')}
      </tbody></table></div>
      <datalist id="lenses">${['14mm', '16mm', '24mm', '35mm', '50mm', '85mm', '100mm macro', '135mm', '24-70mm', '70-200mm'].map(l => `<option value="${l}">`).join('')}</datalist>
      <div class="row" style="margin-top:6px"><button class="btn pri" data-addshot>+ Plano</button><span class="spacer"></span>
      <div class="tot"><span><b>${shots.length}</b> planos</span><span><b>${fmtDur(dur)}</b> en pantalla</span></div></div>`;
  }
  app.innerHTML = `<div class="layout"><aside class="side">${sceneList(scenes, { right: x => meta(x.id).shots.length || '' })}</aside>
    <section class="main"><div class="main-narrow" style="max-width:1250px">
      <div class="row" style="margin-bottom:14px"><h1 class="vt">Lista de planos</h1><span class="spacer"></span>
        <button class="btn ${UI.shotsAll ? '' : 'pri'} sm" data-mode="0">Por escena</button><button class="btn ${UI.shotsAll ? 'pri' : ''} sm" data-mode="1">Todo el guion</button></div>
      ${body}</div></section></div>`;
  hydrate();
  bindSide(sid => { UI.sid = sid; UI.shotsAll = false; renderPlanos(); });
  const main = $('.main');
  const shotsOf = () => meta(UI.sid).shots;
  main.addEventListener('click', async e => {
    const md = e.target.closest('[data-mode]'); if (md) { UI.shotsAll = md.dataset.mode === '1'; renderPlanos(); return; }
    if (e.target.closest('[data-addshot]')) {
      const sh = shotsOf(); const last = sh[sh.length - 1];
      sh.push({ id: uid(), size: '', lens: last?.lens || '', move: '', desc: '', dur: '', img: null });
      save(); keepScroll(renderPlanos); $$('.shots tbody tr').pop()?.querySelector('select')?.focus(); return;
    }
    const tr = e.target.closest('tr[data-i]'); if (!tr) return; const i = +tr.dataset.i; const sh = shotsOf();
    if (e.target.closest('[data-x]')) { if (sh[i].img) imgDel(sh[i].img).catch(() => {}); sh.splice(i, 1); }
    else if (e.target.closest('[data-dup]')) sh.splice(i + 1, 0, { ...sh[i], id: uid(), img: null, parts: [] });
    else if (e.target.closest('[data-mv]')) { const j = i + +e.target.closest('[data-mv]').dataset.mv; if (j < 0 || j >= sh.length) return; [sh[i], sh[j]] = [sh[j], sh[i]]; }
    else if (e.target.closest('[data-rmpart]')) { const sc = getScenes().find(x => x.id === UI.sid); const byId = Object.fromEntries(sc.blocks.map(b => [b.id, b])); const keep = shotParts(sh[i], byId); keep.splice(+e.target.closest('[data-rmpart]').dataset.rmpart, 1); sh[i].parts = keep; }
    else if (e.target.closest('[data-rmimg]')) { if (!confirm('¿Quitar la imagen de este plano?')) return; imgDel(sh[i].img).catch(() => {}); sh[i].img = null; }
    else if (e.target.closest('[data-pick]')) {
      const [f] = await pickFiles('image/*'); if (!f) return;
      try { if (sh[i].img) imgDel(sh[i].img).catch(() => {}); sh[i].img = await storeImage(f); } catch (err) { toast(err.message); return; }
    } else return;
    save(); keepScroll(renderPlanos);
  });
  $('#shotEx')?.addEventListener('mouseup', () => setTimeout(showShotPop, 0));
  const lightShot = (i, on) => { $$(`#shotEx .shm[data-sh~="${i}"]`).forEach(m => m.classList.toggle('hl', on)); $$('#shotEx .shl').forEach(l => {}); };
  main.addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-i]'); $$('#shotEx .shm.hl').forEach(m => m.classList.remove('hl')); if (tr) lightShot(tr.dataset.i, true); });
  $('#shotEx')?.addEventListener('click', e => {
    const m = e.target.closest('.shm'); if (!m || !getSelection().isCollapsed) return;
    const i = m.dataset.sh.trim().split(' ').pop(); const tr = $(`tr[data-i="${i}"]`); if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1400);
  });
  const upd = e => { const tr = e.target.closest('tr[data-i]'); const f = e.target.dataset.f; if (!tr || !f) return; shotsOf()[+tr.dataset.i][f] = e.target.value; save(); };
  main.addEventListener('input', upd); main.addEventListener('change', e => { upd(e); if (e.target.dataset.f === 'dur') keepScroll(renderPlanos); });
}
/* ---- Planos ↔ guion: partes del texto de la escena asignadas a cada plano ---- */
const SHOT_COLORS = ['#f2b544', '#4fc3f7', '#ef6f8e', '#7bd389', '#b39dff', '#ff9f5a', '#5ad1c6', '#e6d55a', '#ff7a7a', '#9fb6ff'];
const shotColor = i => SHOT_COLORS[i % SHOT_COLORS.length];
// devuelve las partes vigentes (si el texto cambió, se busca la frase; si ya no está, se descarta)
function shotParts(sh, byId) {
  return (sh.parts || []).map(pt => {
    const x = byId[pt.b]?.x; if (x == null) return null;
    if (x.slice(pt.s, pt.e) === pt.q) return pt;
    const k = x.indexOf(pt.q); return k >= 0 ? { ...pt, s: k, e: k + pt.q.length } : null;
  }).filter(Boolean);
}
function shotExcerpt(s) {
  const shots = meta(s.id).shots, byId = Object.fromEntries(s.blocks.map(b => [b.id, b]));
  const ranges = {}; // por bloque: [s, e, i]
  shots.forEach((sh, i) => shotParts(sh, byId).forEach(pt => (ranges[pt.b] ||= []).push([pt.s, pt.e, i])));
  const blocks = s.blocks.filter(b => b.x.trim());
  if (!blocks.length) return '<span style="color:#888">(Escena sin texto)</span>';
  return blocks.map(b => {
    const x = upT(b), rs = ranges[b.id] || [];
    const cuts = [...new Set([0, x.length, ...rs.flatMap(r => [r[0], r[1]])])].sort((a, c) => a - c);
    let h = '';
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], c = cuts[k + 1], on = rs.filter(r => r[0] <= a && r[1] >= c).map(r => r[2]);
      const starts = rs.filter(r => r[0] === a).map(r => r[2]);
      const lab = starts.map(i => `<sup class="shl" style="--c:${shotColor(i)}">${shotCode(s, i)}</sup>`).join('');
      const t = esc(x.slice(a, c));
      h += lab + (on.length ? `<mark class="shm" data-sh=" ${on.join(' ')} " style="--c:${shotColor(on[on.length - 1])}">${t}</mark>` : t);
    }
    return `<div class="el" data-t="${b.t}" data-bid="${b.id}">${h}</div>`;
  }).join('');
}
// posición dentro del texto del bloque, sin contar las etiquetas 1A, 1B…
function textOffset(el, node, off) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, sum = 0;
  if (node.nodeType !== 3) { const r = document.createRange(); r.setStart(node, off); r.collapse(true); while ((n = w.nextNode())) { if (n.parentElement.closest('.shl')) continue; if (r.comparePoint(n, 0) >= 0) return sum; sum += n.length; } return sum; }
  while ((n = w.nextNode())) { if (n === node) return sum + (n.parentElement.closest('.shl') ? 0 : off); if (!n.parentElement.closest('.shl')) sum += n.length; }
  return sum;
}
function selectionParts() {
  const sel = getSelection(), ex = $('#shotEx'); if (!ex || !sel.rangeCount || sel.isCollapsed) return [];
  const r = sel.getRangeAt(0), out = [];
  $$('.el', ex).forEach(el => {
    if (!r.intersectsNode(el)) return;
    const b = P.blocks.find(x => x.id === el.dataset.bid); if (!b) return;
    let s = el.contains(r.startContainer) ? textOffset(el, r.startContainer, r.startOffset) : 0;
    let e = el.contains(r.endContainer) ? textOffset(el, r.endContainer, r.endOffset) : b.x.length;
    while (s < e && /\s/.test(b.x[s])) s++; while (e > s && /\s/.test(b.x[e - 1])) e--;
    if (e > s) out.push({ b: b.id, s, e, q: b.x.slice(s, e) });
  });
  return out;
}
function showShotPop() {
  const pop = $('#tagpop'); if (isRO()) return hideTagpop();
  const parts = selectionParts(); if (!parts.length) return hideTagpop();
  const sc = getScenes().find(x => x.id === UI.sid); if (!sc) return;
  const shots = meta(sc.id).shots, r = getSelection().getRangeAt(0).getBoundingClientRect();
  const q = parts.map(p => p.q).join(' … ');
  pop.innerHTML = `<b>Asignar «${esc(q.length > 50 ? q.slice(0, 50) + '…' : q)}» a:</b>` + shots.map((sh, i) => `<button style="--c:${shotColor(i)}" data-tosh="${i}">${shotCode(sc, i)}${sh.size ? ' · ' + esc(sh.size) : ''}</button>`).join('') + `<button style="--c:#8e909b" data-tosh="new">+ Nuevo plano</button>`;
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = (r.top - h - 8 < 60 ? r.bottom + 8 : r.top - h - 8) + 'px';
  pop.onmousedown = e => e.preventDefault();
  pop.onclick = e => {
    const t = e.target.closest('[data-tosh]'); if (!t) return;
    let i = t.dataset.tosh;
    if (i === 'new') { const last = shots[shots.length - 1]; shots.push({ id: uid(), size: '', lens: last?.lens || '', move: '', desc: q.length <= 140 ? q : q.slice(0, 137) + '…', dur: '', img: null, parts: [] }); i = shots.length - 1; }
    const sh = shots[+i]; sh.parts ||= [];
    parts.forEach(p => { if (!sh.parts.some(o => o.b === p.b && o.s === p.s && o.e === p.e)) sh.parts.push(p); });
    if (!sh.desc) sh.desc = q.length <= 140 ? q : q.slice(0, 137) + '…';
    hideTagpop(); getSelection().removeAllRanges(); save(); keepScroll(renderPlanos);
    toast(`Asignado a ${shotCode(sc, +i)}`);
  };
}
const fmtDur = s => { s = Math.round(s); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };

/* ================= PLAN DE RODAJE ================= */
function stripClass(s) { return (s.ie === 'EXT' ? 'ext' : 'int') + '-' + (s.night ? 'night' : 'day'); }
const openShots = new Set();
function stripShots(s) {
  return `<div class="strip-shots">${meta(s.id).shots.map((sh, i) => `<div class="ss-row"><b>${shotCode(s, i)}</b><span>${esc(sh.size) || '—'}</span><span class="muted">${esc([sh.lens, sh.move].filter(Boolean).join(' · '))}</span><span class="ss-desc">${esc(sh.desc)}</span><span class="muted">${sh.dur ? esc(sh.dur) + ' s' : ''}</span>${sh.img ? `<span class="ss-th"><img data-img="${sh.img}" alt=""></span>` : '<span></span>'}</div>`).join('')}
    <button class="btn ghost sm" data-goshot="${s.id}">Editar planos de la escena ${s.num} →</button></div>`;
}
function renderRodaje() {
  const scenes = getScenes(); const byId = Object.fromEntries(scenes.map(s => [s.id, s]));
  P.days.forEach(d => d.scenes = d.scenes.filter(id => byId[id]));
  const assigned = new Set(P.days.flatMap(d => d.scenes));
  const pool = scenes.filter(s => !assigned.has(s.id));
  const dayOpts = sid => `<select class="inp" data-move="${sid}" title="Mover a…"><option value="">Sin asignar</option>${P.days.map((d, i) => `<option value="${d.id}" ${d.scenes.includes(sid) ? 'selected' : ''}>Día ${i + 1}</option>`).join('')}</select>`;
  const strip = s => `<div class="strip ${stripClass(s)}" draggable="${!isRO()}" data-sid="${s.id}">
    <span class="grip">⋮⋮</span><span class="n">${s.num}</span><span>${s.ie || '—'}</span><span class="loc" title="${esc(s.heading)}">${esc(s.loc)}</span>
    <span class="time-c">${esc(s.time) || '—'}</span><span>${fmtE(s.eighths)}</span><span class="chars">${esc(s.chars.join(', '))}</span>
    ${meta(s.id).shots.length ? `<button class="shots-b ${openShots.has(s.id) ? 'on' : ''}" data-shots="${s.id}" title="Ver los planos de la escena">${meta(s.id).shots.length} planos ${openShots.has(s.id) ? '▴' : '▾'}</button>` : `<button class="shots-b none" data-goshot="${s.id}" title="Añadir planos en la pestaña Planos">+ planos</button>`}
    ${dayOpts(s.id)}</div>${openShots.has(s.id) ? stripShots(s) : ''}`;
  const nShots = ids => ids.reduce((a, id) => a + meta(id).shots.length, 0);
  const pages = ids => ids.reduce((a, id) => a + (byId[id]?.eighths || 0), 0);
  const anyOpen = scenes.some(s => openShots.has(s.id));
  app.innerHTML = `<section class="main"><div class="main-narrow">
    <div class="row" style="margin-bottom:6px"><h1 class="vt">Plan de rodaje</h1><span class="spacer"></span>
      <button class="btn sm" data-allshots>${anyOpen ? 'Plegar planos' : 'Desplegar planos'}</button>
      <button class="btn sm" data-sortloc>Ordenar sin asignar por locación</button><button class="btn pri" data-addday>+ Día de rodaje</button></div>
    <p class="sub">Arrastra cada tira al día en que se graba (o usa el selector de la derecha). ${scenes.length} escenas · ${fmtE(pages(scenes.map(s => s.id)))} páginas en total.</p>
    <div class="legend" style="margin-bottom:14px"><span style="--sc:#e9e6dc">INT · día</span><span style="--sc:#f5cf3d">EXT · día</span><span style="--sc:#4f7cff">INT · noche</span><span style="--sc:#3fbf7f">EXT · noche</span></div>
    <div class="days">
      ${P.days.map((d, i) => `<div class="day" data-day="${d.id}">
        <div class="day-h"><b>Día ${i + 1}</b><input class="inp" type="date" data-date="${d.id}" value="${esc(d.date || '')}">
          <input class="inp" data-dnote="${d.id}" value="${esc(d.note || '')}" placeholder="Locación, llamado, notas…" style="flex:1;min-width:160px">
          <span class="muted">${d.scenes.length} esc. · ${fmtE(pages(d.scenes))} pág. · ${nShots(d.scenes)} planos</span>
          <button class="iconbtn" data-dmv="${i}" data-dir="-1" title="Subir día">↑</button><button class="iconbtn" data-dmv="${i}" data-dir="1" title="Bajar día">↓</button>
          <button class="iconbtn" data-delday="${d.id}" title="Borrar día">×</button></div>
        <div class="zone" data-zone="${d.id}">${d.scenes.map(id => strip(byId[id])).join('') || '<div class="empty">Arrastra escenas aquí</div>'}</div>
        <div class="day-end">Fin del día ${i + 1} — ${fmtE(pages(d.scenes))} páginas</div></div>`).join('')}
      <div class="day"><div class="day-h"><b>Sin asignar</b><span class="muted">${pool.length} escenas</span></div>
        <div class="zone" data-zone="">${pool.map(strip).join('') || '<div class="empty">Todas las escenas tienen día. 🎬</div>'}</div></div>
    </div></div></section>`;
  hydrate();
  const main = $('.main');
  const moveTo = (sid, dayId, index) => {
    P.days.forEach(d => d.scenes = d.scenes.filter(x => x !== sid));
    if (dayId) { const d = P.days.find(x => x.id === dayId); const at = index == null ? d.scenes.length : index; d.scenes.splice(at, 0, sid); }
    save(); keepScroll(renderRodaje);
  };
  main.addEventListener('click', e => {
    const sb = e.target.closest('[data-shots]');
    if (sb) { const id = sb.dataset.shots; openShots.has(id) ? openShots.delete(id) : openShots.add(id); keepScroll(renderRodaje); return; }
    const gs = e.target.closest('[data-goshot]');
    if (gs) { UI.sid = gs.dataset.goshot; UI.shotsAll = false; go('planos'); return; }
    if (e.target.closest('[data-allshots]')) { if (anyOpen) openShots.clear(); else scenes.forEach(s => meta(s.id).shots.length && openShots.add(s.id)); keepScroll(renderRodaje); return; }
    if (e.target.closest('[data-addday]')) { P.days.push({ id: uid(), date: '', note: '', scenes: [] }); save(); keepScroll(renderRodaje); return; }
    if (e.target.closest('[data-sortloc]')) {
      const firstPool = pool.slice().sort((a, b) => a.loc.localeCompare(b.loc) || (a.ie > b.ie ? 1 : -1) || a.night - b.night);
      // agrupa: crea un día por locación con las escenas sin asignar
      if (!firstPool.length) return toast('No hay escenas sin asignar');
      if (!confirm('¿Crear un día de rodaje por cada locación con las escenas sin asignar?')) return;
      const groups = {}; firstPool.forEach(s => (groups[s.loc] ||= []).push(s.id));
      Object.entries(groups).forEach(([loc, ids]) => P.days.push({ id: uid(), date: '', note: loc, scenes: ids }));
      save(); keepScroll(renderRodaje); return;
    }
    const dd = e.target.closest('[data-delday]');
    if (dd) { const d = P.days.find(x => x.id === dd.dataset.delday); if (d.scenes.length && !confirm('¿Borrar este día? Sus escenas vuelven a "Sin asignar".')) return; P.days = P.days.filter(x => x !== d); save(); keepScroll(renderRodaje); return; }
    const dm = e.target.closest('[data-dmv]');
    if (dm) { const i = +dm.dataset.dmv, j = i + +dm.dataset.dir; if (j < 0 || j >= P.days.length) return; [P.days[i], P.days[j]] = [P.days[j], P.days[i]]; save(); keepScroll(renderRodaje); }
  });
  main.addEventListener('change', e => {
    if (e.target.dataset.move !== undefined) moveTo(e.target.dataset.move, e.target.value || null);
    if (e.target.dataset.date) { P.days.find(d => d.id === e.target.dataset.date).date = e.target.value; save(); }
  });
  main.addEventListener('input', e => { if (e.target.dataset.dnote) { P.days.find(d => d.id === e.target.dataset.dnote).note = e.target.value; save(); } });
  // Arrastrar y soltar
  let dragSid = null; const line = document.createElement('div'); line.className = 'drop-line';
  main.addEventListener('dragstart', e => { const s = e.target.closest('.strip'); if (!s) return; dragSid = s.dataset.sid; s.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragSid); });
  main.addEventListener('dragend', () => { $$('.dragging').forEach(x => x.classList.remove('dragging')); line.remove(); $$('.zone.over').forEach(z => z.classList.remove('over')); dragSid = null; });
  main.addEventListener('dragover', e => {
    const z = e.target.closest('.zone'); if (!z || !dragSid) return; e.preventDefault();
    $$('.zone.over').forEach(x => x !== z && x.classList.remove('over')); z.classList.add('over');
    const after = $$('.strip:not(.dragging)', z).find(s => { const r = s.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (z.dataset.zone) { if (after) z.insertBefore(line, after); else z.appendChild(line); }
  });
  main.addEventListener('drop', e => {
    const z = e.target.closest('.zone'); if (!z || !dragSid) return; e.preventDefault();
    let idx = null;
    if (z.dataset.zone) { idx = 0; for (const n of z.children) { if (n === line) break; if (n.classList.contains('strip') && n.dataset.sid !== dragSid) idx++; } }
    moveTo(dragSid, z.dataset.zone || null, idx);
  });
}

/* ================= PRESUPUESTO ================= */
function money(v) {
  const c = P.budget.currency;
  return new Intl.NumberFormat(CURRENCIES[c] || 'es-CO', { style: 'currency', currency: c, maximumFractionDigits: c === 'COP' ? 0 : 2 }).format(v || 0);
}
function budgetTotals() {
  const B = P.budget; let plan = 0, act = 0;
  const depts = B.depts.map(d => { const p = d.items.reduce((a, it) => a + num(it.qty) * num(it.cost), 0); const r = d.items.reduce((a, it) => a + num(it.actual), 0); plan += p; act += r; return { id: d.id, p, r }; });
  const cont = plan * num(B.contingency) / 100;
  return { depts, plan, cont, total: plan + cont, act };
}
function renderPresupuesto() {
  const B = P.budget; const T = budgetTotals(); const open = renderPresupuesto.open ||= new Set();
  app.innerHTML = `<section class="main"><div class="main-narrow">
    <div class="row" style="margin-bottom:6px"><h1 class="vt">Presupuesto</h1><span class="spacer"></span>
      <label class="muted">Moneda <select class="inp" data-cur style="width:auto;display:inline-block">${Object.keys(CURRENCIES).map(c => `<option ${B.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="muted">Imprevistos % <input class="inp" type="number" min="0" max="100" data-cont value="${esc(B.contingency)}" style="width:70px;display:inline-block"></label></div>
    <p class="sub">Valor previsto = cantidad × valor unitario. En "Real" apunta lo que de verdad se pagó.</p>
    <div class="row" style="margin-bottom:12px"><button class="btn sm" data-frombd>← Traer del desglose</button>
      <button class="btn sm" data-fit title="Ajusta los valores unitarios para que el total quede en el presupuesto inicial">Cuadrar al presupuesto inicial</button>
      ${B.fitUndo ? '<button class="btn sm" data-unfit>Deshacer el ajuste</button>' : ''}<span class="spacer"></span>
      <span class="muted" data-k="perday">${perDay(T)}</span></div>
    <div class="kpis">
      <div class="kpi kpi-in"><span>Presupuesto inicial</span><input class="inp" type="number" min="0" step="any" data-target value="${esc(B.target || '')}" placeholder="¿Cuánto hay para el rodaje?"></div>
      <div class="kpi"><span>Previsto</span><b data-k="plan">${money(T.plan)}</b></div>
      <div class="kpi"><span>Con imprevistos</span><b data-k="total">${money(T.total)}</b></div>
      <div class="kpi"><span>Gastado real</span><b data-k="act">${money(T.act)}</b></div>
      <div class="kpi"><span>Disponible</span><b data-k="left" class="${T.total - T.act < 0 ? 'bad' : 'ok'}">${money(T.total - T.act)}</b></div>
      <div class="kpi"><span data-k="difl">${fitInfo(T).l}</span><b data-k="dif" class="${fitInfo(T).c}">${fitInfo(T).v}</b><small data-k="difs">${fitInfo(T).s}</small></div>
    </div>
    ${B.depts.map((d, di) => { const t = T.depts[di]; const pct = t.p ? Math.min(100, t.r / t.p * 100) : (t.r ? 100 : 0); return `
    <details class="dept" data-dept="${d.id}" ${open.has(d.id) ? 'open' : ''}>
      <summary><span class="car">▸</span><span><b>${esc(d.name)}</b> <span class="muted">${d.items.length ? '· ' + d.items.length + ' conceptos' : ''}</span> <span class="muted pct" data-dpct="${d.id}">${T.plan && t.p ? Math.round(t.p / T.plan * 100) + ' %' : ''}</span></span>
        <span class="money" data-dp="${d.id}">${money(t.p)}</span><span class="money act muted" data-dr="${d.id}">${money(t.r)} real</span>
        <span class="bar"><i data-db="${d.id}" class="${t.r > t.p ? 'over' : ''}" style="width:${pct}%"></i></span></summary>
      <div class="items"><table><thead><tr><th>Concepto</th><th class="num" style="width:80px">Cant.</th><th style="width:100px">Unidad</th><th class="num" style="width:140px">Valor unitario</th><th class="num" style="width:130px">Previsto</th><th class="num" style="width:140px">Real</th><th style="width:30px"></th></tr></thead><tbody>
        ${d.items.map((it, ii) => `<tr data-ii="${ii}">
          <td><input class="inp ${it.src ? 'bd' : ''}" data-f="name" value="${esc(it.name)}" placeholder="Ej.: alquiler de cámara" ${it.src ? 'title="Viene del desglose"' : ''}></td>
          <td><input class="inp" type="number" min="0" step="any" data-f="qty" value="${esc(it.qty)}"></td>
          <td><input class="inp" data-f="unit" value="${esc(it.unit)}" placeholder="días" list="units"></td>
          <td><input class="inp" type="number" min="0" step="any" data-f="cost" value="${esc(it.cost)}"></td>
          <td class="num" data-ip="${ii}">${money(num(it.qty) * num(it.cost))}</td>
          <td><input class="inp" type="number" min="0" step="any" data-f="actual" value="${esc(it.actual)}"></td>
          <td><button class="iconbtn" data-xi="${ii}" title="Borrar">×</button></td></tr>`).join('')}
      </tbody></table>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-additem>+ Concepto</button><span class="spacer"></span>
        <input class="inp" data-dname value="${esc(d.name)}" style="width:220px" title="Nombre del departamento"><button class="btn sm danger" data-deldept>Borrar departamento</button></div></div>
    </details>`; }).join('')}
    <div class="row" style="margin-top:10px"><button class="btn" data-adddept>+ Departamento</button></div>
    <datalist id="units">${['días', 'horas', 'semanas', 'unidad', 'persona', 'jornada', 'global', 'km'].map(u => `<option value="${u}">`).join('')}</datalist>
  </div></section>`;
  const main = $('.main');
  main.addEventListener('toggle', e => { const d = e.target.closest('details.dept'); if (!d) return; d.open ? open.add(d.dataset.dept) : open.delete(d.dataset.dept); }, true);
  const deptOf = el => B.depts.find(d => d.id === el.closest('[data-dept]')?.dataset.dept);
  main.addEventListener('click', e => {
    if (e.target.closest('[data-frombd]')) { bdBudgetDialog(); return; }
    if (e.target.closest('[data-fit]')) { fitBudget(); return; }
    if (e.target.closest('[data-unfit]')) { const m = new Map(B.fitUndo); B.depts.forEach(d => d.items.forEach(it => { if (m.has(it.id)) it.cost = m.get(it.id); })); delete B.fitUndo; save(); keepScroll(renderPresupuesto); toast('Ajuste deshecho'); return; }
    if (e.target.closest('[data-adddept]')) { const d = { id: uid(), name: 'Nuevo departamento', items: [] }; B.depts.push(d); open.add(d.id); save(); keepScroll(renderPresupuesto); return; }
    const d = deptOf(e.target); if (!d) return;
    if (e.target.closest('[data-additem]')) { d.items.push({ id: uid(), name: '', qty: 1, unit: '', cost: 0, actual: 0 }); save(); keepScroll(renderPresupuesto); $(`[data-dept="${d.id}"] tbody tr:last-child input`)?.focus(); }
    else if (e.target.closest('[data-xi]')) { d.items.splice(+e.target.closest('[data-xi]').dataset.xi, 1); save(); keepScroll(renderPresupuesto); }
    else if (e.target.closest('[data-deldept]')) { if (d.items.length && !confirm(`¿Borrar "${d.name}" y sus ${d.items.length} conceptos?`)) return; B.depts = B.depts.filter(x => x !== d); save(); keepScroll(renderPresupuesto); }
  });
  main.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-cont]')) B.contingency = num(t.value);
    else if (t.matches('[data-target]')) B.target = t.value;
    else if (t.matches('[data-dname]')) { const d = deptOf(t); d.name = t.value; t.closest('details').querySelector('summary b').textContent = t.value; }
    else if (t.dataset.f) { const d = deptOf(t); const it = d.items[+t.closest('tr').dataset.ii]; it[t.dataset.f] = t.type === 'number' ? t.value : t.value; }
    else return;
    save(); updateBudget();
  });
  main.addEventListener('change', e => { if (e.target.matches('[data-cur]')) { B.currency = e.target.value; save(); keepScroll(renderPresupuesto); } });
}
function updateBudget() {
  const T = budgetTotals();
  $('[data-k=plan]').textContent = money(T.plan); $('[data-k=total]').textContent = money(T.total); $('[data-k=act]').textContent = money(T.act);
  const l = $('[data-k=left]'); l.textContent = money(T.total - T.act); l.className = T.total - T.act < 0 ? 'bad' : 'ok';
  const f = fitInfo(T); $('[data-k=difl]').textContent = f.l; $('[data-k=dif]').textContent = f.v; $('[data-k=dif]').className = f.c; $('[data-k=difs]').textContent = f.s;
  $('[data-k=perday]').textContent = perDay(T);
  P.budget.depts.forEach((d, i) => { const c = $(`[data-dpct="${d.id}"]`); if (c) c.textContent = T.plan && T.depts[i].p ? Math.round(T.depts[i].p / T.plan * 100) + ' %' : ''; });
  P.budget.depts.forEach((d, i) => {
    const t = T.depts[i]; const pct = t.p ? Math.min(100, t.r / t.p * 100) : (t.r ? 100 : 0);
    $(`[data-dp="${d.id}"]`).textContent = money(t.p); $(`[data-dr="${d.id}"]`).textContent = money(t.r) + ' real';
    const b = $(`[data-db="${d.id}"]`); b.style.width = pct + '%'; b.classList.toggle('over', t.r > t.p);
    d.items.forEach((it, ii) => { const c = $(`[data-dept="${d.id}"] [data-ip="${ii}"]`); if (c) c.textContent = money(num(it.qty) * num(it.cost)); });
  });
}

function fitInfo(T) {
  const tg = num(P.budget.target);
  if (!tg) return { l: 'Frente al inicial', v: '—', c: '', s: 'Escribe el presupuesto inicial' };
  const d = tg - T.total, pct = Math.round(T.total / tg * 100);
  return d < 0 ? { l: 'Faltan', v: money(-d), c: 'bad', s: `El total es el ${pct} % del inicial` } : { l: 'Sobran', v: money(d), c: 'ok', s: `Usado el ${pct} % del inicial` };
}
const perDay = T => P.days.length ? `Por día de rodaje: ${money(T.total / P.days.length)} (${P.days.length} días)` : 'Crea los días en Plan de rodaje para ver el costo por día';
function fitBudget() {
  const B = P.budget, tg = num(B.target);
  if (!tg) { toast('Primero escribe el presupuesto inicial'); $('[data-target]')?.focus(); return; }
  const goal = tg / (1 + num(B.contingency) / 100);
  const items = B.depts.flatMap(d => d.items), paid = it => num(it.actual) > 0, val = it => num(it.qty) * num(it.cost);
  const fixed = items.filter(paid).reduce((a, it) => a + val(it), 0), flex = items.filter(it => !paid(it)).reduce((a, it) => a + val(it), 0);
  if (!flex) return toast('Pon primero precios a los conceptos: no hay valores que ajustar');
  const f = (goal - fixed) / flex;
  if (f <= 0) return toast('Lo ya pagado supera el presupuesto inicial');
  if (Math.abs(f - 1) < .001) return toast('Ya está cuadrado');
  if (!confirm(`Para que el total (con ${num(B.contingency)} % de imprevistos) quede en ${money(tg)}, los valores unitarios de los conceptos sin pagar ${f < 1 ? 'bajan' : 'suben'} un ${Math.abs(Math.round((f - 1) * 1000) / 10)} %.\n\nLo que ya tiene valor "Real" no se toca. Puedes deshacerlo después.`)) return;
  const rnd = v => B.currency === 'COP' ? Math.round(v / 100) * 100 : Math.round(v * 100) / 100;
  B.fitUndo = items.map(it => [it.id, it.cost]);
  items.filter(it => !paid(it)).forEach(it => it.cost = rnd(num(it.cost) * f));
  save(); keepScroll(renderPresupuesto); toast('Presupuesto cuadrado al inicial');
}

/* ================= MOODBOARD (tablero libre) =================
   Cada escena (y el proyecto, «General») tiene un tablero de 1600×900 donde se colocan libremente
   imágenes, títulos, textos, colores, notas y huecos para imágenes. Plantillas o tablero en blanco. */
const MB_W = 1600, MB_H = 900;
const MB_FONTS = {
  marker: { label: 'Marcador', css: "'Permanent Marker', cursive", w: 400 },
  hand: { label: 'Manuscrita', css: "'Caveat', cursive", w: 600 },
  sans: { label: 'Sans', css: "'Inter', sans-serif", w: 500 },
  sansb: { label: 'Sans negrita', css: "'Inter', sans-serif", w: 800 },
  serif: { label: 'Serif', css: "'Playfair Display', serif", w: 600 },
  type: { label: 'Máquina', css: "'Courier Prime', monospace", w: 400 }
};
const MB_BGS = { paper: { label: 'Papel', c: '#f1efea' }, white: { label: 'Blanco', c: '#ffffff' }, kraft: { label: 'Kraft', c: '#cdb48d' }, dark: { label: 'Negro', c: '#161616' } };
const MB_FRAMES = { none: 'Sin marco', white: 'Marco blanco', torn: 'Borde rasgado', tape: 'Con cinta' };
const MB_PALETTE = ['#efeee8', '#282828', '#ba3f1e', '#cd711c', '#5b6b2e', '#2f4b6e', '#d9b48f', '#8a2f3c'];
const MB = { sid: null, sel: null, scale: 1, hist: [], fut: [], histSid: null, editing: null };

function mbBoard(sid) {
  P.canvas ||= {};
  if (!P.canvas[sid]) {
    const cv = { bg: 'paper', items: [] };
    // tableros de la versión anterior (cuadrícula de imágenes): se colocan en el tablero
    const old = P.boards?.[sid] || [];
    old.forEach((it, i) => cv.items.push({ id: uid(), type: 'img', img: it.img, x: 40 + (i % 5) * 310, y: 40 + Math.floor(i / 5) * 270, w: 290, h: 230, rot: 0, frame: 'white' }));
    if (old.length) delete P.boards[sid];
    P.canvas[sid] = cv;
  }
  return P.canvas[sid];
}
const mbCv = () => mbBoard(MB.sid);
const mbFind = id => mbCv().items.find(i => i.id === id);

/* bordes rasgados: polígono irregular, siempre igual para el mismo elemento */
function tornPts(id, n = 10, amp = 2.4) {
  let seed = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([i / n * 100, rnd() * amp]);
  for (let i = 1; i <= n; i++) pts.push([100 - rnd() * amp, i / n * 100]);
  for (let i = n - 1; i >= 0; i--) pts.push([i / n * 100, 100 - rnd() * amp]);
  for (let i = n - 1; i >= 1; i--) pts.push([rnd() * amp, i / n * 100]);
  return pts;
}
const tornCss = id => `polygon(${tornPts(id).map(([x, y]) => x.toFixed(1) + '% ' + y.toFixed(1) + '%').join(',')})`;
function contrastOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#1b1b1b';
  const n = parseInt(m[1], 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (.299 * r + .587 * g + .114 * b) / 255 > .58 ? '#1b1b1b' : '#ffffff';
}
const txStyle = it => { const f = MB_FONTS[it.font] || MB_FONTS.sans; return `font-family:${f.css};font-weight:${f.w};font-size:${it.size || 20}px;color:${it.color || '#1b1b1b'};text-align:${it.align || 'left'}`; };

function mbItemHTML(it) {
  const st = `left:${it.x}px;top:${it.y}px;width:${it.w}px;${it.type === 'text' ? '' : `height:${it.h}px;`}transform:rotate(${it.rot || 0}deg)`;
  let inner = '';
  if (it.type === 'img') inner = `<div class="mb-frame f-${it.frame || 'none'}"${it.frame === 'torn' ? ` style="clip-path:${tornCss(it.id)}"` : ''}><img data-img="${it.img}" alt="" draggable="false"></div>${it.frame === 'tape' ? '<i class="mb-tape"></i>' : ''}`;
  else if (it.type === 'slot') inner = `<div class="mb-slot"><b>+</b><span>${esc(it.text || 'Imagen')}</span><small>arrastra o haz doble clic</small></div>`;
  else if (it.type === 'color') inner = `<div class="mb-sw" style="background:${it.color};clip-path:${tornCss(it.id)}"></div>${it.label !== false ? `<span class="mb-hex" style="color:${contrastOf(it.color)}">${esc(it.color)}</span>` : ''}`;
  else if (it.type === 'note') inner = `<div class="mb-note"><div class="mb-tx" style="${txStyle(it)}">${esc(it.text)}</div></div>`;
  else if (it.type === 'link') inner = mbLinkHTML(it);
  else inner = `<div class="mb-tx" style="${txStyle(it)}">${esc(it.text)}</div>`;
  return `<div class="mb-item mb-${it.type}${MB.sel === it.id ? ' sel' : ''}" data-id="${it.id}" style="${st}">${inner}</div>`;
}
function mbPlace(el, it) {
  el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.width = it.w + 'px';
  if (it.type !== 'text') el.style.height = it.h + 'px';
  el.style.transform = `rotate(${it.rot || 0}deg)`;
  mbSyncSel();
}
/* marco de selección con tiradores, siempre por encima de todo */
function mbSyncSel() {
  const box = $('#mbSel'); if (!box) return;
  const it = mbFind(MB.sel); const el = it && $(`#mbBoard [data-id="${it.id}"]`);
  if (!el) { box.hidden = true; return; }
  box.hidden = false;
  box.style.left = it.x + 'px'; box.style.top = it.y + 'px'; box.style.width = it.w + 'px';
  box.style.height = (it.type === 'text' ? el.offsetHeight : it.h) + 'px';
  box.style.transform = `rotate(${it.rot || 0}deg)`;
  box.classList.toggle('editing', MB.editing === it.id);
}

/* ---------- Plantillas ---------- */
const mbT = (text, x, y, w, o = {}) => ({ id: uid(), type: 'text', text, x, y, w, h: 40, rot: o.rot || 0, font: o.font || 'sans', size: o.size || 18, color: o.color || '#3a3a3a', align: o.align || 'left' });
const mbH = (text, x, y, w = 420, o = {}) => mbT(text, x, y, w, { font: 'marker', size: 38, color: '#1b1b1b', ...o });
// título de la plantilla: cabe en una línea (el marcador ocupa ~0,62 del tamaño por letra)
const mbTitle = (t, def, x = 340, w = 920) => mbH(t || def, x, 30, w, { size: Math.max(26, Math.min(50, Math.floor(w / (Math.max(8, (t || def).length) * .62)))), align: 'center' });
const mbS = (x, y, w, h, rot = 0, text = 'Imagen', frame = 'white') => ({ id: uid(), type: 'slot', x, y, w, h, rot, text, frame });
const mbC = (color, x, y, w, h, rot = 0) => ({ id: uid(), type: 'color', color, x, y, w, h, rot, label: true });
const mbN = (text, x, y, w = 240, h = 170, rot = 0) => ({ id: uid(), type: 'note', text, x, y, w, h, rot, font: 'hand', size: 28, color: '#2a2a2a' });
const MB_TPLS = {
  visual: { label: 'Moodboard visual (collage)', build: t => [
    mbTitle(t, 'MI MOODBOARD VISUAL'),
    mbH('FOTOS', 60, 110), mbT('retratos en b/n · luz natural · larga exposición', 60, 160, 440),
    mbS(50, 205, 230, 265, -2, 'Foto'), mbS(300, 215, 210, 245, 3, 'Foto'),
    mbH('COLORES', 600, 110), mbT('blanco, negro, cálidos, verde', 600, 160, 400),
    mbC('#efeee8', 590, 215, 170, 130, -3), mbC('#282828', 740, 205, 150, 150, 2), mbC('#ba3f1e', 870, 240, 150, 140, -2), mbC('#cd711c', 610, 335, 170, 120, 2), mbC('#5b6b2e', 790, 345, 170, 115, -1),
    mbH('ELEMENTOS', 1100, 110), mbT('recortes, garabatos, objetos', 1100, 160, 420),
    mbS(1100, 205, 220, 210, -3, 'Recorte', 'none'), mbS(1340, 225, 210, 225, 2, 'Garabato', 'none'),
    mbH('TIPOGRAFÍA', 60, 500), mbT('manuscrita · sans limpia · máquina', 60, 550, 440),
    mbT('se siente escrito a mano', 60, 598, 250, { font: 'hand', size: 34, rot: -2, color: '#1b1b1b' }),
    mbT('Menos es más.\nCuenta una sola cosa.', 60, 705, 270, { font: 'sansb', size: 30, color: '#111' }),
    mbT('INT. CASA - NOCHE', 330, 610, 210, { font: 'type', size: 20, color: '#1b1b1b' }),
    mbS(335, 665, 180, 190, 2, 'Muestra'),
    mbH('TEXTURA', 600, 500), mbT('grano, película, papel', 600, 550, 400),
    mbS(590, 600, 210, 255, -2, 'Textura', 'torn'), mbS(820, 620, 220, 235, 3, 'Textura', 'tape'),
    mbH('GRÁFICOS', 1100, 500), mbT('storytelling, mixed media', 1100, 550, 420),
    mbS(1095, 600, 200, 150, -2, 'Gráfico'), mbS(1320, 590, 230, 175, 2, 'Gráfico'), mbS(1180, 762, 250, 118, -1, 'Gráfico')
  ] },
  escena: { label: 'Escena (luz, color, encuadre…)', build: t => [
    mbTitle(t, 'ESCENA'),
    mbH('LUZ', 60, 110), mbT('dura o suave · de dónde viene · hora del día', 60, 160, 440),
    mbS(50, 205, 235, 255, -2, 'Luz'), mbS(305, 220, 205, 235, 2, 'Luz'),
    mbH('COLOR', 600, 110), mbT('paleta de la escena', 600, 160, 400),
    mbC('#1f2a36', 590, 215, 180, 140, -2), mbC('#c98b4a', 760, 205, 160, 150, 2), mbC('#6f7f6a', 610, 340, 170, 115, 1), mbC('#e9e1d3', 800, 345, 160, 115, -2),
    mbH('ENCUADRE', 1100, 110), mbT('planos clave · lentes · movimiento', 1100, 160, 440),
    mbS(1095, 205, 255, 170, -1, 'Plano 1'), mbS(1330, 265, 225, 165, 2, 'Plano 2'),
    mbH('LOCACIÓN', 60, 500), mbT('dónde se graba · cómo se ve', 60, 550, 440),
    mbS(50, 600, 255, 250, -2, 'Locación'), mbS(320, 620, 195, 225, 3, 'Locación'),
    mbH('VESTUARIO Y ARTE', 600, 500, 460), mbT('ropa · objetos · utilería', 600, 550, 420),
    mbS(590, 600, 200, 250, -2, 'Vestuario'), mbS(810, 615, 220, 230, 2, 'Objeto', 'tape'),
    mbH('REFERENCIAS', 1100, 500), mbT('películas, fotogramas, publicidad', 1100, 550, 440),
    mbS(1095, 600, 240, 150, -2, 'Película'), mbS(1350, 595, 200, 170, 2, 'Película'),
    mbN('¿Qué tiene que sentir quien la vea?', 1160, 765, 280, 115, -1)
  ] },
  personaje: { label: 'Personaje (casting, vestuario…)', build: t => [
    mbTitle(t, 'PERSONAJE'),
    mbH('ROSTRO / CASTING', 60, 110, 470), mbT('edad · rasgos · referencias de actores', 60, 160, 440),
    mbS(50, 205, 225, 270, -2, 'Rostro'), mbS(295, 215, 215, 255, 3, 'Rostro'),
    mbH('PALETA', 600, 110), mbT('colores que lo definen', 600, 160, 400),
    mbC('#2b2b2b', 590, 215, 175, 135, -2), mbC('#8a2f3c', 745, 205, 155, 150, 2), mbC('#d9b48f', 615, 340, 170, 115, 1), mbC('#2f4b6e', 800, 345, 160, 115, -2),
    mbH('VESTUARIO', 1100, 110), mbT('prendas · texturas · desgaste', 1100, 160, 440),
    mbS(1095, 205, 215, 265, -2, 'Vestuario'), mbS(1330, 220, 215, 250, 2, 'Vestuario'),
    mbH('ACTITUD', 60, 500), mbT('cómo se mueve, cómo habla', 60, 550, 440),
    mbN('Lo que quiere:\n\nLo que teme:', 60, 600, 250, 240, -2), mbS(330, 620, 185, 220, 2, 'Gesto'),
    mbH('ACCESORIOS', 600, 500), mbT('objetos que siempre lleva', 600, 550, 420),
    mbS(590, 600, 205, 240, -2, 'Objeto', 'torn'), mbS(815, 620, 215, 215, 3, 'Objeto', 'tape'),
    mbH('REFERENCIAS', 1100, 500), mbT('personajes parecidos en cine o series', 1100, 550, 440),
    mbS(1095, 600, 235, 160, -2, 'Referencia'), mbS(1345, 595, 205, 175, 2, 'Referencia'), mbS(1170, 770, 240, 110, -1, 'Referencia')
  ] },
  blanco: { label: 'En blanco', build: () => [] }
};

/* ---------- Enlaces (YouTube, Vimeo, Eye Candy, Pinterest, cualquier web) ---------- */
const ytId = u => (String(u).match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/) || [])[1];
const vimeoId = u => (String(u).match(/vimeo\.com\/(?:video\/|channels\/[\w-]+\/)?(\d{6,})/) || [])[1];
const IMG_URL_RE = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;
const linkHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const favicon = u => `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(linkHost(u))}`;
function normUrl(t) {
  t = String(t || '').trim().replace(/^<|>$/g, '');
  if (!/^https?:\/\//i.test(t) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) t = 'https://' + t;
  try { const u = new URL(t); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}
const urlsIn = text => String(text || '').split(/\s+/).map(normUrl).filter(Boolean);
function mbLinkHTML(it) {
  const host = linkHost(it.url), title = it.title || host;
  const video = ytId(it.url) || vimeoId(it.url);
  if (it.mode === 'compact') return `<div class="mb-link compact"><img class="mb-fav" src="${favicon(it.url)}" alt="" referrerpolicy="no-referrer" draggable="false" onerror="this.style.visibility='hidden'"><div class="mb-lt"><b>${esc(title)}</b><span>${esc(host)}</span></div><i class="mb-arrow">${video ? '▶' : '↗'}</i></div>`;
  return `<div class="mb-link card"><div class="mb-lthumb">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" referrerpolicy="no-referrer" draggable="false" onerror="this.remove()">` : `<span class="mb-lph">${it.loading ? 'Cargando vista previa…' : esc(host)}</span>`}${video ? '<i class="mb-play">▶</i>' : ''}</div>
    <div class="mb-lmeta"><img class="mb-fav" src="${favicon(it.url)}" alt="" referrerpolicy="no-referrer" draggable="false" onerror="this.style.visibility='hidden'"><div class="mb-lt"><b>${esc(title)}</b><span>${esc(it.site || host)}</span></div></div></div>`;
}
// Microlink (gratis, con límite diario) se usa de uno en uno
let mlQueue = Promise.resolve();
const microlink = url => (mlQueue = mlQueue.then(async () => {
  try { const r = await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url)); const j = await r.json(); return j.status === 'success' ? j.data || {} : null; }
  catch { return null; }
  finally { await new Promise(res => setTimeout(res, 400)); }
}));
const getJson = async u => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
async function linkMeta(url) {
  const out = {}; const yt = ytId(url), vm = vimeoId(url);
  if (IMG_URL_RE.test(url)) return { thumb: url, site: linkHost(url) };
  if (yt) { // YouTube: miniatura directa y título por su oEmbed
    out.thumb = `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`; out.site = 'YouTube';
    const j = await getJson('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + yt));
    if (j) { out.title = j.title || ''; out.site = j.author_name ? 'YouTube · ' + j.author_name : 'YouTube'; }
    return out;
  }
  if (vm) { // Vimeo: su oEmbed
    out.site = 'Vimeo';
    const j = await getJson('https://vimeo.com/api/oembed.json?width=640&url=' + encodeURIComponent(url));
    if (j) { out.title = j.title || ''; out.thumb = j.thumbnail_url || ''; if (j.author_name && j.author_name !== 'Vimeo') out.site = 'Vimeo · ' + j.author_name; }
    return out;
  }
  // cualquier otra web: título e imagen con Microlink; si falla, queda solo el enlace
  const d = await microlink(url);
  if (d) { out.title = d.title || ''; out.site = d.publisher || ''; out.thumb = d.image?.url || d.logo?.url || ''; }
  else out.failed = true;
  return out;
}
async function mbFetchLink(it) {
  const sid = MB.sid; it.loading = true; mbRedrawItem(it);
  const m = await linkMeta(it.url);
  const cur = P.canvas?.[sid]?.items.find(x => x.id === it.id) || it;
  Object.assign(cur, { title: m.title || cur.title || '', site: m.site || cur.site || '', thumb: m.thumb || cur.thumb || '' }); delete cur.loading;
  if (m.failed && !cur.title) toast('No se pudo traer la vista previa de ' + linkHost(cur.url) + '. Puedes reintentar con ↻ o escribir el título.');
  save(); if (MB.sid === sid && $(`#mbBoard [data-id="${cur.id}"]`)) mbRedrawItem(cur);
}
function mbAddLinks(urls, pt) {
  urls = [...new Set(urls)].slice(0, 12); if (!urls.length) return;
  const c = pt || mbCenterPoint(); const made = [];
  urls.forEach((url, i) => made.push({ id: uid(), type: 'link', url, title: '', site: '', thumb: '', mode: 'card', x: Math.round(c.x - 150 + i * 30), y: Math.round(c.y - 120 + i * 30), w: 300, h: 233, rot: 0 }));
  mbHist(); mbCv().items.push(...made); MB.sel = made[made.length - 1].id; save(); mbDraw();
  made.forEach(mbFetchLink);
}
function mbLinkDialog() {
  const d = $('#dialog');
  d.innerHTML = `<div class="dialog"><h3>Añadir enlaces</h3>
    <label>Pega uno o varios enlaces (uno por línea): YouTube, Vimeo, Eye Candy, Pinterest, Instagram, cualquier web…</label>
    <textarea class="inp" id="dLinks" rows="4" placeholder="https://www.youtube.com/watch?v=…"></textarea>
    <div class="row"><button class="btn" data-x>Cancelar</button><button class="btn pri" data-ok>Añadir</button></div></div>`;
  d.hidden = false; setTimeout(() => $('#dLinks').focus(), 30);
  d.onclick = e => {
    if (e.target === d || e.target.closest('[data-x]')) d.hidden = true;
    if (e.target.closest('[data-ok]')) { const u = urlsIn($('#dLinks').value); d.hidden = true; if (u.length) mbAddLinks(u); else toast('No encontré ningún enlace válido'); }
  };
}
function mbOpenLink(it) {
  const yt = ytId(it.url), vm = vimeoId(it.url);
  if (yt || vm) {
    const src = yt ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0` : `https://player.vimeo.com/video/${vm}?autoplay=1`;
    const lb = $('#lightbox');
    lb.innerHTML = `<div class="lb-video"><iframe src="${src}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe><a href="${esc(it.url)}" target="_blank" rel="noopener">Abrir en ${yt ? 'YouTube' : 'Vimeo'} ↗</a></div>`;
    lb.hidden = false; return;
  }
  window.open(it.url, '_blank', 'noopener');
}

/* ---------- Vista ---------- */
function renderMoodboard() {
  const scenes = getScenes(); ensureSid(scenes, true);
  const sid = UI.sid; const s = scenes.find(x => x.id === sid);
  if (MB.histSid !== sid) { MB.hist = []; MB.fut = []; MB.histSid = sid; MB.sel = null; }
  MB.sid = sid; MB.editing = null;
  const cv = mbBoard(sid);
  app.innerHTML = `<div class="layout"><aside class="side">${sceneList(scenes, { general: true, right: x => P.canvas?.[x.id]?.items.length || '' })}</aside>
  <section class="main mb-main">
    <div class="mb-bar">
      <div class="row">
        <b class="mb-title">${s ? s.num + ' · ' + esc(s.heading) : 'Moodboard general'}</b><span class="spacer"></span>
        <button class="btn sm" data-mb="img">+ Imagen</button><button class="btn sm" data-mb="title">+ Título</button>
        <button class="btn sm" data-mb="text">+ Texto</button><button class="btn sm" data-mb="color">+ Color</button>
        <button class="btn sm" data-mb="note">+ Nota</button><button class="btn sm" data-mb="slot">+ Hueco</button><button class="btn sm" data-mb="link">+ Enlace</button>
        <select class="inp mb-inl" data-mbsel="tpl" title="Empezar desde una plantilla"><option value="">Plantilla…</option>${Object.entries(MB_TPLS).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select>
        <select class="inp mb-inl" data-mbsel="bg" title="Fondo">${Object.entries(MB_BGS).map(([k, b]) => `<option value="${k}" ${cv.bg === k ? 'selected' : ''}>Fondo: ${b.label}</option>`).join('')}</select>
        <button class="btn sm" data-mb="undo" title="Deshacer (Ctrl+Z)">↶</button><button class="btn sm" data-mb="redo" title="Rehacer (Ctrl+Y)">↷</button>
        <button class="btn sm pri" data-mb="png">Descargar PNG</button>
      </div>
      <div class="row mb-ctx" id="mbCtx"></div>
    </div>
    <div class="mb-stage" id="mbStage"><div class="mb-wrap" id="mbWrap"><div class="mb-board bg-${cv.bg}" id="mbBoard"></div></div></div>
    <p class="muted mb-help">Arrastra imágenes desde tu PC o pégalas con Ctrl+V (también sobre un hueco) · doble clic en un texto para escribir · Supr borra · Ctrl+D duplica · Ctrl+Z deshace</p>
  </section></div>`;
  bindSide(id => { mbStopEdit(); UI.sid = id; renderMoodboard(); });
  mbDraw(); mbFit(); mbBind();
  if (!cv.items.length) mbCtx(true);
}
function mbDraw() {
  const board = $('#mbBoard'); if (!board) return;
  const cv = mbCv();
  board.className = `mb-board bg-${cv.bg}`;
  board.innerHTML = cv.items.map(mbItemHTML).join('') + (cv.items.length ? '' : `<div class="mb-empty"><b>Tablero en blanco</b><span>Elige una plantilla arriba o añade imágenes, títulos, colores, notas y enlaces.</span></div>`)
    + `<div id="mbSel" class="mb-sel" hidden><i class="mb-h mb-rs" data-h="rs" title="Tamaño (Mayús: libre)"></i><i class="mb-h mb-rt" data-h="rt" title="Girar"></i></div>`;
  hydrate(board); mbCtx(); mbSyncSel();
}
function mbFit() {
  const stage = $('#mbStage'), wrap = $('#mbWrap'), board = $('#mbBoard'); if (!stage) return;
  const top = stage.getBoundingClientRect().top;
  const s = Math.max(.2, Math.min((stage.clientWidth - 4) / MB_W, (innerHeight - top - 46) / MB_H));
  MB.scale = s;
  wrap.style.width = MB_W * s + 'px'; wrap.style.height = MB_H * s + 'px';
  board.style.transform = `scale(${s})`; board.style.setProperty('--inv', 1 / s);
}
window.addEventListener('resize', () => { if ($('#mbBoard')) mbFit(); });

function mbHist() { MB.hist.push(JSON.stringify(mbCv())); if (MB.hist.length > 60) MB.hist.shift(); MB.fut = []; }
function mbUndo(redo) {
  const from = redo ? MB.fut : MB.hist, to = redo ? MB.hist : MB.fut;
  if (!from.length) return toast(redo ? 'Nada que rehacer' : 'Nada que deshacer');
  to.push(JSON.stringify(mbCv())); P.canvas[MB.sid] = JSON.parse(from.pop());
  if (!mbFind(MB.sel)) MB.sel = null;
  save(); mbDraw();
}
function mbSelect(id) {
  if (MB.sel === id) return;
  MB.sel = id;
  $$('#mbBoard .mb-item').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
  mbCtx(); mbSyncSel();
}
function mbPoint(e) { const r = $('#mbBoard').getBoundingClientRect(); return { x: (e.clientX - r.left) / MB.scale, y: (e.clientY - r.top) / MB.scale }; }
function mbCenterPoint() {
  const st = $('#mbStage').getBoundingClientRect(), r = $('#mbBoard').getBoundingClientRect();
  const cx = (Math.min(st.right, r.right) + Math.max(st.left, r.left)) / 2, cy = (Math.min(st.bottom, r.bottom) + Math.max(st.top, r.top)) / 2;
  return { x: (cx - r.left) / MB.scale, y: (cy - r.top) / MB.scale };
}
function mbAdd(it, edit) {
  mbHist(); mbCv().items.push(it); MB.sel = it.id; save(); mbDraw();
  if (edit) { const el = $(`#mbBoard [data-id="${it.id}"]`); if (el) mbEdit(el, it); }
}
function mbNew(kind) {
  const c = mbCenterPoint(); const j = () => Math.round((Math.random() - .5) * 60);
  const at = (w, h) => ({ x: Math.round(c.x - w / 2) + j(), y: Math.round(c.y - h / 2) + j() });
  if (kind === 'title') mbAdd({ id: uid(), type: 'text', text: 'TÍTULO', ...at(420, 60), w: 420, h: 60, rot: 0, font: 'marker', size: 44, color: '#1b1b1b', align: 'left' }, true);
  else if (kind === 'text') mbAdd({ id: uid(), type: 'text', text: 'Escribe aquí', ...at(300, 30), w: 300, h: 30, rot: 0, font: 'sans', size: 20, color: '#2b2b2b', align: 'left' }, true);
  else if (kind === 'color') { const used = mbCv().items.filter(i => i.type === 'color').map(i => i.color); const col = MB_PALETTE.find(p => !used.includes(p)) || MB_PALETTE[Math.floor(Math.random() * MB_PALETTE.length)]; mbAdd({ id: uid(), type: 'color', color: col, ...at(160, 120), w: 160, h: 120, rot: Math.round((Math.random() - .5) * 6), label: true }); }
  else if (kind === 'note') mbAdd({ id: uid(), type: 'note', text: 'Nota…', ...at(230, 190), w: 230, h: 190, rot: -2, font: 'hand', size: 28, color: '#2a2a2a' }, true);
  else if (kind === 'slot') mbAdd({ id: uid(), type: 'slot', text: 'Imagen', ...at(260, 200), w: 260, h: 200, rot: 0, frame: 'white' });
}
const loadImgEl = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
async function mbAddImages(files, pt) {
  files = files.filter(f => f.type.startsWith('image/')); if (!files.length) return;
  toast(`Guardando ${files.length} imagen(es)…`);
  const c = pt || mbCenterPoint(); const added = [];
  for (const [i, f] of files.entries()) {
    try {
      const id = await storeImage(f); const im = await loadImgEl(await imgGet(id));
      const r = im.height / im.width; const w = Math.round(r > 1 ? 340 / r : 340), h = Math.round(w * r); // lado mayor: 340
      added.push({ id: uid(), type: 'img', img: id, x: Math.round(c.x - w / 2 + i * 28), y: Math.round(c.y - h / 2 + i * 28), w, h, rot: 0, frame: 'none' });
    } catch { }
  }
  if (!added.length) return;
  mbHist(); mbCv().items.push(...added); MB.sel = added[added.length - 1].id; save(); mbDraw();
}
async function mbFillSlot(it, file) {
  try {
    const id = await storeImage(file); mbHist();
    Object.assign(it, { type: 'img', img: id, frame: it.frame || 'white' }); delete it.text;
    MB.sel = it.id; save(); mbDraw();
  } catch (err) { toast(err.message); }
}
async function mbReplaceImg(it) { const [f] = await pickFiles('image/*'); if (f) mbFillSlot(it, f); }

function mbEdit(el, it) {
  const tx = el.querySelector('.mb-tx'); if (!tx) return;
  mbHist(); MB.editing = it.id; el.classList.add('editing');
  try { tx.contentEditable = 'plaintext-only'; } catch { tx.contentEditable = 'true'; }
  if (tx.contentEditable !== 'plaintext-only') tx.contentEditable = 'true';
  tx.focus();
  const r = document.createRange(); r.selectNodeContents(tx); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  tx.onblur = () => {
    tx.contentEditable = 'false'; el.classList.remove('editing'); MB.editing = null;
    const v = tx.innerText.replace(/\n$/, '');
    if (v !== it.text) { it.text = v; save(); } else MB.hist.pop();
    mbSyncSel();
  };
  tx.onkeydown = ev => { if (ev.key === 'Escape') { ev.preventDefault(); tx.blur(); } ev.stopPropagation(); };
  tx.oninput = () => mbSyncSel(); mbSyncSel();
}
function mbStopEdit() { if (MB.editing) document.activeElement?.blur?.(); }

/* ---------- Barra del elemento seleccionado ---------- */
function mbCtx(empty) {
  const box = $('#mbCtx'); if (!box) return;
  const it = mbFind(MB.sel);
  if (!it) { box.innerHTML = `<span class="muted">${empty ? 'Empieza con una <b>plantilla</b> (Moodboard visual, Escena, Personaje) o en blanco.' : 'Selecciona un elemento del tablero para editarlo.'}</span>`; return; }
  const font = () => `<select class="inp mb-inl" data-ctx="font">${Object.entries(MB_FONTS).map(([k, f]) => `<option value="${k}" ${it.font === k ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
    <input class="inp mb-num" type="number" min="8" max="200" data-ctx="size" value="${it.size || 20}" title="Tamaño de letra">
    <input type="color" data-ctx="color" value="${it.color || '#1b1b1b'}" title="Color del texto">
    <span class="mb-seg">${['left', 'center', 'right'].map(a => `<button class="btn sm ${it.align === a ? 'on' : ''}" data-ctxb="align" data-v="${a}">${{ left: '⯇', center: '≡', right: '⯈' }[a]}</button>`).join('')}</span>
    <button class="btn sm" data-ctxb="edit">Escribir</button>`;
  let specific = '';
  if (it.type === 'text') specific = font();
  else if (it.type === 'note') specific = font();
  else if (it.type === 'img') specific = `<select class="inp mb-inl" data-ctx="frame">${Object.entries(MB_FRAMES).map(([k, l]) => `<option value="${k}" ${(it.frame || 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <button class="btn sm" data-ctxb="replace">Cambiar imagen</button><button class="btn sm" data-ctxb="view">Ver grande</button>`;
  else if (it.type === 'slot') specific = `<button class="btn sm pri" data-ctxb="replace">Poner imagen</button>
    <select class="inp mb-inl" data-ctx="frame">${Object.entries(MB_FRAMES).map(([k, l]) => `<option value="${k}" ${(it.frame || 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input class="inp" data-ctx="text" value="${esc(it.text || '')}" placeholder="Etiqueta" style="width:130px">`;
  else if (it.type === 'color') specific = `<input type="color" data-ctx="color" value="${it.color}"><input class="inp" data-ctx="hex" value="${esc(it.color)}" style="width:96px">
    <label class="muted"><input type="checkbox" data-ctx="label" ${it.label !== false ? 'checked' : ''}> mostrar código</label>`;
  else if (it.type === 'link') specific = `<select class="inp mb-inl" data-ctx="mode"><option value="card" ${it.mode !== 'compact' ? 'selected' : ''}>Vista previa</option><option value="compact" ${it.mode === 'compact' ? 'selected' : ''}>Solo enlace</option></select>
    <button class="btn sm pri" data-ctxb="open">${ytId(it.url) || vimeoId(it.url) ? '▶ Reproducir' : 'Abrir ↗'}</button>
    <input class="inp" data-ctx="title" value="${esc(it.title || '')}" placeholder="Título" style="width:180px">
    <input class="inp" data-ctx="url" value="${esc(it.url)}" placeholder="https://…" style="width:220px">
    <button class="btn sm" data-ctxb="refresh" title="Volver a buscar la vista previa">↻</button>`;
  const names = { text: 'Texto', note: 'Nota', img: 'Imagen', slot: 'Hueco', color: 'Color', link: 'Enlace' };
  box.innerHTML = `<b class="mb-kind">${names[it.type]}</b>${specific}<span class="spacer"></span>
    <button class="btn sm" data-ctxb="dup" title="Ctrl+D">Duplicar</button><button class="btn sm" data-ctxb="front">Al frente</button><button class="btn sm" data-ctxb="back">Atrás</button>
    <button class="btn sm" data-ctxb="rot0" title="Quitar el giro">0°</button><button class="btn sm danger" data-ctxb="del" title="Supr">Borrar</button>`;
}
function mbRedrawItem(it) { const el = $(`#mbBoard [data-id="${it.id}"]`); if (!el) return mbDraw(); const t = document.createElement('template'); t.innerHTML = mbItemHTML(it); const n = t.content.firstChild; el.replaceWith(n); hydrate(n); mbSyncSel(); }

/* ---------- Eventos ---------- */
function mbBind() {
  const board = $('#mbBoard'), stage = $('#mbStage'), main = $('.mb-main');
  main.addEventListener('click', async e => {
    const b = e.target.closest('[data-mb]');
    if (b) {
      const k = b.dataset.mb;
      if (k === 'img') return mbAddImages(await pickFiles('image/*', true));
      if (k === 'undo') return mbUndo(false);
      if (k === 'redo') return mbUndo(true);
      if (k === 'png') return mbExportPng();
      if (k === 'link') return mbLinkDialog();
      return mbNew(k);
    }
    const c = e.target.closest('[data-ctxb]'); if (!c) return;
    const it = mbFind(MB.sel); if (!it) return; const items = mbCv().items; const k = c.dataset.ctxb;
    if (k === 'edit') { const el = $(`#mbBoard [data-id="${it.id}"]`); return mbEdit(el, it); }
    if (k === 'replace') return mbReplaceImg(it);
    if (k === 'open') return mbOpenLink(it);
    if (k === 'refresh') return mbFetchLink(it);
    if (k === 'view') { openImage(await imgGet(it.img)); return; }
    mbHist();
    if (k === 'align') it.align = c.dataset.v;
    else if (k === 'dup') { const n = { ...JSON.parse(JSON.stringify(it)), id: uid(), x: it.x + 24, y: it.y + 24 }; items.push(n); MB.sel = n.id; }
    else if (k === 'front') { items.splice(items.indexOf(it), 1); items.push(it); }
    else if (k === 'back') { items.splice(items.indexOf(it), 1); items.unshift(it); }
    else if (k === 'rot0') it.rot = 0;
    else if (k === 'del') { items.splice(items.indexOf(it), 1); MB.sel = null; }
    save(); mbDraw();
  });
  main.addEventListener('focusin', e => { if (e.target.closest('[data-ctx]')) mbHist(); });
  const ctxInput = e => {
    const t = e.target.closest('[data-ctx]'); if (!t) return; const it = mbFind(MB.sel); if (!it) return;
    const k = t.dataset.ctx;
    if (k === 'size') it.size = Math.max(8, Math.min(200, num(t.value) || 20));
    else if (k === 'label') it.label = t.checked;
    else if (k === 'mode') { it.mode = t.value; if (it.mode === 'compact') it.h = 58; else { it.w = Math.max(it.w, 240); it.h = Math.round(it.w * 9 / 16 + 64); } }
    else if (k === 'url') { const u = normUrl(t.value); if (!u) return; it.url = u; if (e.type === 'change') { it.title = ''; it.thumb = ''; save(); return mbFetchLink(it); } }
    else if (k === 'hex') { const v = t.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) it.color = v[0] === '#' ? v.toLowerCase() : '#' + v.toLowerCase(); else return; }
    else it[k] = t.value;
    save(); mbRedrawItem(it);
    if (k === 'color' && it.type === 'color') { const h = $('[data-ctx="hex"]'); if (h) h.value = it.color; }
  };
  main.addEventListener('input', ctxInput); main.addEventListener('change', e => {
    const s = e.target.closest('[data-mbsel]');
    if (s) {
      const cv = mbCv();
      if (s.dataset.mbsel === 'bg') { mbHist(); cv.bg = s.value; save(); mbDraw(); }
      if (s.dataset.mbsel === 'tpl' && s.value) {
        const tpl = MB_TPLS[s.value]; s.value = '';
        if (cv.items.length && !confirm(`¿Cambiar el tablero por la plantilla «${tpl.label}»? Lo que hay se quita (puedes deshacer con Ctrl+Z).`)) return;
        const sc = getScenes().find(x => x.id === MB.sid);
        mbHist(); cv.items = tpl.build(sc ? sc.heading : (P.title || '').toUpperCase()); MB.sel = null; save(); mbDraw();
      }
      return;
    }
    ctxInput(e);
  });

  // mover, cambiar tamaño, girar
  board.addEventListener('pointerdown', e => {
    const h = e.target.closest('.mb-h')?.dataset.h;
    const el = h ? $(`#mbBoard [data-id="${MB.sel}"]`) : e.target.closest('.mb-item');
    if (!el) { mbStopEdit(); mbSelect(null); return; }
    if (MB.editing === el.dataset.id && !h) return;
    mbStopEdit();
    const it = mbFind(el.dataset.id); if (!it) return;
    mbSelect(it.id);
    e.preventDefault();
    const cap = e.target.closest('.mb-h') || el; cap.setPointerCapture(e.pointerId);
    const s = MB.scale, sx = e.clientX, sy = e.clientY, o = { x: it.x, y: it.y, w: it.w, h: it.h || el.offsetHeight, rot: it.rot || 0 };
    const rc = el.getBoundingClientRect(), cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
    const ratio = o.h / o.w; let moved = false;
    const mv = ev => {
      const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      if (!moved) { mbHist(); moved = true; }
      if (!h) { it.x = Math.round(o.x + dx); it.y = Math.round(o.y + dy); }
      else if (h === 'rs') {
        const a = o.rot * Math.PI / 180, lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
        it.w = Math.max(30, Math.round(o.w + lx));
        if (it.type !== 'text') it.h = (it.type === 'img') !== ev.shiftKey ? Math.round(it.w * ratio) : Math.max(24, Math.round(o.h + ly));
      } else if (h === 'rt') {
        let ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
        if (ang > 180) ang -= 360;
        if (Math.abs(ang) < 3) ang = 0;
        it.rot = Math.round(ang * 10) / 10;
      }
      mbPlace(el, it);
    };
    const up = () => { cap.removeEventListener('pointermove', mv); cap.removeEventListener('pointerup', up); cap.removeEventListener('pointercancel', up); if (moved) save(); };
    cap.addEventListener('pointermove', mv); cap.addEventListener('pointerup', up); cap.addEventListener('pointercancel', up);
  });
  board.addEventListener('dblclick', e => {
    const el = e.target.closest('.mb-item'); if (!el) return; const it = mbFind(el.dataset.id); if (!it) return;
    if (it.type === 'text' || it.type === 'note') mbEdit(el, it);
    else if (it.type === 'img' || it.type === 'slot') mbReplaceImg(it);
    else if (it.type === 'link') mbOpenLink(it);
  });
  // soltar archivos: sobre un hueco lo rellena; si no, se colocan donde caen
  stage.addEventListener('dragover', e => { const ty = [...e.dataTransfer.types]; if (ty.includes('Files') || ty.includes('text/uri-list')) { e.preventDefault(); stage.classList.add('over'); } });
  stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget)) stage.classList.remove('over'); });
  stage.addEventListener('drop', e => {
    e.preventDefault(); stage.classList.remove('over');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (!files.length) { const u = urlsIn((e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n').filter(l => !l.startsWith('#')).join(' ')); if (u.length) mbAddLinks(u, mbPoint(e)); return; }
    const slotEl = document.elementsFromPoint(e.clientX, e.clientY).map(n => n.closest?.('.mb-slot')?.closest('.mb-item')).find(Boolean);
    const slot = slotEl && mbFind(slotEl.dataset.id);
    if (slot) { mbFillSlot(slot, files[0]); if (files.length > 1) mbAddImages(files.slice(1), mbPoint(e)); }
    else mbAddImages(files, mbPoint(e));
  });
}
document.addEventListener('keydown', e => {
  if (!P || UI.view !== 'moodboard' || !$('#mbBoard') || MB.editing) return;
  if (e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); return mbUndo(e.shiftKey); }
  if (mod && k === 'y') { e.preventDefault(); return mbUndo(true); }
  const it = mbFind(MB.sel); if (!it) return;
  const items = mbCv().items;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); mbHist(); items.splice(items.indexOf(it), 1); MB.sel = null; save(); mbDraw(); }
  else if (mod && k === 'd') { e.preventDefault(); mbHist(); const n = { ...JSON.parse(JSON.stringify(it)), id: uid(), x: it.x + 24, y: it.y + 24 }; items.push(n); MB.sel = n.id; save(); mbDraw(); }
  else if (e.key === 'Escape') mbSelect(null);
  else if (e.key === 'Enter' && (it.type === 'text' || it.type === 'note')) { e.preventDefault(); mbEdit($(`#mbBoard [data-id="${it.id}"]`), it); }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault(); const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') it.x -= d; if (e.key === 'ArrowRight') it.x += d; if (e.key === 'ArrowUp') it.y -= d; if (e.key === 'ArrowDown') it.y += d;
    mbPlace($(`#mbBoard [data-id="${it.id}"]`), it); save();
  }
});
document.addEventListener('paste', e => {
  if (!P || UI.view !== 'moodboard' || !$('#mbBoard') || MB.editing || e.target.closest?.('input,textarea')) return;
  const files = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if (files.length) {
    e.preventDefault();
    const sel = mbFind(MB.sel);
    if (sel && sel.type === 'slot') mbFillSlot(sel, files[0]); else mbAddImages(files);
    return;
  }
  const text = e.clipboardData?.getData('text/plain')?.trim();
  if (text && text.split(/\s+/).every(w => normUrl(w) && /[./]/.test(w))) { e.preventDefault(); return mbAddLinks(urlsIn(text)); }
  if (text) { e.preventDefault(); const c = mbCenterPoint(); mbAdd({ id: uid(), type: 'text', text: text.slice(0, 600), x: Math.round(c.x - 160), y: Math.round(c.y - 20), w: 320, h: 40, rot: 0, font: 'sans', size: 20, color: '#2b2b2b', align: 'left' }); }
});
$('#lightbox').addEventListener('click', e => {
  const lb = $('#lightbox');
  if (e.target.closest('a')) return;
  // clic en la imagen: zoom a tamaño real (y vuelta); clic fuera o ×: cerrar
  if (e.target.matches('.lb-img') && !e.target.closest('.lb-x')) {
    const im = e.target, r = im.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    lb.classList.toggle('zoom');
    if (lb.classList.contains('zoom')) { lb.scrollLeft = im.offsetWidth * fx - innerWidth / 2; lb.scrollTop = im.offsetHeight * fy - innerHeight / 2; }
    return;
  }
  lb.hidden = true; lb.innerHTML = ''; lb.classList.remove('zoom');
});
// ver en grande las imágenes de referencia (planos, plan de rodaje, lista completa)
function openImage(src) {
  if (!src) return;
  const lb = $('#lightbox'); lb.classList.remove('zoom');
  lb.innerHTML = `<img class="lb-img" src="${src}" alt="" title="Clic para ampliar"><button class="lb-x" title="Cerrar (Esc)">×</button>`; lb.hidden = false;
}
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-view], .thumb img[data-img], .ss-th img[data-img], .pr-thumb');
  if (!t || e.target.closest('#mbBoard, [data-pick]')) return;
  e.stopPropagation(); openImage(await imgGet(t.dataset.view || t.dataset.img));
}, true);

/* ---------- Descargar como imagen ---------- */
function tornPath(g, id, w, h) {
  g.beginPath(); tornPts(id).forEach(([px, py], i) => { const X = px / 100 * w, Y = py / 100 * h; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath();
}
function drawCover(g, im, x, y, w, h) {
  const r = Math.max(w / im.width, h / im.height), sw = w / r, sh = h / r;
  g.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h);
}
function drawTextBlock(g, it, x0, y0, w) {
  const f = MB_FONTS[it.font] || MB_FONTS.sans, size = it.size || 20, lh = size * 1.15;
  g.font = `${f.w} ${size}px ${f.css}`; g.fillStyle = it.color || '#1b1b1b'; g.textBaseline = 'top';
  const align = it.align || 'left'; g.textAlign = align;
  const ax = align === 'center' ? x0 + w / 2 : align === 'right' ? x0 + w : x0;
  let y = y0 + (lh - size) / 2;
  for (const para of String(it.text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (g.measureText(test.trimEnd()).width > w && line.trim()) { g.fillText(line.trimEnd(), ax, y); y += lh; line = word.trimStart(); }
      else line = test;
    }
    g.fillText(line.trimEnd(), ax, y); y += lh;
  }
}
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawLinkCard(g, it, h, im) {
  const host = linkHost(it.url), title = it.title || host, video = ytId(it.url) || vimeoId(it.url);
  g.save(); g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 12; g.shadowOffsetY = 4; rrect(g, 0, 0, it.w, h, 10); g.fillStyle = '#fff'; g.fill(); g.restore();
  const ellipsis = (txt, max) => { if (g.measureText(txt).width <= max) return txt; while (txt.length > 1 && g.measureText(txt + '…').width > max) txt = txt.slice(0, -1); return txt + '…'; };
  if (it.mode === 'compact') {
    g.fillStyle = '#1b1b1b'; g.font = '700 15px Inter, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillText(ellipsis(title, it.w - 60), 14, h / 2 - 17);
    g.fillStyle = '#777'; g.font = '500 12px Inter, sans-serif'; g.fillText(ellipsis(host, it.w - 60), 14, h / 2 + 3);
    g.fillStyle = '#999'; g.font = '600 16px Inter, sans-serif'; g.textAlign = 'right'; g.fillText(video ? '▶' : '↗', it.w - 12, h / 2 - 9);
    return;
  }
  const th = Math.max(20, h - 64);
  g.save(); rrect(g, 0, 0, it.w, h, 10); g.clip();
  g.fillStyle = '#e7e4dd'; g.fillRect(0, 0, it.w, th);
  if (im) drawCover(g, im, 0, 0, it.w, th);
  else { g.fillStyle = '#8d877b'; g.font = '600 14px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(host, it.w / 2, th / 2); }
  g.restore();
  if (video) { g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.arc(it.w / 2, th / 2, 24, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(it.w / 2 - 8, th / 2 - 12); g.lineTo(it.w / 2 + 13, th / 2); g.lineTo(it.w / 2 - 8, th / 2 + 12); g.closePath(); g.fill(); }
  g.fillStyle = '#1b1b1b'; g.font = '700 15px Inter, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText(ellipsis(title, it.w - 24), 12, th + 12);
  g.fillStyle = '#777'; g.font = '500 12px Inter, sans-serif'; g.fillText(ellipsis(it.site || host, it.w - 24), 12, th + 34);
}
async function mbExportPng() {
  mbStopEdit(); toast('Preparando la imagen…');
  const c = await mbRenderCanvas(mbCv(), $('#mbBoard'), 2);
  const sc = getScenes().find(x => x.id === MB.sid);
  c.toBlob(b => { download(`${slug(P.title)}-moodboard${sc ? '-escena-' + sc.num : ''}.png`, b, 'image/png'); toast('Imagen descargada'); }, 'image/png');
}
async function mbRenderCanvas(cv, board, S = 2) {
  await document.fonts.ready;
  const c = document.createElement('canvas'); c.width = MB_W * S; c.height = MB_H * S;
  const g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = MB_BGS[cv.bg]?.c || '#fff'; g.fillRect(0, 0, MB_W, MB_H);
  if (cv.bg === 'paper' || cv.bg === 'kraft') for (let i = 0; i < 14000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * .05})`; g.fillRect(Math.random() * MB_W, Math.random() * MB_H, 1.3, 1.3); }
  const ims = {};
  for (const it of cv.items) if (it.type === 'img' && it.img && !ims[it.img]) { try { ims[it.img] = await loadImgEl(await imgGet(it.img)); } catch { } }
  // miniaturas de enlaces: solo si la web lo permite (si no, la tarjeta sale sin imagen)
  const remote = src => new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.referrerPolicy = 'no-referrer'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; setTimeout(() => res(null), 8000); });
  for (const it of cv.items) if (it.type === 'link' && it.thumb && it.mode !== 'compact' && !ims['L' + it.id]) ims['L' + it.id] = await remote(it.thumb);
  for (const it of cv.items) {
    if (it.type === 'slot') continue; // los huecos vacíos no salen en la imagen
    const el = board?.querySelector(`[data-id="${it.id}"]`);
    const h = it.type === 'text' ? (el?.offsetHeight || it.h || 40) : it.h;
    g.save(); g.translate(it.x + it.w / 2, it.y + h / 2); g.rotate((it.rot || 0) * Math.PI / 180); g.translate(-it.w / 2, -h / 2);
    if (it.type === 'img' && ims[it.img]) {
      const im = ims[it.img], fr = it.frame || 'none';
      if (fr === 'white') {
        const pad = it.w * .04;
        g.save(); g.shadowColor = 'rgba(0,0,0,.2)'; g.shadowBlur = 16; g.shadowOffsetY = 5; g.fillStyle = '#fff'; g.fillRect(0, 0, it.w, h); g.restore();
        drawCover(g, im, pad, pad, it.w - pad * 2, h - pad * 2);
      } else if (fr === 'torn') { tornPath(g, it.id, it.w, h); g.clip(); drawCover(g, im, 0, 0, it.w, h); }
      else {
        g.save(); g.shadowColor = 'rgba(0,0,0,.14)'; g.shadowBlur = 10; g.shadowOffsetY = 3; g.fillStyle = '#ddd'; g.fillRect(0, 0, it.w, h); g.restore();
        drawCover(g, im, 0, 0, it.w, h);
        if (fr === 'tape') { g.save(); g.translate(it.w * .5, 1); g.rotate(-3 * Math.PI / 180); g.fillStyle = 'rgba(240,234,214,.8)'; g.fillRect(-it.w * .18, -13, it.w * .36, 26); g.restore(); }
      }
    } else if (it.type === 'color') {
      g.save(); g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 8; g.shadowOffsetY = 3; tornPath(g, it.id, it.w, h); g.fillStyle = it.color; g.fill(); g.restore();
      if (it.label !== false) { g.fillStyle = contrastOf(it.color); g.font = '600 13px Inter, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left'; g.fillText(it.color, 10, 9); }
    } else if (it.type === 'note') {
      g.save(); g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 10; g.shadowOffsetY = 4; g.fillStyle = '#fbe58a'; g.fillRect(0, 0, it.w, h); g.restore();
      g.save(); g.beginPath(); g.rect(0, 0, it.w, h); g.clip(); drawTextBlock(g, it, 14, 14, it.w - 28); g.restore();
    } else if (it.type === 'text') drawTextBlock(g, it, 0, 0, it.w);
    else if (it.type === 'link') drawLinkCard(g, it, h, ims['L' + it.id]);
    g.restore();
  }
  return c;
}

/* ================= NUBE (Supabase): cuentas, guiones compartidos, turno de edición y comentarios =================
   Un guion en la nube lo edita una sola persona a la vez (turno). Los demás lo ven en modo lectura, en vivo, y comentan. */
const SB_URL = 'https://egjzkvlcqqwqxcugsfed.supabase.co', SB_KEY = 'sb_publishable_4LS7xS-Tzm39nRtrFptIFQ_L3FahX4Q';
LIBS.sb = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
const CL = { sb: null, user: null, token: null, ready: null, pid: null, row: null, role: null, editing: false, chan: null, beat: null, pushT: null, comments: [], showRes: false, draft: null, reply: null, lastAct: 0, open: false };
const isRO = () => !!(P && P.cloud && !CL.editing);
const myName = () => CL.user?.user_metadata?.name || CL.user?.email?.split('@')[0] || 'Alguien';
const LOCK_TTL = 90e3, IDLE_MAX = 10 * 60e3;
const lockFresh = r => !!(r?.lock_user && Date.now() - new Date(r.lock_at).getTime() < LOCK_TTL);
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => CL.lastAct = Date.now(), true));

function cloudInit() {
  return CL.ready ||= (async () => {
    try { await loadScript(LIBS.sb); } catch { return null; }
    CL.sb = supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, storageKey: 'glanx.auth' } });
    const { data } = await CL.sb.auth.getSession();
    CL.user = data.session?.user || null; CL.token = data.session?.access_token || null;
    if (CL.user) setTimeout(() => { upsertProfile(); loadMentions(); mentionsLive(); }, 0);
    CL.sb.auth.onAuthStateChange((ev, s) => {
      const before = CL.user?.id; CL.user = s?.user || null; CL.token = s?.access_token || null;
      userBtn();
      if (before !== CL.user?.id) setTimeout(() => { upsertProfile(); loadMentions(); mentionsLive(); bell(); }, 0);
      if (before !== CL.user?.id) { if (!P) renderHome(); else if (P.cloud) { cloudLeave(); P = null; location.hash = '#/'; route(); } }
    });
    userBtn();
    return CL.sb;
  })();
}
function userBtn() {
  const b = $('#userBtn'); if (!b) return;
  b.textContent = CL.user ? '● ' + myName() : 'Entrar'; b.classList.toggle('on', !!CL.user);
  b.title = CL.user ? CL.user.email : 'Entra para trabajar en equipo';
  topButtons();
}
function topButtons() {
  const s = $('#shareBtn'), c = $('#cmtBtn'); if (!s) return;
  const cloud = !!P?.cloud;
  s.hidden = !P || !CL.user || (cloud && !CL.row);
  s.textContent = cloud ? 'Compartir' : 'Subir a la nube';
  c.hidden = !cloud;
  const n = CL.comments.filter(x => !x.parent_id && !x.resolved).length;
  c.innerHTML = `💬${n ? ` <b>${n}</b>` : ''}`; c.title = 'Comentarios';
}
const AUTH_ERR = m => /invalid login/i.test(m) ? 'Correo o contraseña incorrectos.' : /already registered|already exists/i.test(m) ? 'Ese correo ya tiene cuenta: entra con tu contraseña.'
  : /at least 6|password should/i.test(m) ? 'La contraseña debe tener al menos 6 caracteres.' : /not confirmed/i.test(m) ? 'Falta confirmar el correo (revisa tu bandeja).'
  : /rate limit|too many/i.test(m) ? 'Demasiados intentos: espera un momento.' : /valid email|invalid email/i.test(m) ? 'Ese correo no es válido.' : m;
async function loginDialog(msg) {
  if (!(await cloudInit())) return toast('No se pudo conectar (revisa internet)');
  const d = $('#dialog'); let signup = false;
  d.innerHTML = `<div class="dialog"><h3 id="lTitle">Entrar</h3>${msg ? `<p class="muted" style="margin:-6px 0 6px">${esc(msg)}</p>` : ''}
    <div id="lNameWrap" hidden><label>Tu nombre (lo verán tus socios)</label><input class="inp" id="lName" autocomplete="name"></div>
    <label>Correo</label><input class="inp" id="lEmail" type="email" autocomplete="email">
    <label>Contraseña</label><input class="inp" id="lPass" type="password" autocomplete="current-password">
    <p id="lErr" style="color:var(--bad);min-height:1.2em;margin:8px 0 0;font-size:13px"></p>
    <div class="row"><button class="btn ghost" data-mode>¿No tienes cuenta? Crear una</button><span class="spacer"></span><button class="btn" data-x>Cancelar</button><button class="btn pri" data-ok>Entrar</button></div></div>`;
  d.hidden = false; $('#lEmail').focus();
  const submit = async () => {
    const email = $('#lEmail').value.trim().toLowerCase(), password = $('#lPass').value, name = $('#lName').value.trim();
    if (!email || !password) { $('#lErr').textContent = 'Escribe tu correo y contraseña.'; return; }
    if (signup && !name) { $('#lErr').textContent = 'Escribe tu nombre.'; return; }
    $('#lErr').textContent = ''; $('[data-ok]', d).disabled = true;
    const r = signup ? await CL.sb.auth.signUp({ email, password, options: { data: { name } } }) : await CL.sb.auth.signInWithPassword({ email, password });
    $('[data-ok]', d).disabled = false;
    if (r.error) { $('#lErr').textContent = AUTH_ERR(r.error.message); return; }
    if (signup && !r.data.session) { $('#lErr').style.color = 'var(--ok)'; $('#lErr').textContent = 'Cuenta creada. Te llegó un correo para confirmarla: ábrelo y luego entra aquí.'; return; }
    d.hidden = true; toast(signup ? `¡Bienvenido, ${name}!` : 'Sesión iniciada');
  };
  d.onclick = e => {
    if (e.target === d || e.target.closest('[data-x]')) { d.hidden = true; return; }
    if (e.target.closest('[data-mode]')) {
      signup = !signup; $('#lNameWrap').hidden = !signup; $('#lTitle').textContent = signup ? 'Crear cuenta' : 'Entrar';
      e.target.closest('[data-mode]').textContent = signup ? 'Ya tengo cuenta' : '¿No tienes cuenta? Crear una';
      $('[data-ok]', d).textContent = signup ? 'Crear cuenta' : 'Entrar'; $('#lPass').autocomplete = signup ? 'new-password' : 'current-password'; $('#lErr').textContent = '';
      (signup ? $('#lName') : $('#lEmail')).focus(); return;
    }
    if (e.target.closest('[data-ok]')) submit();
  };
  d.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
}
function accountDialog() {
  const d = $('#dialog');
  d.innerHTML = `<div class="dialog"><h3>${esc(myName())}</h3><p class="muted" style="margin:0">${esc(CL.user.email)}</p>
    <p class="muted" style="font-size:12.5px">Tus guiones de la nube están en la página de inicio, en «En la nube».</p>
    <div class="row"><button class="btn danger" data-out>Cerrar sesión</button><span class="spacer"></span><button class="btn pri" data-x>Listo</button></div></div>`;
  d.hidden = false;
  d.onclick = async e => {
    if (e.target === d || e.target.closest('[data-x]')) { d.hidden = true; return; }
    if (e.target.closest('[data-out]')) { d.hidden = true; await cloudLeave(); await CL.sb.auth.signOut(); toast('Sesión cerrada'); location.hash = '#/'; }
  };
}

/* ---- imágenes en la nube ---- */
async function cloudPutImg(pid, id, dataUrl) {
  if (!CL.sb || !CL.user) return;
  const blob = await (await fetch(dataUrl)).blob();
  const { error } = await CL.sb.storage.from('img').upload(`${pid}/${id}`, blob, { contentType: blob.type, upsert: false });
  if (error && !/exists|duplicate/i.test(error.message)) console.warn('img', error.message);
}
async function cloudGetImg(pid, id) {
  if (!CL.sb || !CL.user) return null;
  const { data } = await CL.sb.storage.from('img').download(`${pid}/${id}`);
  if (!data) return null;
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(data); });
}

/* ---- lista y subida ---- */
async function cloudList() {
  const { data, error } = await CL.sb.from('projects').select('id,title,owner,owner_email,updated_at,updated_by_name,lock_user,lock_name,lock_at').order('updated_at', { ascending: false });
  if (error) throw error; return data;
}
async function cloudHome() {
  const box = $('#cloudBox'); if (!box) return;
  const sb = await cloudInit();
  if (!$('#cloudBox')) return;
  if (!sb) { box.innerHTML = '<p class="muted">No se pudo conectar con la nube (revisa internet).</p>'; return; }
  if (!CL.user) {
    box.innerHTML = `<div class="note" style="margin:10px 0 0"><b>Trabajar en equipo:</b> entra con tu cuenta para abrir los guiones que compartes con tus socios, dejar comentarios y ver los cambios en vivo. <button class="btn sm pri" data-login style="margin-left:6px">Entrar o crear cuenta</button></div>`;
    $$('[data-up]').forEach(b => b.hidden = true); return;
  }
  $$('[data-up]').forEach(b => b.hidden = false);
  try {
    const list = await cloudList(); if (!$('#cloudBox')) return;
    $('#cloudCount').textContent = list.length;
    box.innerHTML = `<div class="plist">${list.map(p => `<div class="pcard cloud" data-copen="${p.id}">
        <h3>${esc(p.title)}</h3>
        <div class="meta">${p.owner === CL.user.id ? 'Tuyo' : 'De ' + esc(p.owner_email || '—')} · editado ${fmtDate(p.updated_at)}${p.updated_by_name ? ' por ' + esc(p.updated_by_name) : ''}</div>
        ${lockFresh(p) ? `<div class="lockpill">✎ ${p.lock_user === CL.user.id ? 'Lo estás editando tú' : esc(p.lock_name || 'Alguien') + ' está editando'}</div>` : ''}
        <div class="acts">${p.owner === CL.user.id ? `<button class="btn sm danger" data-cdel="${p.id}">Borrar de la nube</button>` : ''}</div></div>`).join('')
      || '<p class="muted">Aún no hay guiones en la nube. Abre uno de este navegador y pulsa «Subir a la nube», o súbelo desde su tarjeta.</p>'}</div>`;
  } catch (e) { box.innerHTML = `<p class="muted">No se pudo leer la nube: ${esc(e.message)}</p>`; }
}
async function cloudUpload(id) {
  if (!CL.user) return loginDialog('Entra para subir el guion a la nube.');
  syncNow(); flushSave();
  const p = loadProject(id); if (!p) return;
  if (!confirm(`¿Subir «${p.title}» a la nube? Luego podrás compartirlo con tus socios.`)) return;
  toast('Subiendo a la nube…');
  p.cloud = true;
  const { error } = await CL.sb.from('projects').insert({ id: p.id, owner: CL.user.id, owner_email: CL.user.email, title: p.title, data: p,
    updated_by: CL.user.id, updated_by_name: myName(), lock_user: CL.user.id, lock_name: myName(), lock_at: new Date().toISOString() });
  if (error) { toast('No se pudo subir: ' + error.message); return; }
  for (const img of imageIds(p)) { const d = await imgGet(img); if (d) await cloudPutImg(p.id, img, d).catch(() => {}); }
  writeProject(p);
  if (P?.id === p.id) { P = null; CL.pid = null; route(); } else location.hash = `#/p/${p.id}/guion`;
  toast('Listo: el guion está en la nube. Usa «Compartir» para invitar a tus socios.');
}

/* ---- abrir, turno de edición, guardar ---- */
async function cloudOpen(id) {
  await cloudInit();
  if (!CL.user) { loginDialog('Este guion está en la nube: entra para abrirlo.'); if (!P) location.hash = '#/'; return; }
  CL.pid = id; CL.editing = false; CL.row = null; CL.comments = [];
  const { data, error } = await CL.sb.from('projects').select('*').eq('id', id).maybeSingle();
  if (CL.pid !== id) return;
  if (error || !data) {
    CL.pid = null;
    if (P?.id === id) { delete P.cloud; writeProject(P); toast('Este guion ya no está en la nube o no te lo compartieron: queda solo en este navegador.'); render(); }
    else { toast('No tienes acceso a ese guion'); location.hash = '#/'; }
    return;
  }
  CL.role = data.owner === CL.user.id ? 'owner' : (await CL.sb.rpc('project_role', { pid: id })).data || 'viewer';
  applyRow(data);
  CL.chan = CL.sb.channel('p-' + id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${id}` }, ev => onRemoteRow(ev.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `project_id=eq.${id}` }, () => loadComments())
    .subscribe();
  await loadPeople(); await loadComments();
  if (CL.role !== 'viewer') await tryLock(true); else rerender();
  if (CL.goC?.project_id === id) setTimeout(() => focusComment(CL.goC), 300);
  clearInterval(CL.tick); CL.tick = setInterval(cloudTick, 15e3);
}
function applyRow(row) {
  CL.row = row;
  const p = normalizeProject(row.data); p.cloud = true; p.title = row.title || p.title; p.updated = new Date(row.updated_at).getTime();
  P = p; writeProject(P);
}
async function refetch() {
  const { data } = await CL.sb.from('projects').select('*').eq('id', CL.pid).maybeSingle();
  if (data && P?.id === data.id) { applyRow(data); return true; }
  return false;
}
async function onRemoteRow(row) {
  if (!CL.row || row.id !== CL.pid) return;
  const changed = row.updated_at !== CL.row.updated_at && row.updated_by !== CL.user.id;
  Object.assign(CL.row, { lock_user: row.lock_user, lock_name: row.lock_name, lock_at: row.lock_at, updated_at: row.updated_at, updated_by_name: row.updated_by_name, title: row.title });
  if (changed && !CL.editing) { await refetch(); safeRerender(); return; }
  cloudBar();
}
async function tryLock(first) {
  const { data } = await CL.sb.rpc('acquire_lock', { pid: CL.pid, nm: myName() });
  if (!data || data.error) { CL.editing = false; cloudBar(); if (first) rerender(); return false; }
  const mine = data.lock_user === CL.user.id, was = CL.editing;
  Object.assign(CL.row, data);
  if (mine && !was) { await refetch(); CL.editing = true; CL.lastAct = Date.now(); clearInterval(CL.beat); CL.beat = setInterval(heartbeat, 30e3); }
  if (!mine) CL.editing = false;
  if (first || mine !== was) rerender(); else cloudBar();
  return mine;
}
async function heartbeat() {
  if (!CL.editing) return clearInterval(CL.beat);
  if (Date.now() - CL.lastAct > IDLE_MAX) { await cloudRelease(); toast('Dejaste de editar por inactividad: el guion quedó libre para tus socios.'); return; }
  const { data } = await CL.sb.rpc('acquire_lock', { pid: CL.pid, nm: myName() });
  if (data && data.lock_user !== CL.user.id) { CL.editing = false; clearInterval(CL.beat); Object.assign(CL.row, data); toast('Perdiste el turno de edición: ' + (data.lock_name || 'otra persona') + ' está editando.'); rerender(); }
  else if (data) Object.assign(CL.row, data);
}
async function cloudRelease() {
  if (!CL.pid) return;
  if (CL.pushT) { clearTimeout(CL.pushT); CL.pushT = null; await cloudPush(); }
  clearInterval(CL.beat);
  if (CL.editing) { CL.editing = false; await CL.sb.rpc('release_lock', { pid: CL.pid }); if (CL.row) CL.row.lock_user = null; }
  rerender();
}
function cloudAfterSave() {
  if (!P?.cloud || !CL.editing || P.id !== CL.pid) return;
  clearTimeout(CL.pushT); setSaved('Guardando en la nube…'); CL.pushT = setTimeout(cloudPush, 900);
}
async function cloudPush() {
  CL.pushT = null; if (!P?.cloud || !CL.editing) return;
  const at = new Date().toISOString();
  const { data, error } = await CL.sb.from('projects').update({ data: P, title: P.title, updated_at: at, updated_by: CL.user.id, updated_by_name: myName() }).eq('id', P.id).select('id');
  if (error) { setSaved('Sin conexión: se reintentará', true); CL.pushT = setTimeout(cloudPush, 8000); return; }
  if (!data?.length) { CL.editing = false; clearInterval(CL.beat); toast('No se guardó en la nube: ya no tienes el turno de edición.'); await refetch(); rerender(); return; }
  CL.row.updated_at = at; setSaved('Guardado en la nube');
}
async function cloudLeave() {
  const pid = CL.pid; if (!pid) return;
  if (CL.pushT) { clearTimeout(CL.pushT); await cloudPush(); }
  clearInterval(CL.beat); clearInterval(CL.tick);
  if (CL.editing) CL.sb.rpc('release_lock', { pid }).then(() => {}, () => {});
  if (CL.chan) CL.sb.removeChannel(CL.chan);
  Object.assign(CL, { pid: null, row: null, editing: false, chan: null, comments: [], draft: null, reply: null });
  $('#cloudBar').hidden = true; cmtClose();
}
window.addEventListener('pagehide', () => {
  if (!CL.editing || !CL.pid || !CL.token) return;
  const h = { apikey: SB_KEY, Authorization: 'Bearer ' + CL.token, 'Content-Type': 'application/json' };
  if (CL.pushT) { const body = JSON.stringify({ data: P, title: P.title, updated_at: new Date().toISOString(), updated_by: CL.user.id, updated_by_name: myName() });
    if (body.length < 60000) fetch(`${SB_URL}/rest/v1/projects?id=eq.${encodeURIComponent(CL.pid)}`, { method: 'PATCH', keepalive: true, headers: h, body }); }
  fetch(`${SB_URL}/rest/v1/rpc/release_lock`, { method: 'POST', keepalive: true, headers: h, body: JSON.stringify({ pid: CL.pid }) });
});
function cloudTick() { if (!CL.pid) return clearInterval(CL.tick); cloudBar(); }
function rerender() {
  if (!P) return;
  const sc = ['.main', '.paper-scroll', '.side', '.mb-stage'].map(s => [s, $(s)?.scrollTop]);
  if ($('#dialog').hidden === false) { cloudBar(); return; }
  render();
  sc.forEach(([s, v]) => { if (v != null && $(s)) $(s).scrollTop = v; });
}
// no recargar mientras alguien selecciona texto o escribe un comentario
function safeRerender() {
  const sel = getSelection(), busy = (sel.rangeCount && !sel.isCollapsed) || document.activeElement?.closest?.('#cmt,#dialog');
  clearTimeout(CL.rrT);
  if (busy) { CL.rrT = setTimeout(safeRerender, 1500); return; }
  rerender();
}
function cloudBar() {
  const b = $('#cloudBar'); if (!b) return; topButtons();
  if (!P?.cloud || !CL.row) { b.hidden = true; return; }
  const r = CL.row, other = lockFresh(r) && r.lock_user !== CL.user.id;
  let h;
  if (CL.editing) h = `<span class="dot ed"></span><span>Estás editando. Tus socios lo ven en modo lectura.</span><button class="btn sm" data-release>Dejar de editar</button>`;
  else if (CL.role === 'viewer') h = `<span class="dot"></span><span>Solo lectura: puedes ver y comentar.</span>`;
  else if (other) h = `<span class="dot ro"></span><span><b>${esc(r.lock_name || 'Alguien')}</b> está editando. Estás en modo lectura: ves sus cambios en vivo y puedes comentar.</span>`;
  else h = `<span class="dot free"></span><span>Nadie está editando.</span><button class="btn sm pri" data-take>Editar</button>`;
  b.innerHTML = h; b.hidden = false;
  document.body.classList.toggle('ro', isRO());
}
$('#cloudBar').addEventListener('click', async e => {
  if (e.target.closest('[data-release]')) { await cloudRelease(); toast('Listo: el guion quedó libre para tus socios'); }
  if (e.target.closest('[data-take]')) { const ok = await tryLock(); if (!ok) toast('Otra persona tomó el turno antes'); }
});
let roToastAt = 0;
function roWarn() {
  if (Date.now() - CL.lastAct > 1500 || Date.now() - roToastAt < 4000) return;
  roToastAt = Date.now();
  toast(CL.role === 'viewer' ? 'Solo lectura: puedes comentar' : lockFresh(CL.row) ? `Modo lectura: ${CL.row.lock_name || 'otra persona'} está editando` : 'Pulsa «Editar» (abajo) para tomar el turno');
}

/* ---- compartir ---- */
async function shareDialog() {
  if (!P.cloud) return cloudUpload(P.id);
  const d = $('#dialog'), owner = CL.role === 'owner';
  const load = async () => (await CL.sb.from('project_members').select('*').eq('project_id', P.id).order('added_at')).data || [];
  const draw = list => {
    d.innerHTML = `<div class="dialog"><h3>Compartir «${esc(P.title)}»</h3>
      <div class="mem"><span><b>${esc(CL.row.owner_email || '—')}</b></span><span class="muted">Dueño</span></div>
      ${list.map(m => `<div class="mem"><span>${esc(m.email)}</span>${owner ? `<select class="inp" data-role="${esc(m.email)}" style="width:auto"><option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Puede editar</option><option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Solo ver y comentar</option></select><button class="iconbtn" data-rmm="${esc(m.email)}" title="Quitar">×</button>` : `<span class="muted">${m.role === 'editor' ? 'Puede editar' : 'Solo ver'}</span>`}</div>`).join('')}
      ${owner ? `<label>Invitar por correo</label><div class="row" style="margin:0;flex-wrap:nowrap"><input class="inp" id="mEmail" type="email" placeholder="correo@ejemplo.com"><select class="inp" id="mRole" style="width:auto"><option value="editor">Puede editar</option><option value="viewer">Solo ver y comentar</option></select><button class="btn pri" data-addm>Invitar</button></div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0">Tu socio entra en <b>virtualtut.github.io/glanx-guiones</b>, crea su cuenta <b>con ese mismo correo</b> y verá el guion en «En la nube».</p>` : '<p class="muted" style="font-size:12.5px">Solo el dueño puede invitar.</p>'}
      <div class="row"><button class="btn pri" data-x>Listo</button></div></div>`;
  };
  draw(await load()); d.hidden = false;
  d.onclick = async e => {
    if (e.target === d || e.target.closest('[data-x]')) { d.hidden = true; return; }
    if (e.target.closest('[data-addm]')) {
      const email = $('#mEmail').value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Escribe un correo válido');
      if (email === CL.user.email) return toast('Ese eres tú');
      const { error } = await CL.sb.from('project_members').upsert({ project_id: P.id, email, role: $('#mRole').value });
      if (error) return toast('No se pudo invitar: ' + error.message);
      toast('Invitado: ' + email); draw(await load()); loadPeople();
    }
    const rm = e.target.closest('[data-rmm]');
    if (rm && confirm(`¿Quitar a ${rm.dataset.rmm}?`)) { await CL.sb.from('project_members').delete().eq('project_id', P.id).eq('email', rm.dataset.rmm); draw(await load()); }
  };
  d.onchange = async e => { const s = e.target.closest('[data-role]'); if (s) { await CL.sb.from('project_members').update({ role: s.value }).eq('project_id', P.id).eq('email', s.dataset.role); toast('Permiso cambiado'); } };
}

/* ---- comentarios ---- */
const VIEW_LABEL = { guion: 'Guion', desglose: 'Desglose', planos: 'Planos', rodaje: 'Plan de rodaje', presupuesto: 'Presupuesto', moodboard: 'Moodboard' };
async function loadComments() {
  if (!CL.pid) return;
  const { data } = await CL.sb.from('comments').select('*').eq('project_id', CL.pid).order('created_at');
  CL.comments = data || []; topButtons(); markCommented(); if (CL.open) cmtRender();
}
function sceneOfBlock(bid) { let sid = null; for (const b of P.blocks) { if (b.t === 'scene') sid = b.id; if (b.id === bid) return sid; } return null; }
function cmtWhere(c) {
  const sc = c.sid && getScenes().find(s => s.id === c.sid);
  return (VIEW_LABEL[c.view] || 'General') + (sc ? ` · Escena ${sc.num}` : '');
}
function markCommented() {
  const open = new Set(CL.comments.filter(c => !c.parent_id && !c.resolved && c.block).map(c => c.block));
  $$('#ed > .el').forEach(el => el.classList.toggle('has-cmt', open.has(el.dataset.id)));
  placeMarks();
}
// flechas en el margen del guion: señalan la línea comentada; clic = abre esos comentarios
function placeMarks() {
  const paper = $('.paper'), ed = $('#ed'); if (!paper || !ed) return;
  let lay = $('#cmarks', paper); if (!lay) { lay = document.createElement('div'); lay.id = 'cmarks'; paper.appendChild(lay); }
  if (!P?.cloud) { lay.innerHTML = ''; return; }
  const by = new Map();
  CL.comments.filter(c => !c.parent_id && !c.resolved && c.block).forEach(c => { if (!by.has(c.block)) by.set(c.block, []); by.get(c.block).push(c); });
  const pr = paper.getBoundingClientRect(); let lastTop = -99;
  lay.innerHTML = [...by].map(([bid, list]) => {
    const el = ed.querySelector(`[data-id="${bid}"]`); if (!el) return '';
    let top = el.getBoundingClientRect().top - pr.top - 2; if (top < lastTop + 30) top = lastTop + 30; lastTop = top;
    const who = [...new Set(list.map(c => c.author_name || '—'))].join(', ');
    return `<button class="cmark ${CL.focus === bid ? 'on' : ''}" data-cmark="${bid}" style="top:${top}px" title="${esc(who)}: ${esc(list[0].body.slice(0, 80))}"><span class="arr"></span><svg viewBox="0 0 16 16" width="13" height="13"><path d="M2 3h12v8H7l-3 3v-3H2z" fill="currentColor"/></svg>${list.length}</button>`;
  }).join('');
}
document.addEventListener('click', e => {
  const m = e.target.closest('[data-cmark]'); if (!m) return;
  CL.focus = m.dataset.cmark; cmtOpen(); placeMarks();
  setTimeout(() => $('.cm.focus')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
});
window.addEventListener('resize', () => placeMarks());
function cmtOpen(draft) {
  if (!P?.cloud) return toast('Sube el guion a la nube para comentar');
  CL.open = true; if (draft) CL.draft = draft;
  CL.draft ||= { view: UI.view, sid: ['desglose', 'planos', 'moodboard', 'guion'].includes(UI.view) ? (UI.sid === 'general' ? null : UI.sid) : null };
  $('#cmt').hidden = false; document.body.classList.add('cmt-open'); cmtRender(); setTimeout(placeMarks, 0);
  loadPeople().catch(() => {});
  setTimeout(() => $('#cmtTxt')?.focus(), 30);
}
function cmtClose() { CL.open = false; CL.focus = null; CL.focusC = null; setTimeout(placeMarks, 0); const c = $('#cmt'); if (c) c.hidden = true; document.body.classList.remove('cmt-open'); }
const ago = t => { const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'ahora' : s < 3600 ? `hace ${Math.floor(s / 60)} min` : s < 86400 ? `hace ${Math.floor(s / 3600)} h` : fmtDate(t); };
function cmtRender() {
  const box = $('#cmt'); if (!box || !CL.open || !CL.user) return;
  const all = CL.comments, roots = all.filter(c => !c.parent_id).reverse();
  const shown = roots.filter(c => CL.showRes || !c.resolved), nres = roots.filter(c => c.resolved).length;
  const canMod = c => c.author === CL.user.id || CL.role === 'owner';
  const one = c => `<div class="cm-body">${bodyHTML(c.body)}</div><div class="cm-meta"><b>${esc(c.author_name || '—')}</b> · ${ago(c.created_at)}${canMod(c) ? ` · <a data-cdelc="${c.id}">borrar</a>` : ''}</div>`;
  const d = CL.draft;
  box.innerHTML = `<div class="cm-h"><b>Comentarios</b><span class="spacer"></span>${nres ? `<label class="muted"><input type="checkbox" data-showres ${CL.showRes ? 'checked' : ''}> Resueltos (${nres})</label>` : ''}<button class="iconbtn" data-cclose title="Cerrar">×</button></div>
    <div class="cm-new">${d ? `<div class="cm-where">En: ${esc(cmtWhere(d))}${d.quote ? `<q>${esc(d.quote)}</q>` : ''}<button class="iconbtn" data-cnodraft title="Quitar">×</button></div>` : ''}
      <textarea class="inp" id="cmtTxt" rows="3" placeholder="Escribe un comentario… Usa @ para mencionar a alguien (Ctrl+Enter envía)"></textarea>
      <div class="row" style="margin-top:6px"><span class="muted" style="font-size:11.5px">Selecciona texto del guion para comentar esa parte.</span><span class="spacer"></span><button class="btn pri sm" data-csend>Comentar</button></div></div>
    <div class="cm-list">${shown.map(c => `<div class="cm ${c.resolved ? 'res' : ''} ${(CL.focus && c.block === CL.focus) || CL.focusC === c.id ? 'focus' : ''}" data-cid="${c.id}">
        <div class="cm-where link" data-cgo="${c.id}">${esc(cmtWhere(c))}${c.quote ? `<q>${esc(c.quote)}</q>` : ''}</div>${one(c)}
        ${all.filter(r => r.parent_id === c.id).map(r => `<div class="cm-reply">${one(r)}</div>`).join('')}
        ${CL.reply === c.id ? `<div class="cm-reply"><textarea class="inp" id="cmtRep" rows="2" placeholder="Responder…"></textarea><div class="row" style="margin-top:4px;justify-content:flex-end"><button class="btn sm" data-crcancel>Cancelar</button><button class="btn sm pri" data-crsend="${c.id}">Responder</button></div></div>` : ''}
        <div class="cm-acts"><a data-crep="${c.id}">Responder</a><a data-cres="${c.id}">${c.resolved ? 'Reabrir' : '✓ Resuelto'}</a></div></div>`).join('')
      || '<p class="muted" style="padding:10px">Aún no hay comentarios.</p>'}</div>`;
  if (CL.reply) $('#cmtRep')?.focus();
}
async function cmtSend(body, parent) {
  body = body.trim(); if (!body) return;
  const base = parent ? { parent_id: parent.id, view: parent.view, sid: parent.sid, block: parent.block } : { ...(CL.draft || { view: UI.view }) };
  const mentions = mentionsIn(body);
  const { error } = await CL.sb.from('comments').insert({ ...base, project_id: P.id, body, mentions, author: CL.user.id, author_name: myName() });
  if (error) return toast('No se pudo comentar: ' + error.message);
  if (!parent) CL.draft = null; CL.reply = null; await loadComments();
  if (mentions.length) toast('Avisado: ' + CL.people.filter(p => mentions.includes(p.email)).map(p => p.name).join(', '));
}
function cmtGo(c) {
  const show = () => {
    if (c.block) { const el = $(`#ed [data-id="${c.block}"]`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
  };
  if (c.sid && getScenes().some(s => s.id === c.sid)) UI.sid = c.sid;
  if (c.view && c.view !== UI.view) { go(c.view); setTimeout(show, 120); } else { if (c.view !== 'guion') rerender(); show(); }
}
$('#cmt').addEventListener('click', async e => {
  const t = e.target, id = x => CL.comments.find(c => c.id === x);
  if (t.closest('[data-cclose]')) return cmtClose();
  if (t.closest('[data-cnodraft]')) { CL.draft = { view: UI.view }; return cmtRender(); }
  if (t.closest('[data-csend]')) return cmtSend($('#cmtTxt').value);
  if (t.closest('[data-crep]')) { CL.reply = t.closest('[data-crep]').dataset.crep; return cmtRender(); }
  if (t.closest('[data-crcancel]')) { CL.reply = null; return cmtRender(); }
  if (t.closest('[data-crsend]')) return cmtSend($('#cmtRep').value, id(t.closest('[data-crsend]').dataset.crsend));
  if (t.closest('[data-cres]')) { const c = id(t.closest('[data-cres]').dataset.cres); const { error } = await CL.sb.from('comments').update({ resolved: !c.resolved }).eq('id', c.id); if (error) toast(error.message); return loadComments(); }
  if (t.closest('[data-cdelc]')) { if (!confirm('¿Borrar este comentario?')) return; await CL.sb.from('comments').delete().eq('id', t.closest('[data-cdelc]').dataset.cdelc); return loadComments(); }
  if (t.closest('[data-cgo]')) return cmtGo(id(t.closest('[data-cgo]').dataset.cgo));
});
$('#cmt').addEventListener('change', e => { if (e.target.matches('[data-showres]')) { CL.showRes = e.target.checked; cmtRender(); } });
$('#cmt').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.target.id === 'cmtTxt') cmtSend(e.target.value); if (e.target.id === 'cmtRep') cmtSend(e.target.value, CL.comments.find(c => c.id === CL.reply)); }
  e.stopPropagation();
});
// botón flotante «Comentar» al seleccionar texto del guion
document.addEventListener('mouseup', () => setTimeout(() => {
  const pop = $('#cmtpop'); if (!pop) return;
  const sel = getSelection(), ed = $('#ed');
  const ok = P?.cloud && ed && sel.rangeCount && !sel.isCollapsed && ed.contains(sel.anchorNode) && sel.toString().trim();
  if (!ok) { pop.hidden = true; return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  pop.hidden = false; pop.style.left = Math.min(innerWidth - 130, r.right + 6) + 'px'; pop.style.top = Math.max(60, r.top - 36) + 'px';
}, 0));
$('#cmtpop').addEventListener('mousedown', e => {
  e.preventDefault();
  const sel = getSelection(); const el = (sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest('.el');
  const quote = sel.toString().trim().replace(/\s+/g, ' ').slice(0, 200);
  $('#cmtpop').hidden = true;
  cmtOpen({ view: 'guion', sid: el ? sceneOfBlock(el.dataset.id) : null, block: el?.dataset.id || null, quote });
});
$('#cmtBtn').addEventListener('click', () => CL.open ? cmtClose() : cmtOpen());
$('#shareBtn').addEventListener('click', () => shareDialog());
$('#userBtn').addEventListener('click', async () => { await cloudInit(); CL.user ? accountDialog() : loginDialog(); });
app.addEventListener('click', async e => {
  if (P) return;
  const t = e.target;
  if (t.closest('[data-login]')) { e.stopPropagation(); return loginDialog(); }
  const up = t.closest('[data-up]'); if (up) { e.stopPropagation(); return cloudUpload(up.dataset.up); }
  const del = t.closest('[data-cdel]');
  if (del) {
    e.stopPropagation();
    if (!confirm('¿Borrar este guion de la nube? Tus socios dejarán de verlo. La copia de este navegador se queda.')) return;
    const { error } = await CL.sb.from('projects').delete().eq('id', del.dataset.cdel);
    if (error) return toast(error.message);
    const lp = loadProject(del.dataset.cdel); if (lp) { delete lp.cloud; writeProject(lp); }
    return renderHome();
  }
  const co = t.closest('[data-copen]'); if (co) { e.stopPropagation(); location.hash = `#/p/${co.dataset.copen}/guion`; }
}, true);
/* ---- menciones (@persona) y avisos ---- */
async function upsertProfile() {
  if (!CL.user) return;
  await CL.sb.from('profiles').upsert({ id: CL.user.id, email: CL.user.email.toLowerCase(), name: myName() });
}
async function loadPeople() {
  if (!CL.pid) return;
  const mem = (await CL.sb.from('project_members').select('email').eq('project_id', CL.pid)).data || [];
  const emails = [...new Set([CL.row?.owner_email, ...mem.map(m => m.email)].filter(Boolean).map(e => e.toLowerCase()))];
  const prof = emails.length ? (await CL.sb.from('profiles').select('email,name').in('email', emails)).data || [] : [];
  CL.people = emails.map(e => ({ email: e, name: (prof.find(p => (p.email || '').toLowerCase() === e)?.name || e.split('@')[0]).trim() }));
}
const mentionsIn = body => (CL.people || []).filter(p => p.email !== CL.user.email.toLowerCase() && (body.includes('@' + p.name) || fold(body).includes('@' + fold(p.email.split('@')[0])))).map(p => p.email);
function bodyHTML(body) {
  let h = esc(body);
  [...(CL.people || [])].sort((a, b) => b.name.length - a.name.length).forEach(p => {
    const me = p.email === CL.user?.email?.toLowerCase();
    h = h.split('@' + esc(p.name)).join(`<span class="ment ${me ? 'me' : ''}" title="${esc(p.email)}">@${esc(p.name)}</span>`);
  });
  return h.replace(/\n/g, '<br>');
}
// lista al escribir @ en un comentario
const MP = { ta: null, items: [], i: 0, at: 0 };
function mentUpdate(ta) {
  const pop = $('#mentpop'); const pre = ta.value.slice(0, ta.selectionStart); const m = /(^|\s)@([^\s@]{0,30})$/.exec(pre);
  if (!m) { pop.hidden = true; MP.items = []; return; }
  const others = (CL.people || []).filter(p => p.email !== CL.user.email.toLowerCase());
  if (!others.length) {
    MP.items = []; pop.innerHTML = `<div class="ac-h" style="padding:8px 10px;font-size:12px;max-width:300px;white-space:normal">Aún no hay nadie más en este guion. Usa <b>Compartir</b> (arriba) para invitar a tus socios y podrás mencionarlos.</div>`;
    const r = ta.getBoundingClientRect(); pop.hidden = false; pop.style.left = r.left + 'px'; pop.style.top = (r.bottom + 4) + 'px'; pop.style.width = r.width + 'px'; return;
  }
  const q = fold(m[2]);
  MP.items = CL.people.filter(p => p.email !== CL.user.email.toLowerCase() && (fold(p.name).includes(q) || fold(p.email).includes(q))).slice(0, 6);
  if (!MP.items.length) { pop.hidden = true; return; }
  MP.ta = ta; MP.at = pre.length - m[2].length - 1; MP.i = Math.min(MP.i, MP.items.length - 1);
  pop.innerHTML = `<div class="ac-h">Mencionar a…</div>` + MP.items.map((p, i) => `<button data-mp="${i}" class="${i === MP.i ? 'on' : ''}"><b>${esc(p.name)}</b><span>${esc(p.email)}</span></button>`).join('');
  const r = ta.getBoundingClientRect(); pop.hidden = false;
  pop.style.left = r.left + 'px'; pop.style.top = (r.bottom + 4) + 'px'; pop.style.width = r.width + 'px';
}
function mentPick(i) {
  const p = MP.items[i], ta = MP.ta; if (!p || !ta) return;
  const v = ta.value, end = ta.selectionStart, ins = '@' + p.name + ' ';
  ta.value = v.slice(0, MP.at) + ins + v.slice(end);
  const c = MP.at + ins.length; ta.setSelectionRange(c, c); ta.focus();
  $('#mentpop').hidden = true; MP.items = [];
}
document.addEventListener('mousedown', e => { const b = e.target.closest('[data-mp]'); if (b) { e.preventDefault(); mentPick(+b.dataset.mp); } else if (!e.target.closest('#cmt')) $('#mentpop').hidden = true; });
$('#cmt').addEventListener('input', e => { if (e.target.matches('textarea')) mentUpdate(e.target); });
$('#cmt').addEventListener('keydown', e => {
  if (!MP.items.length || $('#mentpop').hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); MP.i = (MP.i + (e.key === 'ArrowDown' ? 1 : MP.items.length - 1)) % MP.items.length; mentUpdate(e.target); e.stopImmediatePropagation(); }
  else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); mentPick(MP.i); e.stopImmediatePropagation(); }
  else if (e.key === 'Escape') { $('#mentpop').hidden = true; MP.items = []; e.stopImmediatePropagation(); }
}, true);

// campana: menciones a mí en cualquier proyecto
async function loadMentions() {
  if (!CL.user) return;
  const me = CL.user.email.toLowerCase();
  const [{ data }, { data: prof }] = await Promise.all([
    CL.sb.from('comments').select('id,project_id,view,sid,block,quote,body,author,author_name,created_at,resolved,projects(title)').contains('mentions', [me]).order('created_at', { ascending: false }).limit(40),
    CL.sb.from('profiles').select('mentions_seen_at').eq('id', CL.user.id).maybeSingle()]);
  CL.mentions = (data || []).filter(c => c.author !== CL.user.id);
  CL.seenAt = prof?.mentions_seen_at ? new Date(prof.mentions_seen_at).getTime() : 0;
  bell();
}
function bell() {
  const b = $('#bellBtn'); if (!b) return;
  b.hidden = !CL.user;
  const n = (CL.mentions || []).filter(c => new Date(c.created_at).getTime() > CL.seenAt).length;
  b.innerHTML = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M8 1.5a4 4 0 0 0-4 4v2.6L2.6 10.5v1h10.8v-1L12 8.1V5.5a4 4 0 0 0-4-4zM6.3 12.5a1.8 1.8 0 0 0 3.4 0z" fill="currentColor"/></svg>${n ? `<b>${n}</b>` : ''}`;
  b.title = n ? `${n} menciones nuevas` : 'Menciones';
}
function bellDialog() {
  const d = $('#dialog'), list = CL.mentions || [];
  d.innerHTML = `<div class="dialog wide"><h3>Te mencionaron</h3><div class="ment-list">${list.map(c => `<button class="ment-it ${new Date(c.created_at).getTime() > CL.seenAt ? 'new' : ''}" data-mgo="${c.id}">
      <span class="muted">${esc(c.author_name || '—')} · ${ago(c.created_at)} · <b>${esc(c.projects?.title || 'Guion')}</b> · ${esc(VIEW_LABEL[c.view] || 'General')}${c.resolved ? ' · resuelto' : ''}</span>
      ${c.quote ? `<q>${esc(c.quote)}</q>` : ''}<span class="ment-body">${esc(c.body)}</span></button>`).join('') || '<p class="muted">Nadie te ha mencionado todavía.</p>'}</div>
    <div class="row"><button class="btn pri" data-x>Cerrar</button></div></div>`;
  d.hidden = false;
  CL.sb.from('profiles').update({ mentions_seen_at: new Date().toISOString() }).eq('id', CL.user.id).then(() => { CL.seenAt = Date.now(); bell(); });
  d.onclick = e => {
    if (e.target === d || e.target.closest('[data-x]')) { d.hidden = true; return; }
    const it = e.target.closest('[data-mgo]'); if (!it) return;
    const c = list.find(x => x.id === it.dataset.mgo); d.hidden = true;
    CL.goC = c;
    if (P?.id === c.project_id && CL.pid === c.project_id) focusComment(c);
    else location.hash = `#/p/${c.project_id}/${c.view || 'guion'}`;
  };
}
function focusComment(c) {
  CL.goC = null; CL.focus = c.block || null; CL.focusC = c.id; CL.showRes ||= !!c.resolved;
  cmtOpen(); cmtGo(c);
  setTimeout(() => $(`.cm[data-cid="${c.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 400);
}
let mentChan = null;
function mentionsLive() {
  if (mentChan) { CL.sb.removeChannel(mentChan); mentChan = null; }
  if (!CL.user) return;
  const me = CL.user.email.toLowerCase();
  mentChan = CL.sb.channel('ment-' + CL.user.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, ev => {
    const c = ev.new; if (!c.mentions?.includes(me) || c.author === CL.user.id) return;
    toast(`🔔 ${c.author_name || 'Alguien'} te mencionó: «${c.body.slice(0, 60)}»`); loadMentions();
  }).subscribe();
}
$('#bellBtn').addEventListener('click', () => bellDialog());

/* ---- aviso de versión nueva: compara con la que hay publicada ---- */
async function checkVersion() {
  try {
    const h = await (await fetch('index.html?_=' + Date.now(), { cache: 'no-store' })).text();
    const v = /app\.js\?v=(\w+)/.exec(h)?.[1];
    if (v && v !== APP_V && !$('#newver')) {
      const b = document.createElement('div'); b.id = 'newver'; b.className = 'newver';
      b.innerHTML = 'Hay una versión nueva de la app. <button class="btn sm pri">Actualizar</button>';
      b.querySelector('button').onclick = () => { syncNow(); flushSave(); location.reload(); };
      document.body.appendChild(b);
    }
  } catch {}
}
setInterval(checkVersion, 5 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
setTimeout(checkVersion, 8000);
cloudInit();

/* ================= Ejemplo ================= */
function sampleProject() {
  const text = `INT. APARTAMENTO DE LUCÍA - NOCHE

La luz del pasillo parpadea. LUCÍA (28) revisa en su celular la cámara de seguridad del edificio. En la pantalla, la puerta de su apartamento está abierta.

Mira la puerta real: cerrada.

LUCÍA
(en voz baja)
¿Quién dejó la puerta abierta?

Un golpe seco en la cocina. El celular se apaga solo.

CORTE A:

EXT. CALLE DEL BARRIO - NOCHE

Llovizna. Lucía sale corriendo del edificio con la chaqueta mal puesta. Un TAXI amarillo espera con el motor encendido.

TAXISTA
¿Para dónde, mona?

LUCÍA
Para donde sea. Arranque.

INT. TAXI - NOCHE - CONTINUO

Lucía respira. Por el retrovisor, los ojos del taxista no parpadean. En el asiento de al lado, el mismo celular de la cocina, encendido.

LUCÍA
Ese... ese es mi celular.

FUNDE A NEGRO.`;
  const p = newProject('La puerta (ejemplo)');
  p.blocks = parseScript(text); p.author = 'Glanx Studio';
  p.logline = 'Una mujer descubre por la cámara de seguridad que alguien entró a su casa, y huir solo la acerca más.';
  const sc = p.blocks.filter(b => b.t === 'scene');
  p.scenes[sc[0].id] = { bd: { props: ['celular', 'puerta'], sfx: ['luz que parpadea'], sound: ['golpe seco'] }, notes: 'Grabar el pasillo con tubo LED a la vista para el parpadeo.', shots: [
    { id: uid(), size: 'Plano detalle', lens: '50mm', move: 'Fijo', desc: 'Pantalla del celular: la puerta abierta en la cámara', dur: '3', img: null },
    { id: uid(), size: 'Plano medio', lens: '35mm', move: 'Cámara en mano', desc: 'Lucía levanta la vista hacia la puerta', dur: '4', img: null },
    { id: uid(), size: 'Plano general', lens: '24mm', move: 'Dolly in', desc: 'La puerta cerrada, lento hacia ella', dur: '5', img: null }] };
  p.scenes[sc[1].id] = { bd: { vehicles: ['taxi amarillo'], sfx: ['lluvia'], wardrobe: ['chaqueta de Lucía'] }, notes: '', shots: [] };
  p.days = [{ id: uid(), date: '', note: 'Apartamento (Chapinero)', scenes: [sc[0].id] }];
  p.budget.depts[4].items.push({ id: uid(), name: 'Alquiler de cámara y lentes', qty: 2, unit: 'días', cost: 450000, actual: 0 });
  p.budget.depts[3].items.push({ id: uid(), name: 'Actriz principal', qty: 2, unit: 'jornada', cost: 350000, actual: 350000 });
  p.budget.depts[11].items.push({ id: uid(), name: 'Almuerzos equipo (8 personas)', qty: 16, unit: 'persona', cost: 18000, actual: 0 });
  return p;
}

route();
