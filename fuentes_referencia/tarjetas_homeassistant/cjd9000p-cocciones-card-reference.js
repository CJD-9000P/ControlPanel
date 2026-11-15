/* CJD-9000P Mis cocciones — v0.6.7; añade comprobación CSV a la v0.6.6. */
class Cjd9000pCoccionesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._selected = new Set();
    this._all = [];
    this._details = new Map();
    this._visible = false;
    this._showSv = true;
    this._showProgram = true;
    this._showEvents = true;
    this._showSegments = true;
    this._showDeviation = true;
    this._filterName = '';
    this._filterState = '';
    this._filterFrom = '';
    this._filterTo = '';
    this._groupByProfile = true;
    this._noteDrafts = new Map();
    this._busy = false;
    this._deleteConfirm = false;
    this._renameTarget = null;
    this._notice = '';
    this._integrity = null;
    this._integritySeenRef = null;
  }
  setConfig(config) {
    this._config = {title: 'Mis cocciones', integrity_entity:'sensor.cjd9000p_recuperacion_integridad', ...config};
    this.render();
  }
  set hass(hass) {
    const changed = this._hass?.connection !== hass.connection;
    this._hass = hass;
    if (!this._loaded || changed) this.refresh();
    const reply=hass.states[this._config.integrity_entity];
    if (this._integrity && reply && reply !== this._integritySeenRef &&
        reply.attributes?.solicitud_id === this._integrity.request_id &&
        Number(reply.attributes?.coccion_id) === this._integrity.coccion_id) {
      this._integritySeenRef=reply;
      this._integrity={...this._integrity,estado:reply.state,datos:reply.attributes};
      this.render();
    }
  }
  getCardSize() { return 8; }
  static getStubConfig() {return {title:'Mis cocciones'};}
  esc(value) {return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  date(value) {return value ? new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';}
  duration(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    const seconds = Math.round(value);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds/60), remaining=seconds%60;
    const hours = Math.floor(minutes/60), remMin=minutes%60;
    if (hours) return `${hours} h ${remMin} min`;
    return `${minutes} min${remaining ? ` ${remaining} s` : ''}`;
  }
  minutes(value) {
    if (!Number.isFinite(value)) return '—';
    return value < 60 ? this.duration(value) : `${(value/60).toFixed(1).replace('.',',')} min`;
  }
  fmt(value, digits=1) {
    return Number.isFinite(value) ? value.toLocaleString('es-ES',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
  }
  durationOf(d) {
    const n=d?.estadisticas?.duracion_segundos;
    if (Number.isFinite(n)) return n;
    const from=Date.parse(d?.inicio || ''), to=Date.parse(d?.fin || '');
    return Number.isFinite(from)&&Number.isFinite(to)&&to>=from?(to-from)/1000:null;
  }
  // Duración cronológica de la cocción, con las fechas del listado PostgreSQL.
  // Incluye pausas y posibles periodos sin lecturas; no es "Observado min".
  historyDurationLabel(c) {
    if (!c?.fin) {
      const state = String(c?.estado ?? '').toLowerCase();
      return ['en_marcha', 'pausada', 'funcionando', 'iniciada'].includes(state)
        ? 'En curso' : '—';
    }
    const from = Date.parse(c?.inicio ?? '');
    const to = Date.parse(c.fin);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return '—';
    const seconds = Math.round((to - from) / 1000);
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
  }
  coverageOf(d) {
    const span=this.durationOf(d), registered=d?.estadisticas?.registrados_segundos;
    if (!(Number.isFinite(span)&&span>0&&Number.isFinite(registered))) return null;
    return Math.max(0,Math.min(100,registered/span*100));
  }
  filteredList() {
    const q=this._filterName.trim().toLocaleLowerCase('es-ES').replace(/^#/, '');
    const start=this._filterFrom ? new Date(`${this._filterFrom}T00:00:00`).getTime():null;
    const end=this._filterTo ? new Date(`${this._filterTo}T00:00:00`).getTime()+86400000:null;
    return this._all.filter(c=>{
      if(q&&!String(c.nombre||'').toLocaleLowerCase('es-ES').includes(q) && !String(c.id).includes(q)) return false;
      if(this._filterState&&c.estado!==this._filterState) return false;
      const t=Date.parse(c.inicio||'');
      if(start!==null&&!(t>=start))return false;
      if(end!==null&&!(t<end))return false;
      return true;
    });
  }
  async refresh() {
    if (!this._hass || this._busy) return;
    this._busy=true;
    try {
      this._all=await this._hass.callWS({type:'cjd9000p_history/list'});
      this._selected = new Set([...this._selected].filter(x=>this._all.some(c=>c.id===x)));
      this._loaded=true;
      this._error='';
    } catch(e) {this._error=String(e.message || e);}
    finally {this._busy=false;this.render();}
  }
  async checkIntegrity() {
    if (!this._hass || this._busy || this._selected.size !== 1 ||
        this._integrity?.estado === 'comprobando' || this._integrity?.estado === 'solicitando') return;
    const coccion_id=[...this._selected][0];
    const row=this._all.find(c=>c.id===coccion_id);
    if (!row || !row.fin) {
      this._error='La integridad solo se puede comprobar en cocciones cerradas.';
      this.render();return;
    }
    const request_id='r'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12);
    this._integrity={request_id,coccion_id,estado:'solicitando',datos:null};
    this._error='';this.render();
    try {
      await this._hass.callService('mqtt','publish',{
        topic:'horno/cjd9000p/recuperacion/solicitar',
        payload:JSON.stringify({accion:'comprobar',coccion_id,solicitud_id:request_id}),
        qos:1,retain:false
      });
    } catch(e) {
      this._integrity={...this._integrity,estado:'error',datos:{mensaje:String(e?.message||e)}};
      this.render();
    }
  }
  integritySummary() {
    const result=this._integrity;
    if (!result) return '';
    const d=result.datos||{};
    const status=result.estado;
    const text=status==='integro'?'CSV y PostgreSQL coinciden en las lecturas comprobadas.':
      status==='faltantes'?`Hay ${Number(d.faltantes||0).toLocaleString('es-ES')} lecturas en el CSV que faltan en PostgreSQL. No se ha cambiado la base de datos.`:
      status==='comprobando'?'Comparando el CSV con PostgreSQL…':
      status==='solicitando'?'Enviando solicitud a Ubuntu…':
      status==='no_verificable'?'No se puede verificar con seguridad esta cocción (CSV o metadatos incompletos).':
      status==='revisar'?'Hay discrepancias o filas inválidas: revisar el informe antes de recuperar.':
      status==='ocupado'?'El recuperador ya está comprobando otra cocción.':
      status==='error'?'No se pudo completar la comprobación.':
      'Resultado de comprobación: '+status;
    const counts=Number.isFinite(Number(d.total_csv)) && d.total_csv!==undefined
      ? ` · CSV: ${Number(d.total_csv).toLocaleString('es-ES')} · Ya en BD: ${Number(d.existentes||0).toLocaleString('es-ES')} · Discrepancias: ${Number(d.discrepancias||0).toLocaleString('es-ES')}` : '';
    return `<div class="notice" role="status"><strong>Integridad de cocción #${result.coccion_id}</strong><div>${this.esc(text)}${this.esc(counts)}</div>${d.mensaje?`<small>${this.esc(d.mensaje)}</small>`:''}<div class="muted tiny">Solo comprobación: no se insertan ni borran lecturas.</div></div>`;
  }
  async compare() {
    if(!this._selected.size || !this._hass)return;
    if(this._selected.size>7){this._error='La comparación admite hasta 7 cocciones simultáneas.';this.render();return;}
    this._busy=true;this._error='';this.render();
    let success=false;
    try {
      const missing=[...this._selected].filter(id=>!this._details.has(id));
      for(const id of missing) this._details.set(id, await this._hass.callWS({type:'cjd9000p_history/detail',coccion_id:id}));
      this._visible=true;
      success=true;
    } catch(e) {this._error=String(e.message || e);}
    finally {
      this._busy=false;
      this.render();
      // Navegar a la gráfica solo tras pulsar Ver/Comparar y recibir los datos.
      // No desplazar al modificar filtros, detalles, opciones o notas.
      if (success) this._scrollToGraphResults();
    }
  }

  _scrollToGraphResults() {
    const target=this.shadowRoot?.querySelector('#cjd-graph-results');
    if (!target) return;
    const prefersReducedMotion=typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const move=()=>{
      // No desplazar a un resultado que haya desaparecido mientras esperábamos.
      if (this.shadowRoot?.querySelector('#cjd-graph-results') !== target) return;
      try {
        target.scrollIntoView({behavior:prefersReducedMotion?'auto':'smooth',block:'start',inline:'nearest'});
      } catch (e) { target.scrollIntoView(); }
      // Permite anunciar el resultado a lectores de pantalla sin segundo scroll.
      try {target.focus({preventScroll:true});} catch (e) { /* soporte antiguo */ }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(move);
    else move();
  }
  requestDelete() {
    if (this._busy || this._selected.size < 1) return;
    if (this._selected.size > 50) {
      this._error = 'Selecciona como máximo 50 cocciones por operación.';
      this.render();
      return;
    }
    this._error = '';
    this._deleteConfirm = true;
    this.render();
  }
  async deleteSelected() {
    if (!this._deleteConfirm || this._busy || !this._hass) return;
    const ids = [...this._selected].sort((a,b)=>a-b);
    if (!ids.length || ids.length > 50) return;
    this._deleteConfirm = false;
    this._busy = true;
    this._notice = '';
    this._error = '';
    this.render();
    let success = false;
    try {
      const response = await this._hass.callWS({
        type:'cjd9000p_history/delete', coccion_ids: ids, confirm: true
      });
      const deleted = response?.eliminadas || [];
      if (deleted.length !== ids.length) throw new Error('La respuesta no confirma todos los registros seleccionados');
      for (const id of deleted) { this._details.delete(id); this._noteDrafts.delete(id); }
      this._all = this._all.filter(c => !deleted.includes(c.id));
      this._selected.clear();
      this._visible = false;
      this._notice = `Se eliminaron ${deleted.length} cocciones de PostgreSQL. Los CSV originales no se han tocado.`;
      success = true;
    } catch(e) {
      this._error = `No se pudieron eliminar las cocciones: ${String(e?.message || e)}`;
    } finally {
      this._busy = false;
      this.render();
    }
    if (success) await this.refresh();
  }
  openRename() {
    if (this._busy || this._selected.size !== 1) return;
    const id = [...this._selected][0];
    const item = this._all.find(c => c.id === id);
    if (!item) return;
    this._renameTarget = {id};
    this._error = '';
    this._notice = '';
    this.render();
    // El nuevo cuadro mantiene su nodo mientras se escribe, incluso en móvil.
    this.shadowRoot.querySelector('#rename-name')?.focus();
  }
  closeRename() {
    if (this._busy) return;
    this._renameTarget = null;
    this.render();
  }
  async saveRename() {
    if (this._busy || !this._hass || !this._renameTarget) return;
    const id = this._renameTarget.id;
    const input = this.shadowRoot.querySelector('#rename-name');
    const inlineError = this.shadowRoot.querySelector('#rename-error');
    const button = this.shadowRoot.querySelector('#confirm-rename');
    const cancel = this.shadowRoot.querySelector('#cancel-rename');
    if (!input) return;
    const nombre = input.value.trim();
    if (!nombre || nombre.length > 120) {
      if (inlineError) inlineError.textContent = 'Escribe un nombre de 1 a 120 caracteres.';
      input.focus();
      return;
    }
    this._busy = true;
    if (button) button.disabled = true;
    if (cancel) cancel.disabled = true;
    if (input) input.disabled = true;
    if (inlineError) inlineError.textContent = '';
    try {
      const result = await this._hass.callWS({
        type:'cjd9000p_history/rename', coccion_id:id, nombre
      });
      if (result?.id !== id || typeof result?.nombre !== 'string' || !result.nombre.trim())
        throw new Error('PostgreSQL no ha confirmado el cambio de nombre');
      const stored = result.nombre;
      const item = this._all.find(c => c.id === id);
      if (item) item.nombre = stored;
      const detail = this._details.get(id);
      if (detail) detail.nombre = stored;
      this._renameTarget = null;
      this._error = '';
      this._notice = `Cocción #${id} renombrada como «${stored}». No se ha modificado el perfil de Mis curvas.`;
      // Restablecer busy ANTES de pintar botones, especialmente en la vista móvil.
      this._busy = false;
      // Tras el guardado sí refrescamos el listado, agrupaciones y leyendas.
      this.render();
    } catch (e) {
      // No redibujar al fallar: conserva el nombre tecleado y el foco del móvil.
      if (inlineError) inlineError.textContent = `No se pudo guardar: ${String(e?.message || e)}`;
      if (button) button.disabled = false;
      if (cancel) cancel.disabled = false;
      if (input) { input.disabled = false; input.focus(); }
    } finally {
      this._busy = false;
    }
  }
  async saveNote() {
    if(this._busy || !this._hass || this._selected.size!==1) return;
    const id=[...this._selected][0];
    const field=this.shadowRoot.querySelector('#personal-note');
    if(!field) return;
    const text=field.value;
    if(text.length>4000) {this._error='Máximo 4000 caracteres por observación.';this.render();return;}
    this._busy=true;this._error='';this._notice='';
    // No redibujar mientras se guarda: conservar el texto editable ante fallos.
    const btn=this.shadowRoot.querySelector('#save-note');
    if(btn)btn.disabled=true;
    try {
      const res=await this._hass.callWS({type:'cjd9000p_history/save_note',coccion_id:id,observaciones:text});
      const stored=res?.observaciones;
      if(typeof stored!=='string')throw new Error('Respuesta de guardado incompleta');
      const detail=this._details.get(id);
      if(detail)detail.observaciones=stored;
      this._noteDrafts.delete(id);
      const list=this._all.find(c=>c.id===id);
      if(list)list.tiene_observaciones=!!stored.trim();
      this._notice=`Observaciones guardadas en PostgreSQL para la cocción #${id}.`;
    } catch(e) {
      this._error=`No se guardaron las observaciones: ${String(e?.message || e)}`;
      const err=this.shadowRoot.querySelector('[data-note-error]');
      if(err)err.textContent=this._error;
      else this._notice=this._error;
      if(btn)btn.disabled=false;
    } finally {this._busy=false;}
    if (!this._error) this.render();
  }
  comparison() {
    if(this._selected.size<2)return '';
    const datasets=[...this._selected].map(id=>this._details.get(id)).filter(Boolean);
    if(datasets.length<2)return '';
    const colors=['#11a77c','#d97706','#8b5cf6','#2386e2','#cf4779','#778b17','#a46a39'];
    const metrics=[
      {label:'Temperatura máxima PV',value:d=>d.estadisticas?.pv_max,unit:'°C',fmt:v=>`${this.fmt(v)} °C`},
      {label:'Duración entre primera y última lectura',value:d=>this.durationOf(d),unit:'s',fmt:v=>this.duration(v)},
      {label:'Desviación media |PV − SV|',value:d=>d.estadisticas?.desviacion_abs_media,unit:'°C',fmt:v=>`${this.fmt(v)} °C`,lower:true},
      {label:'Continuidad temporal registrada',value:d=>this.coverageOf(d),unit:'%',fmt:v=>`${this.fmt(v)} %`}
    ];
    const signature=d=>JSON.stringify((d.segmentos||[]).map((s,i)=>i===0?[null,s.minutos]:[s.temperatura,s.minutos]));
    const comparable=datasets.every(d=>Array.isArray(d.segmentos)&&d.segmentos.length===20&&signature(d)===signature(datasets[0]));
    const head=`<div class="compare-note">${comparable?'Curvas programadas coincidentes (ignorando C01): se pueden contrastar sus resultados.':'Las curvas programadas son diferentes o incompletas: los indicadores describen cada cocción, pero no permiten clasificar cuál fue mejor.'} Las cifras proceden de todas las lecturas almacenadas, no solo de los puntos reducidos de la gráfica.</div>`;
    const blocks=metrics.map(m=>{
      const vals=datasets.map(d=>m.value(d)).filter(Number.isFinite);
      const max=Math.max(0,...vals);
      const bars=datasets.map((d,i)=>{
        const val=m.value(d), v=Number.isFinite(val)?val:null;
        const width=v===null?0:(m.unit==='%'?v:Math.max(2, max>0?100*v/max:0));
        const baseline=m.value(datasets[0]);
        const delta=v!==null&&Number.isFinite(baseline)?v-baseline:null;
        const deltaLabel=i>0&&delta!==null?` · Δ ${delta>=0?'+':'−'}${m.unit==='s'?this.duration(Math.abs(delta)):this.fmt(Math.abs(delta))}${m.unit==='s'?'':m.unit}`:'';
        return `<div class="metric-row"><div class="metric-name"><span class="metric-dot" style="background:${colors[i%colors.length]}"></span><span>${this.esc(d.nombre)} #${d.id}</span></div><div class="metric-track"><div class="metric-fill" style="width:${Math.min(100,width)}%;background:${colors[i%colors.length]}"></div></div><span class="metric-number">${v===null?'—':m.fmt(v)}<small>${this.esc(deltaLabel)}</small></span></div>`;
      }).join('');
      return `<div class="metric-block"><h4>${this.esc(m.label)}</h4>${bars}</div>`;
    }).join('');
    const segmentNumbers=[...new Set(datasets.flatMap(d=>(d.segmentos_reales||[]).map(s=>s.numero).filter(n=>Number.isInteger(n)&&n>=1&&n<=20)))].sort((a,b)=>a-b);
    const perSegment=segmentNumbers.length?`<details class="compare-segments"><summary>Comparar tramos, tiempos observados y desviación PV−SV (${segmentNumbers.length})</summary><div class="scroll"><table><thead><tr><th>Tramo</th>${datasets.map((d,i)=>`<th><i class="metric-dot inline-dot" style="background:${colors[i%colors.length]}"></i> #${d.id} · ${this.esc(d.nombre)}</th>`).join('')}</tr></thead><tbody>${segmentNumbers.map(n=>`<tr><td>${n}</td>${datasets.map(d=>{const s=(d.segmentos_reales||[]).find(x=>x.numero===n);return `<td>${s?`${this.minutes(s.segundos)}<br><small>|PV−SV| ${this.fmt(s.desviacion_abs_media)} °C · ${s.muestras} muestras</small>`:'—'}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><p class="muted tiny">Se comparan números físicos de tramo. Si los programas son diferentes, un mismo número puede representar temperaturas distintas.</p></details>`:'';
    const notes=`<div class="comparison-notes"><h4>Observaciones y resultados registrados</h4><div class="note-columns">${datasets.map((d,i)=>`<div class="note-preview"><div class="metric-name"><i class="metric-dot" style="background:${colors[i%colors.length]}"></i><strong>${this.esc(d.nombre)} · #${d.id}</strong></div><div class="note-body">${d.observaciones?this.esc(d.observaciones):'<span class="muted">Sin observaciones personales</span>'}</div></div>`).join('')}</div></div>`;
    return `<section class="comparison"><h3>Comparación de resultados</h3>${head}${blocks}${perSegment}${notes}<p class="muted tiny">Δ significa diferencia respecto a la primera cocción seleccionada. La desviación PV−SV representa seguimiento de consigna, no una valoración automática de calidad. La continuidad solo suma intervalos válidos de hasta 5 s; no demuestra que la cocción fuese técnicamente correcta.</p></section>`;
  }
  deviationChart() {
    if(!this._showDeviation||!this._selected.size)return '';
    const datasets=[...this._selected].map(id=>this._details.get(id)).filter(Boolean);
    const valid=datasets.flatMap(d=>(d.points||[]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])&&Number.isFinite(p[2])));
    if(valid.length<2)return '';
    const colors=['#11a77c','#d97706','#8b5cf6','#2386e2','#cf4779','#778b17','#a46a39'];
    const W=860,H=190,L=57,R=18,T=14,B=36;
    const maxX=Math.max(1,...valid.map(p=>p[0]));
    const timeAxis=this._timeAxis(maxX);
    const maxDev=Math.max(5,...valid.map(p=>Math.abs(p[1]-p[2])))*1.1;
    const x=n=>L+(W-L-R)*n/timeAxis.domainMax;
    const y=n=>T+(H-T-B)*(maxDev-n)/(2*maxDev);
    const zero=y(0);
    const paths=datasets.map((d,i)=>{
      const pts=(d.points||[]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])&&Number.isFinite(p[2]));
      const path=pts.map((p,k)=>`${k?'L':'M'}${x(p[0]).toFixed(1)} ${y(p[1]-p[2]).toFixed(1)}`).join(' ');
      return `<path d="${path}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="2"/>`;
    }).join('');
    const ticks=Array.from({length:timeAxis.tickCount+1},(_,i)=>{
      const v=timeAxis.step*i;
      return `<text x="${x(v).toFixed(1)}" y="${H-19}" font-size="11" text-anchor="middle" fill="currentColor">${timeAxis.format(v)}</text>`;
    }).join('');
    return `<h3>Desviación registrada PV − SV</h3><div class="graph"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Desviación entre temperatura real y consigna; cero indica igualdad"><line x1="${L}" y1="${zero}" x2="${W-R}" y2="${zero}" stroke="currentColor" stroke-dasharray="5 4" opacity=".5"/><text x="${L-6}" y="${y(maxDev)+7}" text-anchor="end" font-size="12" fill="currentColor">+${Math.round(maxDev)}°</text><text x="${L-6}" y="${zero+4}" text-anchor="end" font-size="12" fill="currentColor">0°</text><text x="${L-6}" y="${y(-maxDev)-3}" text-anchor="end" font-size="12" fill="currentColor">−${Math.round(maxDev)}°</text>${paths}${ticks}<text x="${W-R}" y="${H-5}" text-anchor="end" font-size="11" fill="currentColor">${this.esc(timeAxis.title)}</text></svg></div><p class="muted tiny">Desviación positiva: PV supera SV. Negativa: PV está por debajo. En la gráfica se usan puntos agregados para mantener el rendimiento.</p>`;
  }
  // Convierte un evento del historial en un hito verificable.
  // No deducimos una PAUSA de una SV horizontal: el controlador puede mantener
  // una consigna estable sin encontrarse pausado.
  _eventKind(evento) {
    const tipo=String(evento?.tipo ?? '').trim().toLowerCase();
    const descripcion=String(evento?.descripcion ?? '').trim().toUpperCase();
    if (tipo==='reanudacion' || tipo==='reanudación' || tipo==='resume' ||
        /REANUD|RESUME/.test(descripcion)) return 'Reanudación';
    if (tipo==='pausa' || tipo==='pausado' || /PAUSAD|^PAUSA$/.test(descripcion)) return 'Pausa';
    if (tipo==='inicio') return 'Inicio';
    if (tipo==='fin') return 'Fin';
    if (tipo==='parada' || tipo==='parado' || /\bPARADO\b/.test(descripcion)) return 'Parada';
    if (tipo==='funcionando' || /\bFUNCIONANDO\b/.test(descripcion)) return 'Marcha';
    return 'Evento';
  }
  _eventTimeline(coccion, maxX) {
    const base=Date.parse(coccion?.inicio || '');
    if (!Number.isFinite(base) || !Number.isFinite(maxX) || maxX<=0)
      return {markers:[],pauses:[]};
    const raw=(coccion.eventos||[]).flatMap(e=>{
      if (!e?.fecha || e.tipo==='importacion_csv') return [];
      const ts=Date.parse(e.fecha);
      const second=(ts-base)/1000;
      if (!Number.isFinite(second) || second<0 || second>maxX) return [];
      return [{second,kind:this._eventKind(e),description:String(e.descripcion||e.tipo||'Evento'),fecha:e.fecha}];
    }).sort((a,b)=>a.second-b.second);
    const markers=[];
    for (const m of raw) {
      // MQTT QoS 1 puede entregar más de una notificación del mismo cambio.
      if (markers.some(prev=>prev.kind===m.kind && Math.abs(prev.second-m.second)<2))continue;
      markers.push(m);
    }
    const pauses=[];
    let pausedAt=null;
    for (const m of markers) {
      if (m.kind==='Pausa') {
        if (pausedAt===null)pausedAt=m.second;
      } else if (pausedAt!==null && ['Reanudación','Marcha','Parada','Fin'].includes(m.kind)) {
        if(m.second>pausedAt) pauses.push({start:pausedAt,end:m.second,open:false});
        pausedAt=null;
      }
    }
    // Si no hay REANUDACIÓN registrada, sombrear solo hasta la última muestra
    // observada, nunca hasta la duración de la curva teórica.
    if (pausedAt!==null && maxX>pausedAt)
      pauses.push({start:pausedAt,end:maxX,open:true});
    return {markers,pauses};
  }
  // Cuatro intervalos con incrementos adecuados para pequeñas temperaturas.
  // 40 °C -> 50 °C, sin forzar siempre la escala a 100 °C.
  _niceTemperatureTop(maximum) {
    const target=Math.max(5,maximum)*1.08;
    const raw=target/4;
    const magnitude=Math.pow(10,Math.floor(Math.log10(raw)));
    const increments=[1,1.25,1.5,2,2.5,3,4,5,7.5,10];
    const inc=increments.find(n=>n*magnitude >= raw-1e-10) ?? 10;
    return 4*inc*magnitude;
  }
  _timeAxis(maxX) {
    const seconds=Math.max(1,maxX);
    // Los ticks emplean intervalos humanos: 2, 5, 10, 15, 30 min, etc.
    // De este modo una prueba de diez minutos muestra 0, 2, 4, 6, 8 y 10 min.
    const steps=[1,2,5,10,15,20,30,60,90,120,180,240,300,600,900,1200,
      1800,2400,3600,5400,7200,10800,14400,21600,43200,86400];
    const target=seconds/5;
    const step=steps.find(value=>value>=target) ?? Math.ceil(target/86400)*86400;
    const tickCount=Math.max(1,Math.ceil(seconds/step));
    const basis={step,tickCount,domainMax:step*tickCount};
    if (seconds<300) return {...basis,title:'Tiempo transcurrido (segundos)',format:v=>`${Math.round(v)} s`};
    if (seconds<7200) return {...basis,title:'Tiempo transcurrido (minutos)',format:v=>{
      const m=Math.round(v/60*10)/10;
      return `${String(m).replace('.',',')} min`;
    }};
    return {...basis,title:'Tiempo transcurrido (horas)',format:v=>{
      const h=Math.floor(v/3600),m=Math.round((v-h*3600)/60);
      return `${h+(m===60?1:0)}h${m>0&&m<60?` ${m}m`:''}`;
    }};
  }
  chart() {
    const ids=[...this._selected];
    const datasets=ids.map(id=>this._details.get(id)).filter(Boolean);
    if(!datasets.length)return '<div class="muted">No hay datos para mostrar.</div>';
    const palette=['#11a77c','#d97706','#8b5cf6','#2386e2','#cf4779','#778b17','#a46a39'];
    const W=860,H=348,L=60,R=20,B=51;
    const eventLane=datasets.length===1 && this._showEvents;
    const T=eventLane?57:27;
    const all=datasets.flatMap(d=>d.points || []).filter(p=>Array.isArray(p)&&Number.isFinite(p[0]));
    if(!all.length)return '<div class="muted">Esta cocción no contiene lecturas.</div>';
    // t01 recorre C01 → C02; C01 proviene del valor real al iniciar.
    const programs=new Map();
    for (const d of datasets) {
      const seg=[...(d.segmentos||[])].sort((a,b)=>a.numero-b.numero);
      if(seg.length!==20 || !seg.every((v,i)=>v.numero===i+1&&Number.isFinite(v.temperatura)&&Number.isFinite(v.minutos)&&v.minutos>=0))continue;
      let last=-1;
      for(let i=0;i<19;i++)if(seg[i].minutos>0)last=i;
      if(last<0)continue;
      let elapsed=0;
      const pts=[[0,seg[0].temperatura]];
      for(let i=0;i<=last;i++) {
        elapsed+=seg[i].minutos*60;
        pts.push([elapsed,seg[i+1].temperatura]);
      }
      programs.set(d.id,pts);
    }
    const shownPrograms=this._showProgram?[...programs.values()].flat():[];
    const observedMaxX=Math.max(1,...all.map(p=>p[0]));
    const maxX=Math.max(observedMaxX,...shownPrograms.map(p=>p[0]));
    const timeAxis=this._timeAxis(maxX);
    const plotted=all.flatMap(p=>[p[1],...(this._showSv?[p[2]]:[])]).concat(shownPrograms.map(p=>p[1])).filter(Number.isFinite);
    const maxTemp=Math.max(5,...plotted);
    const minTemp=Math.min(0,...plotted);
    const upper=this._niceTemperatureTop(maxTemp);
    const lower=minTemp<0?-this._niceTemperatureTop(-minTemp):0;
    const x=v=>L+v/timeAxis.domainMax*(W-L-R);
    const y=v=>T+(upper-v)/(upper-lower)*(H-T-B);
    const drawLine=pts=>pts.filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]))
      .map((p,i)=>`${i?'L':'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
    const axes=Array.from({length:5},(_,i)=>{
      const v=lower+(upper-lower)*i/4,yy=y(v);
      const label=Number.isInteger(v)?String(v):this.fmt(v,1);
      return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="currentColor" opacity=".13"/><text x="${L-8}" y="${yy+4}" text-anchor="end" font-size="12" fill="currentColor">${label}</text>`;
    }).join('');
    let segmentMarks='';
    if (datasets.length===1 && this._showSegments) {
      const pts=datasets[0].points||[];
      let last=null,count=0;
      for (const p of pts) {
        const num=p[3];
        if(num==null || !Number.isFinite(Number(num)))continue;
        if(last!==null && Number(num)!==Number(last) && Number.isFinite(p[0])) {
          const xx=x(p[0]);
          const yy=T+13+(count%2)*15;
          segmentMarks+=`<line x1="${xx}" y1="${T}" x2="${xx}" y2="${H-B}" stroke="#64748b" stroke-width="1" opacity=".55" stroke-dasharray="2 6"><title>Tramo observado ${this.esc(num)} · ${this.esc(this.duration(p[0]))}</title></line><text x="${xx+3}" y="${yy}" font-size="11" fill="#64748b">T${this.esc(num)}</text>`;
          count++;
        }
        last=num;
      }
    }
    let eventMarks='',eventSummary='',pauseBands='';
    if(eventLane) {
      const timeline=this._eventTimeline(datasets[0],observedMaxX);
      const colors={'Pausa':'#3b82f6','Reanudación':'#16a34a','Marcha':'#16a34a','Parada':'#dc2626','Fin':'#dc2626','Inicio':'#94a3b8','Evento':'#64748b'};
      pauseBands=timeline.pauses.map(p=>{
        const xx=x(p.start), width=Math.max(0,x(p.end)-xx);
        const tooltip=p.open?'Pausa registrada sin reanudación posterior; sombreado hasta el final de los datos':'Intervalo en pausa confirmado por eventos registrados';
        return `<rect x="${xx.toFixed(1)}" y="${T}" width="${width.toFixed(1)}" height="${H-B-T}" fill="#60a5fa" opacity=".15"><title>${tooltip} · desde ${this.esc(this.duration(p.start))} hasta ${this.esc(this.duration(p.end))}</title></rect>`;
      }).join('');
      eventMarks=timeline.markers.map(m=>{
        const xx=x(m.second), c=colors[m.kind]||'#64748b';
        const label=this.esc(`${m.kind}: ${m.description} · ${this.duration(m.second)}`);
        return `<line x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${T}" y2="${H-B}" stroke="${c}" opacity=".52" stroke-dasharray="5 4"><title>${label}</title></line><circle cx="${xx.toFixed(1)}" cy="34" r="5" fill="${c}" stroke="var(--card-background-color,#fff)" stroke-width="1.2"><title>${label}</title></circle>`;
      }).join('');
      if(timeline.markers.length)eventSummary=`<div class="event-key"><strong>Eventos:</strong> ${timeline.markers.map(m=>`<span class="event-pill"><i style="background:${colors[m.kind]||'#64748b'}"></i>${this.esc(m.kind)} · ${this.esc(this.duration(m.second))}</span>`).join('')}</div>`;
      if(timeline.pauses.length)eventSummary+=`<div class="muted tiny">Las franjas azules suaves muestran intervalos en PAUSA confirmados por eventos, no intervalos deducidos de una consigna SV constante.</div>`;
    }
    const paths=datasets.map((d,i)=>{
      const c=palette[i%palette.length];
      const real=drawLine((d.points||[]).map(p=>[p[0],p[1]]));
      const sv=drawLine((d.points||[]).map(p=>[p[0],p[2]]));
      const program=drawLine(programs.get(d.id)||[]);
      return `<path d="${real}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linejoin="round"/>${this._showSv?`<path d="${sv}" fill="none" stroke="${c}" stroke-dasharray="7 4" stroke-width="1.7" opacity=".8"/>`:''}${this._showProgram&&program?`<path d="${program}" fill="none" stroke="${c}" stroke-dasharray="2 5" stroke-width="2" stroke-linejoin="round"/>`:''}`;
    }).join('');
    const ticks=Array.from({length:timeAxis.tickCount+1},(_,i)=>{
      const v=timeAxis.step*i;
      return `<text x="${x(v).toFixed(1)}" y="${H-18}" font-size="12" fill="currentColor" text-anchor="middle">${timeAxis.format(v)}</text>`;
    }).join('');
    const legend=datasets.map((d,i)=>`<span class="legend"><b style="background:${palette[i%palette.length]}"></b>${this.esc(d.nombre)} (#${d.id})${!programs.has(d.id)?' · sin programa guardado':''}</span>`).join('');
    const rail=eventLane?`<line x1="${L}" x2="${W-R}" y1="45" y2="45" stroke="currentColor" opacity=".18"/><text x="${L-7}" y="38" fill="currentColor" font-size="11" text-anchor="end">Eventos</text>`:'';
    return `<div class="graph"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperaturas en grados centígrados y eventos en una franja independiente; ${this.esc(timeAxis.title)}">${pauseBands}${axes}${segmentMarks}${eventMarks}${paths}${rail}${ticks}<text x="${L}" y="13" fill="currentColor" font-size="12">Temperatura (°C)</text><text x="${W-R}" y="${H-3}" text-anchor="end" fill="currentColor" font-size="12">${this.esc(timeAxis.title)}</text></svg></div><div class="legends">${legend}</div>${eventSummary}<div class="muted tiny">Continua: PV real. ${this._showSv?'Rayas largas: SV registrada. ':''}${this._showProgram?'Punteada: programa teórico a partir de los tramos guardados. ':''}Las líneas comparten color por cocción; las marcas T indican cambios de tramo observados. Los eventos se dibujan en una banda independiente y nunca representan una temperatura. La duración programada no incluye esperas del controlador. En históricos sin programa no se inventa la curva original.</div>`;
  }
  detail() {
    if(this._selected.size!==1)return '';
    const d=this._details.get([...this._selected][0]);if(!d)return '';
    const events=d.eventos||[], seg=d.segmentos||[], observed=d.segmentos_reales||[], st=d.estadisticas||{};
    const byNumber=new Map(observed.map(r=>[r.numero,r]));
    const configured=new Map(seg.map(s=>[s.numero,s]));
    const lastProgrammed=Math.max(0,...seg.filter(s=>s.numero<20&&s.minutos>0).map(s=>s.numero));
    const numbers=[...new Set([...seg.filter(s=>s.numero<=lastProgrammed).map(s=>s.numero),...observed.map(s=>s.numero)])].sort((a,b)=>a-b);
    const rows=numbers.map(num=>{
      const programmed=configured.get(num), next=configured.get(num+1), actual=byNumber.get(num);
      const route=programmed&&next?`${this.fmt(programmed.temperatura,0)} → ${this.fmt(next.temperatura,0)} °C`:'—';
      const extra=actual?`<details><summary>Detalles</summary><div class="segment-sub">PV mín. ${this.fmt(actual.pv_min)} °C · máx. ${this.fmt(actual.pv_max)} °C<br>Desviación media |PV−SV| ${this.fmt(actual.desviacion_abs_media)} °C<br>Media firmada PV−SV ${this.fmt(actual.desviacion_media)} °C</div></details>`:'—';
      return `<tr><td>${num}</td><td>${route}</td><td>${programmed?.minutos??'—'}</td><td>${actual?this.minutes(actual.segundos):'—'}</td><td>${actual?.muestras??'—'}</td><td>${extra}</td></tr>`;
    }).join('');
    const missingTime=d.total>5 && (d.points||[]).length<=2;
    const summary=`<div class="facts"><div><small>Temperatura máxima PV</small>${this.fmt(st.pv_max)} °C</div><div><small>Duración entre lecturas</small>${this.duration(this.durationOf(d))}</div><div><small>Desviación media |PV−SV|</small>${this.fmt(st.desviacion_abs_media)} °C</div><div><small>Continuidad temporal (≤ 5 s)</small>${Number.isFinite(this.coverageOf(d))?this.fmt(this.coverageOf(d))+' %':'—'}</div><div><small>Lecturas</small>${d.total??'—'}</div><div><small>Huecos mayores de 5 s</small>${st.lagunas??'—'}</div></div>`;
    const note=`<section class="notes"><h3>Observaciones personales</h3><p class="muted tiny">Anota piezas, esmaltes, carga, incidencias y resultado final. Se guarda en PostgreSQL exclusivamente para esta cocción, y no modifica el perfil ni el horno.</p><textarea id="personal-note" rows="5" maxlength="4000" placeholder="Ej.: Esmalte utilizado, piezas, posición en el horno, resultado, defectos...">${this.esc(this._noteDrafts.has(d.id)?this._noteDrafts.get(d.id):d.observaciones||'')}</textarea><div class="bar"><small class="muted">Hasta 4000 caracteres · escritura manual</small><button id="save-note" ${this._busy?'disabled':''}>Guardar observaciones</button></div><p class="error" data-note-error></p></section>`;
    return `${missingTime?'<p class="error">Atención: este histórico parece tener marcas de tiempo incorrectas o repetidas. Comprueba o repara su importación CSV antes de comparar su duración.</p>':''}<h3>Detalles de ${this.esc(d.nombre)} · #${d.id}</h3>${summary}<div class="facts fine"><div><small>Primera lectura</small>${this.date(d.inicio)}</div><div><small>Última lectura</small>${this.date(d.fin)}</div><div><small>Estado</small>${this.esc(d.estado)}</div><div><small>Memoria física</small>${this.esc(d.numero_curva??'—')}</div></div><h4>Tramos: programa y comportamiento observado</h4>${numbers.length?`<div class="scroll"><table><thead><tr><th>Tramo</th><th>Desde → Hasta</th><th>Programado min</th><th>Observado</th><th>Muestras</th><th>Análisis</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted tiny">El tiempo observado suma solo intervalos consecutivos de hasta 5 s dentro del mismo tramo; no incluye lagunas de comunicación. Para los recorridos físicos, t01 conecta C01 con C02, etc.; t20 se conserva pero no dibuja C21. Los resultados históricos con datos incompletos muestran «—».</p>`:'<p class="muted">Sin datos de segmentos.</p>'}${note}<h4>Eventos (${events.length})</h4>${events.length?`<div class="scroll"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th></tr></thead><tbody>${events.map(e=>`<tr><td>${this.date(e.fecha)}</td><td>${this.esc(e.tipo)}</td><td>${this.esc(e.descripcion)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No hay eventos.</p>'}`;
  }
  // v0.6.2: No reconstruir los filtros durante la escritura ni al abrir un calendario.
  // Solo se sustituye la lista de resultados. Los inputs conservan su identidad
  // DOM, su foco, el teclado virtual y la selección del usuario.
  _historyRowHtml(c) {
    const selected=this._selected;
    return `<div class="item ${selected.has(c.id)?'on':''}" data-id="${c.id}" role="checkbox" aria-checked="${selected.has(c.id)}" tabindex="0"><input type="checkbox" ${selected.has(c.id)?'checked':''} aria-label="Seleccionar cocción #${c.id}" tabindex="-1"><div class="grow"><div class="name">${this.esc(c.nombre)} · #${c.id}${c.tiene_observaciones?' <span title="Observaciones guardadas">📝</span>':''}</div><div class="meta">${this.date(c.inicio)} · ${this.esc(c.estado)} · ${c.lecturas} lecturas · ${c.segmentos} segmentos</div></div><div class="item-metrics"><div class="metric-temp"><small>Máxima PV</small><strong>${c.pv_max==null?'—':`${this.fmt(c.pv_max)} °C`}</strong></div><div class="metric-duration" title="Tiempo entre inicio y fin registrados; incluye pausas y posibles huecos de comunicación"><small>Duración</small><strong>${this.historyDurationLabel(c)}</strong></div></div></div>`;
  }
  _historyListHtml(visible=this.filteredList()) {
    if (!this._groupByProfile) return visible.map(c=>this._historyRowHtml(c)).join('');
    const groups=new Map();
    for (const c of visible) {
      const key=c.nombre||'Sin nombre';
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(c);
    }
    return [...groups].map(([name,rows])=>`<section class="history-group"><h3>${this.esc(name)} <small>(${rows.length})</small></h3>${rows.map(c=>this._historyRowHtml(c)).join('')}</section>`).join('');
  }
  _refreshFilteredList() {
    const container=this.shadowRoot?.querySelector('#history-results');
    if (!container) return;
    const visible=this.filteredList();
    // El elemento #history-results es estable: el input y los calendarios
    // quedan intactos; la delegación de eventos mantiene la selección activa.
    container.innerHTML=this._historyListHtml(visible);
    const count=this.shadowRoot.querySelector('#history-count');
    if (count) count.textContent=`Mostrando ${visible.length} de ${this._all.length} cocciones. La selección se conserva al filtrar.`;
  }
  _toggleHistoryItem(id) {
    if (!Number.isInteger(id)) return;
    if (this._selected.has(id)) this._selected.delete(id);
    else this._selected.add(id);
    this._visible=false;
    this._deleteConfirm=false;
    this._renameTarget=null;
    this.render();
  }
  render() {
    const root=this.shadowRoot;if(!root || !this._config)return;
    const selected=this._selected;
    const visible=this.filteredList();
    const listHtml=this._historyListHtml(visible);
    const states=[...new Set(this._all.map(c=>c.estado).filter(Boolean))].sort();
    root.innerHTML=`<style>
      :host{display:block;font-family:var(--paper-font-body1_-_font-family,inherit);color:var(--primary-text-color);--cjd-primary:#29bc6c;--cjd-primary-text:#fff}
      ha-card{display:block;padding:24px;min-width:0;overflow:hidden;background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:18px}
      h2{margin:0 0 15px;font-size:22px}h3{margin-top:26px}h4{margin-bottom:8px}
      .cjd-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
      .cjd-eyebrow{font-size:11px;font-weight:800;letter-spacing:1.6px;color:var(--cjd-primary);margin-bottom:5px}
      .cjd-header h1{margin:0;font-size:27px;line-height:1.15;font-weight:750;color:var(--primary-text-color,#212121)}
      .cjd-subtitle{margin-top:7px;color:var(--secondary-text-color,#757575);font-size:14px}
      .btn-refresh{flex-shrink:0;white-space:nowrap;background:var(--cjd-primary);color:var(--cjd-primary-text)}
      .btn-view{background:var(--cjd-primary);color:var(--cjd-primary-text)}
      .bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .muted{color:var(--secondary-text-color,#777)}.tiny{font-size:12px;margin:10px 0}.item{display:flex;align-items:center;gap:12px;border:1px solid var(--divider-color,#ddd);border-radius:10px;padding:12px;cursor:pointer;margin:8px 0}
      .item.on{background:color-mix(in srgb,var(--cjd-primary) 9%,var(--ha-card-background,var(--card-background-color,#fff)));border-color:var(--cjd-primary);box-shadow:inset 3px 0 0 var(--cjd-primary)}.item:focus-visible{outline:2px solid var(--cjd-primary);outline-offset:2px}.item input{width:19px;height:19px;flex-shrink:0;accent-color:var(--cjd-primary);pointer-events:none}.name{font-weight:600;overflow-wrap:anywhere}.meta{font-size:12px;color:var(--secondary-text-color,#777);margin-top:3px}.grow{flex:1;min-width:0}.item-metrics{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;min-width:105px;text-align:right}.item-metrics>div{display:flex;flex-direction:column;gap:2px}.item-metrics small{font-size:10px;line-height:1.1;color:var(--secondary-text-color,#777)}.item-metrics strong{font-size:13px;white-space:nowrap;line-height:1.3;font-variant-numeric:tabular-nums}.metric-duration strong{color:var(--primary-text-color)}button{border:0;border-radius:11px;min-height:42px;padding:10px 17px;cursor:pointer;background:var(--cjd-primary);color:var(--cjd-primary-text);font-size:14px;font-weight:700}button:focus-visible{outline:2px solid var(--cjd-primary);outline-offset:2px}button.alt{background:var(--secondary-background-color,#eee);color:var(--primary-text-color,#222)}button:disabled{opacity:.4;cursor:default}button.danger{background:#b42318;color:#fff}.notice{padding:10px 12px;border-radius:8px;margin:10px 0;background:var(--secondary-background-color,#eee)}.delete-overlay{position:fixed;inset:0;background:rgba(0,0,0,.58);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px}.delete-dialog{width:min(100%,540px);max-height:80vh;overflow:auto;background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color);padding:22px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.3)}.delete-dialog h3{margin:0 0 12px}.delete-items{max-height:220px;overflow:auto;padding-left:18px}.delete-items li{margin:7px 0}.danger-text{color:var(--error-color,#b42318);font-weight:700}.actions{display:flex;gap:9px;flex-wrap:wrap;margin:18px 0}.error{color:var(--error-color,#c00);padding:8px}.graph-results{scroll-margin-top:92px;outline:none}.graph-results:focus-visible{outline:2px solid var(--cjd-primary);outline-offset:3px}.graph{overflow-x:auto}.graph svg{width:100%;min-width:340px;height:auto}.legends{display:flex;gap:12px;flex-wrap:wrap}.legend{font-size:12px;display:flex;gap:5px;align-items:center}.legend b{width:14px;height:3px;display:inline-block}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}.facts>div{background:var(--secondary-background-color,#eee);border-radius:8px;padding:10px}.facts small{display:block;color:var(--secondary-text-color,#777);margin-bottom:5px}.scroll{max-height:330px;overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:7px;border-bottom:1px solid var(--divider-color,#ddd);text-align:left}.event-key{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0;font-size:12px}.event-pill{display:inline-flex;align-items:center;gap:4px;background:var(--secondary-background-color,#eee);padding:4px 7px;border-radius:6px}.event-pill i{width:8px;height:8px;border-radius:50%;display:inline-block}label.toggle{display:inline-flex;gap:6px;align-items:center;font-size:13px}
      .filters{display:flex;align-items:end;gap:10px;flex-wrap:wrap;padding:12px;background:var(--secondary-background-color,#f4f4f5);border-radius:10px;margin:12px 0}
      .filters label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--secondary-text-color,#666)}.filters input,.filters select{font:inherit;font-size:13px;color:var(--primary-text-color);background:var(--card-background-color,#fff);border:1px solid var(--divider-color,#ddd);padding:8px;border-radius:8px;min-width:125px;max-width:100%}.filters input[type="checkbox"]{min-width:0}.filters .check{flex-direction:row;align-items:center}
      .history-group>h3{font-size:15px;margin:18px 0 7px}.history-group small{font-weight:normal;color:var(--secondary-text-color)}
      .comparison{margin:26px 0}.compare-note{font-size:13px;padding:10px;background:var(--secondary-background-color,#eee);border-radius:8px}.metric-block{padding:12px 0;border-bottom:1px solid var(--divider-color,#ddd)}.metric-block h4{margin:0 0 10px}.metric-row{display:grid;grid-template-columns:minmax(140px,2fr) minmax(80px,3fr) minmax(100px,1.5fr);align-items:center;gap:10px;margin:8px 0;font-size:12px}.metric-name{display:flex;align-items:center;gap:6px}.metric-dot{height:10px;width:10px;flex:none;border-radius:50%}.metric-track{height:10px;background:var(--secondary-background-color,#eee);border-radius:8px;overflow:hidden}.metric-fill{height:100%;border-radius:8px}.metric-number{font-weight:600}.metric-number small{display:block;font-weight:normal;color:var(--secondary-text-color)}
      .compare-segments{margin-top:16px;border:1px solid var(--divider-color,#ddd);border-radius:9px;padding:12px}.compare-segments summary{cursor:pointer;font-weight:600}.compare-segments .scroll{margin-top:12px}.inline-dot{display:inline-block;vertical-align:middle}.comparison-notes{margin:16px 0}.note-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.note-preview{border:1px solid var(--divider-color,#ddd);border-radius:8px;padding:12px}.note-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;margin-top:8px;line-height:1.5}
      .rename-dialog label{display:block;font-weight:600;font-size:13px;margin:14px 0 8px}.rename-dialog input{display:block;width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid var(--divider-color,#ddd);background:var(--card-background-color,#fff);color:var(--primary-text-color);font:inherit;font-size:16px}.rename-dialog .actions{justify-content:flex-end}
      .notes{padding:14px;margin:20px 0;background:var(--secondary-background-color,#f3f4f5);border-radius:10px}.notes textarea{display:block;width:100%;box-sizing:border-box;min-height:125px;resize:vertical;border:1px solid var(--divider-color,#ddd);background:var(--card-background-color,#fff);color:var(--primary-text-color);border-radius:8px;font:inherit;font-size:14px;padding:10px}.notes .bar{margin-top:10px}.segment-sub{padding:8px 0;color:var(--secondary-text-color);line-height:1.7}.fine{margin-top:10px}.fine>div{padding:7px}
      @media(max-width:650px){ha-card{padding:16px}.cjd-header{gap:12px}.cjd-header h1{font-size:25px}.btn-refresh{padding:9px 12px}.metric-row{grid-template-columns:1fr 1.3fr;gap:6px}.metric-number{grid-column:2}.filters label{flex:1 1 120px}}
      @media(max-width:430px){.item{flex-wrap:wrap}.item-metrics{flex:0 0 100%;min-width:0;flex-direction:row;justify-content:flex-end;gap:20px;padding-left:31px}.item-metrics>div{align-items:flex-end}.cjd-header{align-items:flex-start}.cjd-header h1{font-size:23px}.cjd-subtitle{font-size:12px}.btn-refresh{font-size:12px;padding:7px 9px;min-height:38px}}
    </style><ha-card><div class="cjd-header"><div><div class="cjd-eyebrow">CJD-9000P</div><h1>${this.esc(this._config.title)}</h1><div class="cjd-subtitle">Historial de cocciones del horno</div></div><button class="btn-refresh" id="refresh" ${this._busy?'disabled':''}>↻ Actualizar</button></div>
      <div class="muted">Selecciona una o varias cocciones y pulsa Ver o comparar gráficas. ${selected.size} seleccionada(s).</div>
      ${this._error?`<div class="error">${this.esc(this._error)}</div>`:''}
      ${this._notice?`<div class="notice">${this.esc(this._notice)}</div>`:''}
      ${this.integritySummary()}
      ${!this._all.length?'<p class="muted">No hay cocciones o todavía no se ha cargado la lista.</p>':''}
      <div class="filters"><label>Buscar curva o #<input id="filter-name" type="search" placeholder="Nombre o número" value="${this.esc(this._filterName)}"></label><label>Estado<select id="filter-state"><option value="">Todos</option>${states.map(v=>`<option value="${this.esc(v)}" ${v===this._filterState?'selected':''}>${this.esc(v)}</option>`).join('')}</select></label><label>Desde<input id="filter-from" type="date" value="${this.esc(this._filterFrom)}"></label><label>Hasta<input id="filter-to" type="date" value="${this.esc(this._filterTo)}"></label><label class="check"><input id="group-by-profile" type="checkbox" ${this._groupByProfile?'checked':''}> Agrupar por curva</label></div>
      <p class="muted tiny" id="history-count">Mostrando ${visible.length} de ${this._all.length} cocciones. La selección se conserva al filtrar.</p>
      <div id="history-results">${listHtml}</div>
      <div class="actions"><button class="btn-view" id="compare" ${selected.size===0||this._busy?'disabled':''}>${this._busy?'Consultando…':selected.size===1?'Ver gráfica':'Comparar gráficas'}</button><button id="check-integrity" class="alt" ${selected.size!==1||this._busy||['solicitando','comprobando'].includes(this._integrity?.estado)?'disabled':''}>⌕ Comprobar integridad</button><button id="clear" class="alt">Limpiar selección</button><button id="rename-selected" class="alt" ${selected.size!==1||this._busy?'disabled':''}>✎ Cambiar nombre</button><button id="delete-selected" class="danger" ${selected.size===0||this._busy?'disabled':''}>Eliminar seleccionadas (${selected.size})</button></div>
      ${this._visible?`<section class="graph-results" id="cjd-graph-results" tabindex="-1" aria-label="${selected.size===1?'Gráfica de cocción':'Comparación de cocciones'}"><div class="bar"><h3>${selected.size===1?'Gráfica de cocción':'Comparación de cocciones'}</h3><div class="bar"><label class="toggle"><input id="show-sv" type="checkbox" ${this._showSv?'checked':''}> Mostrar SV</label><label class="toggle"><input id="show-program" type="checkbox" ${this._showProgram?'checked':''}> Programa original</label>${selected.size===1?`<label class="toggle"><input id="show-segments" type="checkbox" ${this._showSegments?'checked':''}> Marcar segmentos</label><label class="toggle"><input id="show-events" type="checkbox" ${this._showEvents?'checked':''}> Marcar eventos</label>`:''}<label class="toggle"><input id="show-deviation" type="checkbox" ${this._showDeviation?'checked':''}> Ver desviación PV−SV</label></div></div>${this.chart()}${this.deviationChart()}${this.comparison()}${this.detail()}</section>`:''}
      ${this._renameTarget ? (()=>{const c=this._all.find(x=>x.id===this._renameTarget.id);return c?`<div class="delete-overlay" role="presentation"><div class="delete-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title"><h3 id="rename-title">Cambiar nombre de la cocción #${c.id}</h3><p class="muted tiny">Solo cambia el nombre de este registro en PostgreSQL. No modifica el perfil de «Mis curvas», otras cocciones ni la programación del horno.</p><label for="rename-name">Nombre para el historial</label><input id="rename-name" type="text" maxlength="120" autocomplete="off" value="${this.esc(c.nombre)}"><p class="error" id="rename-error" role="alert"></p><div class="actions"><button id="cancel-rename" class="alt">Cancelar</button><button id="confirm-rename">Guardar nombre</button></div></div></div>`:'';})() : ''}
      ${this._deleteConfirm?`<div class="delete-overlay" role="presentation"><div class="delete-dialog" role="alertdialog" aria-modal="true" aria-label="Confirmar eliminación de cocciones"><h3>Eliminar ${selected.size} cocciones</h3><p class="danger-text">Esta acción no se puede deshacer desde Home Assistant.</p><p>Se borrarán las lecturas, los tramos, los eventos y los historiales asociados en PostgreSQL. Los CSV del ASUS se conservarán. No se permite eliminar cocciones en marcha o todavía abiertas.</p><ul class="delete-items">${this._all.filter(c=>selected.has(c.id)).map(c=>`<li>${this.esc(c.nombre)} · #${c.id} (${this.esc(c.estado)})</li>`).join('')}</ul><div class="actions"><button id="cancel-delete" class="alt">Cancelar</button><button id="confirm-delete" class="danger">Sí, eliminar definitivamente</button></div></div></div>`:''}
    </ha-card>`;
    root.querySelector('#refresh')?.addEventListener('click',()=>this.refresh());
    root.querySelector('#filter-name')?.addEventListener('input',e=>{this._filterName=e.target.value;this._refreshFilteredList();});
    root.querySelector('#filter-state')?.addEventListener('change',e=>{this._filterState=e.target.value;this._refreshFilteredList();});
    root.querySelector('#filter-from')?.addEventListener('change',e=>{this._filterFrom=e.target.value;this._refreshFilteredList();});
    root.querySelector('#filter-to')?.addEventListener('change',e=>{this._filterTo=e.target.value;this._refreshFilteredList();});
    root.querySelector('#group-by-profile')?.addEventListener('change',e=>{this._groupByProfile=e.target.checked;this._refreshFilteredList();});
    root.querySelector('#personal-note')?.addEventListener('input',e=>{if(this._selected.size===1)this._noteDrafts.set([...this._selected][0],e.target.value);});
    root.querySelector('#save-note')?.addEventListener('click',()=>this.saveNote());
    root.querySelector('#rename-selected')?.addEventListener('click',()=>this.openRename());
    root.querySelector('#cancel-rename')?.addEventListener('click',()=>this.closeRename());
    root.querySelector('#confirm-rename')?.addEventListener('click',()=>this.saveRename());
    root.querySelector('#rename-name')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.saveRename();}if(e.key==='Escape'){e.preventDefault();this.closeRename();}});
    root.querySelector('#delete-selected')?.addEventListener('click',()=>this.requestDelete());
    root.querySelector('#cancel-delete')?.addEventListener('click',()=>{this._deleteConfirm=false;this.render();});
    root.querySelector('#confirm-delete')?.addEventListener('click',()=>this.deleteSelected());
    root.querySelector('#clear')?.addEventListener('click',()=>{this._selected.clear();this._visible=false;this._deleteConfirm=false;this.render();});
    root.querySelector('#compare')?.addEventListener('click',()=>this.compare());
    root.querySelector('#check-integrity')?.addEventListener('click',()=>this.checkIntegrity());
    root.querySelector('#show-sv')?.addEventListener('change',e=>{this._showSv=e.target.checked;this.render();});
    root.querySelector('#show-deviation')?.addEventListener('change',e=>{this._showDeviation=e.target.checked;this.render();});
    root.querySelector('#show-program')?.addEventListener('change',e=>{this._showProgram=e.target.checked;this.render();});
    root.querySelector('#show-segments')?.addEventListener('change',e=>{this._showSegments=e.target.checked;this.render();});
    root.querySelector('#show-events')?.addEventListener('change',e=>{this._showEvents=e.target.checked;this.render();});
    // Delegación: también funciona para las filas insertadas tras filtrar.
    const results=root.querySelector('#history-results');
    results?.addEventListener('click',e=>{
      const item=e.target.closest('.item[data-id]');
      if (item && results.contains(item)) this._toggleHistoryItem(Number(item.dataset.id));
    });
    results?.addEventListener('keydown',e=>{
      if (e.key!=='Enter' && e.key!==' ') return;
      const item=e.target.closest('.item[data-id]');
      if (!item || !results.contains(item)) return;
      e.preventDefault();
      this._toggleHistoryItem(Number(item.dataset.id));
    });
  }
}
if(!customElements.get('cjd9000p-cocciones-card')) customElements.define('cjd9000p-cocciones-card', Cjd9000pCoccionesCard);
window.customCards=window.customCards||[];
window.customCards.push({type:'cjd9000p-cocciones-card',name:'CJD-9000P · Mis cocciones',description:'Historial y comparación de cocciones desde PostgreSQL'});
