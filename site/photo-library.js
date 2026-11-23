'use strict';
(() => {
  const root=document.querySelector('#club-library');
  if(!root)return;
  const endpoint=document.querySelector('meta[name="ferrum-media-api"]')?.content;
  if(!endpoint)return;
  let origin;try{const parsed=new URL(endpoint);if(parsed.protocol!=='https:')return;origin=parsed.origin;}catch{return;}
  const grid=root.querySelector('#club-albums'),status=root.querySelector('[data-library-status]'),empty=root.querySelector('[data-library-empty]');
  const more=root.querySelector('[data-library-more]'),retry=root.querySelector('[data-library-retry]'),dialog=document.querySelector('#club-photo-dialog');
  const image=dialog.querySelector('[data-club-photo]'),loading=dialog.querySelector('[data-photo-loading]'),imageError=dialog.querySelector('[data-photo-error]');
  let category='all',cursor=null,albums=new Map(),requestId=0,opening=0,current=null,position=0,trigger=null,previousOverflow='',pointer=null;
  const idOK=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,90}$/.test(value);
  function safeImage(value){try{const u=new URL(value);return u.origin===origin && /^\/photo\/[a-zA-Z0-9_-]{1,90}\/(thumb|full)$/.test(u.pathname) && !u.search && !u.hash;}catch{return false;}}
  const textOK=(value,max)=>typeof value==='string' && value.length<=max;
  const photoOK=p=>p && idOK(p.id) && idOK(p.albumId) && safeImage(p.src) && safeImage(p.thumb) && Number.isInteger(p.width) && p.width>0 && Number.isInteger(p.height) && p.height>0;
  const albumOK=a=>a && idOK(a.id) && textOK(a.title,80) && textOK(a.caption,1500) && ['training','matches','events'].includes(a.category) && textOK(a.categoryLabel,30) && safeImage(a.cover) && Number.isInteger(a.count) && a.count>0 && a.count<=10 && Number.isFinite(Date.parse(a.publishedAt));
  const date=iso=>new Date(iso).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Moscow'});
  const countLabel=n=>`${n} ${n%10===1 && n%100!==11?'альбом':n%10>=2 && n%10<=4 && (n%100<12 || n%100>14)?'альбома':'альбомов'}`;
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  async function api(path){const response=await fetch(origin+path,{credentials:'omit',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Unavailable');return response.json();}
  function albumCard(album){
    const button=node('button','club-album');button.type='button';button.dataset.albumId=album.id;button.setAttribute('aria-label',`Открыть альбом: ${album.title}, ${album.count} фото`);
    const cover=node('div','club-album-cover'),img=node('img');img.src=album.cover;img.alt=album.title;img.loading='lazy';img.decoding='async';cover.append(img,node('span','club-album-count',`${album.count} ФОТО`));
    const meta=node('div','club-album-meta'),time=node('time',null,date(album.publishedAt));time.dateTime=album.publishedAt;meta.append(node('span',null,album.categoryLabel),time);
    const foot=node('div','club-album-foot');foot.append(node('span',null,'Смотреть альбом'),node('b',null,'↗'));
    button.append(cover,meta,node('h3',null,album.title),foot);button.addEventListener('click',()=>openAlbum(album.id,button));return button;
  }
  async function loadAlbums(reset=true){
    const number=++requestId;status.textContent='Загружаем альбомы…';retry.hidden=true;more.disabled=true;root.setAttribute('aria-busy','true');
    const query=new URLSearchParams({category});if(!reset && cursor)query.set('before',cursor);
    try{
      const data=await api('/albums?'+query);
      if(number!==requestId)return;
      if(!Array.isArray(data.albums) || data.albums.length>12 || !data.albums.every(albumOK) || (data.next!=null && !textOK(data.next,120)))throw new Error('Invalid data');
      if(reset){albums.clear();grid.replaceChildren();}
      for(const album of data.albums){if(!albums.has(album.id)){albums.set(album.id,album);grid.append(albumCard(album));}}
      cursor=data.next || null;more.hidden=!cursor;empty.hidden=albums.size>0;status.textContent=albums.size?countLabel(albums.size):'В этом разделе пока нет альбомов.';
    }catch{
      if(number!==requestId)return;
      status.textContent='Не удалось загрузить фотографии. Попробуйте ещё раз.';retry.hidden=false;more.hidden=true;
    }finally{if(number===requestId){root.removeAttribute('aria-busy');more.disabled=false;}}
  }
  function showPhoto(){
    const p=current.photos[position];loading.hidden=false;imageError.hidden=true;image.alt=`${current.title} — фото ${position+1}`;image.src=p.src;
    dialog.querySelector('[data-photo-count]').textContent=`${position+1} / ${current.photos.length}`;
    dialog.querySelector('[data-photo-original]').href=p.src;
    dialog.querySelector('.previous').hidden=dialog.querySelector('.next').hidden=current.photos.length<2;
    dialog.querySelector('#club-photo-title').textContent=current.title;
    dialog.querySelector('[data-photo-caption]').textContent=current.caption;
    dialog.querySelector('[data-photo-category]').textContent=({training:'Тренировки',matches:'Матчи',events:'События'})[current.category] || 'Жизнь клуба';
  }
  function move(step){if(current){position=(position+step+current.photos.length)%current.photos.length;showPhoto();}}
  async function openAlbum(id,control,selectedPhoto){
    const number=++opening;status.textContent='Открываем альбом…';
    try{
      const data=await api('/albums/'+encodeURIComponent(id));
      if(number!==opening)return;
      if(!data || !idOK(data.id) || !textOK(data.title,80) || !textOK(data.caption,1500) || !Array.isArray(data.photos) || !data.photos.length || data.photos.length>10 || !data.photos.every(photoOK))throw new Error('Invalid album');
      current=data;position=Math.max(0,data.photos.findIndex(p=>p.id===selectedPhoto));trigger=control;previousOverflow=document.body.style.overflow;
      showPhoto();dialog.showModal();document.body.style.overflow='hidden';document.body.classList.add('photo-viewing');status.textContent=countLabel(albums.size);
    }catch{if(number===opening){status.textContent='Не удалось открыть альбом. Возможно, он снят с публикации. Попробуйте обновить библиотеку.';retry.hidden=false;}}
  }
  image.addEventListener('load',()=>{loading.hidden=true;imageError.hidden=true;});
  image.addEventListener('error',()=>{loading.hidden=true;imageError.hidden=false;});
  dialog.querySelector('[data-photo-retry]').addEventListener('click',()=>{image.removeAttribute('src');showPhoto();});
  dialog.querySelector('.previous').addEventListener('click',()=>move(-1));dialog.querySelector('.next').addEventListener('click',()=>move(1));
  dialog.querySelector('.club-photo-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}if(e.key==='ArrowRight'){e.preventDefault();move(1);}});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{opening++;document.body.style.overflow=previousOverflow;document.body.classList.remove('photo-viewing');image.removeAttribute('src');trigger?.focus();});
  const stage=dialog.querySelector('.club-photo-stage');
  stage.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')pointer={x:e.clientX,y:e.clientY};});
  stage.addEventListener('pointerup',e=>{if(!pointer)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer=null;if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);});stage.addEventListener('pointercancel',()=>pointer=null);
  root.querySelectorAll('[data-library-category]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.libraryCategory;root.querySelectorAll('[data-library-category]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});loadAlbums();}));
  more.addEventListener('click',()=>loadAlbums(false));retry.addEventListener('click',()=>loadAlbums());
  async function loadWeekly(){
    try{const data=await api('/weekly');if(!Array.isArray(data.photos) || data.photos.length>6 || !data.photos.every(photoOK) || !data.photos.length)return;
      const week=document.querySelector('.week-grid');week.replaceChildren();week.dataset.photoCount=String(data.photos.length);
      for(const p of data.photos){const b=node('button','week-tile library-week-photo');b.type='button';b.setAttribute('aria-label','Открыть фотографию недели');const img=node('img');img.src=p.thumb;img.alt=typeof p.caption==='string'?p.caption.slice(0,200):'Момент из жизни клуба';img.loading='lazy';b.append(img,node('span',null,'Фото недели ↗'));b.addEventListener('click',()=>openAlbum(p.albumId,b,p.id));week.append(b);}
    }catch{/* Keep the existing weekly placeholders when the service is unavailable. */}
  }
  loadAlbums();loadWeekly();
})();
