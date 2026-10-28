'use strict';
/* AI Car Doctor — obd.js
   Small helpers for ELM327-style adapters: classify replies and decode Mode 03 (stored DTC) replies.
   Used by bluetooth_test.html. Works in a browser and in Node (for testing). */
(function (root) {
  const ELM_ERRORS = ['UNABLE TO CONNECT', 'NO DATA', 'BUS INIT', 'CAN ERROR', 'BUS BUSY', 'BUS ERROR', 'DATA ERROR', 'FB ERROR', 'LV RESET', 'STOPPED', 'ERROR'];

  function lines(raw) {
    return String(raw).replace(/>/g, '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  }

  // Returns {kind, text}. kind: 'empty' | 'unknown-command' | 'adapter-id' | 'searching' | 'vehicle-error' | 'data'
  function classify(raw) {
    const ls = lines(raw);
    if (!ls.length) return { kind: 'empty', text: 'No reply from the adapter.' };
    const joined = ls.join(' ').toUpperCase();
    if (/ELM3\d\d|ELM\s?327|OBDII|OBD II/.test(joined) && !/^[0-9A-F ]+$/.test(joined)) return { kind: 'adapter-id', text: ls.join(' ') };
    for (const e of ELM_ERRORS) if (joined.includes(e)) return { kind: 'vehicle-error', text: e + ' (the adapter answered, but the vehicle did not)' };
    if (ls.length === 1 && ls[0] === '?') return { kind: 'unknown-command', text: 'Adapter did not understand the command.' };
    if (/^OK$/.test(joined)) return { kind: 'ok', text: 'OK' };
    if (/SEARCHING/.test(joined) && ls.every(l => /SEARCHING|^[\.\s]*$/i.test(l))) return { kind: 'searching', text: 'Adapter is searching for a protocol.' };
    return { kind: 'data', text: ls.join(' / ') };
  }

  function bytesOfLine(l) {
    const hex = l.replace(/[^0-9A-Fa-f]/g, '');
    const out = [];
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
    return out;
  }

  // Splits a multi-line reply into messages (handles "0:", "1:" continuation lines of CAN multi-frame replies).
  function messages(raw) {
    const msgs = [];
    let cur = null;
    for (const l of lines(raw)) {
      if (!/^[0-9A-Fa-f: ]+$/.test(l)) continue; // skip text lines such as SEARCHING...
      const m = l.match(/^([0-9A-Fa-f]{1,2}):\s*(.*)$/);
      if (m) {
        if (!cur) { cur = []; msgs.push(cur); }
        cur.push(...bytesOfLine(m[2]));
      } else if (/^[0-9A-Fa-f]{3}$/.test(l)) {
        cur = []; msgs.push(cur); // length line of a multi-frame reply
      } else {
        cur = null; msgs.push(bytesOfLine(l));
      }
    }
    return msgs.filter(m => m.length);
  }

  function decodeDtc(a, b) {
    return ['P', 'C', 'B', 'U'][a >> 6] + ((a >> 4) & 3) + (a & 15).toString(16).toUpperCase() + b.toString(16).toUpperCase().padStart(2, '0');
  }

  // isCan: true for ISO 15765 (CAN) protocols, where a count byte follows 0x43.
  function parseDtcs(raw, isCan, header) {
    const found = [];
    for (const msg of messages(raw)) {
      const i = msg.indexOf(header);
      if (i < 0) continue;
      let p = msg.slice(i + 1);
      if (isCan && p.length % 2 === 1) p = p.slice(1); // drop the count byte
      for (let k = 0; k + 1 < p.length; k += 2) {
        if (p[k] === 0 && p[k + 1] === 0) continue;
        found.push(decodeDtc(p[k], p[k + 1]));
      }
    }
    return [...new Set(found)];
  }
  function parseStoredDtcs(raw, isCan) { return parseDtcs(raw, isCan, 0x43); }
  function parsePendingDtcs(raw, isCan) { return parseDtcs(raw, isCan, 0x47); }

  // Protocol number from ATDPN reply, e.g. "A6" -> 6
  function protocolIsCan(atdpn) {
    const m = String(atdpn).replace(/[^0-9A-Fa-f]/g, '').match(/([0-9A-Fa-f])$/);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return n >= 6 && n <= 9; // ELM327 protocols 6-9 are ISO 15765-4 CAN
  }

  const api = { classify, parseStoredDtcs, parsePendingDtcs, decodeDtc, messages, protocolIsCan, lines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OBD = api;
})(typeof window !== 'undefined' ? window : globalThis);
