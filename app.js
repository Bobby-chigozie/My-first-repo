'use strict';
/* =========================================================
   AI CAR DOCTOR — app.js (application logic)
   The OBD-II code database now lives in dtc-database.js
   (loaded before this file by index.html). Edit codes there.
   ========================================================= */
/* Loads dtc-database.js by itself, so index.html does not need to change. */
(function () {
  function say(msg) { const s = document.getElementById('status'); if (s) s.textContent = msg; }
  if (typeof DTC_DATABASE !== 'undefined') { startApp(); return; }
  const sc = document.createElement('script');
  sc.src = 'dtc-database.js';
  sc.onload = startApp;
  sc.onerror = () => say('Database file dtc-database.js did not load. Put it in the same folder as index.html.');
  document.head.appendChild(sc);
})();

function startApp() {
const VEHICLES = {"Acura":["ILX","MDX","RDX","TL","TLX","TSX","Integra"],"Audi":["A3","A4","A6","Q3","Q5","Q7"],"BMW":["1 Series","3 Series","5 Series","X1","X3","X5"],"Chevrolet":["Aveo","Camaro","Cruze","Malibu","Spark"],"Ford":["Fiesta","Focus","Fusion","Escape","Explorer","Ranger"],"Honda":["Accord","Civic","CR-V","Fit","HR-V","Pilot"],"Hyundai":["Accent","Elantra","Santa Fe","Sonata","Tucson"],"Kia":["Cerato/Forte","Rio","Sportage","Sorento"],"Lexus":["ES","GS","IS","RX","NX"],"Mazda":["Mazda 2","Mazda 3","Mazda 6","CX-5"],"Mercedes-Benz":["C-Class","E-Class","GLA","GLC","GLE"],"Mitsubishi":["Lancer","Outlander","Pajero"],"Nissan":["Altima","Maxima","Pathfinder","Sentra","Sunny","X-Trail"],"Subaru":["Forester","Impreza","Legacy","Outback"],"Suzuki":["Swift","Vitara","Jimny"],"Toyota":["4Runner","Avalon","Camry","Corolla","Highlander","Hilux","Land Cruiser","Prius","RAV4","Sienna","Yaris"],"Volkswagen":["Golf","Jetta","Passat","Polo","Tiguan"],"Other / not listed":["Other"]};

const $ = id => document.getElementById(id),
  make = $('make'), model = $('model'), codeInput = $('codes'),
  statusBox = $('status'), results = $('results'), report = $('reportContent');

function opt(label, value = label) { const o = document.createElement('option'); o.textContent = label; o.value = value; return o; }
Object.keys(VEHICLES).sort().forEach(m => make.appendChild(opt(m)));
make.addEventListener('change', () => {
  model.innerHTML = '';
  model.appendChild(opt(VEHICLES[make.value] ? 'Select model' : 'Select make first', ''));
  (VEHICLES[make.value] || []).forEach(m => model.appendChild(opt(m)));
  model.disabled = !make.value;
});

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- what the code NUMBER itself tells us (SAE J2012 structure) ---------- */
function codeStructure(code) {
  const letter = code[0], d1 = code[1], d2 = code[2];
  const prefix = { P: 'Powertrain', B: 'Body', C: 'Chassis', U: 'Network/communication' }[letter];
  let kind = 'unknown', kindText = '';
  if (letter === 'P') {
    const n = parseInt(code.slice(1), 16);
    if (d1 === '0' || d1 === '2' || (d1 === '3' && n >= 0x3400)) kind = 'generic';
    else kind = 'manufacturer';
  } else {
    kind = d1 === '0' ? 'generic' : (d1 === '3' ? 'unknown' : 'manufacturer');
  }
  if (kind === 'generic') kindText = 'The first digits mark this as a generic (SAE-defined) code range, so the basic meaning should be the same on all makes, but this app has no verified entry for it.';
  else if (kind === 'manufacturer') kindText = 'The first digits mark this as a manufacturer-specific code range: the meaning depends on make, model, year and engine, so it must be looked up for the exact vehicle.';
  else kindText = 'This code falls in a reserved or unclear range; confirm the meaning with a trusted diagnostic database.';
  let system = '';
  if (letter === 'P') {
    if (code.slice(1, 3) === '0A') system = 'Hybrid propulsion system';
    else if (d1 === '0' || d1 === '1') {
      system = { '0': 'Fuel and air metering, auxiliary emission controls', '1': 'Fuel and air metering', '2': 'Fuel and air metering (injector circuits)', '3': 'Ignition system or misfire', '4': 'Auxiliary emission controls', '5': 'Vehicle speed, idle control and auxiliary inputs', '6': 'Computer and output circuits', '7': 'Transmission', '8': 'Transmission', '9': 'Transmission' }[d2] || '';
    }
  } else if (letter === 'U') system = 'Vehicle network / module communication';
  else if (letter === 'C') system = 'Chassis (brakes, steering, suspension)';
  else if (letter === 'B') system = 'Body (airbags, lighting, comfort systems)';
  return { prefix, kind, kindText, system };
}

function fallback(code) {
  const s = codeStructure(code);
  return {
    title: 'Code not found in the installed offline database.',
    causes: 'AI Car Doctor has no verified definition for ' + code + ', so it will not guess a cause. ' + s.kindText + ' Do not infer a failed part from the code alone.',
    symptoms: 'Unknown without the exact definition.' + (s.system ? ' From the code range, this is in the "' + s.system + '" area.' : ''),
    checks: 'Look up the exact definition for this make, model, year and engine in OEM service information or a trusted diagnostic database. Record freeze-frame data before clearing anything, check for related codes, and check for technical service bulletins.',
    repair: 'No repair direction is given until the definition is verified.',
    prevention: 'Follow the manufacturer maintenance schedule and repair confirmed faults promptly.',
    note: s.prefix + ' code. Do not guess; confirm with vehicle service information.',
    type: s.kind
  };
}
function getCode(c) { return DTC_DATABASE[c] || fallback(c); }

function vehicleLine() {
  return [make.value, model.value, $('year').value.trim(), $('engine').value.trim()].filter(Boolean).join(' ');
}

function card(c) {
  const known = !!DTC_DATABASE[c], d = getCode(c), s = codeStructure(c);
  const kind = d.type || s.kind;
  const badge = kind === 'manufacturer' ? 'Manufacturer-specific: meaning varies by vehicle' : kind === 'generic' ? 'Generic OBD-II code' : 'Range unclear';
  const sys = s.system ? ` <span class="muted small">• ${esc(s.system)}</span>` : '';
  const v = vehicleLine();
  let ctx = '';
  if (known && v && (kind === 'manufacturer' || /bank|sensor|cylinder/i.test(d.title))) {
    ctx = `<p class="muted small" style="margin-top:6px">Vehicle context (${esc(v)}): bank, sensor and cylinder numbering, and any maker-specific wording, depend on the exact engine. Confirm them in the service manual before testing.</p>`;
  }
  return `<article class="section"><span class="code">${esc(c)}</span> <span class="muted small">${known ? 'Built-in reference' : 'Needs verified lookup'}</span> <span class="tag ${kind}">${esc(badge)}</span>${sys}<div class="title">${esc(d.title)}</div>`
    + `<div class="section"><h3>Possible causes</h3><p>${esc(d.causes)}</p></div>`
    + `<div class="section"><h3>Possible symptoms</h3><p>${esc(d.symptoms)}</p></div>`
    + `<div class="section"><h3>Recommended checks</h3><p>${esc(d.checks)}</p></div>`
    + (d.repair ? `<div class="section"><h3>Repair direction</h3><p>${esc(d.repair)}</p></div>` : '')
    + `<div class="section"><h3>Prevention</h3><p>${esc(d.prevention)}</p></div>`
    + `<div class="section warn"><h3>Precautions / verification</h3><p>${esc(d.note)}</p>${ctx}</div></article>`;
}

function diagnose() {
  try {
    const raw = codeInput.value.trim();
    results.style.display = 'none';
    if (!raw) { statusBox.textContent = 'Enter a code, for example P0301.'; codeInput.focus(); return; }
    const codes = [...new Set(raw.toUpperCase().match(/[PBCU][0-3][0-9A-F]{3}/g) || [])];
    if (!codes.length) { statusBox.textContent = 'No code recognized. Use a format like P0301, B1234, C1234 or U0100.'; return; }
    const year = $('year').value.trim();
    let warn = '';
    if (year && !/^(19|20)\d{2}$/.test(year)) warn = ' Note: the year "' + year + '" does not look like a 4-digit year.';
    else if (year && +year < 1996) warn = ' Note: vehicles before about 1996 may not use standard OBD-II codes.';
    $('vehicleSummary').textContent = vehicleLine() || 'Vehicle not specified';
    report.innerHTML = codes.map(card).join('');
    const symptom = $('symptoms').value.trim();
    if (symptom) report.insertAdjacentHTML('afterbegin', `<div class="section"><h3>Reported symptoms</h3><p>${esc(symptom)}</p><p class="muted small">Symptoms are context, not proof of a failed part.</p></div>`);
    report.insertAdjacentHTML('beforeend', `<div class="section warn"><h3>Before repairs</h3><p>Record codes and freeze-frame data before clearing them. A code often identifies a system or circuit, not automatically a failed part, so test before replacing parts. If the engine overheats, an oil-pressure warning appears, fuel is leaking, brakes or steering are affected, or the check-engine light flashes with severe shaking, stop safely and seek qualified help.</p></div>`);
    results.style.display = 'block';
    const known = codes.filter(c => DTC_DATABASE[c]).length;
    statusBox.textContent = `Diagnosis complete: ${codes.length} code(s) processed offline (${known} found in the database, ${codes.length - known} not found).` + warn;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { statusBox.textContent = 'Diagnostic error: ' + e.message; console.error(e); }
}
$('runBtn').addEventListener('click', diagnose);
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); diagnose(); } });
$('sampleBtn').addEventListener('click', () => {
  codeInput.value = 'P0301';
  if (!make.value) { make.value = 'Toyota'; make.dispatchEvent(new Event('change')); model.value = 'Camry'; }
  diagnose();
});
$('clearBtn').addEventListener('click', () => {
  codeInput.value = ''; $('symptoms').value = ''; $('year').value = ''; $('engine').value = '';
  results.style.display = 'none'; report.innerHTML = '';
  statusBox.textContent = 'Cleared. Enter a code and tap Diagnose codes.'; codeInput.focus();
});
$('copyBtn').addEventListener('click', async () => {
  const t = 'AI Car Doctor report\n' + $('vehicleSummary').innerText + '\n\n' + report.innerText;
  try { await navigator.clipboard.writeText(t); statusBox.textContent = 'Report copied.'; }
  catch (e) {
    const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select();
    const ok = document.execCommand('copy'); a.remove();
    statusBox.textContent = ok ? 'Report copied.' : 'Copy unavailable; select report text manually.';
  }
});
const dbCount = $('dbCount');
if (dbCount) dbCount.textContent = Object.keys(DTC_DATABASE).length + ' codes in the local database';
/* Optional: open the page with ?codes=P0133,P0498 (used by bluetooth_test.html) to prefill and run a diagnosis. */
try {
  const q = new URLSearchParams(location.search).get('codes');
  if (q) { codeInput.value = q.split(',').join(', '); diagnose(); }
} catch (e) { /* ignore */ }

/* Keep the old HTML working: update the notice, add tag styles. */
(function () {
  const css = document.createElement('style');
  css.textContent = '.tag{display:inline-block;border-radius:99px;padding:2px 9px;font-size:.74rem;font-weight:700;margin-left:4px}.tag.generic{background:#15463e;color:#92f3d7}.tag.manufacturer{background:#4a3a14;color:#ffd37d}.tag.unknown{background:#3a3a3a;color:#ddd}';
  document.head.appendChild(css);
  const NOTICE = 'AI Car Doctor is an offline generic OBD-II reference with broad but not exhaustive code coverage. Manufacturer-specific definitions and vehicle-specific procedures may vary. Confirm diagnostic findings using vehicle service information and proper testing. A trouble code does not automatically prove that a particular component has failed.';
  document.querySelectorAll('section.card').forEach(sec => {
    const h = sec.querySelector('h2');
    if (h && /Important (limits|notice)/i.test(h.textContent)) { h.textContent = 'Important notice'; const p = sec.querySelector('p'); if (p) p.textContent = NOTICE; }
  });
  const foot = document.querySelector('p.muted.small[style*="center"]');
  if (foot && !document.getElementById('dbCount')) foot.textContent = 'AI Car Doctor • Offline reference database • ' + Object.keys(DTC_DATABASE).length + ' codes';
})();
}
