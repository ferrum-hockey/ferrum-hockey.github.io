'use strict';
(() => {
  const source = 'https://mos.rhl.su/team/148/?season=64';
  function valid(data) {
    if (!data || data.source !== source || !Array.isArray(data.matches) || !data.matches.length || data.matches.length > 2000 || !Number.isFinite(Date.parse(data.checked_at))) return false;
    const seen = new Set();
    for (const m of data.matches) {
      if (!m || !/^https:\/\/mos\.rhl\.su\/match\/\d+\/$/.test(m.url) || seen.has(m.url)) return false;
      seen.add(m.url);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !/^\d{2}:\d{2}$/.test(m.time) || !Number.isFinite(Date.parse(`${m.date}T${m.time}:00+03:00`))) return false;
      if (![m.home,m.away].every(n=>typeof n === 'string' && n.length > 0 && n.length <= 100) || [m.home,m.away].filter(n=>n==='Феррум').length !== 1) return false;
      if (!['played','future','pending'].includes(m.status)) return false;
      if (m.status === 'played' ? !Array.isArray(m.score) || m.score.length !== 2 || !m.score.every(n=>Number.isInteger(n) && n>=0) : m.score !== null) return false;
      for (const logo of [m.home_logo,m.away_logo]) if (logo != null && !/^assets\/teams\/\d+\.png$/.test(logo)) return false;
      if (m.arena != null && (typeof m.arena !== 'string' || m.arena.length > 250)) return false;
    }
    const t = data.standings;
    return t && ['games','wins','draws','losses','goals_for','goals_against','points','place','teams'].every(k=>Number.isInteger(t[k]) && t[k]>=0) && t.games === t.wins+t.draws+t.losses && t.games === data.matches.filter(m=>m.score).length && t.place > 0 && t.place <= t.teams;
  }
  async function load(endpoint) {
    if (!endpoint) return null;
    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:') return null;
      const response = await fetch(url,{signal:AbortSignal.timeout(8000),credentials:'omit'});
      if (!response.ok) return null;
      const data = await response.json();
      return valid(data) ? data : null;
    } catch { return null; }
  }
  window.FerrumMatchSource = {load,valid};
})();
