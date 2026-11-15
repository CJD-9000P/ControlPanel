/* Regresiones ejecutables con V8: runHistoryUITests(codigoApp).
   DOM simulado: comprueba datos y SVG; no sustituye la aceptación visual. */
async function runHistoryUITests(source) {
 const elements=new Map();
 function element(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,checked:true,disabled:false,innerHTML:'',textContent:'',dataset:{},options:[{},{}],classList:{toggle(){}},addEventListener(){},setAttribute(){},scrollIntoView(){},focus(){}});return elements.get(id);}
 const document={getElementById:element,querySelectorAll:()=>[],querySelector:()=>element('query')},window={addEventListener(){}};
 const sessionStorage={getItem:()=>''};
 class AbortController{constructor(){this.signal={};}abort(){}}
 let responseData=null,failEvents=false;
 async function fetch(path){if(failEvents&&path.endsWith('/events'))throw Error('Eventos no disponibles');return {ok:true,status:200,json:async()=>responseData};}
 const body=source.replace(/\ninit\(\);\s*$/,'\n')+`
 function check(condition,message){if(!condition)throw Error(message);}
 const snapshot=Array.from({length:20},(_,i)=>({temperature:20+i*20,minutes:i<3?10:0}));
 const stats={pv_max:40,duration_seconds:60,mean_abs_deviation:2.5,mean_deviation:-2.5,continuity_percent:80,gaps:1,duplicate_or_reversed:0,segments:[{memory:1,step:1,observed_seconds:5,mean_abs_deviation:2,mean_deviation:-2,samples:5,pv_min:20,pv_max:40}]};
 const f={id:'f1',name:'Cocción <uno>',notes:'Original',curve_name:'Curva',curve_key:'same',started_at:'2026-11-15T10:00:00Z',ended_at:null,status:'running',memory:1,samples:2,snapshot,statistics:stats,events:[{kind:'state',timestamp:'2026-11-15T10:00:30Z',message:'Estado confirmado: PAUSADO',origin:'observed'}],readings:[{timestamp:'2026-11-15T10:00:00Z',pv:20,sv:20,memory:1,step:1,plot_group:0},{timestamp:'2026-11-15T10:01:00Z',pv:40,sv:45,memory:1,step:2,plot_group:1}],timeline:{segments:[{timestamp:'2026-11-15T10:00:00Z',memory:1,step:1},{timestamp:'2026-11-15T10:00:01Z',memory:1,step:2}],gaps:[{start:'2026-11-15T10:00:00Z',end:'2026-11-15T10:01:00Z',seconds:60}],pauses:[{start:'2026-11-15T10:00:00Z',end:'2026-11-15T10:01:00Z',open:false}]}};
 details=[f];detailID='f1';page='history';renderFiringDetail();
 const domain=()=>el=>el.innerHTML.match(/data-time-max="([^"]+)"/)[1];
 check(domain()($('history-chart'))===domain()($('deviation-chart')),'escala compartida con programa');
 check($('history-chart').innerHTML.includes('>T1<')&&$('history-chart').innerHTML.includes('>T2<'),'etiquetas visibles, incluido tramo inicial/breve');
 check($('deviation-chart').innerHTML.includes('Desviación registrada'),'nombre accesible de desviación');
 check($('deviation-legend').innerHTML.includes('Cocción &lt;uno&gt;'),'leyenda de desviación segura');
 check($('history-chart').innerHTML.includes('PAUSA observada'),'sombreado por estado');
 check($('history-marker-key').innerHTML.includes('1 s'),'tiempo completo del tramo breve');
 check(historyPoints(f,r=>r.pv).some(p=>Number.isNaN(p[0])),'corte en huecos');
 check($('history-segments').innerHTML.includes('Media firmada PV − SV: -2'),'desviación firmada');
 $('show-program').checked=false;renderHistoryChart();
 check(domain()($('history-chart'))===domain()($('deviation-chart')),'escala compartida sin programa');
 check(domain()($('history-chart'))<30,'escala cambia con programa oculto');
 $('show-segments').checked=false;$('show-events').checked=false;renderHistoryChart();
 check(!$('history-chart').innerHTML.includes('>T1<'),'ocultar segmentos');
 check(!$('history-chart').innerHTML.includes('PAUSA observada'),'ocultar pausa con eventos');
 details=[f,{...f,id:'f2',name:'Segunda',statistics:{...stats,continuity_percent:90}}];renderStatistics();
 check($('history-statistics').innerHTML.includes('width="90"'),'continuidad absoluta 0–100');
 check($('history-statistics').innerHTML.includes('Δ +10 puntos porcentuales'),'diferencias respecto a primera');
 check(!$('history-statistics').innerHTML.includes('style='),'estilos compatibles con CSP');
 details=[f];detailID='f1';firingDirty=true;$('firing-name').value='Nombre editado';$('firing-notes').value='Borrador sin guardar';
 await setData({...f,ended_at:'2026-11-15T10:02:00Z',status:'ended',samples:3});
 await refreshOpenFiring();
 check(details[0].samples===3,'detalle abierto actualizado hasta cierre');
 check($('firing-notes').value==='Borrador sin guardar'&&$('firing-name').value==='Nombre editado','borrador preservado');
 check(!$('delete-firing').disabled,'cierre observado habilita eliminar');
 state={online:true,state:0,memory:1,step:1,minutes:0,pv:20,sv:20,memories:{1:snapshot}};$('editor-view').hidden=true;
 await setData(state);await setEventFailure(true);page='control';await refresh();
 check(state.online,'fallo de eventos no falsea conexión RTU');
 check($('connection').textContent.includes('MODBUS'),'modo simulado explícito');
 return '20 comprobaciones de interfaz superadas';`;
 return await new Function('document','window','sessionStorage','AbortController','fetch','setData','setEventFailure',`return (async()=>{${body}})();`)(document,window,sessionStorage,AbortController,fetch,async data=>{responseData=data;},async fail=>{failEvents=fail;});
}
