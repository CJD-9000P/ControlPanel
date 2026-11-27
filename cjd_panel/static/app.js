'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = stamp => stamp ? new Date(stamp).toLocaleString('es-ES') : '—';
const fmt = (v,d=1) => Number.isFinite(v)?v.toLocaleString('es-ES',{maximumFractionDigits:d}):'—';
const duration = seconds => Number.isFinite(seconds)?`${Math.floor(seconds/3600)} h ${Math.floor(seconds%3600/60)} min ${Math.floor(seconds%60)} s`:'—';
const states={running:'En curso',paused:'Pausada',ended:'Finalizada',interrupted:'Interrumpida',imported:'Importada'};
const colors=['#11a77c','#d97706','#8b5cf6','#2386e2','#cf4779','#778b17','#a46a39'];
let state={},profiles=[],selected=null,draft=null,dirty=false,firingDirty=false,busy=false,page='control';
let firings=[],selectedFirings=new Set(),details=[],detailID=null,loadProfileID=null,importType=null,token=sessionStorage.getItem('cjd-token')||'';
let requestedUpdate=null,lastUpdateError=null;
let pointerDown=false;
window.addEventListener('pointerdown',()=>{pointerDown=true;},{passive:true});
window.addEventListener('pointerup',()=>{setTimeout(()=>{pointerDown=false;},0);},{passive:true});
window.addEventListener('pointercancel',()=>{pointerDown=false;},{passive:true});
let toastTimer,lastControlMemoryKey='',lastMemoryKey='',lastTableKey='',lastProfileKey='',historyListKey='';
let segmentClock=null;
let journey={memory:null,step:0,fraction:0,active:null},lastState=null,lastModeGeneration=null;
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?10000:5000);}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){toast(e.message,true);}};}
async function api(path,options={}){
 const headers={'X-CJD-Request':'1',...options.headers};if(token)headers.Authorization='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode(':'+token)));
 if(options.body&&typeof options.body!=='string'){options.body=JSON.stringify(options.body);headers['Content-Type']='application/json';}
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),options.method&&options.method!=='GET'?20000:12000);
 try{const response=await fetch('/api/'+path,{...options,headers,cache:'no-store',signal:controller.signal});
 if(response.status===401){if(!$('auth-dialog').open)$('auth-dialog').showModal();throw Error('Se necesita la clave de acceso.');}
 if(!response.ok){const data=await response.json();throw Error(data.error||'No se pudo completar la operación.');}
 return await (options.download?response.blob():response.json());
 }catch(e){if(e.name==='AbortError')throw Error('El servidor local no responde a tiempo; consulta el estado antes de repetir una orden.');throw e;}finally{clearTimeout(timeout);}
}
async function download(path,name){const blob=await api(path,{download:true});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function confirmAction(title,message,{allowSchedule=false}={}){const dialog=$('confirm-dialog');if(dialog.open)return false;$('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-schedule').hidden=!allowSchedule;$('confirm-submit').textContent=allowSchedule?'Iniciar ahora':'Confirmar';dialog.returnValue='cancel';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(allowSchedule&&dialog.returnValue==='schedule'?'schedule':dialog.returnValue==='confirm'),{once:true}));}
function timeScale(maximum){
 const max=maximum>0?maximum:1/60;
 const seconds=max*60,steps=[1,2,5,10,15,20,30,60,120,300,600,900,1800,3600,7200,14400,21600,43200,86400];
 const step=steps.find(v=>v>=seconds/5)||Math.ceil(seconds/5/86400)*86400;
 const ticks=[0];
 for(let tick=step;tick<=seconds-step/2;tick+=step)ticks.push(tick/60);
 ticks.push(max);
 const format=v=>seconds<300?fmt(v*60,0)+' s':seconds<7200?fmt(v)+' min':fmt(v/60)+' h';
 return {max,ticks,format};
}
function drawChart(target,series,{empty='No hay lecturas disponibles.',markers=[],bands=[],axis='minutos',scale=null,deviation=false,plotWidth=0,plotHeight=340}={}){
 const values=series.flatMap(s=>s.points).filter(p=>p.every(Number.isFinite));
 if(!values.length){target.innerHTML=`<div class="empty">${escapeHTML(empty)}</div>`;return;}
 const W=plotWidth||860,H=plotHeight;
 const L=plotWidth?42:60,R=plotWidth?28:20,T=plotWidth?25:70,B=42;
 const domain=scale||timeScale(Math.max(...values.map(p=>p[0]))),maxX=domain.max;
 const maxRaw=Math.max(...values.map(p=>p[1])),minRaw=Math.min(...values.map(p=>p[1]));
 const step=maxRaw<=50?10:maxRaw<=150?25:maxRaw<=400?50:100;
 const extent=Math.max(5,Math.ceil(Math.max(Math.abs(maxRaw),Math.abs(minRaw))/5)*5);
 const maxY=deviation?extent:Math.max(step,Math.ceil(maxRaw/step)*step),minY=deviation?-extent:Math.min(0,Math.floor(minRaw/step)*step);
 const x=v=>L+v/maxX*(W-L-R),y=v=>H-B-(v-minY)/(maxY-minY)*(H-T-B);
 let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${deviation?'Desviación registrada PV menos SV':'Temperatura'} en grados Celsius frente a tiempo" data-time-max="${maxX}"><text x="8" y="16" fill="#a0aaa5" font-size="11">${deviation?'PV − SV · °C':'°C'}</text>`;
 for(const band of bands){const start=Math.max(0,Math.min(maxX,band.start)),end=Math.max(0,Math.min(maxX,band.end));if(end>start)svg+=`<rect x="${x(start)}" y="${T}" width="${x(end)-x(start)}" height="${H-B-T}" fill="${band.kind==='pause'?'#60a5fa':'#a0aaa5'}" opacity=".13"><title>${escapeHTML(band.label)}</title></rect>`;}
 for(let i=0;i<=4;i++){const v=minY+(maxY-minY)*i/4;svg+=`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="${deviation&&v===0?'#c4d0c8':'#343a37'}" stroke-dasharray="3 5"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="#a0aaa5">${fmt(v)}</text>`;}
 for(const v of domain.ticks)svg+=`<text x="${x(v)}" y="${H-16}" text-anchor="${v===maxX?'end':'middle'}" fill="#a0aaa5" font-size="11">${domain.format(v)}</text>`;
 for(const [i,m] of markers.entries()){if(!Number.isFinite(m.minute)||m.minute<0||m.minute>maxX)continue;const lane=28+(i%3)*14;svg+=`<line x1="${x(m.minute)}" y1="${T}" x2="${x(m.minute)}" y2="${H-B}" stroke="${m.color}" stroke-dasharray="4 5" opacity=".5"><title>${escapeHTML(m.label)}</title></line>${m.tag?`<text x="${Math.min(W-R-25,x(m.minute)+3)}" y="${lane}" fill="${m.color}" font-size="11">${escapeHTML(m.tag)}<title>${escapeHTML(m.label)}</title></text>`:`<circle cx="${x(m.minute)}" cy="${lane}" r="4" fill="${m.color}"><title>${escapeHTML(m.label)}</title></circle>`}`;}
 for(const s of series){let runs=[],run=[];for(const p of s.points){if(p.every(Number.isFinite))run.push(p);else if(run.length){runs.push(run);run=[];}}if(run.length)runs.push(run);
 for(const points of runs){if(s.nodes)svg+=points.map((p,i)=>`<circle cx="${x(p[0])}" cy="${y(p[1])}" r="4" fill="${s.color}" stroke="#151718" stroke-width="1.5"><title>${i===0?'Inicio C01':'Fin del tramo '+i} · ${fmt(p[0])} min · ${fmt(p[1])} °C</title></circle>`).join('');svg+=`<polyline fill="none" stroke="${s.color}" stroke-width="${s.width||2.5}" stroke-linecap="round" stroke-linejoin="round" ${s.dotted?'stroke-dasharray="2 5"':s.dashed?'stroke-dasharray="7 4"':''} points="${points.map(p=>`${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(' ')}"/>`;if(points.length===1||s.dot){const p=points.at(-1);svg+=`<circle cx="${x(p[0])}" cy="${y(p[1])}" r="${s.dot?5:2.5}" fill="${s.dot||s.color}"/>`;}}
 }
 svg+=`<text x="${W-R}" y="${H-2}" text-anchor="end" font-size="10" fill="#82978a">${escapeHTML(axis)}</text></svg>`;target.innerHTML=svg;
}
function previewSegments(segments){const copy=segments.map(s=>({...s}));copy[0].temperature=state.online?state.pv:NaN;return copy;}
function curvePoints(segments){if(!segments?.length)return[];let last=0;for(let i=0;i<19;i++)if(segments[i].minutes>0)last=i+1;if(!last)return[];let t=0;return segments.slice(0,last+1).map(s=>{const p=[t,s.temperature];t+=s.minutes;return p;});}
function metrics(segments){const temperatures=curvePoints(segments).map(p=>p[1]).filter(Number.isFinite);return`${temperatures.length?fmt(Math.max(...temperatures),0):'—'} °C máx. · ${fmt(segments.slice(0,19).reduce((v,s)=>v+s.minutes,0),0)} min`;}
function matches(segments){return profiles.filter(p=>p.segments.every((s,i)=>s.minutes===segments[i].minutes&&(i===0||s.temperature===segments[i].temperature)));}
function matchLabel(segments){if(!state.online)return'Coincidencia sin confirmar · desconectado';const m=matches(segments);return m.length?m.map(p=>p.name).join(' / '):'Sin perfil coincidente';}
function memoryMarkup(control=false){return Object.entries(state.memories||{}).map(([id,s])=>{
 const chosen=control&&$('run-memory').value===id;
 const disabled=busy||!state.online||control&&state.state!==0;
 const title=`<span class="memory-number">${id}</span>${control?'Memoria '+id:escapeHTML(matchLabel(s))}${control&&Number(id)===state.memory?' · SPC':''}`;
 return control?`<button type="button" class="memory-tile memory-choice ${chosen?'active':''}" data-preview-memory="${id}" aria-pressed="${chosen}" ${disabled?'disabled':''}><strong>${title}</strong><span>${escapeHTML(matchLabel(s))}</span><small>${metrics(s)}</small></button>`:`<button type="button" class="memory-tile memory-choice" data-copy-memory="${id}" ${disabled?'disabled':''}><strong>${title}</strong><small>${metrics(s)}</small><span>${matches(s).length?'Pulsa para ver perfil coincidente':'Pulsa para crear un perfil desde esta memoria'}</span></button>`;
 }).join('')||'<p class="helper">Esperando lectura de memorias.</p>';}
function renderMemories(){const key=JSON.stringify([state.online,state.memory,state.memories,busy,profiles.map(p=>[p.id,p.name,p.updated_at])]);if(key!==lastMemoryKey&&!pointerDown){$('memories').innerHTML=memoryMarkup();lastMemoryKey=key;}const controlKey=key+'|'+state.state+'|'+$('run-memory').value+'|'+busy;if(controlKey!==lastControlMemoryKey&&!pointerDown){$('control-memories').innerHTML=memoryMarkup(true);lastControlMemoryKey=controlKey;}}
function renderState(){
 const online=!!state.online;
 const mqtt=state.mqtt||{},mqttLabel=$('mqtt-connection');
 const mqttOnline=!state.server_unavailable&&mqtt.connected&&mqtt.subscribed;
 const mqttPending=!state.server_unavailable&&mqtt.connected&&!mqtt.subscribed;
 mqttLabel.hidden=false;
 mqttLabel.textContent=!mqtt.enabled?'MQTT · Desactivado':state.server_unavailable?'MQTT · Desconocido':mqttOnline?'MQTT · Conectado':mqttPending?'MQTT · Conectando':'MQTT · Desconectado';
 mqttLabel.className='connection '+(mqttOnline?'online':mqttPending||!mqtt.enabled?'pending':'offline');
 mqttLabel.title=mqtt.error||'Ver estado de la conexión MQTT con Home Assistant';
 $('mqtt-detail-status').textContent=!mqtt.enabled?'MQTT está desactivado.':state.server_unavailable?'No se puede confirmar la conexión: el servidor local no responde.':mqttOnline?'Conexión y suscripciones MQTT confirmadas.':mqtt.error||'Esperando conexión y suscripciones MQTT.';
 $('mqtt-detail-broker').textContent=mqtt.enabled?`${mqtt.host}:${mqtt.port}`:'—';
 $('mqtt-detail-prefix').textContent=mqtt.topic_prefix||'—';
 $('mqtt-detail-pending').textContent=state.server_unavailable?'Sin confirmar':Number.isInteger(mqtt.history_pending)?String(mqtt.history_pending):'—';
 const update=state.update||{};
 $('update-program').hidden=!update.version||!state.update_idle||!!state.server_unavailable||!!requestedUpdate;
 $('update-program').disabled=busy;
 if(update.error&&update.error!==lastUpdateError){
  lastUpdateError=update.error;
  requestedUpdate=null;
  toast(update.error,true);
 }
 if(!update.error)lastUpdateError=null;
 if(requestedUpdate&&state.version===requestedUpdate&&!state.server_unavailable){
  requestedUpdate=null;
  if(!dirty&&!firingDirty)location.reload();
  else toast('Programa actualizado. Guarda tus cambios y recarga el panel.');
 }
 const physical=state.mode==='physical';
 document.querySelector('.topbar').classList.toggle('simulator-mode',state.mode==='simulator');
 $('connection').textContent=online?'MODBUS · Conectado':state.server_unavailable?'MODBUS · Desconocido':state.communication_status==='connecting'?'MODBUS · Conectando':'MODBUS · Desconectado';
 $('connection').className='connection '+(online?'online':state.communication_status==='connecting'?'pending':'offline');
 $('connection').title=physical?(state.port||''):'Adaptador del simulador';
 const connectionMode=$('connection-mode');
 const selectedPort=physical?state.port:null;
 const detectedPorts=state.serial_ports||[];
 const fallbackPort=selectedPort||(!detectedPorts.length&&state.configured_port);
 const ports=[...new Set([...detectedPorts,...(fallbackPort?[fallbackPort]:[])])];
 if(JSON.stringify(ports)!==connectionMode.dataset.ports){
  const options=ports.map((port,index)=>{
   const label=/^\/dev\/tty(?:USB|ACM)\d+$/.test(port)?port:`USB ${index+1}`;
   const option=new Option(label,port);
   option.title=port;
   return option;
  });
  connectionMode.replaceChildren(new Option('Simulador','simulator'),...options);
  connectionMode.dataset.ports=JSON.stringify(ports);
 }
 connectionMode.value=selectedPort||'simulator';
 connectionMode.title=selectedPort||'Seleccionar conexión';
 connectionMode.disabled=busy||!!state.server_unavailable||!state.physical_usb_supported||!!state.active_firing||[1,2].includes(state.state);
 $('mode-label').textContent=physical?'':'SIMULADOR AISLADO';$('mode-label').hidden=physical;
 $('mode-description').parentElement.hidden=physical;
 document.querySelectorAll('[data-sim]').forEach(b=>b.disabled=busy||physical);
 if(lastModeGeneration!==null&&lastModeGeneration!==state.mode_generation){$('run-memory').value='';journey={memory:null,step:0,fraction:0,active:null};lastControlMemoryKey=lastMemoryKey=lastTableKey='';}
 lastModeGeneration=state.mode_generation;
 $('version').textContent=state.version?'v'+state.version:'';
 for(const id of ['pv','sv'])$(id).textContent=online?state[id]:'—';
 const scheduled=state.scheduled_start;
 const pendingStart=online&&state.state===0&&!!scheduled;
 const label=online?['PARADO','FUNCIONANDO','PAUSADO'][state.state]:'SIN COMUNICACIÓN';
 $('state-text').textContent=pendingStart?'INICIO PROGRAMADO':label;
 const stateClass=online?({0:'stopped',1:'running',2:'paused'}[state.state]||''):'';
 $('programmer-state').className='metric state-metric '+(pendingStart?'scheduled':stateClass);
 $('step').textContent=online?(state.step<=19?`${state.step} / 19`:'C20 · fin'):'—';$('updated').textContent=state.timestamp?'Lectura '+date(state.timestamp):'Esperando sincronización';
 $('connection-error').hidden=online;$('connection-error').textContent=state.error||'Esperando respuesta.';
 if(online&&state.state===0&&lastState!==null&&lastState!==0)$('run-memory').value='';
 if(online)lastState=state.state;
 const scheduleLocked=busy||!online||state.state!==0||!!scheduled;
 $('start-date').disabled=scheduleLocked;
 $('start-hour').disabled=$('start-minute').disabled=scheduleLocked||!$('start-date').value;
 $('scheduled-start').hidden=!scheduled;
 $('cancel-start').hidden=!scheduled;
 $('stop').hidden=!!scheduled&&state.state===0;
 $('cancel-start').disabled=busy||!!state.server_unavailable;
 if(scheduled){
  const minutes=Math.max(0,Math.ceil((Date.parse(scheduled.start_at)-Date.now())/60000));
  $('start-countdown').textContent=`Memoria ${scheduled.memory} · ${date(scheduled.start_at)} · faltan ${Math.floor(minutes/60)} h ${minutes%60} min`;
 }
 $('run-memory').disabled=busy||!online||state.state!==0;
 $('run').disabled=scheduleLocked;$('pause').disabled=busy||!online||state.state!==1;$('resume').disabled=busy||!online||state.state!==2;$('stop').disabled=busy||!online||state.state===0;
 $('control-memories').hidden=[1,2].includes(state.state);$('memory-choice-help').hidden=[1,2].includes(state.state);
 renderMemories();renderProgram();renderSegmentTime();
 const readings=state.recent||[],first=readings.length?new Date(readings[0].timestamp).getTime():0;
 drawChart($('live-chart'),[{color:colors[0],points:readings.map(r=>[(new Date(r.timestamp)-first)/60000,r.pv])},{color:colors[1],dashed:true,points:readings.map(r=>[(new Date(r.timestamp)-first)/60000,r.sv])}],{axis:'tiempo real'});
 if(!$('editor-view').hidden)refreshEditorPV();
 document.querySelectorAll('[data-profile-action="load"]').forEach(b=>b.disabled=busy||!online||state.state!==0);
 updatePhysicalBadges();
}
function renderSegmentTime(){
 const {online,state:runState,active_firing,memory,step,minutes,mode_generation}=state;
 const total=step>=1&&step<=19?state.memories?.[memory]?.[step-1]?.minutes:null;
 const progress=$('segment-progress'),caption=$('segment-percentage');
 if(!online||![1,2].includes(runState)||!Number.isInteger(minutes)||minutes<0||total==null){
  segmentClock=null;
  $('segment-time').textContent='—';
  progress.value=0;
  progress.setAttribute('aria-valuetext','Sin tramo activo');
  caption.hidden=true;
  return;
 }
 // El registro del programador aporta minutos enteros. Los segundos se estiman
 // entre cambios de minuto y se congelan cuando se observa una pausa.
 const key=[mode_generation,active_firing,memory,step,minutes].join(':');
 const now=performance.now();
 if(segmentClock?.key!==key)segmentClock={key,runState,since:now,elapsed:0};
 const clock=segmentClock;
 if(clock.runState!==runState){
  if(runState===2)clock.elapsed+=now-clock.since;
  else clock.since=now;
  clock.runState=runState;
 }
 const seconds=Math.min(59,Math.floor((clock.elapsed+(runState===1?now-clock.since:0))/1000));
 $('segment-time').textContent=`${minutes}:${String(seconds).padStart(2,'0')} / ${total>0?total+':00':'—'}`;
 const percent=total>0?Math.min(100,(minutes*60+seconds)/(total*60)*100):0;
 progress.value=percent;
 caption.hidden=total<=0;
 caption.textContent=`${fmt(percent,0)} % · segundos estimados`;
 progress.setAttribute('aria-valuetext',total>0?caption.textContent:'Sin duración programada');
}
function shortDuration(seconds){
 if(seconds>0&&seconds<1)return '<1 s';
 const total=Math.floor(seconds), hours=Math.floor(total/3600), minutes=Math.floor(total%3600/60);
 return [hours?hours+' h':'',hours||minutes?minutes+' min':'',total%60+' s'].filter(Boolean).join(' ');
}
let programFrame = 0;
function renderProgram(){
 cancelAnimationFrame(programFrame);
 const previous = journey;
 const active=state.online&&[1,2].includes(state.state);const memory=active?state.memory:Number($('run-memory').value)||state.memory;
 const source=state.memories?.[memory];if(!source){$('program-chart').innerHTML='<div class="empty">Esperando el programa de las memorias.</div>';$('control-segments').innerHTML='';return;}
 const sameJourney=journey.memory===memory;
 const completed=state.online&&!active&&state.completed_memory===memory;
 const segments=active||completed||sameJourney?source:previewSegments(source);
 const points=curvePoints(segments);const m=matches(source);
 $('program-title').textContent=`Memoria ${memory}${m.length?' · '+m.map(p=>p.name).join(' / '):''}`;
 $('program-summary').textContent=metrics(source)+(active?' · programa activo':completed?' · programa completado':sameJourney?' · último recorrido observado':' · vista previa; C01 será PV');
 const rawStep=state.step;
 let fraction=0;
 if(active&&rawStep>=1&&rawStep<=19){const start=source[rawStep-1].temperature,end=source[rawStep].temperature,t=source[rawStep-1].minutes;fraction=end!==start?(state.sv-start)/(end-start):t>0?state.minutes/t:0;fraction=Math.max(0,Math.min(1,fraction));
  if(journey.active!==state.active_firing||journey.memory!==memory)journey={memory,step:rawStep,fraction,active:state.active_firing};else journey={...journey,step:rawStep,fraction};
 }
 const chart=$('program-chart');
 const plotWidth=chartContentWidth(chart);
 const confirmed=journey;
 const drawProgress=fraction=>{
  const series=[{color:'#b46d68',points,nodes:true}];
  if(completed&&points.length>1){
   series.push({color:colors[0],points,dot:colors[0],width:3});
  }else if(state.online&&confirmed.memory===memory&&confirmed.step>0&&points.length>1){
   const i=Math.min(points.length-2,confirmed.step-1),from=points[i],to=points[i+1];
   const dot=[from[0]+(to[0]-from[0])*fraction,from[1]+(to[1]-from[1])*fraction];
   series.push({color:colors[0],points:[...points.slice(0,i+1),dot],dot:colors[1],width:3});
  }
  drawChart(chart,series,{plotWidth,axis:'minutos virtuales programados',empty:state.online?'Programa sin tramos con tiempo positivo.':'Vista previa de C01 no disponible sin PV confirmada.'});
 };
 const animate=state.mode==='simulator'&&active&&state.state===1&&page==='control'
  &&!$('program-chart-panel').hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches
  &&previous.active===confirmed.active&&previous.memory===memory
  &&previous.step===confirmed.step&&confirmed.fraction>previous.fraction;
 if(animate){
  const started=performance.now();
  const frame=now=>{
   const weight=Math.min(1,(now-started)/450);
   drawProgress(previous.fraction+(confirmed.fraction-previous.fraction)*weight);
   if(weight<1)programFrame=requestAnimationFrame(frame);
  };
  programFrame=requestAnimationFrame(frame);
 }else drawProgress(confirmed.fraction);
 const key=JSON.stringify([memory,source]);if(key!==lastTableKey){$('control-segments').innerHTML=source.slice(0,19).map((s,i)=>`<tr data-control-step="${i+1}"><td>${i+1}</td><td>${i===0?'C01 · ':''}<span data-control-start="${i}">${fmt(segments[i].temperature,0)}</span> °C</td><td>${s.minutes} min</td><td data-run-duration>—</td><td>${source[i+1].temperature} °C</td></tr>`).join('');lastTableKey=key;}
 const initial=document.querySelector('[data-control-start="0"]');if(initial)initial.textContent=fmt(segments[0].temperature,0);
 document.querySelectorAll('[data-control-step]').forEach(row=>{const n=Number(row.dataset.controlStep);
  const elapsed=state.segment_run_seconds?.[memory]?.[n];
  row.querySelector('[data-run-duration]').textContent=Number.isFinite(elapsed)?shortDuration(elapsed):'—';
  row.classList.toggle('segment-active',active&&n===rawStep);
  row.classList.toggle('segment-completed',completed?source[n-1].minutes>0:state.online&&journey.memory===memory&&n<journey.step);
  if(active&&n===rawStep)row.setAttribute('aria-current','step');else row.removeAttribute('aria-current');});
 $('segment-target').textContent=active&&rawStep<=19?`Objetivo: ${source[rawStep].temperature} °C`:'Sin tramo activo';
 $('progress-method').textContent=!state.online?'Sin comunicación: el avance no está confirmado.':active?'Avance visual calculado con SV en rampas y CCH en mesetas; no mide la temperatura de la pieza.':'';
}
function updatePhysicalBadges(){document.querySelectorAll('[data-match-profile]').forEach(el=>{const p=profiles.find(p=>p.id===el.dataset.matchProfile);if(!p)return;const ids=state.online?Object.entries(state.memories||{}).filter(([,s])=>matches(s).some(m=>m.id===p.id)).map(([id])=>id):[];el.textContent=!state.online?'Memorias sin confirmar':ids.length?'Coincide con '+(ids.length===1?'memoria ':'memorias ')+ids.join(', ')+' del programador':'Solo en biblioteca';});}
function eventMessage(event) {
 if(event.kind!=='scheduled_start')return event.message;
 return event.message.replace(/\((\d{4}-\d{2}-\d{2}T[^)]+)\)\.$/, (original, stamp)=>
  Number.isFinite(Date.parse(stamp))?`(${date(stamp)}).`:original);
}
function renderEvents(target,events,limit=15){const origins={app:'Aplicación',mqtt:'Home Assistant',observed:'Observado',system:'Sistema',import:'Importado'};target.innerHTML=events.length?events.slice(0,limit).map(e=>`<div class="event-row"><time>${escapeHTML(date(e.timestamp))}</time><span>${escapeHTML(eventMessage(e))}</span><span class="event-origin">${origins[e.origin]||escapeHTML(e.origin)}</span></div>`).join(''):'<div class="empty">Sin eventos registrados.</div>';}
const activityPageSize=15, eventBatchSize=100;
let activity=[], activityLimit=activityPageSize, moreActivity=true;
function mergeActivity(events){
 const byId=new Map(activity.map(event=>[event.id,event]));
 for(const event of events)byId.set(event.id,event);
 const merged=[...byId.values()].sort((a,b)=>b.id-a.id);
 const limit=activityLimit+eventBatchSize;
 if(merged.length>limit)moreActivity=true;
 activity=merged.slice(0,limit);
}
function renderActivity(){
 renderEvents($('events'),activity,activityLimit);
 $('more-events').hidden=activityLimit>=activity.length&&!moreActivity;
}
$('more-events').onclick=safe(async()=>{
 const button=$('more-events');
 button.disabled=true;
 try{
  if(activityLimit+activityPageSize>activity.length&&moreActivity&&activity.length){
   const older=await api('events?before='+activity.at(-1).id);
   moreActivity=older.length===eventBatchSize;
   mergeActivity(older);
  }
  activityLimit+=activityPageSize;
  renderActivity();
 }finally{button.disabled=false;}
});
async function refresh({events=true}={}){try{state=await api('state');renderState();}catch(e){state={...state,online:false,server_unavailable:true,error:'Sin comunicación con el servidor local: '+e.message};renderState();return;}
 if(events&&page==='control'){try{
  const latest=await api('events');
  if(!activity.length)moreActivity=latest.length===eventBatchSize;
  mergeActivity(latest);
  renderActivity();
 }catch(e){$('events').textContent='No se pudo actualizar la actividad: '+e.message;}}
}
function commandNotification(operation,extra,result){
 switch(operation){
  case 'run':return `Cocción iniciada en la memoria ${extra.memory}.`;
  case 'pause':return 'Cocción pausada.';
  case 'resume':return 'Cocción reanudada.';
  case 'stop':return 'Cocción detenida.';
  case 'load':{
   const device=result.state?.mode==='simulator'?'el simulador':'el programador';
   return `Curva cargada en la memoria ${extra.memory}. Confirmado por ${device}.`;
  }
  default:return result.message;
 }
}
async function command(operation,extra={}){if(busy)throw Error('Espera a que termine la orden anterior.');busy=true;renderState();try{const result=await api('commands',{method:'POST',body:{operation,...extra}});if(result.state)state={...result.state,version:state.version};toast(commandNotification(operation,extra,result));await refresh();return result;}finally{busy=false;renderState();}}
const helpPages=['ayuda-curvas','ayuda-control','ayuda-cocciones'];
const pages=['control','curves','history',...helpPages];
async function navigate(next){if(next===page)return;if(dirty&&!await confirmAction('¿Salir del editor?','Los cambios de la curva sin guardar se perderán.'))return;if(firingDirty&&!await confirmAction('¿Salir del historial?','Las observaciones sin guardar se perderán.'))return;
 dirty=false;firingDirty=false;if(!$('editor-view').hidden){$('editor-view').hidden=true;$('curves-list-view').hidden=false;}
 page=next;
 for(const name of pages)$('page-'+name).hidden=name!==page;
 $('help-pages').hidden=!helpPages.includes(page);
 document.querySelectorAll('.topbar [data-page]').forEach(link=>link.classList.toggle('active',link.dataset.page===page));
 document.querySelectorAll('.help-nav a').forEach(link=>{
  if(link.dataset.page===page)link.setAttribute('aria-current','page');
  else link.removeAttribute('aria-current');
 });
 location.hash=page;
 if(helpPages.includes(page))$('help-pages').scrollIntoView({block:'start'});
 if(page==='curves'){await loadProfiles();renderMemories();}if(page==='history')await loadHistory();}
async function loadProfiles(){profiles=await api('profiles');renderProfileList();lastMemoryKey='';lastControlMemoryKey='';renderMemories();}
function renderProfileList(){const search=$('profile-search').value.toLocaleLowerCase(),filtered=profiles.filter(p=>(p.name+' '+p.notes).toLocaleLowerCase().includes(search));$('profile-count').textContent=`${profiles.length} curvas guardadas`;
 $('profile-list').innerHTML=filtered.length?filtered.map(p=>`<article id="profile-${escapeHTML(p.id)}" class="profile-card" tabindex="-1"><div><h2>${escapeHTML(p.name)}</h2><div class="profile-metrics"><span class="pill">${metrics(p.segments)}</span><span class="pill" data-match-profile="${p.id}"></span></div><p class="profile-description">${escapeHTML(p.notes||'Sin descripción')}</p><p class="profile-meta">Modificada: ${date(p.updated_at)}</p></div><div id="mini-${p.id}" class="chart chart-mini"></div><div class="profile-actions"><button class="button outline" data-profile-action="load" data-id="${p.id}">↑ Cargar</button><button class="button secondary" data-profile-action="edit" data-id="${p.id}">✎ Editar</button><button class="button secondary" data-profile-action="duplicate" data-id="${p.id}">⧉ Duplicar</button><button class="button secondary" data-profile-action="delete" data-id="${p.id}">Eliminar</button></div></article>`).join(''):'<div class="empty"><h2>'+ (profiles.length?'No hay coincidencias':'Todavía no tienes curvas guardadas')+'</h2><p>Crea una curva o copia una memoria del programador.</p></div>';
 drawProfileCharts();updatePhysicalBadges();renderState();}
function chartContentWidth(chart){
 if(!chart?.clientWidth)return 0;
 const style=getComputedStyle(chart);
 return Math.round(chart.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));
}
function drawProfileCharts(){
 const plotWidth=chartContentWidth($('profile-list').querySelector('.chart-mini'));
 if(!plotWidth)return;
 for(const p of profiles){
  const chart=$('mini-'+p.id);
  if(chart)drawChart(chart,[{color:colors[0],points:curvePoints(previewSegments(p.segments)),nodes:true}],
   {axis:'C01 = PV al cargar / iniciar',plotWidth,plotHeight:200});
 }
}
for(const [id,render] of [['profile-list',drawProfileCharts],['program-chart',renderProgram]]){
 let previousWidth=0;
 new ResizeObserver(([entry])=>{
  const width=entry.contentRect.width;
  if(width===previousWidth)return;
  previousWidth=width;
  if(width)render();
 }).observe($(id));
}
async function editProfile(p,ident=null){if(dirty&&!await confirmAction('¿Cambiar de curva?','Los cambios sin guardar se perderán.'))return;selected=ident;draft=structuredClone(p);dirty=false;$('curves-list-view').hidden=true;$('editor-view').hidden=false;$('editor-title').textContent=ident?'Editar curva':'Nueva curva';$('profile-name').value=p.name;$('profile-notes').value=p.notes||'';$('export-profile').disabled=!ident;
 $('segments').innerHTML=p.segments.slice(0,19).map((s,i)=>`<tr><td>${i+1}</td><td>${i===0?'<strong class="initial-pv" id="initial-pv">PV · —</strong>':`<span data-start="${i}">${s.temperature}</span> °C`}</td><td><input type="number" min="0" max="32767" step="1" required value="${s.minutes}" data-minutes="${i}" aria-label="Duración del tramo ${i+1}"></td><td><input type="number" min="0" max="1200" step="1" required value="${p.segments[i+1].temperature}" data-temperature="${i+1}" aria-label="Temperatura final C${i+2}"></td></tr>`).join('');refreshEditorPV();$('profile-name').focus();}
function formProfile(){const fallback=draft?.segments?.[0]?.temperature??0;return{name:$('profile-name').value,notes:$('profile-notes').value,segments:Array.from({length:20},(_,i)=>({temperature:i?Number(document.querySelector(`[data-temperature="${i}"]`).value):state.online?state.pv:fallback,minutes:i<19?Number(document.querySelector(`[data-minutes="${i}"]`).value):0}))};}
function refreshEditorPV(){if($('editor-view').hidden)return;const value=state.online?`${fmt(state.pv,0)} °C`:'sin lectura confirmada';$('editor-pv').textContent=value;$('initial-pv').textContent='PV · '+value;previewCurve();}
function previewCurve(){const p=formProfile();for(let i=1;i<19;i++){const el=document.querySelector(`[data-start="${i}"]`);if(el)el.textContent=fmt(p.segments[i].temperature,0);}const preview=previewSegments(p.segments);drawChart($('profile-chart'),[{color:colors[0],points:curvePoints(preview)}],{axis:'minutos programados · C01 = PV'});}
async function leaveEditor(){if(dirty&&!await confirmAction('¿Descartar cambios?','La curva guardada no se modificará.'))return;dirty=false;selected=null;draft=null;$('editor-view').hidden=true;$('curves-list-view').hidden=false;await loadProfiles();}
function openLoad(p){loadProfileID=p.id;$('load-summary').innerHTML=`<span>${escapeHTML(p.name)}</span><span>${metrics(p.segments)}</span>`;$('load-choices').innerHTML=[1,2,3,4].map(i=>`<label class="radio-memory"><input type="radio" name="load-memory" value="${i}" required>Memoria ${i}</label>`).join('');$('load-dialog').showModal();}
function filteredHistory(){const search=$('history-search').value.toLocaleLowerCase(),status=$('history-state').value,from=$('history-from').value,to=$('history-to').value;return firings.filter(f=>{const d=new Date(f.started_at),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return(!search||(f.name+' '+f.id+' '+f.curve_name).toLocaleLowerCase().includes(search))&&(!status||f.status===status)&&(!from||day>=from)&&(!to||day<=to);});}
function historyRow(f){const elapsed=f.first_reading&&f.last_reading?(new Date(f.last_reading)-new Date(f.first_reading))/1000:null;return`<div class="history-item ${selectedFirings.has(f.id)?'selected':''}" data-select-firing="${f.id}"><input type="checkbox" data-compare="${f.id}" ${selectedFirings.has(f.id)?'checked':''} aria-label="Seleccionar ${escapeHTML(f.name)}"><div class="history-main"><strong>${escapeHTML(f.name)}${f.notes?' <span title="Observaciones guardadas" aria-label="Con observaciones">📝</span>':''}</strong><small>#${f.id.slice(0,10)} · ${date(f.started_at)} · ${states[f.status]||escapeHTML(f.status)} · ${f.samples} lecturas · memoria ${f.memory||'desconocida'}${f.status==='imported'?'':f.mode==='physical'?' · Horno físico':' · Simulación'}</small></div><div class="history-item-metric"><small>Máxima PV</small><strong>${fmt(f.pv_max)} °C</strong></div><div class="history-item-metric"><small>Duración entre lecturas</small><strong>${duration(elapsed)}</strong></div><button class="button secondary" data-firing="${f.id}">Ver detalle</button></div>`;}
function renderHistory(){const rows=filteredHistory();$('history-count').textContent=`Mostrando ${rows.length} de ${firings.length} cocciones. La selección se conserva al filtrar.`;let html='';if($('history-group').checked){const groups=new Map();for(const f of rows){const key=f.curve_key||'unknown';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f);}html=[...groups].map(([key,items])=>`<section class="history-group"><h3>${key==='unknown'?'Sin snapshot de curva':escapeHTML(items[0].curve_name||'Programa registrado')} · ${items.length}</h3>${items.map(historyRow).join('')}</section>`).join('');}else html=rows.map(historyRow).join('');$('firings').innerHTML=html||'<div class="empty">No hay cocciones para estos filtros.</div>';$('selection-count').textContent=selectedFirings.size+' seleccionadas';$('compare').textContent=selectedFirings.size>1?'Comparar gráficas':'Ver gráfica';$('compare').disabled=!selectedFirings.size;$('delete-selected').disabled=!selectedFirings.size||[...selectedFirings].some(id=>!firings.find(f=>f.id===id)?.ended_at);}
async function loadHistory(){firings=await api('firings');selectedFirings=new Set([...selectedFirings].filter(id=>firings.some(f=>f.id===id)));const key=JSON.stringify([firings,Array.from(selectedFirings),$('history-group').checked]);if(key!==historyListKey&&!pointerDown){renderHistory();historyListKey=key;}}
function eventMarkers(f,color){return f.events.filter(e=>['state','started','offline','online','interrupted'].includes(e.kind)).map(e=>({minute:(new Date(e.timestamp)-new Date(f.started_at))/60000,label:`${f.name}: ${e.message}`,color}));}
function historyPoints(f,value){const origin=new Date(f.started_at),points=[];let previous=null;for(const r of f.readings){const t=new Date(r.timestamp);if(previous){const dt=(t-new Date(previous.timestamp))/1000;const disconnected=r.plot_group!==undefined?r.plot_group!==previous.plot_group:dt>5||dt<=0;if(disconnected)points.push([NaN,NaN]);}points.push([(t-origin)/60000,value(r)]);previous=r;}return points;}
function renderHistoryChart(){const series=[],deviations=[],markers=[],bands=[];let maxTime=0;const key=[];
 for(const [i,f] of details.entries()){
 const origin=new Date(f.started_at),color=colors[i],minute=stamp=>(new Date(stamp)-origin)/60000;
 const pv=historyPoints(f,r=>r.pv),sv=historyPoints(f,r=>r.sv),dev=historyPoints(f,r=>r.pv-r.sv);
 series.push({color,points:pv});if($('show-sv').checked)series.push({color,dashed:true,points:sv});
 if($('show-program').checked&&f.snapshot.length)series.push({color,dotted:true,points:curvePoints(f.snapshot)});
 deviations.push({color,points:dev});
 if($('show-events').checked){markers.push(...eventMarkers(f,color));for(const p of f.timeline?.pauses||[])bands.push({start:minute(p.start),end:minute(p.end),kind:'pause',label:`${f.name}: PAUSA observada${p.open?' sin reanudación observada':''}`});}
 for(const gap of f.timeline?.gaps||[]){if(gap.seconds>5)bands.push({start:minute(gap.start),end:minute(gap.end),kind:'gap',label:`${f.name}: hueco de ${duration(gap.seconds)}`});}
 if($('show-segments').checked){const marks=f.timeline?.segments||f.readings.filter((r,n,rs)=>!n||r.step!==rs[n-1].step||r.memory!==rs[n-1].memory);for(const r of marks){const label=`${f.name} · memoria ${r.memory} · tramo observado ${r.step}`;markers.push({minute:minute(r.timestamp),tag:`T${r.step}${details.length>1?' · '+(i+1):''}`,label,color});key.push(`<span class="series-${i}">T${r.step} · ${duration(Math.max(0,minute(r.timestamp)*60))}${details.length>1?' · '+escapeHTML(f.name):''}</span>`);}}
 }
 for(const row of series)for(const point of row.points)if(Number.isFinite(point[0]))maxTime=Math.max(maxTime,point[0]);const scale=timeScale(maxTime);
 drawChart($('history-chart'),series,{markers,bands,scale,axis:'Tiempo desde el inicio · PV continua / SV rayas / programa punteado'});
 $('deviation-panel').hidden=!$('show-deviation').checked;if($('show-deviation').checked)drawChart($('deviation-chart'),deviations,{bands,scale,deviation:true,axis:'Tiempo desde el inicio · desviación registrada PV − SV'});
 const legend=details.map((f,i)=>`<span class="series-${i}">${i+1}. ${escapeHTML(f.name)}${!f.snapshot.length?' · sin programa guardado':''}</span>`).join('');$('history-legend').innerHTML=legend;$('deviation-legend').innerHTML=legend;
 $('history-marker-key').innerHTML=key.length?'<summary>Tramos observados y tiempos ('+key.length+')</summary><div class="segment-key">'+key.join('')+'</div>':'';
}
function seriesHeading(f,i){return `<span class="series-heading series-${i}">${escapeHTML(f.name)}</span>`;}
function observedCell(f,number){const groups=f.statistics.segments.filter(s=>s.step===number);return groups.length?groups.map(s=>`<div class="segment-observation"><strong>${duration(s.observed_seconds)}</strong><small>Memoria ${s.memory||'desconocida'} · |PV − SV| ${fmt(s.mean_abs_deviation)} °C</small><small>${s.samples} muestras · PV ${fmt(s.pv_min)}–${fmt(s.pv_max)} °C</small><small>Media firmada PV − SV: ${fmt(s.mean_deviation)} °C</small></div>`).join(''):'—';}
function renderStatistics(){
 const metricRows=[['Máxima PV','pv_max',v=>fmt(v)+' °C'],['Duración entre lecturas','duration_seconds',duration],['Desviación media |PV − SV|','mean_abs_deviation',v=>fmt(v)+' °C'],['Continuidad temporal (intervalos ≤ 5 s)','continuity_percent',v=>fmt(v)+' %']];
 if(details.length===1){const f=details[0],s=f.statistics;$('history-statistics').innerHTML='<div class="statistics">'+metricRows.map(([label,key,format])=>`<div class="stat"><small>${label}</small><strong>${format(s[key])}</strong></div>`).join('')+'</div>'+`<p class="helper">${s.gaps} huecos mayores de 5 s · ${s.duplicate_or_reversed} intervalos con fechas repetidas o inversas. Los indicadores usan todas las lecturas.</p>`;
 const numbers=[...new Set([...curvePoints(f.snapshot).slice(1).map((_,i)=>i+1),...s.segments.map(x=>x.step)])].sort((a,b)=>a-b);
 $('history-segments').innerHTML='<h3>Tramos: programa y comportamiento observado</h3><table><thead><tr><th>Tramo</th><th>Desde → Hasta</th><th>Programado</th><th>Tiempo observado, muestras y análisis</th></tr></thead><tbody>'+numbers.map(n=>{const start=f.snapshot[n-1],end=f.snapshot[n];return `<tr><td>${n}</td><td>${start&&end?`${fmt(start.temperature)} → ${fmt(end.temperature)} °C`:'—'}</td><td>${start&&end?fmt(start.minutes)+' min':'—'}</td><td>${observedCell(f,n)}</td></tr>`;}).join('')+'</tbody></table>';
 }else{
 const comparable=details[0].curve_key&&details.every(f=>f.curve_key===details[0].curve_key);
 $('history-statistics').innerHTML=`<h3>Comparación de resultados</h3><p class="helper">${comparable?'Programas coincidentes, ignorando C01.':'Programas diferentes o incompletos: no permiten clasificar qué cocción fue mejor.'}</p>`+metricRows.map(([label,key,format])=>{const max=Math.max(0,...details.map(f=>f.statistics[key]).filter(Number.isFinite));return `<section class="comparison-metric"><h4>${label}</h4>${details.map((f,i)=>{const v=f.statistics[key],width=Number.isFinite(v)&&max>0?Math.max(0,Math.min(100,key==='continuity_percent'?v:v/max*100)):0;return `<div class="comparison-bar-row">${seriesHeading(f,i)}<svg class="metric-track" viewBox="0 0 100 7" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(label)}: ${format(v)}"><rect class="fill-${i}" width="${width}" height="7" rx="3"/></svg><strong>${format(v)}${i?`<small class="metric-delta">${metricDelta(v,details[0].statistics[key],key)}</small>`:''}</strong></div>`;}).join('')}</section>`;}).join('')+`<h3>Observaciones y resultados registrados</h3><div class="comparison-notes">${details.map((f,i)=>`<div class="note-preview">${seriesHeading(f,i)}<p>${escapeHTML(f.notes||'Sin observaciones personales.')}</p></div>`).join('')}</div>`;
 const numbers=[...new Set(details.flatMap(f=>f.statistics.segments.map(s=>s.step)))].sort((a,b)=>a-b);
 $('history-segments').innerHTML='<h3>Comparar tramos, tiempos observados y desviación PV − SV</h3><table class="comparison-table"><thead><tr><th>Tramo</th>'+details.map((f,i)=>`<th>${seriesHeading(f,i)}</th>`).join('')+'</tr></thead><tbody>'+numbers.map(n=>`<tr><td>${n}</td>${details.map(f=>`<td>${observedCell(f,n)}</td>`).join('')}</tr>`).join('')+'</tbody></table>';
 }
 if(details.length>1)$('history-statistics').innerHTML+='<p class="helper">Δ indica la diferencia respecto a la primera cocción seleccionada. La continuidad usa una escala fija de 0 a 100 %. Los indicadores describen medidas, no valoran la calidad del resultado.</p>';
 $('history-segments').innerHTML+='<p class="helper">Tiempo observado: solo intervalos consecutivos de hasta 5 s dentro del mismo tramo y memoria. Un mismo número puede representar temperaturas distintas en programas diferentes. La desviación no es una valoración de calidad. Sin snapshot no se inventa el programa.</p>';
}
function metricDelta(value,baseline,key){if(!Number.isFinite(value)||!Number.isFinite(baseline))return 'Δ —';const delta=value-baseline,sign=delta>=0?'+':'−';return `Δ ${sign}${key==='duration_seconds'?duration(Math.abs(delta)):fmt(Math.abs(delta))+(key==='continuity_percent'?' puntos porcentuales':' °C')}`;}
function renderFiringDetail(updateForms=true){
 const f=details[0];if(!f)return;$('history-detail').hidden=false;$('export-firing').hidden=!detailID;$('firing-form').hidden=!detailID;
 $('history-title').textContent=detailID?f.name:'Comparación de cocciones';$('history-subtitle').textContent=details.map(f=>`${f.name} · ${f.samples} lecturas · ${states[f.status]||f.status} · ${f.mode==='physical'?'Horno físico':'Simulación'}`).join(' | ');
 renderHistoryChart();renderStatistics();$('history-snapshot').textContent=(detailID?(f.snapshot.length?'Programa guardado: C01 inicial conservada.':'Cocción importada desde CSV.'):'Cada cocción comienza en su propio inicio.')+' Ambas gráficas comparten escala temporal. El programa usa minutos teóricos, sin pausas ni esperas reales. Franjas azules: estado PAUSA registrado; grises: huecos de comunicación. Los huecos no se unen con líneas.';
 $('snapshot-detail').hidden=!detailID||!f.snapshot.length;$('snapshot-table').innerHTML=detailID?'<table><thead><tr><th>Punto</th><th>°C</th><th>Minutos</th></tr></thead><tbody>'+f.snapshot.map((s,i)=>`<tr><td>C${i+1}</td><td>${s.temperature}</td><td>${s.minutes}</td></tr>`).join('')+'</tbody></table>':'';
 if(detailID){if(updateForms){$('firing-name').value=f.name;$('firing-notes').value=f.notes||'';}$('delete-firing').disabled=!f.ended_at;}
 renderEvents($('history-events'),details.flatMap(f=>f.events.map(e=>({...e,message:details.length>1?f.name+': '+e.message:e.message}))).sort((a,b)=>b.timestamp.localeCompare(a.timestamp)),10000);
 $('detail-update-status').textContent=details.some(f=>!f.ended_at)?'Cocción abierta · actualización automática de lecturas y eventos':'Cocción cerrada';
}
let detailRequest=0;
async function showFiring(ids){if(firingDirty&&!await confirmAction('¿Cambiar de cocción?','Las observaciones sin guardar se perderán.'))return;
 const request=++detailRequest,loaded=await Promise.all(ids.map(id=>api('firings/'+id)));if(request!==detailRequest)return;
 details=loaded;firingDirty=false;detailID=ids.length===1?ids[0]:null;renderFiringDetail();$('history-detail').scrollIntoView({behavior:'smooth',block:'start'});
}
async function refreshOpenFiring(){if($('history-detail').hidden||!details.some(f=>!f.ended_at))return;const current=details,request=detailRequest;
 try{const loaded=await Promise.all(current.map(f=>api('firings/'+f.id)));if(request!==detailRequest||current!==details||page!=='history')return;details=loaded;renderFiringDetail(!firingDirty);}catch(e){if(request===detailRequest)$('detail-update-status').textContent='No se pudo actualizar el detalle: '+e.message;}
}
for(const link of document.querySelectorAll('[data-page]'))link.onclick=safe(async event=>{
 if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 event.preventDefault();
 await navigate(link.dataset.page);
});
document.querySelector('.brand').onclick=safe(async e=>{e.preventDefault();await navigate('control');});
$('mqtt-connection').onclick=()=>$('mqtt-dialog').showModal();
$('update-program').onclick=safe(async()=>{
 const version=state.update?.version;
 if(!version||!await confirmAction('Actualizar programa',`Se instalará la versión ${version} y el panel se reiniciará. Guarda antes cualquier cambio pendiente.`))return;
 requestedUpdate=version;
 lastUpdateError=null;
 try{
  const result=await api('update',{method:'POST',body:{version}});
  toast(result.message);
 }catch(error){
  requestedUpdate=null;
  throw error;
 }finally{await refresh();}
});
$('connection-mode').onchange=safe(async()=>{const choice=$('connection-mode').value;const selection=choice==='simulator'?{mode:'simulator'}:{mode:'physical',port:choice};try{await command('set_mode',selection);}finally{await refresh();}});
$('run-memory').onchange=()=>{renderState();};
$('control-memories').onclick=safe(async e=>{const b=e.target.closest('[data-preview-memory]');if(b&&!b.disabled){$('run-memory').value=b.dataset.previewMemory;lastControlMemoryKey='';$('control-memories').innerHTML=memoryMarkup(true);renderState();}});
for(const [id,limit] of [['start-hour',24],['start-minute',60]]){
 for(let i=0;i<limit;i++){
  const value=String(i).padStart(2,'0');
  $(id).add(new Option(value,value));
 }
}
$('start-date').onchange=renderState;
$('cancel-start').onclick=safe(()=>command('cancel_start'));
const startMemoryDialog=$('start-memory-dialog');
$('cancel-start-memory').onclick=()=>startMemoryDialog.close('cancel');
const scheduleFiringDialog=$('schedule-firing-dialog');
$('cancel-schedule-firing').onclick=()=>scheduleFiringDialog.close('cancel');
async function prepareFiring(){

 const generation=state.mode_generation;
 const isAvailable=()=>!$('run').disabled&&state.mode_generation===generation;
 if(!isAvailable()||startMemoryDialog.open)return;
 let memory=Number($('run-memory').value);
 if(![1,2,3,4].includes(memory)){
  const form=startMemoryDialog.querySelector('form');
  $('start-memory-choices').innerHTML=Object.entries(state.memories||{}).map(([id,segments])=>`
   <label class="radio-memory">
    <input type="radio" name="start-memory" value="${id}" required>
    <span class="start-memory-summary">
     <strong>${escapeHTML(matchLabel(segments))}</strong>
     <small>Memoria ${id} · ${metrics(segments)}</small>
    </span>
   </label>`).join('');
  startMemoryDialog.returnValue='cancel';
  startMemoryDialog.showModal();
  await new Promise(resolve=>startMemoryDialog.addEventListener('close',resolve,{once:true}));
  if(startMemoryDialog.returnValue!=='continue'||!isAvailable())return;
  memory=Number(new FormData(form).get('start-memory'));
  if(![1,2,3,4].includes(memory))return;
  $('run-memory').value=String(memory);
  renderState();
 }
 const segments=state.memories?.[memory];
 const matchingProfiles=segments?.length===20?matches(segments):[];
 const names=matchingProfiles.map(profile=>`"${profile.name}"`);
 let memoryMessage=`Se va a utilizar la memoria ${memory} del programador`;
 if(names.length===1)memoryMessage+=`, que corresponde con la curva ${names[0]}.`;
 else if(names.length>1)memoryMessage+=`, que corresponde con las curvas ${names.join(', ')}.`;
 else memoryMessage+='. Esta memoria no tiene un perfil coincidente.';
 const action=await confirmAction(
  'Iniciar desde memoria '+memory,
  `${memoryMessage} La temperatura de inicio del primer tramo se ajusta a la temperatura actual del sensor térmico.`,
  {allowSchedule:true}
 );
 if(!action||!isAvailable())return;
 if(action==='schedule'){
  scheduleFiringDialog.querySelector('form').reset();
  scheduleFiringDialog.returnValue='cancel';
  renderState();
  scheduleFiringDialog.showModal();
  await new Promise(resolve=>scheduleFiringDialog.addEventListener('close',resolve,{once:true}));
  if(scheduleFiringDialog.returnValue!=='continue'||!isAvailable())return;
  const startDate=$('start-date').value;
 const hour=$('start-hour').value,minute=$('start-minute').value;
 if(!hour||!minute)throw Error('Selecciona la hora y los minutos.');
 const time=new Date(`${startDate}T${hour}:${minute}`);
 if(!Number.isFinite(time.getTime())||time.getTime()<=Date.now())throw Error('Elige una fecha y hora futura.');
 if(await confirmAction('Programar memoria '+memory,`${memoryMessage} El programador iniciará esta memoria el ${date(time)}.`)){
  if(!isAvailable())return;
  await command('schedule_start',{memory,start_at:time.toISOString()});
  for(const id of ['start-date','start-hour','start-minute'])$(id).value='';
  renderState();
 }
 return;
 }
 await command('run',{memory});
}
$('run').onclick=safe(prepareFiring);
$('pause').onclick=safe(()=>command('pause'));$('resume').onclick=safe(()=>command('resume'));
$('stop').onclick=safe(async()=>{if(await confirmAction('Parar la cocción','Se enviara la orden que detiene la cocción, ¿esta segur@?'))await command('stop');});
$('new-profile').onclick=safe(()=>editProfile({name:'',notes:'',segments:Array.from({length:20},(_,i)=>({temperature:i?100:state.online?state.pv:0,minutes:i===0?10:0}))}));
$('profile-search').oninput=renderProfileList;
$('profile-list').onclick=safe(async e=>{const b=e.target.closest('[data-profile-action]');if(!b)return;const p=profiles.find(p=>p.id===b.dataset.id);if(!p)throw Error('Curva no disponible.');switch(b.dataset.profileAction){case'edit':await editProfile(p,p.id);break;case'load':openLoad(p);break;case'duplicate':{const copy=await api('profiles',{method:'POST',body:{...p,name:(p.name+' · copia').slice(0,120)}});await loadProfiles();toast('Curva duplicada: '+copy.name);break;}case'delete':if(await confirmAction('Eliminar '+p.name,'Se eliminará la curva de la biblioteca.')){await api('profiles/'+p.id,{method:'DELETE'});await loadProfiles();toast('Curva eliminada.');}break;}});
$('profile-form').oninput=()=>{dirty=true;previewCurve();};
$('profile-form').onsubmit=safe(async e=>{e.preventDefault();const p=await api('profiles'+(selected?'/'+selected:''),{method:selected?'PUT':'POST',body:formProfile()});dirty=false;await loadProfiles();await editProfile(p,p.id);toast('Curva guardada en la biblioteca');});
$('back-curves').onclick=safe(leaveEditor);$('cancel-editor').onclick=safe(leaveEditor);
$('export-profile').onclick=safe(()=>download('profiles/'+selected+'/csv','curva.csv'));
$('memories').onclick=safe(async e=>{const b=e.target.closest('[data-copy-memory]');if(!b||b.disabled||busy||!state.online)return;const id=Number(b.dataset.copyMemory);const source=state.memories?.[id];if(!source)return;const match=matches(source)[0];if(match){$('profile-search').value='';renderProfileList();const card=$('profile-'+match.id);card.focus({preventScroll:true});card.scrollIntoView({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});return;}await editProfile({name:'Copia de memoria '+id,notes:'Recuperada del programador; revisa y guarda para incorporarla a la biblioteca.',segments:source});});
$('cancel-load').onclick=()=>$('load-dialog').close();
$('load-form').onsubmit=safe(async e=>{e.preventDefault();const memory=Number(new FormData($('load-form')).get('load-memory'));if(![1,2,3,4].includes(memory))throw Error('Elige una memoria de destino.');$('confirm-load').disabled=true;try{await command('load',{memory,profile_id:loadProfileID});$('load-dialog').close();await loadProfiles();}finally{$('confirm-load').disabled=false;}});
for(const id of ['history-search','history-state','history-from','history-to','history-group'])$(id).addEventListener(id==='history-search'?'input':'change',renderHistory);
$('refresh-history').onclick=safe(loadHistory);
$('firings').onchange=safe(async e=>{const id=e.target.dataset.compare;if(!id)return;if(e.target.checked){if(selectedFirings.size>=7){e.target.checked=false;throw Error('La comparación admite hasta 7 cocciones.');}selectedFirings.add(id);}else selectedFirings.delete(id);renderHistory();});
$('firings').onclick=safe(async e=>{const b=e.target.closest('[data-firing]');if(b){await showFiring([b.dataset.firing]);return;}if(e.target.closest('input,button,a'))return;const row=e.target.closest('[data-select-firing]');if(row)toggleFiringSelection(row.dataset.selectFiring);});
$('compare').onclick=safe(async()=>{if(!selectedFirings.size||selectedFirings.size>7)throw Error('Selecciona entre 1 y 7 cocciones.');if(selectedFirings.size>1&&[...selectedFirings].some(id=>!firings.find(f=>f.id===id)?.ended_at))throw Error('Para comparar, elige cocciones que ya hayan terminado.');await showFiring([...selectedFirings]);});
function toggleFiringSelection(id){if(selectedFirings.has(id))selectedFirings.delete(id);else{if(selectedFirings.size>=7)throw Error('La selección admite hasta 7 cocciones.');selectedFirings.add(id);}renderHistory();}
$('delete-selected').onclick=safe(async()=>{
 const ids=[...selectedFirings];if(!ids.length)return;
 if(ids.some(id=>!firings.find(f=>f.id===id)?.ended_at))throw Error('Solo se pueden eliminar cocciones terminadas.');
 if(!await confirmAction(`Eliminar ${ids.length} cocciones seleccionadas`,`Se eliminarán sus lecturas, eventos y observaciones.${firingDirty?' Se perderán las observaciones sin guardar.':''}`))return;
 let deleted=0;try{for(const id of ids){await api('firings/'+id,{method:'DELETE'});selectedFirings.delete(id);deleted++;if(details.some(f=>f.id===id)){details=[];detailID=null;firingDirty=false;$('history-detail').hidden=true;}}}catch(e){throw Error(`Eliminadas ${deleted} de ${ids.length}. ${e.message}`);}finally{await loadHistory();}toast(`Eliminadas ${deleted} cocciones.`);
});
for(const [button,target,label] of [['toggle-program-chart','program-chart-panel','gráfica'],['toggle-program-table','program-table','tabla']])$(button).onclick=()=>{const el=$(target);el.hidden=!el.hidden;$(button).textContent=(el.hidden?'Mostrar ':'Ocultar ')+label;$(button).setAttribute('aria-expanded',String(!el.hidden));};
$('clear-selection').onclick=()=>{selectedFirings.clear();renderHistory();};
for(const id of ['show-sv','show-deviation','show-program','show-segments','show-events'])$(id).onchange=renderHistoryChart;
$('export-firing').onclick=safe(()=>download('firings/'+detailID+'/csv','coccion-'+detailID+'.csv'));
$('firing-form').oninput=()=>{firingDirty=true;};
$('firing-form').onsubmit=safe(async e=>{e.preventDefault();await api('firings/'+detailID,{method:'PUT',body:{name:$('firing-name').value,notes:$('firing-notes').value}});firingDirty=false;await loadHistory();await showFiring([detailID]);toast('Nombre y observaciones guardados.');});
$('delete-firing').onclick=safe(async()=>{if(await confirmAction('Eliminar esta cocción','Se eliminarán sus lecturas, eventos y observaciones. Los perfiles y las memorias no se modifican.')){await api('firings/'+detailID,{method:'DELETE'});selectedFirings.delete(detailID);detailID=null;details=[];firingDirty=false;$('history-detail').hidden=true;await loadHistory();toast('Cocción eliminada.');}});
$('backup').onclick=safe(()=>download('backup','cjd-backup.sqlite3'));
for(const[id,type]of[['import-profile','profiles'],['import-firing','firings']])$(id).onclick=()=>{importType=type;$('csv-file').value='';$('csv-file').click();};
$('csv-file').onchange=safe(async()=>{const file=$('csv-file').files[0];if(!file)return;if(file.size>32*1024*1024)throw Error('El archivo supera 32 MiB.');const result=await api(importType+'/import',{method:'POST',headers:{'Content-Type':'text/csv'},body:await file.text()});if(importType==='profiles'){await loadProfiles();await editProfile(result,result.id);}else{await loadHistory();await showFiring([result.id]);}toast(importType==='profiles'?'Curva importada.':'Cocción añadida al historial.');});
$('auth-form').onsubmit=safe(async e=>{e.preventDefault();token=$('access-token').value;await api('state');sessionStorage.setItem('cjd-token',token);$('access-token').value='';$('auth-dialog').close();await loadProfiles();await refresh();});
window.addEventListener('beforeunload',e=>{if(dirty||firingDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',safe(async()=>{const next=location.hash.slice(1);if(pages.includes(next)&&next!==page)await navigate(next);}));
async function init(){await refresh();try{await loadProfiles();const initial=location.hash.slice(1);if(pages.includes(initial))await navigate(initial);}catch(e){if(!$('auth-dialog').open)toast(e.message,true);}let nextEvents=performance.now()+2000,nextHistory=0;
 function refreshDelay(){
  return page==='control'&&state.mode==='simulator'&&state.online&&state.state===1?500:2000;
 }
 async function tick(){
  try{
   if(document.hidden)return;
   const now=performance.now(), events=now>=nextEvents;
   if(events)nextEvents=now+2000;
   await refresh({events});
   if(page==='history'&&now>=nextHistory){nextHistory=now+10000;try{await loadHistory();await refreshOpenFiring();}catch{}}
  }finally{setTimeout(tick,document.hidden?10000:refreshDelay());}
 }
 setTimeout(tick,refreshDelay());}
setInterval(renderSegmentTime,1000);
init();
