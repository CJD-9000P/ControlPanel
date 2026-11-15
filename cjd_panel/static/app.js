'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = stamp => stamp ? new Date(stamp).toLocaleString('es-ES') : '—';
const time = stamp => new Date(stamp).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
let state = {}, profiles = [], selected = null, dirty = false, busy = false, detailID = null, importType = null, page = 'control';
let token = sessionStorage.getItem('cjd-token') || '';
let toastTimer;
function toast(message,error=false) { clearTimeout(toastTimer); $('toast').textContent=message; $('toast').className=error?'error':''; $('toast').hidden=false; toastTimer=setTimeout(()=>$('toast').hidden=true,error?10000:5000); }
async function api(path,options={}) {
  const headers = {'X-CJD-Request':'1', ...options.headers};
  if(token) headers.Authorization='Bearer '+token;
  if(options.body && typeof options.body !== 'string') { options.body=JSON.stringify(options.body); headers['Content-Type']='application/json'; }
  const response = await fetch('/api/'+path,{...options,headers,cache:'no-store'});
  if(response.status===401) { if(!$('auth-dialog').open) $('auth-dialog').showModal(); throw Error('Se necesita la clave de acceso.'); }
  if(!response.ok) { const data=await response.json(); throw Error(data.error || 'No se pudo completar la operación.'); }
  return options.download ? response.blob() : response.json();
}
async function download(path,name) { const blob=await api(path,{download:true}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function confirmAction(title,message) { $('confirm-title').textContent=title; $('confirm-message').textContent=message; const dialog=$('confirm-dialog'); dialog.returnValue='cancel'; dialog.showModal(); return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true})); }
function safe(fn) { return async (...args)=> { try { await fn(...args); } catch(e) { toast(e.message,true); } }; }
function drawChart(target,series,{xLabel='min',empty='Las lecturas aparecerán aquí al conectar con el simulador.'}={}) {
  const values=series.flatMap(s=>s.points);
  if(!values.length) { target.innerHTML=`<div class="empty">${escapeHTML(empty)}</div>`; return; }
  const width=760,height=260,left=48,right=18,top=15,bottom=38;
  const maxX=Math.max(1,...values.map(p=>p[0])), minX=Math.min(0,...values.map(p=>p[0]));
  const maxY=Math.max(100,Math.ceil(Math.max(...values.map(p=>p[1]))/100)*100), minY=Math.min(0,Math.floor(Math.min(...values.map(p=>p[1]))/100)*100);
  const x=v=>left+(v-minX)/(maxX-minX)*(width-left-right), y=v=>height-bottom-(v-minY)/(maxY-minY)*(height-top-bottom);
  let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfica de temperatura en grados Celsius"><text x="8" y="15" fill="#84917b" font-size="10">°C</text>`;
  for(let i=0;i<=4;i++) { const v=minY+(maxY-minY)*i/4; svg+=`<line x1="${left}" y1="${y(v)}" x2="${width-right}" y2="${y(v)}" stroke="#edf0e6"/><text x="${left-10}" y="${y(v)+3}" text-anchor="end" font-size="10" fill="#8c9684">${Math.round(v)}</text>`; }
  for(let i=0;i<=4;i++) { const v=minX+(maxX-minX)*i/4; svg+=`<text x="${x(v)}" y="${height-13}" text-anchor="middle" fill="#8c9684" font-size="10">${xLabel==='hora'?new Date(v).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):Math.round(v)+' min'}</text>`; }
  for(const s of series) if(s.points.length) { svg+=`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ${s.dashed?'stroke-dasharray="6 5"':''} points="${s.points.map(p=>`${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(' ')}"/>`; const last=s.points.at(-1); svg+=`<circle cx="${x(last[0])}" cy="${y(last[1])}" r="3" fill="${s.color}"/>`; }
  target.innerHTML=svg+'</svg>';
}
function curvePoints(segments) { let elapsed=0; return segments.map(s=>{const p=[elapsed,s.temperature]; elapsed+=s.minutes; return p;}); }
function renderState() {
  const online=!!state.online;
  $('connection').textContent=online?'Simulador conectado':'Sin comunicación'; $('connection').className='connection '+(online?'online':'offline');
  $('version').textContent=state.version?'v'+state.version:'';
  for(const id of ['pv','sv','step','memory']) $(id).textContent=online?state[id]:'—';
  $('state-badge').textContent=online?['PARADO','FUNCIONANDO','PAUSADO'][state.state]:'SIN COMUNICACIÓN';
  $('state-badge').className='status-badge '+(online&&state.state===1?'running':online&&state.state===2?'paused':'');
  $('segment-time').textContent=online?`${state.minutes} min en el tramo · tiempo virtual`:'Sin lectura de tiempo';
  $('updated').textContent=state.timestamp?'Lectura '+time(state.timestamp):'Esperando sincronización';
  $('connection-error').hidden=online; $('connection-error').textContent=state.error || 'Esperando respuesta del servicio.';
  $('run').disabled=busy||!online||state.state!==0; $('pause').disabled=busy||!online||state.state!==1; $('resume').disabled=busy||!online||state.state!==2; $('stop').disabled=busy||!online||state.state===0;
  $('load-profile').disabled=busy||!selected||!online||state.state!==0;
  const readings=state.recent||[];
  const first=readings.length?new Date(readings[0].timestamp).getTime():0;
  drawChart($('live-chart'),[{color:'#335f47',points:readings.map(r=>[(new Date(r.timestamp)-first)/60000,r.pv])},{color:'#db794c',dashed:true,points:readings.map(r=>[(new Date(r.timestamp)-first)/60000,r.sv])}]);
  if(page==='curves') renderMemories();
}
function renderEvents(target,events) { const origins={app:'Aplicación',observed:'Observado',system:'Sistema',import:'Importado'}; target.innerHTML=events.length?events.slice(0,15).map(e=>`<div class="event-row"><time title="${escapeHTML(date(e.timestamp))}">${time(e.timestamp)}</time><span>${escapeHTML(e.message)}</span><span class="event-origin">${origins[e.origin]||escapeHTML(e.origin)}</span></div>`).join(''):'<div class="empty">Todavía no hay actividad registrada.</div>'; }
async function refresh() {
  try { state=await api('state'); renderState(); if(page==='control') renderEvents($('events'),await api('events')); }
  catch(e) { state={...state,online:false,error:e.message}; renderState(); }
}
async function command(operation,extra={}) {
  if(busy) return;
  busy=true; renderState();
  try { const result=await api('commands',{method:'POST',body:{operation,...extra}}); toast(result.message); await refresh(); if(page==='history') await loadHistory(); }
  finally { busy=false; renderState(); }
}
async function navigate(next) {
  if(next!=='curves' && dirty && !await confirmAction('¿Salir del editor?','Los cambios sin guardar se perderán.')) return;
  if(next!=='curves') dirty=false;
  page=next;
  for(const name of ['control','curves','history']) $('page-'+name).hidden=name!==page;
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('breadcrumb').textContent={control:'Control',curves:'Curvas',history:'Cocciones'}[page];
  if(page==='curves') { await loadProfiles(); renderMemories(); }
  if(page==='history') await loadHistory();
  location.hash=page;
}
async function loadProfiles() {
  profiles=await api('profiles'); renderProfileList(); const old=$('run-profile').value;
  $('run-profile').innerHTML='<option value="">Usar la memoria del programador</option>'+profiles.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');
  if(profiles.some(p=>p.id===old)) $('run-profile').value=old;
}
function renderProfileList() {
  const search=$('profile-search').value.toLocaleLowerCase();
  const filtered=profiles.filter(p=>p.name.toLocaleLowerCase().includes(search));
  $('profile-list').innerHTML=filtered.length?filtered.map(p=>`<button class="profile-option ${p.id===selected?'selected':''}" data-profile="${p.id}"><strong>${escapeHTML(p.name)}</strong><small>${p.segments.reduce((v,s)=>v+s.minutes,0)} min · ${Math.max(...p.segments.map(s=>s.temperature))} °C máx.</small></button>`).join(''):'<div class="empty">'+(profiles.length?'No hay coincidencias.':'Tu biblioteca está lista para la primera curva.')+'</div>';
}
async function editProfile(p,ident=null) {
  if(dirty && !await confirmAction('¿Cambiar de curva?','Los cambios sin guardar se perderán.')) return;
  selected=ident; dirty=false;
  $('editor-empty').hidden=true; $('profile-form').hidden=false;
  $('editor-title').textContent=ident?'Editar curva':'Nueva curva'; $('profile-name').value=p.name; $('profile-notes').value=p.notes||'';
  $('segments').innerHTML=p.segments.map((s,i)=>`<tr><td>C${String(i+1).padStart(2,'0')}</td><td><input type="number" min="0" max="1200" step="1" required value="${s.temperature}" data-temperature="${i}" aria-label="Temperatura C${i+1}"></td><td><input type="number" min="0" max="32767" step="1" required value="${s.minutes}" data-minutes="${i}" ${i===19?'readonly':''} aria-label="Minutos t${i+1}"></td></tr>`).join('');
  for(const id of ['duplicate-profile','export-profile','delete-profile']) $(id).disabled=!ident;
  renderProfileList(); previewCurve(); renderState();
}
function formProfile() { return {name:$('profile-name').value,notes:$('profile-notes').value,segments:Array.from({length:20},(_,i)=>({temperature:Number(document.querySelector(`[data-temperature="${i}"]`).value),minutes:Number(document.querySelector(`[data-minutes="${i}"]`).value)}))}; }
function previewCurve() { const p=formProfile(); if(p.segments.every(s=>Number.isFinite(s.temperature)&&Number.isFinite(s.minutes))) drawChart($('profile-chart'),[{color:'#4d7348',points:curvePoints(p.segments)}]); }
function renderMemories() {
  $('memories').innerHTML=Object.entries(state.memories||{}).map(([id,s])=>`<div class="memory-tile ${Number(id)===state.memory?'active':''}"><h3>Memoria ${id}${Number(id)===state.memory?' · activa':''}</h3><p>${s.reduce((v,p)=>v+p.minutes,0)} min · ${Math.max(...s.map(p=>p.temperature))} °C máx.</p><button class="button secondary" data-copy-memory="${id}">Copiar a biblioteca</button></div>`).join('')||'<p class="helper">Esperando lectura de memorias.</p>';
}
async function loadHistory() {
  const checked=[...document.querySelectorAll('[data-compare]:checked')].map(c=>c.dataset.compare);
  const rows=await api('firings');
  const names={running:'En curso',paused:'Pausada',ended:'Finalizada',interrupted:'Interrumpida',imported:'Importada'};
  $('firings').innerHTML=rows.length?rows.map(r=>`<tr><td><input type="checkbox" aria-label="Comparar ${escapeHTML(r.name)}" data-compare="${r.id}" ${r.ended_at?'':'disabled'} ${checked.includes(r.id)?'checked':''}></td><td><strong>${escapeHTML(r.name)}</strong></td><td>${date(r.started_at)}</td><td>${names[r.status]||escapeHTML(r.status)}</td><td>${r.memory}</td><td>${r.samples.toLocaleString('es-ES')}</td><td><button class="button secondary" data-firing="${r.id}">Ver detalle</button></td></tr>`).join(''):'<tr><td colspan="7"><div class="empty"><h2>Tu próximo proceso empieza aquí</h2><p>Inicia una cocción desde Control para guardar sus lecturas y eventos automáticamente.</p></div></td></tr>';
}
async function showFiring(ids) {
  const firings=await Promise.all(ids.map(id=>api('firings/'+id)));
  detailID=ids.length===1?ids[0]:null;
  $('history-detail').hidden=false; $('export-firing').hidden=!detailID;
  $('history-title').textContent=firings.map(f=>f.name).join(' / ');
  $('history-subtitle').textContent=firings.map(f=>`${date(f.started_at)} · ${f.samples.toLocaleString('es-ES')} lecturas`).join(' | ');
  const colors=['#335f47','#db794c'];
  const series=[];
  firings.forEach((f,i)=>{const first=new Date(f.started_at); series.push({color:colors[i],points:f.readings.map(r=>[(new Date(r.timestamp)-first)/60000,r.pv])}); if(firings.length===1) series.push({color:'#db794c',dashed:true,points:f.readings.map(r=>[(new Date(r.timestamp)-first)/60000,r.sv])});});
  drawChart($('history-chart'),series,{empty:'Esta cocción no tiene lecturas.'});
  $('history-snapshot').textContent=firings.length===1?(firings[0].snapshot.length?'Curva utilizada conservada como snapshot de 20 puntos. Línea verde: PV; naranja discontinua: SV.':'Importación CSV: no hay snapshot de la curva utilizada.'):'Comparación de PV desde el inicio de cada cocción. Verde: primera seleccionada; naranja: segunda.';
  $('snapshot-detail').hidden=firings.length!==1||!firings[0].snapshot.length;
  $('snapshot-table').innerHTML=firings.length===1?'<table><thead><tr><th>Punto</th><th>°C</th><th>Minutos de transición</th></tr></thead><tbody>'+firings[0].snapshot.map((s,i)=>`<tr><td>C${String(i+1).padStart(2,'0')}</td><td>${s.temperature}</td><td>${s.minutes}</td></tr>`).join('')+'</tbody></table>':'';
  renderEvents($('history-events'),firings[0].events);
  $('history-detail').scrollIntoView({behavior:'smooth',block:'nearest'});
}
document.querySelector('.brand').addEventListener('click',safe(async e=>{e.preventDefault();await navigate('control');}));
for(const b of document.querySelectorAll('[data-page]')) b.addEventListener('click',safe(()=>navigate(b.dataset.page)));
$('run').onclick=safe(async()=>{const memory=Number($('run-memory').value), id=$('run-profile').value; const name=profiles.find(p=>p.id===id)?.name || 'curva guardada en el programador'; if(await confirmAction('Iniciar cocción simulada',`Se utilizará la memoria ${memory} con ${name}. C01 se adaptará a la temperatura actual y se verificará antes de RUN.`)) await command('run',{memory,profile_id:id});});
$('pause').onclick=safe(()=>command('pause'));
$('resume').onclick=safe(()=>command('resume'));
$('stop').onclick=safe(async()=>{if(await confirmAction('Detener la cocción','Se enviará STOP y se comprobará el estado PARADO. La sesión quedará guardada en el historial.')) await command('stop');});
for(const b of document.querySelectorAll('[data-sim]')) b.onclick=safe(()=>command('simulate',{action:b.dataset.sim}));
$('new-profile').onclick=safe(()=>editProfile({name:'',notes:'',segments:state.memories?.[1] || Array.from({length:20},(_,i)=>({temperature:i?100:25,minutes:i===19?0:10}))}));
$('profile-search').oninput=renderProfileList;
$('profile-list').onclick=safe(async e=>{const b=e.target.closest('[data-profile]'); if(b) await editProfile(profiles.find(p=>p.id===b.dataset.profile),b.dataset.profile);});
$('profile-form').oninput=()=>{dirty=true;previewCurve();};
$('profile-form').onsubmit=safe(async e=>{e.preventDefault(); const p=await api('profiles'+(selected?'/'+selected:''),{method:selected?'PUT':'POST',body:formProfile()}); dirty=false;await loadProfiles();await editProfile(p,p.id);toast('Curva guardada en la biblioteca local.');});
$('duplicate-profile').onclick=safe(async()=>{if(dirty) throw Error('Guarda los cambios antes de duplicar.');const p=await api('profiles',{method:'POST',body:{...profiles.find(p=>p.id===selected),name:($('profile-name').value+' · copia').slice(0,120)}});await loadProfiles();await editProfile(p,p.id);toast('Copia creada.');});
$('delete-profile').onclick=safe(async()=>{if(!await confirmAction('Eliminar curva','Se eliminará de la biblioteca. Las cocciones ya registradas conservarán sus datos y su snapshot.')) return;await api('profiles/'+selected,{method:'DELETE'});selected=null;dirty=false;$('profile-form').hidden=true;$('editor-empty').hidden=false;await loadProfiles();toast('Curva eliminada.');});
$('export-profile').onclick=safe(()=>download('profiles/'+selected+'/csv','curva.csv'));
$('load-profile').onclick=safe(async()=>{if(dirty) throw Error('Guarda los cambios antes de cargar la curva.'); const memory=Number($('load-memory').value);if(await confirmAction('Cargar memoria '+memory,'Se reemplazarán sus 40 registros con la curva guardada, adaptando C01 a PV. No se iniciará la cocción.')) await command('load',{profile_id:selected,memory});});
$('memories').onclick=safe(async e=>{const b=e.target.closest('[data-copy-memory]');if(!b) return;const id=Number(b.dataset.copyMemory); const p=await api('profiles',{method:'POST',body:{name:'Copia de memoria '+id,notes:'Copiada del simulador; curva ficticia de demostración.',segments:state.memories[id]}});await loadProfiles();await editProfile(p,p.id);toast('Memoria copiada a la biblioteca.');});
$('firings').onclick=safe(async e=>{const b=e.target.closest('[data-firing]');if(b) await showFiring([b.dataset.firing]);});
$('compare').onclick=safe(async()=>{const ids=[...document.querySelectorAll('[data-compare]:checked')].map(c=>c.dataset.compare);if(ids.length!==2) throw Error('Selecciona exactamente dos cocciones terminadas.');await showFiring(ids);});
$('export-firing').onclick=safe(()=>download('firings/'+detailID+'/csv','coccion-'+detailID+'.csv'));
$('backup').onclick=safe(()=>download('backup','cjd-backup.sqlite3'));
for(const [id,type] of [['import-profile','profiles'],['import-firing','firings']]) $(id).onclick=()=>{importType=type;$('csv-file').value='';$('csv-file').click();};
$('csv-file').onchange=safe(async()=>{const file=$('csv-file').files[0];if(!file)return;if(file.size>32*1024*1024)throw Error('El archivo supera 32 MiB.');const result=await api(importType+'/import',{method:'POST',headers:{'Content-Type':'text/csv'},body:await file.text()});if(importType==='profiles'){await loadProfiles();await editProfile(result,result.id);}else await loadHistory();toast('CSV importado correctamente.');});
$('auth-form').onsubmit=safe(async e=>{e.preventDefault();token=$('access-token').value;await api('state');sessionStorage.setItem('cjd-token',token);$('access-token').value='';$('auth-dialog').close();await loadProfiles();await refresh();});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
function tickClock(){$('clock').textContent=new Date().toLocaleDateString('es-ES',{day:'numeric',month:'short'})+' · '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});}
async function init(){tickClock();await refresh();try{await loadProfiles();const initial=location.hash.slice(1);if(['curves','history'].includes(initial))await navigate(initial);}catch(e){if(!$('auth-dialog').open)toast(e.message,true);}setInterval(async()=>{await refresh();if(page==='history'){try{await loadHistory();}catch{}}},2000);setInterval(tickClock,30000);}
init();
