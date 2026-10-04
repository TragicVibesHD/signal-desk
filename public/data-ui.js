const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);

export function publicDataControls(state){
 const j=state.dataJob||{},source=state.data.source,loaded=!state.data.synthetic&&source?.provider==='Yahoo Finance';
 const ready=j.status==='ready'&&j.source?.provider==='Yahoo Finance',same=loaded&&source.fingerprint===j.source?.fingerprint;
 const capital=state.paper.session?.capital??state.startingCash;
 return `<section class="panel"><div class="panel-head"><h2>Real stock market history</h2><span class="tag ${loaded?'blue':'gray'}">${loaded?'REAL DATA LOADED':'NO API KEY NEEDED'}</span></div><div class="panel-body">
 <p class="section-copy">Download public five-minute history for Apple, Microsoft, NVIDIA, Amazon, Meta and Alphabet. Use it for historical replay and strategy comparison.</p>
 ${loaded?`<div class="notice"><strong>${esc(source.provider)} · Five-minute OHLCV</strong><p>${esc(source.start)} – ${esc(source.end)}<br>${state.data.bars.toLocaleString()} recorded bars · ${state.data.sessions} sessions<br>${esc(source.stocks.join(', '))}</p><p class="help">Downloaded ${esc(new Date(source.downloadedAt).toLocaleString())}. Completed regular sessions only; missing bars are left missing. Replay starts with ${money(state.startingCash)}.</p></div>`:''}
 <button class="primary" data-paper-action="data/public" ${j.status==='loading'?'disabled':''}>${j.status==='loading'&&j.kind==='public'?'Downloading stock history…':'Download public stock history'}</button>
 ${j.status==='error'&&j.kind==='public'?`<div class="notice negative">${esc(j.error)}</div>`:''}
 ${ready?`<div class="notice"><strong>${same?'History loaded into replay':'Public history download ready'}</strong><p>${esc(j.label)} · ${j.bars.toLocaleString()} bars · ${j.sessions} sessions</p>${!same?`<button data-paper-action="data/load" data-archive-replay="true" data-capital="${capital}" ${state.running?'disabled':''}>Back up replay & load history</button><p class="help">Starts a paused ${money(capital)} replay. The current replay, including simulated positions, is backed up locally. Pause replay first. Your Alpaca paper account and completed results are separate.</p>`:''}</div>`:''}
 <p class="help">Yahoo Finance public chart data is historical input, not a live execution feed. Availability may change; exchange volume and price adjustments are not independently verified and do not match Alpaca IEX assumptions. Missing data and costs still matter. Raw history stays on this PC.</p>
 <p class="help"><a href="https://finance.yahoo.com/" target="_blank" rel="noreferrer">Yahoo Finance source</a> · Connect Alpaca below for IEX history matching the paper bot's feed.</p></div></section>`;
}
