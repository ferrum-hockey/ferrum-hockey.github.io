import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateMatches,validateAlbum,validatePhoto,imageExtension,publicPath,patchHtml,patchLibrary,digest,idOK} from './model.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function request(url,{json=false,maxBytes=2000000,optional=false}={}){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{headers:{'User-Agent':'Ferrum-Pages-Sync/1.0','Cache-Control':'no-cache'},signal:AbortSignal.timeout(25000),redirect:'error'});
      if(optional&&response.status===404)return null;
      if(!response.ok)throw new Error(`Source HTTP ${response.status}`);
      if(Number(response.headers.get('content-length')||0)>maxBytes)throw new Error('Source too large');
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new Error('Source too large');chunks.push(chunk);}
      const buffer=Buffer.concat(chunks);
      return json?JSON.parse(buffer.toString('utf8')):buffer;
    }catch(error){if(attempt===2)throw error;await delay(500*(attempt+1));}
  }
}
export async function loadSource(config){
  const origin=new URL(config.mediaOrigin).origin;
  const matches=validateMatches(await request(config.matchesUrl,{json:true}));
  const albums=[];const seen=new Set();let cursor=null;const cursors=new Set();
  do{
    const url=new URL('/albums',origin);url.searchParams.set('category','all');if(cursor)url.searchParams.set('before',cursor);
    const data=await request(url,{json:true});
    if(!Array.isArray(data.albums)||data.albums.length>12)throw new Error('Invalid album page');
    for(const item of data.albums){const album=validateAlbum(item);if(seen.has(album.id))throw new Error('Duplicate published album');seen.add(album.id);albums.push(album);}
    cursor=data.next;if(cursor!=null&&(typeof cursor!=='string'||cursor.length>120||cursors.has(cursor)))throw new Error('Invalid catalog cursor');if(cursor)cursors.add(cursor);
    if(albums.length>5000)throw new Error('Catalog limit reached');
  }while(cursor);
  const weekly=await request(new URL('/weekly',origin),{json:true});
  if(!Array.isArray(weekly.photos)||weekly.photos.length>6)throw new Error('Invalid weekly selection');
  for(const photo of weekly.photos){if(!seen.has(photo.albumId))throw new Error('Weekly selection changed during sync');validatePhoto(photo,photo.albumId,origin);}
  return {matches,albums,weekly:weekly.photos};
}
async function files(directory){
  const result=[];for(const item of await fs.readdir(directory,{withFileTypes:true})){const full=path.join(directory,item.name);if(item.isSymbolicLink())throw new Error('Symbolic links are not allowed');if(item.isDirectory())result.push(...await files(full));else if(item.isFile())result.push(full);}return result.sort();
}
async function siteHash(directory){const hash=createHash('sha256');for(const file of await files(directory)){hash.update(path.relative(directory,file).replaceAll('\\','/'));hash.update(await fs.readFile(file));}return hash.digest('hex');}
async function resetOutput(root){
  const realRoot=await fs.realpath(root),out=path.resolve(realRoot,'dist');
  if(out!==path.join(realRoot,'dist')||out===realRoot||!out.startsWith(realRoot+path.sep))throw new Error('Unsafe output directory');
  try{const info=await fs.lstat(out);if(info.isSymbolicLink()||!(await fs.realpath(out)).startsWith(realRoot+path.sep))throw new Error('Unsafe output directory');await fs.rm(out,{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(out);return out;
}
async function pool(items,count,work){let offset=0;await Promise.all(Array.from({length:Math.min(count,items.length)},async()=>{while(offset<items.length){const item=items[offset++];await work(item);}}));}
export async function build(root,{force=false,config:given}={}){
  root=await fs.realpath(root);const config=given||JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'));
  const base=new URL(config.siteUrl);if(!base.pathname.endsWith('/')||base.search||base.hash)throw new Error('siteUrl must be a directory URL');
  const source=await loadSource(config),sourceHash=await siteHash(path.join(root,'site'));
  const fingerprint=digest({schema:1,sourceHash,base:base.href,...source});
  let previous=null;try{previous=await request(new URL('data/revision.json',base),{json:true,optional:true});}catch{/* A fresh build can recover if the old deployment is unavailable. */}
  if(!force&&previous?.fingerprint===fingerprint)return {changed:false,fingerprint,albums:source.albums.length,photos:previous.photos||0};
  const details=[];
  for(const album of source.albums){const data=await request(new URL('/albums/'+album.id,config.mediaOrigin),{json:true});
    if(data.id!==album.id||data.caption!==album.caption||data.category!==album.category||data.publishedAt!==album.publishedAt||!Array.isArray(data.photos)||data.photos.length!==album.count)throw new Error('Album changed during sync; retry next run');
    const ids=new Set();for(const photo of data.photos){validatePhoto(photo,album.id,new URL(config.mediaOrigin).origin);if(ids.has(photo.id))throw new Error('Duplicate photo');ids.add(photo.id);}details.push({...album,photos:data.photos});
  }
  const out=await resetOutput(root);await fs.cp(path.join(root,'site'),out,{recursive:true});
  for(const file of await files(out)){
    if(file.endsWith('.html'))await fs.writeFile(file,patchHtml(await fs.readFile(file,'utf8'),path.basename(file),base.href));
    if(path.basename(file)==='photo-library.js')await fs.writeFile(file,patchLibrary(await fs.readFile(file,'utf8')));
    if(path.basename(file)==='match-source.js'){let script=await fs.readFile(file,'utf8');if(!script.includes('new URL(endpoint)'))throw new Error('Match loader changed');script=script.replace('new URL(endpoint)','new URL(endpoint,document.baseURI)');await fs.writeFile(file,script);}
  }
  const photoMap=new Map();for(const album of details)for(const photo of album.photos)photoMap.set(photo.id,photo);
  const media={},publicPhotos=new Map();
  await pool([...photoMap.values()],4,async photo=>{
    const paths={};for(const variant of ['thumb','full']){
      let bytes=null;const old=previous?.media?.[photo.id]?.[variant];
      if(publicPath(old)&&old.startsWith('media/'+photo.id+'/'))try{bytes=await request(new URL(old,base),{maxBytes:config.maxPhotoBytes,optional:true});}catch{/* Fetch the Telegram-backed public proxy instead. */}
      if(!bytes)bytes=await request(variant==='full'?photo.src:photo.thumb,{maxBytes:config.maxPhotoBytes});
      const relative=`media/${photo.id}/${variant}.${imageExtension(bytes)}`,destination=path.join(out,...relative.split('/'));await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);paths[variant]=relative;
    }
    media[photo.id]=paths;publicPhotos.set(photo.id,{id:photo.id,albumId:photo.albumId,src:new URL(paths.full,base).href,thumb:new URL(paths.thumb,base).href,width:photo.width,height:photo.height});
  });
  const library={schema:1,albums:details.map(album=>({id:album.id,title:album.title,caption:album.caption,category:album.category,categoryLabel:album.categoryLabel,publishedAt:album.publishedAt,featured:album.featured,count:album.photos.length,cover:publicPhotos.get(album.photos[0].id).thumb,photos:album.photos.map(p=>publicPhotos.get(p.id))})),weekly:source.weekly.map(p=>{const photo=publicPhotos.get(p.id);if(!photo)throw new Error('Weekly photo missing from published catalog');return {...photo,caption:typeof p.caption==='string'?p.caption.slice(0,200):''};})};
  await fs.mkdir(path.join(out,'data'),{recursive:true});await fs.writeFile(path.join(out,'data/library.json'),JSON.stringify(library));await fs.writeFile(path.join(out,'data/matches.json'),JSON.stringify(source.matches));await fs.writeFile(path.join(out,'matches.js'),'window.FERRUM_MATCHES = '+JSON.stringify(source.matches)+';\n');
  await fs.writeFile(path.join(out,'.nojekyll'),'');
  const revision={schema:1,fingerprint,builtAt:new Date().toISOString(),albums:library.albums.length,photos:photoMap.size,media};await fs.writeFile(path.join(out,'data/revision.json'),JSON.stringify(revision));
  let size=0;for(const file of await files(out)){const stat=await fs.stat(file);size+=stat.size;if(stat.size>25*1024*1024)throw new Error('Static file exceeds safe limit');if(/\.(html|js|json|css)$/.test(file)){const body=await fs.readFile(file,'utf8');if(/https?:\/\/[^\s"'<>]*\.(workers|pages)\.dev/.test(body))throw new Error('Cloudflare dependency remains in public output: '+path.relative(out,file));if(/\b\d{8,20}:[A-Za-z0-9_-]{25,100}\b/.test(body)||/"(?:file_id|author_id|BOT_TOKEN)"\s*:/.test(body))throw new Error('Private data in public output');}}
  if(size>config.maxSiteBytes)throw new Error('Site size limit reached; previous deployment remains active');
  return {changed:true,fingerprint,albums:library.albums.length,photos:photoMap.size,bytes:size,builtAt:revision.builtAt};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  try{const result=await build(root,{force:process.argv.includes('--force')||process.env.FORCE_BUILD==='true'});await fs.writeFile(path.join(root,'.sync-result.json'),JSON.stringify(result,null,2));if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`changed=${result.changed}\nfingerprint=${result.fingerprint}\n`);console.log(JSON.stringify(result));}
  catch(error){console.error('Build failed; published site is not changed:',error.message);process.exitCode=1;}
}
