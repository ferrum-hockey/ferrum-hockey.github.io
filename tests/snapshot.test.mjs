import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import vm from 'node:vm';
import {build} from '../scripts/build.mjs';
import {patchHtml,patchLibrary,validateMatches,imageExtension} from '../scripts/model.mjs';
const root=new URL('../',import.meta.url);
const matches=JSON.parse((await fs.readFile(new URL('site/matches.js',root),'utf8')).trim().replace(/^window.FERRUM_MATCHES = /,'').replace(/;$/,''));
const albumId='a'.repeat(32),photoId='b'.repeat(32);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
test('page transformation preserves project path and removes browser Cloudflare endpoints',async()=>{
 const html=await fs.readFile(new URL('site/life.html',root),'utf8');const out=patchHtml(html,'life.html','https://example.github.io/ferrum-hockey/');
 assert(out.includes('https://example.github.io/ferrum-hockey/life.html'));assert(out.includes('https://example.github.io/ferrum-hockey/assets/social/ferrum-share.jpg'));assert(out.includes('ferrum-media-static'));assert(!out.includes('.workers.dev'));assert(!out.includes('.pages.dev'));
 assert(patchLibrary(await fs.readFile(new URL('site/photo-library.js',root),'utf8')).includes('FerrumStaticMedia.api'));
});
test('match safety checks and actual image signatures',()=>{assert.equal(validateMatches(structuredClone(matches)).matches.length,6);const invalid=structuredClone(matches);invalid.matches[0].url='javascript:alert(1)';assert.throws(()=>validateMatches(invalid));assert.equal(imageExtension(png),'png');assert.throws(()=>imageExtension(Buffer.from('<html>not an image</html>')));});
test('static adapter filters/paginates albums and only allows its own media directory',async()=>{
 const endpoint='data/library.json',base='https://example.github.io/ferrum-hockey/';const data={schema:1,albums:Array.from({length:14},(_,i)=>({id:i.toString(16).padStart(32,'0'),category:i%2?'matches':'training',photos:[{id:photoId}]})),weekly:[{id:photoId}]};const window={};let reads=0;
 vm.runInNewContext(await fs.readFile(new URL('site/static-media.js',root),'utf8'),{window,URL,AbortSignal,document:{baseURI:base+'life.html'},fetch:async()=>{reads++;return {ok:true,json:async()=>data}}});
 const api=window.FerrumStaticMedia;assert.equal((await api.api(endpoint,'/albums?category=all')).albums.length,12);assert.equal((await api.api(endpoint,'/albums?category=all&before=12')).albums.length,2);assert.equal((await api.api(endpoint,'/albums?category=matches')).albums.length,7);assert.equal((await api.api(endpoint,'/weekly')).photos.length,1);assert.equal(reads,1);
 assert(api.safeImage(base+'media/'+photoId+'/full.png',endpoint));assert(!api.safeImage('https://foreign.test/media/'+photoId+'/full.png',endpoint));assert(!api.safeImage(base+'private/full.png',endpoint));await assert.rejects(()=>api.api(endpoint,'/albums?before=../secret'));
});
test('end-to-end snapshot copies only public photos, skips unchanged data and keeps last artifact on source failure',async()=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ferrum-pages-test-'));await fs.mkdir(path.join(temporary,'site'));for(const file of ['index.html','life.html','photo-library.js','match-source.js','static-media.js'])await fs.copyFile(new URL('site/'+file,root),path.join(temporary,'site',file));
 let fail=false,published=true,serverOrigin;const requests=[];
 const server=http.createServer(async(req,res)=>{requests.push(req.url);const url=new URL(req.url,serverOrigin);res.setHeader('Content-Type','application/json');
 if(url.pathname==='/matches.json'){if(fail){res.writeHead(503);return res.end('{}')}return res.end(JSON.stringify(matches));}
 const photo={id:photoId,albumId,src:serverOrigin+'/photo/'+photoId+'/full',thumb:serverOrigin+'/photo/'+photoId+'/thumb',width:1,height:1};
 const album={id:albumId,title:'Тренировка',caption:'Опубликовано пользователем',category:'training',categoryLabel:'Тренировки',publishedAt:'2026-11-23T12:00:00.000Z',featured:true,count:1,cover:photo.thumb};
 if(url.pathname==='/albums')return res.end(JSON.stringify({albums:published?[album]:[],next:null}));
 if(url.pathname==='/weekly')return res.end(JSON.stringify({photos:published?[photo]:[]}));
 if(url.pathname==='/albums/'+albumId)return res.end(JSON.stringify({...album,photos:[photo]}));
 if(url.pathname.startsWith('/photo/')){res.setHeader('Content-Type','image/png');return res.end(png)}
 if(url.pathname.startsWith('/published/'))try{const file=path.join(temporary,'dist',url.pathname.slice('/published/'.length));return res.end(await fs.readFile(file));}catch{res.writeHead(404);return res.end('{}')}
 res.writeHead(404);res.end('{}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));serverOrigin='http://127.0.0.1:'+server.address().port;
 const config={siteUrl:serverOrigin+'/published/',mediaOrigin:serverOrigin,matchesUrl:serverOrigin+'/matches.json',maxSiteBytes:2000000,maxPhotoBytes:20971520};
 try{
 const initial=await build(temporary,{config,force:true});assert(initial.changed);assert.equal(initial.photos,1);const catalog=JSON.parse(await fs.readFile(path.join(temporary,'dist/data/library.json'),'utf8'));assert.equal(catalog.albums.length,1);assert.equal(catalog.weekly.length,1);assert(catalog.albums[0].photos[0].src.includes('/published/media/'));assert(!JSON.stringify(catalog).includes('file_id'));assert(!JSON.stringify(catalog).includes('/photo/'));
 assert.equal((await fs.readFile(path.join(temporary,'dist/media',photoId,'full.png'))).toString('hex'),png.toString('hex'));assert.equal((await build(temporary,{config})).changed,false);
 fail=true;const before=await fs.readFile(path.join(temporary,'dist/data/revision.json'),'utf8');await assert.rejects(()=>build(temporary,{config}));assert.equal(await fs.readFile(path.join(temporary,'dist/data/revision.json'),'utf8'),before);
 fail=false;published=false;const removed=await build(temporary,{config});assert(removed.changed);assert.equal(JSON.parse(await fs.readFile(path.join(temporary,'dist/data/library.json'),'utf8')).albums.length,0);await assert.rejects(()=>fs.stat(path.join(temporary,'dist/media',photoId,'full.png')));assert(!requests.some(r=>r.includes('webhook')||r.includes('setup')));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const real=await fs.realpath(temporary);assert(real.startsWith(await fs.realpath(os.tmpdir())+path.sep));await fs.rm(real,{recursive:true});}
});
