import { stamp } from './engine.mjs';

// These hosts are deliberately constants. There is no live-trading URL setting.
export const PAPER_URL = 'https://paper-api.alpaca.markets';
export const DATA_URL = 'https://data.alpaca.markets';
export const UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL'];

export class ProviderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function symbols(input = UNIVERSE) {
  const list = Array.isArray(input) ? input : String(input).split(',').map(s => s.trim().toUpperCase());
  if (!list.length || list.some(s => !UNIVERSE.includes(s))) throw Error('Choose stocks from AAPL, MSFT, NVDA, AMZN, META, GOOGL.');
  return [...new Set(list)];
}

export function regularBars(raw, calendar, now = Date.now()) {
  const sessions = new Map(calendar.map(d => [d.date, d]));
  return Object.entries(raw || {}).flatMap(([symbol, bars]) => bars.map(b => {
    const t = stamp(b.t), session = sessions.get(t.day);
    if (!session) return null;
    const [oh, om] = session.open.split(':').map(Number);
    const [ch, cm] = session.close.split(':').map(Number);
    const closeMinute = ch * 60 + cm - 570;
    if (t.minute < oh * 60 + om - 570 || t.minute + 5 > closeMinute || Date.parse(b.t) + 300000 > now) return null;
    return {symbol, timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, ...t, sessionCloseMinute: closeMinute};
  })).filter(Boolean).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.symbol.localeCompare(b.symbol));
}

export class Alpaca {
  #key; #secret; #fetch;
  constructor({key, secret, fetchImpl = fetch}) {
    if (!key || !secret || !/^[\x21-\x7e]{6,200}$/.test(key) || !/^[\x21-\x7e]{6,200}$/.test(secret)) throw Error('Enter a paper API key and secret, without spaces.');
    this.#key = key; this.#secret = secret; this.#fetch = fetchImpl;
  }
  async request(host, endpoint, {method = 'GET', body} = {}) {
    if (![PAPER_URL, DATA_URL].includes(host) || !endpoint.startsWith('/v2/') || endpoint.includes('://')) throw Error('Endpoint is not allowlisted.');
    if (host !== PAPER_URL && method !== 'GET') throw Error('Market data access is read-only.');
    let response;
    try {
      response = await this.#fetch(host + endpoint, {method, redirect: 'error', signal: AbortSignal.timeout(12000), headers: {'APCA-API-KEY-ID': this.#key, 'APCA-API-SECRET-KEY': this.#secret, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
    } catch { throw new ProviderError(0, 'Provider request timed out or connection failed. Order status may be uncertain; reconcile before retrying.'); }
    if (!response.ok) {
      // Never echo provider bodies: they may contain account details or submitted credentials.
      const message = ({401:'Paper credentials were rejected.',403:'This paper account or data feed is not permitted.',404:'Provider record not found.',422:'Provider rejected the order or request.',429:'Provider rate limit reached; wait before retrying.'})[response.status] || `Provider returned HTTP ${response.status}.`;
      throw new ProviderError(response.status, message);
    }
    if (response.status === 204) return null;
    return response.json();
  }
  account() { return this.request(PAPER_URL, '/v2/account'); }
  clock() { return this.request(PAPER_URL, '/v2/clock'); }
  positions() { return this.request(PAPER_URL, '/v2/positions'); }
  orders() { return this.request(PAPER_URL, '/v2/orders?status=all&limit=500&nested=true&direction=desc'); }
  order(id) { return this.request(PAPER_URL, '/v2/orders:by_client_order_id?client_order_id=' + encodeURIComponent(id)); }
  cancel(id) { return this.request(PAPER_URL, '/v2/orders/' + encodeURIComponent(id), {method: 'DELETE'}); }
  submit(order) { return this.request(PAPER_URL, '/v2/orders', {method:'POST', body:order}); }
  asset(symbol) { if (!UNIVERSE.includes(symbol)) throw Error('Unsupported stock'); return this.request(PAPER_URL, '/v2/assets/' + symbol); }
  calendar(start, end) { return this.request(PAPER_URL, '/v2/calendar?' + new URLSearchParams({start, end})); }
  quotes(list) { return this.request(DATA_URL, '/v2/stocks/quotes/latest?' + new URLSearchParams({symbols:symbols(list).join(','), feed:'iex'})); }

  async historical({start, end, stocks = UNIVERSE, adjustment = 'split', now = Date.now(), maxPages = 30, requireAll = true}) {
    const selected = symbols(stocks);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(start)) || Date.parse(start) > Date.parse(end) || Date.parse(end) > now || Date.parse(end) - Date.parse(start) > 120*86400000) throw Error('Choose a valid historical date range of at most 120 days, ending today or earlier.');
    if (!['raw','split'].includes(adjustment)) throw Error('Unsupported price adjustment');
    const calendar = await this.calendar(start, end);
    if (!calendar.length) throw Error('No exchange sessions in this date range.');
    const raw = {}; let token, page = 0;
    do {
      const query = new URLSearchParams({symbols:selected.join(','), timeframe:'5Min', start:start+'T00:00:00Z', end:new Date(Math.min(Date.parse(end+'T23:59:59Z'),now)).toISOString(), feed:'iex', adjustment, limit:'10000', sort:'asc'});
      if (token) query.set('page_token', token);
      const result = await this.request(DATA_URL, '/v2/stocks/bars?' + query);
      for (const [symbol, bars] of Object.entries(result.bars || {})) { if (!selected.includes(symbol)) throw Error('Provider returned an unexpected stock'); (raw[symbol] ??= []).push(...bars); }
      token = result.next_page_token;
      if (++page >= maxPages && token) throw Error('Dataset pagination limit reached; choose a shorter range. No partial data was loaded.');
    } while (token);
    const bars = regularBars(raw, calendar, now);
    const present = new Set(bars.map(b => b.symbol));
    const missing = selected.filter(s => !present.has(s));
    if (requireAll && missing.length) throw Error('No regular-session data for: ' + missing.join(', '));
    return {label:`Alpaca IEX · 5-minute · ${start} to ${end}`, synthetic:false, source:{provider:'Alpaca',feed:'iex',adjustment,downloadedAt:new Date(now).toISOString(),start,end,stocks:selected,calendar,notes:'Single-exchange prices/volume; not consolidated SIP. Current-symbol selection has survivorship bias.'}, bars};
  }
}
