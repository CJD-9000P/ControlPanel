'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = stamp => stamp ? new Date(stamp).toLocaleString('es-ES') : '—';
const fmt = (v,d=1) => Number.isFinite(v)?v.toLocaleString('es-ES',{maximumFractionDigits:d}):'—';
const duration = seconds => Number.isFinite(seconds)?`${Math.floor(seconds/3600)} h ${Math.floor(seconds%3600/60)} min ${Math.floor(seconds%60)} s`:'—';
const states={running:'En curso',paused:'Pausada',ended:'Finalizada',interrupted:'Interrumpida',imported:'Importada'};
const colors=['#29bc6c','#e6a23c','#a98bfa','#59a6ed','#e37db0','#b6c36e','#d39975'];
let state={},profiles=[],selected=null,draft=null,dirty=false,firingDirty=false,busy=false,page='control';
let firings=[],selectedFirings=new Set(),details=[],detailID=null,loadProfileID=null,importType=null,token=sessionStorage.getItem('cjd-token')||'';
let pointerDown=false;
window.addEventListener('pointerdown',()=>{pointerDown=true;},{passive:true});
window.addEventListener('pointerup',()=>{setTimeout(()=>{pointerDown=false;},0);},{passive:true});
window.addEventListener('pointercancel',()=>{pointerDown=false;},{passive:true});
let toastTimer,lastControlMemoryKey='',lastMemoryKey='',lastTableKey='',lastProfileKey='',historyListKey='';
let journey={memory:null,step:0,fraction:0,active:null},lastState=null;
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?10000:5000);}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){toast(e.message,true);}};}
async function api(path,options={}){
 const headers={'X-CJD-Request':'1',...options.headers};if(token)headers.Authorization='Bearer '+token;
 if(options.body&&typeof options.body!=='string'){options.body=JSON.stringify(options.body);headers['Content-Type']='application/json';}
 const response=await fetch('/api/'+path,{...options,headers,cache:'no-store'});
 if(response.status===401){if(!$('auth-dialog').open)$('auth-dialog').showModal();throw Error('Se necesita la clave de acceso.');}
 if(!response.ok){const data=await response.json();throw Error(data.error||'No se pudo completar la operación.');}
 return options.download?response.blob():response.json();
}
async function download(path,name){const blob=await api(path,{download:true});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function confirmAction(title,message){const dialog=$('confirm-dialog');if(dialog.open)return false;$('confirm-title').textContent=title;$('confirm-message').textContent=message;dialog.returnValue='cancel';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
function drawChart(target,series,{empty='No hay lecturas disponibles.',markers=[],axis='minutos'}={}){
 const values=series.flatMap(s=>s.points).filter(p=>p.every(Number.isFinite));
 if(!values.length){target.innerHTML=`<div class="empty">${escapeHTML(empty)}</div>`;return;}
 const W=860,H=285,L=55,R=20,T=28,B=42;
 const maxX=Math.max(1,...values.map(p=>p[0])),maxRaw=Math.max(...values.map(p=>p[1])),minRaw=Math.min(...values.map(p=>p[1]));
 const step=maxRaw<=50?10:maxRaw<=150?25:maxRaw<=400?50:100;
 const maxY=Math.max(step,Math.ceil(maxRaw/step)*step),minY=Math.min(0,Math.floor(minRaw/step)*step);
 const x=v=>L+v/maxX*(W-L-R),y=v=>H-B-(v-minY)/(maxY-minY)*(H-T-B);
 let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperatura en grados Celsius frente a tiempo"><text x="8" y="16" fill="#a0aaa5" font-size="11">°C</text>`;
 for(let i=0;i<=4;i++){const v=minY+(maxY-minY)*i/4;svg+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#343a37" stroke-dasharray="3 5"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="#a0aaa5">${Math.round(v)}</text>`;}
 for(let i=0;i<=4;i++){const v=maxX*i/4;svg+=`<text x="${x(v)}" y="${H-16}" text-anchor="middle" fill="#a0aaa5" font-size="11">${maxX>180?fmt(v/60)+' h':fmt(v)+' min'}</text>`;}
 for(const m of markers){if(!Number.isFinite(m.minute)||m.minute<0||m.minute>maxX)continue;svg+=`<line x1="${x(m.minute)}" y1="${T}" x2="${x(m.minute)}" y2="${H-B}" stroke="${m.color||'#e6a23c'}" stroke-dasharray="4 5" opacity=".5"><title>${escapeHTML(m.label)}</title></line><circle cx="${x(m.minute)}" cy="18" r="4" fill="${m.color||'#e6a23c'}"><title>${escapeHTML(m.label)}</title></circle>`;}
 for(const s of series){const points=s.points.filter(p=>p.every(Number.isFinite));if(!points.length)continue;svg+=`<polyline fill="none" stroke="${s.color}" stroke-width="${s.width||2.5}" stroke-linecap="round" stroke-linejoin="round" ${s.dashed?'stroke-dasharray="6 5"':''} points="${points.map(p=>`${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(' ')}"/>`;if(s.dot){const p=points.at(-1);svg+=`<circle cx="${x(p[0])}" cy="${y(p[1])}" r="5" fill="${s.dot}" stroke="#202721" stroke-width="2"/>`;}}
 svg+=`<text x="${W-R}" y="${H-2}" text-anchor="end" font-size="10" fill="#82978a">${escapeHTML(axis)}</text></svg>`;
 target.innerHTML=svg;
}
function previewSegments(segments){const copy=segments.map(s=>({...s}));copy[0].temperature=state.online?state.pv:NaN;return copy;}
function curvePoints(segments){if(!segments?.length)return[];let last=0;for(let i=0;i<19;i++)if(segments[i].minutes>0)last=i+1;if(!last)return[];let t=0;return segments.slice(0,last+1).map(s=>{const p=[t,s.temperature];t+=s.minutes;return p;});}
function metrics(segments){const temperatures=curvePoints(segments).map(p=>p[1]).filter(Number.isFinite);return`${temperatures.length?fmt(Math.max(...temperatures),0):'—'} °C máx. · ${fmt(segments.slice(0,19).reduce((v,s)=>v+s.minutes,0),0)} min`;}
function matches(segments){return profiles.filter(p=>p.segments.every((s,i)=>s.minutes===segments[i].minutes&&(i===0||s.temperature===segments[i].temperature)));}
function matchLabel(segments){if(!state.online)return'Coincidencia sin confirmar · desconectado';const m=matches(segments);return m.length?m.map(p=>p.name).join(' / '):'Sin perfil coincidente';}
function memoryMarkup(control=false){return Object.entries(state.memories||{}).map(([id,s])=>`<div class="memory-tile ${Number(id)===state.memory?'active':''}"><h3><span class="memory-number">${id}</span>Memoria ${id}${Number(id)===state.memory?' · SPC':''}</h3><p>${escapeHTML(matchLabel(s))}</p><p>${metrics(s)}</p><button class="button secondary" ${control?'data-preview-memory':'data-copy-memory'}="${id}" ${!state.online||control&&state.state!==0?'disabled':''}>${control?'Revisar y elegir':'Copiar a biblioteca'}</button></div>`).join('')||'<p class="helper">Esperando lectura de memorias.</p>';}
function renderMemories(){const key=JSON.stringify([state.online,state.memory,state.memories,profiles.map(p=>[p.id,p.name,p.updated_at])]);if(key!==lastMemoryKey&&!pointerDown){$('memories').innerHTML=memoryMarkup();lastMemoryKey=key;}const controlKey=key+'|'+state.state;if(controlKey!==lastControlMemoryKey&&!pointerDown){$('control-memories').innerHTML=memoryMarkup(true);lastControlMemoryKey=controlKey;}}
function renderState(){
 const online=!!state.online;
 $('connection').textContent=online?'CJD local · conectado':'CJD local · desconectado';$('connection').className='connection '+(online?'online':'offline');$('version').textContent=state.version?'v'+state.version:'';
 for(const id of ['pv','sv','memory'])$(id).textContent=online?state[id]:'—';
 const label=online?['PARADO','FUNCIONANDO','PAUSADO'][state.state]:'SIN COMUNICACIÓN';$('state-badge').textContent=label;$('state-text').textContent=label;$('state-badge').className='status-badge '+(online&&state.state===1?'running':online&&state.state===2?'paused':'');
 $('step').textContent=online?(state.step<=19?`${state.step} / 19`:'C20 · fin'):'—';$('segment-time').textContent=online?`${state.minutes} min`:'—';$('updated').textContent=state.timestamp?'Lectura '+date(state.timestamp):'Esperando sincronización';
 $('connection-error').hidden=online;$('connection-error').textContent=state.error||'Esperando respuesta.';
 if(online&&state.state===0&&lastState!==null&&lastState!==0)$('run-memory').value='';
 if(online)lastState=state.state;
 const armed=['1','2','3','4'].includes($('run-memory').value);
 $('run-memory').disabled=busy||!online||state.state!==0;
 $('run').disabled=busy||!online||state.state!==0||!armed;$('pause').disabled=busy||!online||state.state!==1;$('resume').disabled=busy||!online||state.state!==2;$('stop').disabled=busy||!online||state.state===0;
 renderMemories();renderProgram();
 const readings=state.recent||[],first=readings.length?new Date(readings[0].timestamp).getTime():0;
 drawChart($('live-chart'),[{color:colors[0],points:readings.map(r=>[(new Date(r.timestamp)-first)/60000,r.pv])},{color:colors[1],dashed:true,points:readings.map(r=>[(new Date(r.timestamp)-first)/60000,r.sv])}],{axis:'tiempo real'});
 if(!$('editor-view').hidden)refreshEditorPV();
 document.querySelectorAll('[data-profile-action="load"]').forEach(b=>b.disabled=busy||!online||state.state!==0);
 updatePhysicalBadges();
}
function renderProgram(){
 const active=state.online&&[1,2].includes(state.state);const memory=active?state.memory:Number($('run-memory').value)||state.memory;
 const source=state.memories?.[memory];if(!source){$('program-chart').innerHTML='<div class="empty">Esperando el programa de las memorias.</div>';$('control-segments').innerHTML='';return;}
 const sameJourney=journey.memory===memory;
 const segments=active||sameJourney?source:previewSegments(source);
 const points=curvePoints(segments);const m=matches(source);
 $('program-title').textContent=`Memoria ${memory}${m.length?' · '+m.map(p=>p.name).join(' / '):''}`;
 $('program-summary').textContent=metrics(source)+(active?' · programa activo':sameJourney?' · último recorrido observado':' · vista previa; C01 será PV');
 const rawStep=state.step;
 let fraction=0;
 if(active&&rawStep>=1&&rawStep<=19){const start=source[rawStep-1].temperature,end=source[rawStep].temperature,t=source[rawStep-1].minutes;fraction=end!==start?(state.sv-start)/(end-start):t>0?state.minutes/t:0;fraction=Math.max(0,Math.min(1,fraction));
  if(journey.active!==state.active_firing||journey.memory!==memory)journey={memory,step:rawStep,fraction,active:state.active_firing};else journey={...journey,step:rawStep,fraction};
 }
 let series=[{color:'#b46d68',points}];
 if(state.online&&journey.memory===memory&&journey.step>0&&points.length>1){const i=Math.min(points.length-2,journey.step-1),from=points[i],to=points[i+1],dot=[from[0]+(to[0]-from[0])*journey.fraction,from[1]+(to[1]-from[1])*journey.fraction];series.push({color:colors[0],points:[...points.slice(0,i+1),dot],dot:colors[1],width:3});}
 drawChart($('program-chart'),series,{axis:'minutos virtuales programados',empty:state.online?'Programa sin tramos con tiempo positivo.':'Vista previa de C01 no disponible sin PV confirmada.'});
 const key=JSON.stringify([memory,source]);if(key!==lastTableKey){$('control-segments').innerHTML=source.slice(0,19).map((s,i)=>`<tr data-control-step="${i+1}"><td>${i+1}</td><td>${i===0?'C01 · ':''}<span data-control-start="${i}">${fmt(segments[i].temperature,0)}</span> °C</td><td>${s.minutes} min</td><td>${source[i+1].temperature} °C</td></tr>`).join('');lastTableKey=key;}
 const initial=document.querySelector('[data-control-start="0"]');if(initial)initial.textContent=fmt(segments[0].temperature,0);
 document.querySelectorAll('[data-control-step]').forEach(row=>{const n=Number(row.dataset.controlStep);row.classList.toggle('segment-active',active&&n===rawStep);row.classList.toggle('segment-completed',state.online&&journey.memory===memory&&n<journey.step);if(active&&n===rawStep)row.setAttribute('aria-current','step');else row.removeAttribute('aria-current');});
 $('segment-target').textContent=active&&rawStep<=19?`Objetivo: ${source[rawStep].temperature} °C`:'Sin tramo activo';
 $('progress-method').textContent=!state.online?'Sin comunicación: el avance no está confirmado.':active?'Avance visual calculado con SV en rampas y CCH en mesetas; no mide la temperatura de la pieza.':'Se conserva el último avance observado; PARADO no permite distinguir por sí solo fin natural de parada manual.';
}
function updatePhysicalBadges(){document.querySelectorAll('[data-match-profile]').forEach(el=>{const p=profiles.find(p=>p.id===el.dataset.matchProfile);if(!p)return;const ids=state.online?Object.entries(state.memories||{}).filter(([,s])=>matches(s).some(m=>m.id===p.id)).map(([id])=>id):[];el.textContent=!state.online?'Memorias sin confirmar':ids.length?'Coincide con memoria '+ids.join(', '):'Solo en biblioteca';});}
function renderEvents(target,events,limit=15){const origins={app:'Aplicación',observed:'Observado',system:'Sistema',import:'Importado'};target.innerHTML=events.length?events.slice(0,limit).map(e=>`<div class="event-row"><time>${escapeHTML(date(e.timestamp))}</time><span>${escapeHTML(e.message)}</span><span class="event-origin">${origins[e.origin]||escapeHTML(e.origin)}</span></div>`).join(''):'<div class="empty">Sin eventos registrados.</div>';}
async function refresh(){try{state=await api('state');renderState();if(page==='control')renderEvents($('events'),await api('events'));}catch(e){state={...state,online:false,error:e.message};renderState();}}
async function command(operation,extra={}){if(busy)throw Error('Espera a que termine la orden anterior.');busy=true;renderState();try{const result=await api('commands',{method:'POST',body:{operation,...extra}});if(result.state)state={...result.state,version:state.version};toast(result.message);await refresh();return result;}finally{busy=false;renderState();}}
async function navigate(next){if(next===page)return;if(dirty&&!await confirmAction('¿Salir del editor?','Los cambios de la curva sin guardar se perderán.'))return;if(firingDirty&&!await confirmAction('¿Salir del historial?','Las observaciones sin guardar se perderán.'))return;
 dirty=false;firingDirty=false;if(!$('editor-view').hidden){$('editor-view').hidden=true;$('curves-list-view').hidden=false;}
 page=next;for(const name of ['control','curves','history'])$('page-'+name).hidden=name!==page;document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));location.hash=page;
 if(page==='curves'){await loadProfiles();renderMemories();}if(page==='history')await loadHistory();}
async function loadProfiles(){profiles=await api('profiles');renderProfileList();lastMemoryKey='';lastControlMemoryKey='';renderMemories();}
function renderProfileList(){const search=$('profile-search').value.toLocaleLowerCase(),filtered=profiles.filter(p=>(p.name+' '+p.notes).toLocaleLowerCase().includes(search));$('profile-count').textContent=`${profiles.length} curvas guardadas`;
 $('profile-list').innerHTML=filtered.length?filtered.map(p=>`<article class="profile-card"><div><h2>${escapeHTML(p.name)}</h2><div class="profile-metrics"><span class="pill">${metrics(p.segments)}</span><span class="pill" data-match-profile="${p.id}"></span></div><p class="profile-description">${escapeHTML(p.notes||'Sin descripción')}</p><p class="profile-meta">Modificada: ${date(p.updated_at)}</p></div><div id="mini-${p.id}" class="chart chart-mini"></div><div class="profile-actions"><button class="button outline" data-profile-action="load" data-id="${p.id}">↑ Cargar</button><button class="button secondary" data-profile-action="edit" data-id="${p.id}">✎ Editar</button><button class="button secondary" data-profile-action="duplicate" data-id="${p.id}">⧉ Duplicar</button><button class="button danger" data-profile-action="delete" data-id="${p.id}">Eliminar</button></div></article>`).join(''):'<div class="empty"><h2>'+ (profiles.length?'No hay coincidencias':'Todavía no tienes curvas guardadas')+'</h2><p>Crea una curva o copia una memoria del simulador.</p></div>';
 for(const p of filtered)drawChart($('mini-'+p.id),[{color:colors[0],points:curvePoints(previewSegments(p.segments))}],{axis:'C01 = PV al cargar / iniciar'});updatePhysicalBadges();renderState();}
async function editProfile(p,ident=null){if(dirty&&!await confirmAction('¿Cambiar de curva?','Los cambios sin guardar se perderán.'))return;selected=ident;draft=structuredClone(p);dirty=false;$('curves-list-view').hidden=true;$('editor-view').hidden=false;$('editor-title').textContent=ident?'Editar curva':'Nueva curva';$('profile-name').value=p.name;$('profile-notes').value=p.notes||'';$('export-profile').disabled=!ident;
 $('segments').innerHTML=p.segments.slice(0,19).map((s,i)=>`<tr><td>${i+1}</td><td>${i===0?'<strong class="initial-pv" id="initial-pv">PV · —</strong>':`<span data-start="${i}">${s.temperature}</span> °C`}</td><td><input type="number" min="0" max="32767" step="1" required value="${s.minutes}" data-minutes="${i}" aria-label="Duración del tramo ${i+1}"></td><td><input type="number" min="0" max="1200" step="1" required value="${p.segments[i+1].temperature}" data-temperature="${i+1}" aria-label="Temperatura final C${i+2}"></td></tr>`).join('');refreshEditorPV();$('profile-name').focus();}
function formProfile(){const fallback=draft?.segments?.[0]?.temperature??0;return{name:$('profile-name').value,notes:$('profile-notes').value,segments:Array.from({length:20},(_,i)=>({temperature:i?Number(document.querySelector(`[data-temperature="${i}"]`).value):state.online?state.pv:fallback,minutes:i<19?Number(document.querySelector(`[data-minutes="${i}"]`).value):0}))};}
function refreshEditorPV(){if($('editor-view').hidden)return;const value=state.online?`${fmt(state.pv,0)} °C`:'sin lectura confirmada';$('editor-pv').textContent=value;$('initial-pv').textContent='PV · '+value;previewCurve();}
function previewCurve(){const p=formProfile();for(let i=1;i<19;i++){const el=document.querySelector(`[data-start="${i}"]`);if(el)el.textContent=fmt(p.segments[i].temperature,0);}const preview=previewSegments(p.segments);drawChart($('profile-chart'),[{color:colors[0],points:curvePoints(preview)}],{axis:'minutos programados · C01 = PV'});}
async function leaveEditor(){if(dirty&&!await confirmAction('¿Descartar cambios?','La curva guardada no se modificará.'))return;dirty=false;selected=null;draft=null;$('editor-view').hidden=true;$('curves-list-view').hidden=false;await loadProfiles();}
function openLoad(p){loadProfileID=p.id;$('load-summary').innerHTML=`<span>${escapeHTML(p.name)}</span><span>${metrics(p.segments)}</span>`;$('load-choices').innerHTML=[1,2,3,4].map(i=>`<label class="radio-memory"><input type="radio" name="load-memory" value="${i}" required>Memoria ${i}</label>`).join('');$('load-dialog').showModal();}
function filteredHistory(){const search=$('history-search').value.toLocaleLowerCase(),status=$('history-state').value,from=$('history-from').value,to=$('history-to').value;return firings.filter(f=>{const d=new Date(f.started_at),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return(!search||(f.name+' '+f.id+' '+f.curve_name).toLocaleLowerCase().includes(search))&&(!status||f.status===status)&&(!from||day>=from)&&(!to||day<=to);});}
function historyRow(f){const elapsed=f.first_reading&&f.last_reading?(new Date(f.last_reading)-new Date(f.first_reading))/1000:null;return`<div class="history-item ${selectedFirings.has(f.id)?'selected':''}"><input type="checkbox" data-compare="${f.id}" ${selectedFirings.has(f.id)?'checked':''} aria-label="Seleccionar ${escapeHTML(f.name)}"><div class="history-main"><strong>${escapeHTML(f.name)}</strong><small>#${f.id.slice(0,10)} · ${date(f.started_at)} · ${states[f.status]||escapeHTML(f.status)} · ${f.samples} lecturas · memoria ${f.memory}</small></div><div class="history-item-metric"><small>Máxima PV</small><strong>${fmt(f.pv_max)} °C</strong></div><div class="history-item-metric"><small>Duración entre lecturas</small><strong>${duration(elapsed)}</strong></div><button class="button secondary" data-firing="${f.id}">Ver detalle</button></div>`;}
function renderHistory(){const rows=filteredHistory();$('history-count').textContent=`Mostrando ${rows.length} de ${firings.length} cocciones. La selección se conserva al filtrar.`;let html='';if($('history-group').checked){const groups=new Map();for(const f of rows){const key=f.curve_key||'unknown';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}html=[...groups].map(([key,items])=>`<section class="history-group"><h3>${key==='unknown'?'Sin snapshot de curva':escapeHTML(items[0].curve_name||'Programa registrado')} · ${items.length}</h3>${items.map(historyRow).join('')}</section>`).join('');}else html=rows.map(historyRow).join('');$('firings').innerHTML=html||'<div class="empty">No hay cocciones para estos filtros.</div>';$('selection-count').textContent=selectedFirings.size+' seleccionadas';}
async function loadHistory(){firings=await api('firings');selectedFirings=new Set([...selectedFirings].filter(id=>firings.some(f=>f.id===id)));const key=JSON.stringify([firings,Array.from(selectedFirings),$('history-group').checked]);if(key!==historyListKey&&!pointerDown){renderHistory();historyListKey=key;}}
function eventMarkers(f,color){return f.events.filter(e=>['state','started','offline','online','interrupted'].includes(e.kind)).map(e=>({minute:(new Date(e.timestamp)-new Date(f.started_at))/60000,label:`${f.name}: ${e.message}`,color}));}
function renderHistoryChart(){const series=[],deviations=[],markers=[];for(const [i,f] of details.entries()){const origin=new Date(f.started_at);series.push({color:colors[i],points:f.readings.map(r=>[(new Date(r.timestamp)-origin)/60000,r.pv])});if($('show-sv').checked)series.push({color:details.length===1?colors[1]:colors[i],dashed:true,points:f.readings.map(r=>[(new Date(r.timestamp)-origin)/60000,r.sv])});deviations.push({color:colors[i],points:f.readings.map(r=>[(new Date(r.timestamp)-origin)/60000,r.pv-r.sv])});markers.push(...eventMarkers(f,colors[i]));}
 drawChart($('history-chart'),series,{markers,axis:'tiempo real desde el inicio · PV continua / SV discontinua'});$('deviation-chart').hidden=!$('show-deviation').checked;if($('show-deviation').checked)drawChart($('deviation-chart'),deviations,{axis:'PV − SV · tiempo real'});
 $('history-legend').innerHTML=details.map((f,i)=>`<span class="series-${i}">${i+1}. ${escapeHTML(f.name)}</span>`).join('');}
function renderStatistics(){
 const metricRows=[['Máxima PV','pv_max',v=>fmt(v)+' °C'],['Duración entre lecturas','duration_seconds',duration],['Desviación media |PV − SV|','mean_abs_deviation',v=>fmt(v)+' °C'],['Continuidad temporal (intervalos ≤ 5 s)','continuity_percent',v=>fmt(v)+' %']];
 if(details.length===1){const s=details[0].statistics;$('history-statistics').innerHTML='<div class="statistics">'+metricRows.map(([label,key,format])=>`<div class="stat"><small>${label}</small><strong>${format(s[key])}</strong></div>`).join('')+'</div>'+`<p class="helper">${s.gaps} huecos mayores de 5 s · ${s.duplicate_or_reversed} intervalos con fechas repetidas o inversas. Los indicadores usan todas las lecturas, no solo los puntos de la gráfica.</p>`;
 }else{const comparable=details[0].curve_key&&details.every(f=>f.curve_key===details[0].curve_key);$('history-statistics').innerHTML=`<h3>Comparación de resultados</h3><p class="helper">${comparable?'Programas coincidentes, ignorando C01.':'Programas diferentes o incompletos: no permiten clasificar qué cocción fue mejor.'}</p><div class="table-scroll"><table class="comparison-table"><thead><tr><th>Indicador</th>${details.map(f=>`<th>${escapeHTML(f.name)}</th>`).join('')}</tr></thead><tbody>${metricRows.map(([label,key,format])=>`<tr><td>${label}</td>${details.map(f=>`<td>${format(f.statistics[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="comparison-notes">${details.map(f=>`<div class="note-preview"><h3>${escapeHTML(f.name)}</h3>${escapeHTML(f.notes||'Sin observaciones personales.')}</div>`).join('')}</div>`;}
 const numbers=[...new Set(details.flatMap(f=>f.statistics.segments.map(s=>`${s.memory}:${s.step}`)))].sort((a,b)=>Number(a.split(':')[1])-Number(b.split(':')[1]));
 $('history-segments').innerHTML='<h3>Tramos y comportamiento observado</h3><table><thead><tr><th>Memoria / tramo</th>'+details.map(f=>`<th>${escapeHTML(f.name)}<br>Tiempo observado / |PV − SV| / muestras</th>`).join('')+'</tr></thead><tbody>'+numbers.map(key=>'<tr><td>'+key.replace(':',' / ')+'</td>'+details.map(f=>{const s=f.statistics.segments.find(s=>`${s.memory}:${s.step}`===key);return`<td>${s?duration(s.observed_seconds)+' / '+fmt(s.mean_abs_deviation)+' °C / '+s.samples:'—'}</td>`;}).join('')+'</tr>').join('')+'</tbody></table><p class="helper">Tiempo observado: solo intervalos consecutivos de hasta 5 s dentro del mismo tramo y memoria. Un mismo número puede representar temperaturas distintas en programas diferentes. La desviación no es una valoración de calidad.</p>';
}
async function showFiring(ids){if(firingDirty&&!await confirmAction('¿Cambiar de cocción?','Las observaciones sin guardar se perderán.'))return;details=await Promise.all(ids.map(id=>api('firings/'+id)));firingDirty=false;detailID=ids.length===1?ids[0]:null;
 $('history-detail').hidden=false;$('export-firing').hidden=!detailID;$('firing-form').hidden=!detailID;$('history-title').textContent=detailID?details[0].name:'Comparación de cocciones';$('history-subtitle').textContent=details.map(f=>`${f.name} · ${f.samples} lecturas`).join(' | ');
 renderHistoryChart();renderStatistics();const f=details[0];$('history-snapshot').textContent=detailID?(f.snapshot.length?'Snapshot de la curva real utilizada: C01 inicial conservada; la PV siguió variando durante el proceso.':'CSV sin snapshot del programa: no se reconstruye una curva supuesta.'):'Cada serie comienza en su propio inicio; se comparan PV y, opcionalmente, SV. Los marcadores identifican eventos registrados.';
 $('snapshot-detail').hidden=!detailID||!f.snapshot.length;$('snapshot-table').innerHTML=detailID?'<table><thead><tr><th>Punto</th><th>°C</th><th>Minutos</th></tr></thead><tbody>'+f.snapshot.map((s,i)=>`<tr><td>C${i+1}</td><td>${s.temperature}</td><td>${s.minutes}</td></tr>`).join('')+'</tbody></table>':'';
 if(detailID){$('firing-name').value=f.name;$('firing-notes').value=f.notes||'';$('delete-firing').disabled=!f.ended_at;}
 renderEvents($('history-events'),details.flatMap(f=>f.events.map(e=>({...e,message:details.length>1?f.name+': '+e.message:e.message}))).sort((a,b)=>b.timestamp.localeCompare(a.timestamp)),10000);
 $('history-detail').scrollIntoView({behavior:'smooth',block:'start'});
}
for(const b of document.querySelectorAll('[data-page]'))b.onclick=safe(()=>navigate(b.dataset.page));
document.querySelector('.brand').onclick=safe(async e=>{e.preventDefault();await navigate('control');});
$('run-memory').onchange=()=>{renderState();};
$('control-memories').onclick=safe(async e=>{const b=e.target.closest('[data-preview-memory]');if(b){$('run-memory').value=b.dataset.previewMemory;renderState();}});
$('run').onclick=safe(async()=>{const memory=Number($('run-memory').value);if(![1,2,3,4].includes(memory))throw Error('Elige explícitamente una memoria antes de iniciar.');if(await confirmAction('Iniciar desde memoria '+memory,`Se utilizará el programa ya verificado de la memoria ${memory}. C01 se adapta a PV antes de RUN. No se carga un perfil de la biblioteca en esta acción.`))await command('run',{memory});});
$('pause').onclick=safe(()=>command('pause'));$('resume').onclick=safe(()=>command('resume'));
$('stop').onclick=safe(async()=>{if(await confirmAction('Parar la cocción','Se enviará STOP y se comprobará PARADO. El historial conservará las lecturas y eventos.'))await command('stop');});
for(const b of document.querySelectorAll('[data-sim]'))b.onclick=safe(()=>command('simulate',{action:b.dataset.sim}));
$('new-profile').onclick=safe(()=>editProfile({name:'',notes:'',segments:Array.from({length:20},(_,i)=>({temperature:i?100:state.online?state.pv:0,minutes:i===0?10:0}))}));
$('profile-search').oninput=renderProfileList;
$('profile-list').onclick=safe(async e=>{const b=e.target.closest('[data-profile-action]');if(!b)return;const p=profiles.find(p=>p.id===b.dataset.id);if(!p)throw Error('Curva no disponible.');switch(b.dataset.profileAction){case'edit':await editProfile(p,p.id);break;case'load':openLoad(p);break;case'duplicate':{const copy=await api('profiles',{method:'POST',body:{...p,name:(p.name+' · copia').slice(0,120)}});await loadProfiles();toast('Curva duplicada: '+copy.name);break;}case'delete':if(await confirmAction('Eliminar '+p.name,'Se elimina solo el perfil local. Las memorias y snapshots del historial permanecen.')){await api('profiles/'+p.id,{method:'DELETE'});await loadProfiles();toast('Curva eliminada.');}break;}});
$('profile-form').oninput=()=>{dirty=true;previewCurve();};
$('profile-form').onsubmit=safe(async e=>{e.preventDefault();const p=await api('profiles'+(selected?'/'+selected:''),{method:selected?'PUT':'POST',body:formProfile()});dirty=false;await loadProfiles();await editProfile(p,p.id);toast('Curva guardada. No se ha escrito en el programador.');});
$('back-curves').onclick=safe(leaveEditor);$('cancel-editor').onclick=safe(leaveEditor);
$('export-profile').onclick=safe(()=>download('profiles/'+selected+'/csv','curva.csv'));
$('memories').onclick=safe(async e=>{const b=e.target.closest('[data-copy-memory]');if(!b)return;const id=Number(b.dataset.copyMemory);const source=state.memories[id],m=matches(source);if(m.length){await editProfile(m[0],m[0].id);return;}await editProfile({name:'Copia de memoria '+id,notes:'Recuperada del simulador; revisa y guarda para incorporarla a la biblioteca.',segments:source});});
$('cancel-load').onclick=()=>$('load-dialog').close();
$('load-form').onsubmit=safe(async e=>{e.preventDefault();const memory=Number(new FormData($('load-form')).get('load-memory'));if(![1,2,3,4].includes(memory))throw Error('Elige una memoria de destino.');$('confirm-load').disabled=true;try{await command('load',{memory,profile_id:loadProfileID});$('load-dialog').close();await loadProfiles();}finally{$('confirm-load').disabled=false;}});
for(const id of ['history-search','history-state','history-from','history-to','history-group'])$(id).addEventListener(id==='history-search'?'input':'change',renderHistory);
$('refresh-history').onclick=safe(loadHistory);
$('firings').onchange=safe(async e=>{const id=e.target.dataset.compare;if(!id)return;if(e.target.checked){if(selectedFirings.size>=7){e.target.checked=false;throw Error('La comparación admite hasta 7 cocciones.');}selectedFirings.add(id);}else selectedFirings.delete(id);renderHistory();});
$('firings').onclick=safe(async e=>{const b=e.target.closest('[data-firing]');if(b)await showFiring([b.dataset.firing]);});
$('compare').onclick=safe(async()=>{if(selectedFirings.size<2)throw Error('Selecciona entre 2 y 7 cocciones terminadas.');if([...selectedFirings].some(id=>!firings.find(f=>f.id===id)?.ended_at))throw Error('Para comparar, elige cocciones que ya hayan terminado.');await showFiring([...selectedFirings]);});
$('clear-selection').onclick=()=>{selectedFirings.clear();renderHistory();};
$('show-sv').onchange=renderHistoryChart;$('show-deviation').onchange=renderHistoryChart;
$('export-firing').onclick=safe(()=>download('firings/'+detailID+'/csv','coccion-'+detailID+'.csv'));
$('firing-form').oninput=()=>{firingDirty=true;};
$('firing-form').onsubmit=safe(async e=>{e.preventDefault();await api('firings/'+detailID,{method:'PUT',body:{name:$('firing-name').value,notes:$('firing-notes').value}});firingDirty=false;await loadHistory();await showFiring([detailID]);toast('Nombre y observaciones guardados.');});
$('delete-firing').onclick=safe(async()=>{if(await confirmAction('Eliminar esta cocción','Se eliminarán sus lecturas, snapshot, eventos y observaciones. Los perfiles y las memorias no se modifican.')){await api('firings/'+detailID,{method:'DELETE'});selectedFirings.delete(detailID);detailID=null;details=[];firingDirty=false;$('history-detail').hidden=true;await loadHistory();toast('Cocción eliminada.');}});
$('backup').onclick=safe(()=>download('backup','cjd-backup.sqlite3'));
for(const[id,type]of[['import-profile','profiles'],['import-firing','firings']])$(id).onclick=()=>{importType=type;$('csv-file').value='';$('csv-file').click();};
$('csv-file').onchange=safe(async()=>{const file=$('csv-file').files[0];if(!file)return;if(file.size>32*1024*1024)throw Error('El archivo supera 32 MiB.');const result=await api(importType+'/import',{method:'POST',headers:{'Content-Type':'text/csv'},body:await file.text()});if(importType==='profiles'){await loadProfiles();await editProfile(result,result.id);}else await loadHistory();toast('CSV importado.');});
$('auth-form').onsubmit=safe(async e=>{e.preventDefault();token=$('access-token').value;await api('state');sessionStorage.setItem('cjd-token',token);$('access-token').value='';$('auth-dialog').close();await loadProfiles();await refresh();});
window.addEventListener('beforeunload',e=>{if(dirty||firingDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',safe(async()=>{const next=location.hash.slice(1);if(['curves','control','history'].includes(next)&&next!==page)await navigate(next);}));
async function init(){await refresh();try{await loadProfiles();const initial=location.hash.slice(1);if(['curves','history'].includes(initial))await navigate(initial);}catch(e){if(!$('auth-dialog').open)toast(e.message,true);}async function tick(){await refresh();if(page==='history'){try{await loadHistory();}catch{}}setTimeout(tick,2000);}setTimeout(tick,2000);}
init();
