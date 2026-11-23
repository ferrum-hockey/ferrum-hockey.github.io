'use strict';
(() => {
  const snapshots=new Map();
  function manifestUrl(value){return new URL(value,document.baseURI);}
  async function snapshot(endpoint){
    const url=manifestUrl(endpoint).href;
    if(!snapshots.has(url))snapshots.set(url,fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)}).then(async response=>{if(!response.ok)throw new Error('Library unavailable');const data=await response.json();if(data.schema!==1 || !Array.isArray(data.albums) || !Array.isArray(data.weekly))throw new Error('Invalid library');return data;}).catch(error=>{snapshots.delete(url);throw error;}));
    return snapshots.get(url);
  }
  function safeImage(value,endpoint){
    try{const url=new URL(value,document.baseURI),manifest=manifestUrl(endpoint),prefix=new URL('../media/',manifest).pathname;return url.origin===manifest.origin && url.pathname.startsWith(prefix) && /^[a-f0-9]{32}\/(thumb|full)\.(jpg|png|webp)$/.test(url.pathname.slice(prefix.length)) && !url.search && !url.hash;}catch{return false;}
  }
  async function api(endpoint,requestPath){
    const data=await snapshot(endpoint),url=new URL(requestPath,'https://catalog.invalid');
    if(url.pathname==='/weekly')return {photos:data.weekly};
    if(url.pathname==='/albums'){
      const category=url.searchParams.get('category') || 'all',raw=url.searchParams.get('before') || '0';
      if(!['all','training','matches','events'].includes(category) || !/^\d{1,6}$/.test(raw))throw new Error('Invalid filter');
      const offset=Number(raw),filtered=data.albums.filter(a=>category==='all'||a.category===category),items=filtered.slice(offset,offset+12);
      return {albums:items.map(({photos,...album})=>album),next:offset+12<filtered.length?String(offset+12):null};
    }
    const id=/^\/albums\/([a-f0-9]{32})$/.exec(url.pathname)?.[1],album=data.albums.find(a=>a.id===id);
    if(!album)throw new Error('Album unavailable');
    return album;
  }
  window.FerrumStaticMedia={api,safeImage};
})();
