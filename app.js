/* Cuadros — galería móvil. Sin dependencias.
   Datos: datos.json (índice) y fichas.json (textos, se pide al abrir la «i»). */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const TEMAS = ['Guerra', 'Paisaje', 'Ciudades', 'Clásicas', 'Retratos'];
const TEMA_LARGO = ['Guerra', 'Paisaje', 'Ciudades y arquitectura', 'Escenas clásicas',
                    'Retratos de monarcas y hombres de estado'];
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

let O = [];            // todas las obras
let vista = [];        // índices de O que pasan el filtro
let tema = -1, q = '', pintadas = 0;
const CHUNK = 90;

/* ------------------------------------------------------- clave de acceso
   El contenido del repositorio va cifrado (AES-256-GCM). La clave se deriva de la contraseña con PBKDF2 (SHA-256) y,
   una vez comprobada, se guarda en este dispositivo para no volver a pedirla. */
const enc = new TextEncoder(), dec = new TextDecoder();
const deB64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
const aB64 = u => btoa(String.fromCharCode(...u));
const normClave = t => t.normalize('NFKC').replace(/\s+/g, '').toLowerCase();   // sin espacios ni mayúsculas
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const leer = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
let KEY = null;
const claveDeBytes = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
async function derivarBytes(clave, kj) {
  const mat = await crypto.subtle.importKey('raw', enc.encode(normClave(clave)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(kj.sal), iterations: kj.it }, mat, 256));
}
async function descifrar(k, buf) {
  const u = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12));
}
async function comprobarClave(k, kj) {
  const r = await descifrar(k, deB64(kj.chk));          // lanza si la clave no es la buena
  if (dec.decode(r) !== 'CUADROS') throw new Error('clave');
}
function pedirClave(kj) {
  return new Promise(resolve => {
    const c = $('candado'), f = $('f-candado'), i = $('i-clave'), e = $('e-clave'), b = f.querySelector('button[type=submit]');
    c.hidden = false; setTimeout(() => i.focus(), 200);
    f.onsubmit = async ev => {
      ev.preventDefault();
      if (!i.value.trim()) return;
      b.disabled = true; e.textContent = 'Comprobando…';
      try {
        const raw = await derivarBytes(i.value, kj), k = await claveDeBytes(raw);
        await comprobarClave(k, kj);
        guardar('cuadros-k', aB64(raw)); i.value = ''; e.textContent = ''; c.hidden = true; resolve(k);
      } catch (err) { e.textContent = 'Clave incorrecta'; b.disabled = false; i.select(); }
    };
  });
}
async function desbloquear() {
  const kj = await (await fetch('k.json')).json();
  const guardada = leer('cuadros-k');
  if (guardada) {
    try { KEY = await claveDeBytes(deB64(guardada)); await comprobarClave(KEY, kj); }
    catch (_) { KEY = null; try { localStorage.removeItem('cuadros-k'); } catch (__) {} }
  }
  if (!KEY) KEY = await pedirClave(kj);
}
async function datosCifrados(nombre) {
  const r = await fetch(nombre);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return JSON.parse(dec.decode(await descifrar(KEY, await r.arrayBuffer())));
}

/* imágenes cifradas: se descifran al pedirlas y se muestran como blob */
const BLOB = { th: new Map(), img: new Map() };      // id -> promesa de la URL del blob
const LRU = [];                                      // ids de imágenes grandes en memoria (se liberan las más viejas)
function urlImg(tipo, o) {
  const m = BLOB[tipo];
  if (m.has(o.i)) {
    if (tipo === 'img') { const k = LRU.indexOf(o.i); if (k >= 0) { LRU.splice(k, 1); LRU.push(o.i); } }
    return m.get(o.i);
  }
  const p = fetch(tipo + '/' + o.x + '.bin')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(b => descifrar(KEY, b))
    .then(b => URL.createObjectURL(new Blob([b], { type: 'image/jpeg' })));
  p.catch(() => m.delete(o.i));
  m.set(o.i, p);
  if (tipo === 'img') {
    LRU.push(o.i);
    while (LRU.length > 8) { const v = LRU.shift(), q = m.get(v); m.delete(v); if (q) q.then(u => URL.revokeObjectURL(u)).catch(() => {}); }
  }
  return p;
}
/* miniaturas: se piden cuando se acercan a la pantalla, de 8 en 8 y lo más nuevo primero */
const obsMini = 'IntersectionObserver' in window
  ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { obsMini.unobserve(e.target); cargarMini(e.target); } }), { rootMargin: '900px' })
  : null;
let activas = 0;
const cola = [];
function verMiniatura(im) { if (obsMini) obsMini.observe(im); else cargarMini(im); }
function cargarMini(im) { cola.push(im); bombear(); }
function bombear() {
  while (activas < 8 && cola.length) {
    const im = cola.pop();
    if (!im.isConnected) continue;
    activas++;
    urlImg('th', im._o).then(u => { im.src = u; }).catch(() => {}).finally(() => { activas--; bombear(); });
  }
}

/* ------------------------------------------------------------ rejilla */
const rej = $('rejilla');

function celda(n) {
  const o = O[vista[n]];
  const a = document.createElement('a');
  a.href = '#o=' + o.i;
  a.dataset.n = n;
  a.style.setProperty('--r', clamp(o.w / o.h, 0.55, 2.4).toFixed(3));
  const im = new Image();
  im.onload = () => im.classList.add('ok');
  im.alt = o.t + ' — ' + o.a;
  im.decoding = 'async';
  im._o = o;
  a.appendChild(im);
  verMiniatura(im);
  return a;
}

function masCeldas() {
  const fr = document.createDocumentFragment();
  for (let k = 0; k < CHUNK && pintadas < vista.length; k++) fr.appendChild(celda(pintadas++));
  rej.appendChild(fr);
}

function llenar() {
  // sigue añadiendo mientras el final de la rejilla quede cerca de la pantalla
  while (pintadas < vista.length && $('mas').getBoundingClientRect().top < innerHeight + 1500) masCeldas();
}

function filtrar() {
  const ps = norm(q.trim()).split(/\s+/).filter(Boolean);
  vista = [];
  O.forEach((o, i) => {
    if ((tema < 0 || o.m === tema) && ps.every(p => o._b.includes(p))) vista.push(i);
  });
  rej.textContent = '';
  pintadas = 0;
  $('vacio').hidden = vista.length > 0;
  $('cuenta').textContent = vista.length + (vista.length === 1 ? ' obra' : ' obras');
  window.scrollTo(0, 0);
  llenar();
}

function asegurar(n) {
  while (pintadas <= n && pintadas < vista.length) masCeldas();
  const el = rej.children[n];
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) el.scrollIntoView({ block: 'center' });
}

function chips() {
  const nav = $('temas');
  ['Todo', ...TEMAS].forEach((t, k) => {
    const b = document.createElement('button');
    b.textContent = t;
    b.setAttribute('aria-pressed', k === 0);
    b.onclick = () => {
      tema = k - 1;
      [...nav.children].forEach((c, j) => c.setAttribute('aria-pressed', j === k));
      filtrar();
    };
    nav.appendChild(b);
  });
}

function reiniciarFiltros() {
  tema = -1; q = ''; $('q').value = '';
  [...$('temas').children].forEach((c, j) => c.setAttribute('aria-pressed', j === 0));
  filtrar();
}

let tq;
$('q').addEventListener('input', e => {
  clearTimeout(tq);
  tq = setTimeout(() => { q = e.target.value; filtrar(); }, 160);
});
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
// scroll como base y el observador como refuerzo (con el panel oculto o en
// segundo plano el observador puede no avisar)
addEventListener('scroll', llenar, { passive: true });
if ('IntersectionObserver' in window) {
  new IntersectionObserver(es => { if (es[0].isIntersecting) llenar(); },
                           { rootMargin: '1500px' }).observe($('mas'));
}

/* -------------------------------------------------------------- visor */
const v = $('v'), vi = $('vi');
let cur = -1, tok = 0, uiOff = false;
let nw = 1, nh = 1;                    // tamaño del fichero
let W = 1, H = 1, fw = 1, fh = 1;      // pantalla y tamaño ajustado (zoom 1)
let s = 1, tx = 0, ty = 0;             // zoom y posición

const maxS = () => Math.min(8, Math.max(3.5, (nw / fw) * 1.6));

function apply() {
  vi.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
  v.classList.toggle('sinui', uiOff || s > 1.05);
}

function limitar() {
  const sw = fw * s, sh = fh * s;
  tx = sw <= W ? (W - sw) / 2 : clamp(tx, W - sw, 0);
  ty = sh <= H ? (H - sh) / 2 : clamp(ty, H - sh, 0);
}

function ajustar() {
  H = v.clientHeight;
  // en horizontal la ficha es un panel lateral: el cuadro se encaja en lo que queda
  const lado = !ficha.hidden && ficha.offsetHeight > H * 0.9 ? ficha.offsetWidth : 0;
  W = v.clientWidth - lado;
  const k = Math.min(W / nw, H / nh, 2);
  fw = nw * k; fh = nh * k;
  vi.style.width = fw + 'px';
  vi.style.height = fh + 'px';
  limitar();
  apply();
}

function anim(fn) {
  vi.style.transition = 'transform .24s ease';
  fn(); limitar(); apply();
  setTimeout(() => { vi.style.transition = ''; }, 280);
}

function zoomEn(x, y, ns) {
  const r = ns / s;
  tx = x - (x - tx) * r;
  ty = y - (y - ty) * r;
  s = ns;
  limitar();
}

function mostrar() {
  const o = O[vista[cur]], mi = ++tok;
  nw = o.w; nh = o.h; s = 1;
  vi.alt = o.t;
  vi.removeAttribute('src');
  let grande = false;
  urlImg('th', o).then(u => { if (mi === tok && !grande) vi.src = u; }).catch(() => {});
  urlImg('img', o).then(u => {
    if (mi !== tok) return;
    const g = new Image();
    g.onload = () => { if (mi === tok) { grande = true; vi.src = u; } };
    g.src = u;
  }).catch(() => {});
  [1, -1].forEach(d => {
    const p = O[vista[(cur + d + vista.length) % vista.length]];
    if (p) urlImg('img', p).catch(() => {});
  });
  $('vt').textContent = o.t;
  $('va').textContent = [o.a, o.f].filter(Boolean).join(' · ');
  $('pos').textContent = (cur + 1) + ' / ' + vista.length;
  cerrarFicha();
  ajustar();
}

function hashId() {
  const m = /^#o=([0-9a-f]{8})$/.exec(location.hash);
  return m && m[1];
}

function abrir(n) {
  const nuevo = v.hidden;
  cur = n;
  if (nuevo) {
    v.hidden = false;
    document.body.classList.add('abierto');
    uiOff = false;
  }
  mostrar();
  const url = '#o=' + O[vista[cur]].i;
  if (nuevo) history.pushState({ v: 1 }, '', url);
  else history.replaceState({ v: 1 }, '', url);
}

function ocultar() {
  if (v.hidden) return;
  v.hidden = true;
  document.body.classList.remove('abierto');
  tok++;
  vi.removeAttribute('src');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  asegurar(cur);
}

function cerrar() {
  if (v.hidden) return;
  if (history.state && history.state.v) history.back();
  else { ocultar(); history.replaceState(null, '', location.pathname + location.search); }
}

function ir(d) {
  if (!vista.length) return;
  cur = (cur + d + vista.length) % vista.length;
  mostrar();
  history.replaceState({ v: 1 }, '', '#o=' + O[vista[cur]].i);
  vi.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 200 });
}

function abrirPorId(id) {
  let n = vista.findIndex(i => O[i].i === id);
  if (n < 0) {
    if (!O.some(o => o.i === id)) return false;
    reiniciarFiltros();
    n = vista.findIndex(i => O[i].i === id);
  }
  abrir(n);
  return true;
}

addEventListener('popstate', () => {
  const id = hashId();
  if (!id) ocultar();
  else if (v.hidden || O[vista[cur]].i !== id) abrirPorId(id);
});

rej.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  abrir(+a.dataset.n);
});

$('bx').onclick = cerrar;
$('ant').onclick = () => ir(-1);
$('sig').onclick = () => ir(1);

/* pantalla completa (Android y escritorio; el iPhone no la ofrece) */
if (document.fullscreenEnabled) $('bf').hidden = false;
$('bf').onclick = async () => {
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    await v.requestFullscreen();
    const o = O[vista[cur]];
    try { await screen.orientation.lock(o.w >= o.h ? 'landscape' : 'portrait'); } catch (_) {}
  } catch (_) {}
};
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) { try { screen.orientation.unlock(); } catch (_) {} }
  setTimeout(ajustar, 120);
});

/* al girar el móvil se vuelve a encajar el cuadro; un cambio pequeño
   (barra del navegador) conserva el zoom */
let ultW = innerWidth, ultH = innerHeight;
addEventListener('resize', () => {
  if (v.hidden) return;
  if ((innerWidth > innerHeight) !== (ultW > ultH)) s = 1;
  ultW = innerWidth; ultH = innerHeight;
  ajustar();
});

/* ------------------------------------------------------------- gestos */
const P = new Map();
let g = null, ult = null, tmr = 0;
const dist = p => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
const medio = p => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });

function ancla(movido) {
  const p = [...P.values()];
  g = { n: p.length, s0: s, tx0: tx, ty0: ty, moved: movido, eje: null, dx: 0, dy: 0 };
  if (p.length >= 2) { g.n = 2; g.d0 = dist(p) || 1; g.c0 = medio(p); g.moved = true; }
  else { g.x0 = p[0].x; g.y0 = p[0].y; }
}

v.addEventListener('pointerdown', e => {
  if (e.target.closest('button, #ficha')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  v.setPointerCapture(e.pointerId);
  vi.style.transition = '';
  P.set(e.pointerId, { x: e.clientX, y: e.clientY });
  ancla(g ? g.moved : false);
});

v.addEventListener('pointermove', e => {
  const p = P.get(e.pointerId);
  if (!p || !g) return;
  p.x = e.clientX; p.y = e.clientY;
  const pts = [...P.values()];
  if (g.n === 2 && pts.length >= 2) {                       // pellizco
    const c = medio(pts), ns = clamp(g.s0 * dist(pts) / g.d0, 1, maxS());
    tx = c.x - (g.c0.x - g.tx0) * (ns / g.s0);
    ty = c.y - (g.c0.y - g.ty0) * (ns / g.s0);
    s = ns; limitar(); apply();
    return;
  }
  if (g.n !== 1 || pts.length !== 1) return;
  const dx = p.x - g.x0, dy = p.y - g.y0;
  if (!g.moved) {
    if (Math.hypot(dx, dy) < 8) return;
    g.moved = true;
    v.classList.add('mueve');
  }
  if (s > 1.001) {                                          // arrastrar el cuadro ampliado
    tx = g.tx0 + dx; ty = g.ty0 + dy; limitar(); apply();
  } else {                                                  // cambiar de obra / cerrar
    if (!g.eje) g.eje = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    g.dx = dx; g.dy = dy;
    if (g.eje === 'x') tx = g.tx0 + dx; else ty = g.ty0 + Math.max(0, dy);
    apply();
  }
});

function fin(e) {
  if (!P.has(e.pointerId)) return;
  P.delete(e.pointerId);
  if (P.size > 0) { ancla(true); return; }
  const gg = g; g = null;
  v.classList.remove('mueve');
  if (!gg) return;
  if (s < 1.02) s = 1;
  if (e.type === 'pointercancel') { anim(() => {}); return; }
  if (gg.n === 1 && !gg.moved) { toque(e.clientX, e.clientY); return; }
  if (gg.n === 1 && gg.s0 <= 1.001 && s === 1) {
    if (gg.eje === 'x' && Math.abs(gg.dx) > Math.min(90, W * 0.18)) { ir(gg.dx < 0 ? 1 : -1); return; }
    if (gg.eje === 'y' && gg.dy > 110) { cerrar(); return; }
  }
  anim(() => {});
}
v.addEventListener('pointerup', fin);
v.addEventListener('pointercancel', fin);

function toque(x, y) {
  const t = performance.now();
  if (ult && t - ult.t < 300 && Math.hypot(x - ult.x, y - ult.y) < 40) {
    clearTimeout(tmr); ult = null;
    if (s > 1.05) anim(() => { s = 1; });
    else anim(() => zoomEn(x, y, Math.min(maxS(), 2.6)));
    return;
  }
  ult = { t, x, y };
  tmr = setTimeout(() => {
    ult = null;
    if (!$('ficha').hidden) cerrarFicha();
    else { uiOff = !uiOff; apply(); }
  }, 280);
}

v.addEventListener('wheel', e => {
  if (e.target.closest('#ficha')) return;
  e.preventDefault();
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018));
  vi.style.transition = '';
  zoomEn(e.clientX, e.clientY, clamp(s * f, 1, maxS()));
  apply();
}, { passive: false });

document.addEventListener('keydown', e => {
  if (v.hidden || e.target === $('q')) return;
  const k = e.key;
  if (k === 'Escape') { if (!$('ficha').hidden) cerrarFicha(); else cerrar(); }
  else if (k === 'ArrowRight') ir(1);
  else if (k === 'ArrowLeft') ir(-1);
  else if (k === '+' || k === '=') anim(() => zoomEn(W / 2, H / 2, clamp(s * 1.5, 1, maxS())));
  else if (k === '-') anim(() => zoomEn(W / 2, H / 2, clamp(s / 1.5, 1, maxS())));
  else if (k === '0') anim(() => { s = 1; });
  else if (k === 'i') $('bi').click();
  else if (k === 'f' && !$('bf').hidden) $('bf').click();
  else return;
  e.preventDefault();
});

/* -------------------------------------------------------------- ficha */
let fichasP = null;
const ficha = $('ficha');

function cerrarFicha() {
  if (ficha.hidden) return;
  ficha.hidden = true;
  if (!v.hidden) ajustar();
}

function el(tag, txt, cls) {
  const e = document.createElement(tag);
  if (txt) e.textContent = txt;
  if (cls) e.className = cls;
  return e;
}

$('fx').onclick = cerrarFicha;
$('bi').onclick = async () => {
  if (!ficha.hidden) { cerrarFicha(); return; }
  const o = O[vista[cur]], mi = tok;
  fichasP = fichasP || datosCifrados('f.bin').catch(() => ({}));
  const f = (await fichasP)[o.i] || [];
  if (mi !== tok || v.hidden) return;
  const c = $('fc');
  c.textContent = '';
  c.append(el('h2', o.t), el('p', [o.a, o.f].filter(Boolean).join(', '), 'au'));
  const dl = el('dl');
  [['Museo', o.s], ['Estilo', o.e], ['Tema', TEMA_LARGO[o.m]]].forEach(([k, val]) => {
    if (val && val[0] !== '(') dl.append(el('dt', k), el('dd', val));
  });
  c.append(dl);
  [['Qué se ve', f[0]], ['Dato curioso', f[1]], ['La obra', f[2]]].forEach(([k, t]) => {
    if (t) c.append(el('h3', k), el('p', t));
  });
  c.append(el('h3', 'Nota'), el('p', 'Textos redactados con IA; pueden contener errores.'));
  ficha.hidden = false;
  ficha.scrollTop = 0;
  ajustar();
};

/* ------------------------------------------------------------- arranque */
$('bloq').onclick = () => { try { localStorage.removeItem('cuadros-k'); } catch (_) {} location.reload(); };
chips();
desbloquear()
  .then(() => datosCifrados('d.bin'))
  .then(d => {
    O = d;
    O.forEach(o => { o._b = norm([o.t, o.a, o.s, o.e, o.f].join(' ')); });
    document.body.classList.remove('cargando');
    filtrar();
    const id = hashId();
    if (id) abrirPorId(id);
  })
  .catch(() => {
    document.body.classList.remove('cargando');
    $('candado').hidden = true;
    $('vacio').textContent = 'No se pudo cargar. Comprueba la conexión y vuelve a intentarlo.';
    $('vacio').hidden = false;
  });
})();
