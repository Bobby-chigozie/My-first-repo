'use strict';
/* AI Car Doctor — scanner.js
   "Scan car" for the Android app. Talks to a paired Bluetooth OBD-II adapter through the
   native ObdBluetooth plugin (ObdBluetoothPlugin.java), reads stored + pending trouble codes,
   then fills the code box and runs the normal diagnosis.
   In a normal browser (no native plugin) it only shows a short note. */
(function () {
  const isNative = !!(window.Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
  const firstCard = document.querySelector('section.card');
  if (!firstCard) return;

  const card = document.createElement('section');
  card.className = 'card';
  card.id = 'scanCard';
  firstCard.parentNode.insertBefore(card, firstCard);

  if (!isNative) {
    card.innerHTML = '<h2>Scan car</h2><p class="muted" style="margin:0">Car scanning works only in the AI Car Doctor Android app. In a web browser you can still type codes below.</p>';
    return;
  }

  card.innerHTML =
    '<h2>Scan car</h2>' +
    '<div class="field"><label for="adapterSel">Bluetooth adapter (paired in Android settings)</label><select id="adapterSel"><option value="">Looking for paired devices…</option></select></div>' +
    '<div class="actions"><button class="primary" id="scanBtn" type="button">Scan car</button><button class="secondary" id="clearCodesBtn" type="button">Clear codes</button><button class="secondary" id="refreshBtn" type="button">Refresh list</button></div>' +
    '<p id="scanStatus" class="hint" role="status">Plug the adapter into the car and turn the ignition ON (engine can be off). Keep the car parked.</p>' +
    '<pre id="scanLog" class="small" style="display:none;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto;background:#091625;border:1px solid #3a536d;border-radius:10px;padding:8px;margin:8px 0 0"></pre>';

  const $ = id => document.getElementById(id);
  const sel = $('adapterSel'), btn = $('scanBtn'), statusEl = $('scanStatus'), logEl = $('scanLog');
  const Obd = Capacitor.registerPlugin('ObdBluetooth');
  let OBD = window.OBD, busy = false, connectedAddr = null, isCan = null;

  const setButtons = d => { btn.disabled = d; $('clearCodesBtn').disabled = d; };
  const say = (t, cls) => { statusEl.textContent = t; statusEl.style.color = cls === 'bad' ? '#ffb4a8' : cls === 'ok' ? '#92f3d7' : ''; };
  const log = t => { logEl.style.display = 'block'; logEl.textContent += t + '\n'; logEl.scrollTop = logEl.scrollHeight; };
  const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + ' did not load')); document.head.appendChild(s); });
  const saved = () => { try { return localStorage.getItem('acd_adapter') || ''; } catch (e) { return ''; } };
  const save = a => { try { localStorage.setItem('acd_adapter', a); } catch (e) { /* ignore */ } };

  async function send(cmd, ms) {
    log('> ' + cmd);
    const r = await Obd.send({ command: cmd, timeoutMs: ms || 5000 });
    log('< ' + JSON.stringify(r.response));
    return r.response || '';
  }

  async function refresh() {
    try {
      const r = await Obd.listPaired();
      const list = r.devices || [];
      sel.innerHTML = '';
      if (!list.length) { sel.add(new Option('No paired devices found', '')); say('No paired Bluetooth devices. Pair the adapter in Android Bluetooth settings first, then tap Refresh list.', 'bad'); return; }
      list.forEach(d => sel.add(new Option((d.name || 'Unnamed') + '  (' + d.address + ')', d.address)));
      // Auto-pick: last used adapter, else a device that looks like an OBD adapter (e.g. 12-digit name, OBD, ELM, vLinker)
      const want = saved();
      let pick = list.find(d => d.address === want) || list.find(d => /^\d{10,14}$/.test(d.name || '') || /obd|elm|vlink|scan|v-?link|icar|veepeak/i.test(d.name || ''));
      if (pick) sel.value = pick.address;
      say('Ready. Tap "Scan car".', '');
    } catch (e) {
      sel.innerHTML = ''; sel.add(new Option('Bluetooth not available', ''));
      say(e.message || String(e), 'bad');
    }
  }

  async function ensureConnected(addr) {
    if (connectedAddr === addr) return;
    if (connectedAddr) { try { await Obd.disconnect(); } catch (e) { /* ignore */ } connectedAddr = null; }
    say('Connecting to adapter…', '');
    await Obd.connect({ address: addr });
    connectedAddr = addr; save(addr);
  }

  // Connect, check the adapter, check the car. Throws a plain-English Error if anything fails.
  async function prepare() {
    if (!OBD) { await load('obd.js'); OBD = window.OBD; }
    const addr = sel.value;
    if (!addr) throw new Error('Choose your adapter first. If the list is empty, pair it in Android Bluetooth settings, then tap Refresh list.');
    try { await ensureConnected(addr); }
    catch (e) { connectedAddr = null; throw new Error('Could not connect to the adapter (' + (e.message || e) + '). Check it is plugged in and powered, and not connected to another app such as DiagZone.'); }

    // 1. Does the ADAPTER answer?
    say('Checking the adapter…', '');
    const z = OBD.classify(await send('ATZ', 4000));
    const id = z.kind === 'adapter-id' ? z : OBD.classify(await send('ATI', 3000));
    if (id.kind !== 'adapter-id') {
      throw new Error(z.kind === 'empty'
        ? 'Connected, but the adapter did not reply. It may use its own private protocol (some branded scanners only work with their own app), so this app cannot read it.'
        : 'Connected, but the adapter did not reply like a standard ELM327 (' + z.text + '). It may use a private protocol that this app cannot read.');
    }
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0']) await send(c, 2500);

    // 2. Does the CAR answer?
    say('Adapter OK. Asking the car… (up to 15 seconds)', '');
    const r0100 = await send('0100', 15000);
    const c0100 = OBD.classify(r0100);
    if (!(c0100.kind === 'data' && /41\s*00/i.test(r0100.replace(/\s+/g, ' ')))) {
      throw new Error(c0100.kind === 'vehicle-error'
        ? 'The adapter works but the car did not answer (' + c0100.text + '). Turn the ignition ON, push the adapter in firmly, and try again.'
        : 'The adapter works but the car gave no clear answer. Turn the ignition ON and try again.');
    }
    const pn = await send('ATDPN', 2500); isCan = OBD.protocolIsCan(pn);
  }

  async function scan() {
    if (busy) return;
    busy = true; setButtons(true); logEl.textContent = '';
    try {
      await prepare();

      // 3. Read codes (read only; nothing is cleared)
      say('Car answered. Reading trouble codes…', '');
      const rStored = await send('03', 15000);
      if (OBD.classify(rStored).kind === 'vehicle-error') throw new Error('The car stopped answering while reading codes. Try again.');
      const stored = OBD.parseStoredDtcs(rStored, isCan === true);
      let pending = [];
      try { pending = OBD.parsePendingDtcs(await send('07', 10000), isCan === true).filter(c => !stored.includes(c)); } catch (e) { /* optional */ }

      const all = [...stored, ...pending];
      if (!all.length) {
        $('codes').value = '';
        say('Car answered and reports NO stored or pending trouble codes.', 'ok');
        return;
      }
      $('codes').value = all.join(', ');
      say('Scan complete. Stored codes: ' + (stored.join(', ') || 'none') + '. Pending codes: ' + (pending.join(', ') || 'none') + '. Report below.', 'ok');
      $('runBtn').click();
    } catch (e) {
      say(e.message || String(e), 'bad');
    } finally {
      busy = false; setButtons(false);
    }
  }

  // Clear codes (OBD service 04). Always asks first.
  async function clearCodes() {
    if (busy) return;
    const ok = window.confirm('Clear trouble codes?\n\n• Write down or scan the codes FIRST. They will be erased.\n• Freeze-frame data is erased and the emissions readiness tests reset.\n• The check-engine light comes back if the fault is still there.\n• Ignition ON, engine OFF, car parked.\n\nClear now?');
    if (!ok) { say('Cancelled. Nothing was cleared.', ''); return; }
    busy = true; setButtons(true); logEl.textContent = '';
    try {
      await prepare();
      say('Clearing codes…', '');
      const r = await send('04', 10000);
      if (/(^|\s)44(\s|$)/.test(r.replace(/[\r\n>]+/g, ' ').trim() + ' ')) {
        say('Done. The car accepted the clear command. Run "Scan car" again to confirm. If a code returns, the fault is still there.', 'ok');
        $('codes').value = '';
      } else {
        throw new Error('The car did not accept the clear command (' + (OBD.classify(r).text || 'no answer') + '). Some cars only allow it with the ignition ON and the engine OFF.');
      }
    } catch (e) {
      say(e.message || String(e), 'bad');
    } finally {
      busy = false; setButtons(false);
    }
  }

  btn.addEventListener('click', scan);
  $('clearCodesBtn').addEventListener('click', clearCodes);
  $('refreshBtn').addEventListener('click', refresh);
  refresh();
})();
