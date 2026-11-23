import {createHash} from 'node:crypto';
export const categories={training:'Тренировки',matches:'Матчи',events:'События'};
export const idOK=value=>typeof value==='string' && /^[a-f0-9]{32}$/.test(value);
const text=(v,n)=>typeof v==='string'&&v.length<=n;
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function validateMatches(data){
  if(data?.source!=='https://mos.rhl.su/team/148/?season=64'||!Array.isArray(data.matches)||!data.matches.length||data.matches.length>2000||!Number.isFinite(Date.parse(data.checked_at)))throw new Error('Invalid match snapshot');
  const seen=new Set();
  for(const m of data.matches){if(!/^https:\/\/mos\.rhl\.su\/match\/\d+\/$/.test(m.url)||seen.has(m.url)||![m.home,m.away].every(n=>text(n,100)&&n)||[m.home,m.away].filter(n=>n==='Феррум').length!==1||!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||!/^\d{2}:\d{2}$/.test(m.time)||!Number.isFinite(Date.parse(`${m.date}T${m.time}:00+03:00`)))throw new Error('Invalid match');seen.add(m.url);
    if(!['future','played','pending'].includes(m.status)||(m.status==='played'?(!Array.isArray(m.score)||m.score.length!==2||!m.score.every(n=>Number.isInteger(n)&&n>=0)):m.score!==null))throw new Error('Invalid score');
    for(const logo of [m.home_logo,m.away_logo])if(logo!=null&&!/^assets\/teams\/\d+\.(png|webp)$/.test(logo))throw new Error('Invalid logo');
  }
  const t=data.standings;if(!t||!['games','wins','draws','losses','goals_for','goals_against','points','place','teams'].every(k=>Number.isInteger(t[k])&&t[k]>=0)||t.games!==t.wins+t.draws+t.losses||t.games!==data.matches.filter(m=>m.score).length||t.place<1||t.place>t.teams)throw new Error('Invalid standings');
  return data;
}
export function validateAlbum(a){
  if(!idOK(a?.id)||!text(a.title,80)||!text(a.caption,1500)||!categories[a.category]||!Number.isInteger(a.count)||a.count<1||a.count>10||!Number.isFinite(Date.parse(a.publishedAt)))throw new Error('Invalid published album');
  return {id:a.id,title:a.title,caption:a.caption,category:a.category,categoryLabel:categories[a.category],publishedAt:a.publishedAt,featured:Boolean(a.featured),count:a.count,cover:a.cover};
}
export function validatePhoto(p,albumId,origin){
  if(!idOK(p?.id)||p.albumId!==albumId||!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<1||p.height<1||p.width>30000||p.height>30000)throw new Error('Invalid photo');
  for(const variant of ['full','thumb']){const value=variant==='full'?p.src:p.thumb,url=new URL(value);if(url.origin!==origin||url.pathname!==`/photo/${p.id}/${variant}`||url.search||url.hash)throw new Error('Untrusted photo URL');}
  return p;
}
export function imageExtension(bytes){
  if(bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
  if(bytes.length>8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(bytes.length>12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'webp';
  throw new Error('Upstream file is not a supported image');
}
export function publicPath(value){return typeof value==='string'&&/^media\/[a-f0-9]{32}\/(thumb|full)\.(jpg|png|webp)$/.test(value);}
export function patchHtml(html,name,base){
  const canonical=name==='index.html'?base:new URL(name,base).href;
  html=html.replaceAll('https://ferrum-hockey.pages.dev/assets/',base+'assets/');
  html=html.replace(/<link rel="canonical"[^>]*>/g,`<link rel="canonical" href="${canonical}">`).replace(/<meta property="og:url"[^>]*>/g,`<meta property="og:url" content="${canonical}">`);
  html=html.replace(/<meta name="ferrum-matches-api"[^>]*>/g,'<meta name="ferrum-matches-api" content="data/matches.json">');
  html=html.replace(/<meta name="ferrum-media-api"[^>]*>/g,'<meta name="ferrum-media-static" content="data/library.json">');
  if(name==='life.html'){if(!html.includes('src="photo-library.js"'))throw new Error('Unexpected library HTML');html=html.replace('<script src="photo-library.js"','<script src="static-media.js" defer></script><script src="photo-library.js"');}
  return html.replaceAll('ЛОКАЛЬНАЯ ВЕРСИЯ','ТЕСТОВАЯ ВЕРСИЯ').replaceAll('Локальная версия','Тестовая версия');
}
export function patchLibrary(script){
  const initial=`  const endpoint=document.querySelector('meta[name="ferrum-media-api"]')?.content;\n  if(!endpoint)return;\n  let origin;try{const parsed=new URL(endpoint);if(parsed.protocol!=='https:')return;origin=parsed.origin;}catch{return;}`;
  if(!script.includes(initial))throw new Error('Library loader changed; review static adapter');
  script=script.replace(initial,`  const staticEndpoint=document.querySelector('meta[name="ferrum-media-static"]')?.content;\n  const endpoint=document.querySelector('meta[name="ferrum-media-api"]')?.content;\n  if(!endpoint&&!staticEndpoint)return;\n  let origin;try{const parsed=new URL(staticEndpoint||endpoint,document.baseURI);if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname))return;origin=parsed.origin;}catch{return;}`);
  script=script.replace('function safeImage(value){try{','function safeImage(value){if(staticEndpoint)return window.FerrumStaticMedia.safeImage(value,staticEndpoint);try{');
  script=script.replace('async function api(path){const response=','async function api(path){if(staticEndpoint)return window.FerrumStaticMedia.api(staticEndpoint,path);const response=');
  return script;
}
