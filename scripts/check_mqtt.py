"""Prueba autorizada MQTT contra simulador temporal; nunca abre un puerto físico."""
import argparse
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import uuid
import urllib.request

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from cjd_panel import __version__
from cjd_panel.mqtt_bridge import MQTTConfig, MQTTBridge, paho_client
from cjd_panel.modbus import SimulatedRTU
from cjd_panel.store import Store
from cjd_panel.worker import Worker


def check(config, exercise=False, against_running=False):
    marker=uuid.uuid4().hex[:10]
    observer=paho_client(replace(config,client_id='cjd-check-observer-'+marker))
    # El cliente de diagnóstico no debe publicar un testamento de disponibilidad.
    observer.will_clear()
    ready=threading.Event()
    outcomes={}
    lock=threading.RLock()
    received=[]
    history=[]
    def connected(client,userdata,flags,reason,properties):
        if reason==0:client.subscribe([(config.topic_prefix+'/event',1),(config.topic_prefix+'/state',1),
             (config.topic_prefix+'/coccion/event',1),(config.topic_prefix+'/coccion/state',1)])
    def subscribed(client,userdata,mid,codes,properties):
        if not any(getattr(code,'is_failure',False) for code in codes):ready.set()
    def message(client,userdata,msg):
        try:data=json.loads(msg.payload)
        except (ValueError,UnicodeError):return
        with lock:
            if '/coccion/' in msg.topic:
                history.append((msg.topic,data))
            elif msg.topic.endswith('/event') and data.get('command_id'):
                outcomes[data['command_id']]=data
            elif msg.topic.endswith('/state'):
                received.append(data)
    observer.on_connect=connected
    observer.on_subscribe=subscribed
    observer.on_message=message
    observer.connect_async(config.host,config.port,keepalive=20)
    observer.loop_start()
    def wait(predicate,description,seconds=12):
        limit=time.monotonic()+seconds
        while time.monotonic()<limit:
            if predicate():return
            time.sleep(.05)
        raise RuntimeError(description+' no confirmada (broker, permisos o respuesta).')
    bridge=worker=store=None
    try:
        wait(ready.is_set,'Conexión y suscripción MQTT')
        print('Autenticación MQTT y suscripción confirmadas.',flush=True)
        if not exercise:return
        with tempfile.TemporaryDirectory(prefix='cjd-mqtt-check-') as directory:
            if against_running:
                class RunningWorker:
                    def request(self,path,payload=None):
                        headers={'X-CJD-Request':'1'}
                        raw=None
                        if payload is not None:
                            raw=json.dumps(payload).encode()
                            headers['Content-Type']='application/json'
                        req=urllib.request.Request('http://127.0.0.1:8080/api/'+path,data=raw,headers=headers)
                        with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
                    def snapshot(self):return self.request('state')
                    def submit(self,operation,payload=None):
                        from concurrent.futures import Future
                        f=Future()
                        try:f.set_result(self.request('commands',{'operation':operation,**(payload or {})}))
                        except Exception as exc:f.set_exception(exc)
                        return f
                    def close(self):pass
                worker=RunningWorker()
                state=worker.snapshot()
                if state.get('mode')!='simulator' or state.get('version')!=__version__:
                    raise RuntimeError('El panel activo no es el simulador de la versión que se está comprobando.')
                if state.get('state')!=0:
                    raise RuntimeError('Hay una cocción activa; el ensayo no la interrumpe.')
            else:
                store=Store(Path(directory)/'panel.sqlite3')
                worker=Worker(SimulatedRTU(segment_seconds=60),store,interval=.1)
                worker.start()
                worker.submit('read').result(3)
                bridge=MQTTBridge(worker,store,replace(config,client_id='cjd-check-bridge-'+marker),Path(directory)/'mqtt.sqlite3')
                bridge.start()
                wait(lambda:bridge.snapshot()['subscribed'],'Suscripción del puente')
            wait(lambda:any(r.get('version')==__version__ and r.get('mode')=='simulator' for r in received),'Telemetría del simulador')
            first=None
            first_run=None
            for action,expected in [('run',1),('pause',2),('resume',1),('stop',0)]:
                ident='check-'+uuid.uuid4().hex
                payload=dict(command=action,command_id=ident,issued_at=datetime.now(timezone.utc).isoformat(),ttl_seconds=30)
                if action=='run':payload['memoria']=1;first=payload
                observer.publish(config.topic_prefix+'/'+action+'/set',json.dumps(payload),qos=1,retain=False).wait_for_publish(timeout=3)
                def finished():
                    with lock:return outcomes.get(ident,{}).get('status') in ('succeeded','failed','rejected')
                wait(finished,action.upper())
                with lock:result=outcomes[ident]
                if result['status']!='succeeded':raise RuntimeError(action.upper()+' rechazada por el puente: '+result.get('code',''))
                observed=worker.snapshot()
                assert observed['state']==expected
                if action=='run':first_run=observed['active_firing']
                print(action.upper()+' recibida por MQTT y confirmada en el simulador.',flush=True)
            def history_complete():
                with lock:
                    events=[p.get('tipo') for topic,p in history if topic.endswith('/event') and p.get('run_id')==first_run]
                    samples=[p for topic,p in history if topic.endswith('/state') and p.get('run_id')==first_run]
                return events==['INICIO','PAUSA','REANUDACION','FIN'] and bool(samples)
            wait(history_complete,'Ciclo histórico INICIO/PAUSA/REANUDACION/FIN y muestras',seconds=20)
            print('Histórico recibido por broker con un único run_id: '+first_run,flush=True)
            # Mismo command_id: no volver a iniciar, incluso tras finalizar la cocción.
            with lock:outcomes.pop(first['command_id'],None)
            observer.publish(config.topic_prefix+'/run/set',json.dumps(first),qos=1,retain=False).wait_for_publish(timeout=3)
            wait(lambda:outcomes.get(first['command_id'],{}).get('status')=='duplicate','Deduplicación MQTT')
            assert worker.snapshot()['state']==0
            print('Duplicado rechazado; no se reinició la cocción.',flush=True)
            before=len(received)
            worker.submit('run',{'memory':2}).result(5)
            wait(lambda:any(r.get('estado')==1 and r.get('memoria')==2 for r in received[before:]),'Publicación del cambio local')
            worker.submit('stop').result(5)
            print('Cambio desde control local publicado a Home Assistant.',flush=True)
            print('Prueba bidireccional e histórica superada; sin puerto físico.'+(' Ensayo guardado en el historial local.' if against_running else ' Datos de ensayo temporales.'),flush=True)
            if bridge:bridge.close();bridge=None
            worker.close();worker=None
            if store:store.close();store=None
    finally:
        if bridge:bridge.close()
        if worker:worker.close()
        if store:store.close()
        observer.disconnect()
        observer.loop_stop()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',type=Path,default=Path('.mqtt.json'))
    p.add_argument('--exercise',action='store_true',help='Publicar pruebas RUN/PAUSE/RESUME/STOP sobre el simulador temporal')
    p.add_argument('--against-running',action='store_true',help='Con --exercise: comprobar el simulador activo en HTTP local, sin crear un segundo puente')
    args=p.parse_args()
    try:check(MQTTConfig.read(args.config),args.exercise,args.against_running)
    except Exception as exc:
        print('Comprobación fallida: '+str(exc),file=sys.stderr)
        sys.exit(1)
