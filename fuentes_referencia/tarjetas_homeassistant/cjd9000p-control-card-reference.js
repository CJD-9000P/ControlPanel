/* CJD-9000P · Control / Curvas físicas · V7.5.9.2 + simulador aislado, conserva V7.5.9.1 (sobre V7.5.8) (compatibilidad Lovelace -621)
 * HA es cliente de MQTT mediante cjd9000p_curves.send_command.
 * La lectura de las cuatro memorias procede EXCLUSIVAMENTE de Python.
 * No se interpreta la aceptación de MQTT como verificación en el horno.
 */
class CJD9000PControl621 extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {
      title: "CJD-9000P · Control del horno",
      state_entity: "sensor.cjd9000p_panel_estado",
      curve_entity: "sensor.cjd9000p_panel_curvas_fisicas",
      event_entity: "sensor.cjd9000p_panel_evento",
      mqtt_entity: "binary_sensor.cjd9000p_panel_mqtt",
      modbus_entity: "binary_sensor.cjd9000p_panel_modbus",
      profiles_entity: "sensor.cjd9000p_curvas",
      sim_entity: "sensor.cjd9000p_simulador_estado",
    };
    // Nunca seleccionar por defecto una memoria para RUN. Esta bandera
    // es independiente de la última curva mostrada en pantalla al finalizar.
    this._previewMemory = null;
    this._runSelectionArmed = false;
    // Preferencias Telegram: se almacenan exclusivamente en ayudantes HA.
    // Nunca son órdenes al CJD ni alteran el estado del horno.
    this._simSending = false;
    this._simNotice = '';
    this._telegramExpanded = false;
    this._telegramError = "";
    this._telegramSaving = new Set();
    this._telegramMaster = "input_boolean.cjd9000p_telegram";
    this._telegramTemperatureEntity = "input_number.cjd9000p_telegram_temperatura_maxima";
    this._telegramTemperatureSaving = false;
    this._telegramTemperaturePending = null;
    this._telegramOptions = [
      {id:"input_boolean.cjd9000p_aviso_inicio",label:"Inicio de cocción",group:"Cocción"},
      {id:"input_boolean.cjd9000p_aviso_pausa",label:"Pausa",group:"Cocción"},
      {id:"input_boolean.cjd9000p_aviso_reanudacion",label:"Reanudación",group:"Cocción"},
      {id:"input_boolean.cjd9000p_aviso_fin",label:"Fin o parada de cocción",group:"Cocción"},
      {id:"input_boolean.cjd9000p_aviso_mqtt",label:"Conexión y desconexión MQTT",group:"Comunicación"},
      {id:"input_boolean.cjd9000p_aviso_modbus",label:"Conexión y desconexión Modbus",group:"Comunicación"},
      {id:"input_boolean.cjd9000p_aviso_desviacion",label:"Desviación PV–SV en tramos de subida",group:"Temperatura"},
      {id:"input_boolean.cjd9000p_aviso_temperatura",label:"Alarma de temperatura máxima",group:"Temperatura"},
    ];

    // Evita mostrar como completada una cocción detenida con STOP en esta tarjeta.
    this._stopRequestedForRun = false;
    // V7.2: 0xCC indica minutos del segmento (observado en el horno físico).
    // No convertirlo en minutos acumulados. Solo estimamos segundos en el navegador.
    this._segmentClock = null;
    this._segmentClockTimer = null;
    // Ajuste visual: adaptar la anchura del SVG a su contenedor sin deformar textos.
    this._graphViewWidth = 720;
    this._graphResizeObserver = null;
    this._observedGraph = null;
    // V7.5: los 20 valores C/T originales son inmutables. La vista presenta
    // t01: C01→C02, t02: C02→C03, etc. No crea un destino C21.
    // Recorrido de la cocción: se conserva después de STOP hasta nuevo RUN
    // o hasta perder la confirmación del estado.
    this._journey = {
      state:null, spc:null, step:null, completed:0, seen:false,
      lastElapsedMinute:null, lastFraction:null, terminalObserved:false,
      inferredCompletion:false, startedAtMs:null,
    };
    // V7.1: bloquear navegación por defecto durante RUN. Solo la interfaz;
    // seleccionar una ficha NUNCA escribe SPC ni envía órdenes Modbus.
    this._menuUnlocked = false;
    this._wasRunning = false;
    this._lastRunningSpc = null;
    this._confirmation = null;
    this._pending = null;
    this._lastOutcome = null;
    this._tableCacheKey = null;
    this._scrollGuardTimer = null;
    this._notice = "";
    this._sending = false;
    this._showAllSegments = true;
    this._showGraph = true;
    // Un botón puede perder el clic si Home Assistant reconstruye su DOM
    // entre pointerdown y click. Aplazamos los repintados durante la pulsación.
    this._pointerActive = false;
    this._renderDeferred = false;
    this._releaseTimer = null;
    this._watchedEntityRefs = null;
    this._structuralFingerprint = null;
    this._releasePointer = () => {
      if (this._releaseTimer !== null) clearTimeout(this._releaseTimer);
      // pointerup ocurre ANTES de click. Se repinta después del click.
      this._releaseTimer = setTimeout(() => {
        this._releaseTimer = null;
        this._pointerActive = false;
        if (this._renderDeferred) this._render();
      }, 0);
    };
    this.shadowRoot.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button[data-action]:not([disabled]), .table-scroll")) {
        this._pointerActive = true;
        if (this._releaseTimer !== null) {
          clearTimeout(this._releaseTimer);
          this._releaseTimer = null;
        }
      }
    });
    // Evita reconstruir la tabla mientras se usa rueda/trackpad.
    this.shadowRoot.addEventListener("wheel", (event) => {
      if (!event.target.closest(".table-scroll")) return;
      this._pointerActive = true;
      if (this._scrollGuardTimer !== null) clearTimeout(this._scrollGuardTimer);
      this._scrollGuardTimer = setTimeout(() => {
        this._scrollGuardTimer = null;
        this._pointerActive = false;
        if (this._renderDeferred) this._render();
      }, 600);
    }, { passive: true });
    this.shadowRoot.addEventListener("click", (event) => this._onClick(event));
    // Delegación única: los checkbox sobreviven a todas las lecturas MQTT.
    this.shadowRoot.addEventListener("change", (event) => {
      const input = event.target?.closest?.('input[data-telegram-helper]');
      if (!input || input.disabled) return;
      this._setTelegramHelper(input.dataset.telegramHelper, input.checked);
    });
    this.shadowRoot.addEventListener("input", (event) => {
      const input = event.target?.closest?.('input[data-telegram-temperature]');
      if (!input) return;
      input.dataset.dirty = "true";
      this._refreshTelegramTemperatureButton();
    });
    this.shadowRoot.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !event.target?.matches?.('input[data-telegram-temperature]')) return;
      event.preventDefault();
      this._setTelegramTemperature();
    });

  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Configuración de Control CJD-9000P inválida.");
    this._config = { ...this._config, ...config };
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    // Los cambios de otras entidades de HA no necesitan reconstruir el panel.
    const watched = [
      this._config.state_entity, this._config.curve_entity,
      this._config.event_entity, this._config.mqtt_entity,
      this._config.modbus_entity, this._config.profiles_entity,
      this._config.sim_entity,
      this._telegramMaster, ...this._telegramOptions.map(option => option.id),
      this._telegramTemperatureEntity,
    ].map(id => hass?.states?.[id] ?? null);
    const changed = !this._watchedEntityRefs ||
      watched.some((state, index) => state !== this._watchedEntityRefs[index]);
    this._watchedEntityRefs = watched;
    if (!changed) return;
    const previewChanged = this._syncMemorySelection();
    // PV, SV, estado y eventos pueden llegar cada segundo. No volver a crear
    // el DOM de la tarjeta en esas lecturas: se perdería el scroll de la página.
    // Solo las curvas y perfiles (o la primera carga) requieren HTML nuevo.
    const structuralFingerprint = JSON.stringify([
      this._physical(), this._profiles(), this._config.title,
    ]);
    if (!this.shadowRoot.querySelector('ha-card')) {
      // Primera carga: se construye la tarjeta una única vez.
      this._render();
      return;
    }
    if (previewChanged || this._structuralFingerprint !== structuralFingerprint) {
      // Nunca reconstruir toda la tarjeta por una publicación MQTT.
      // Actualizar las memorias, gráfica y filas SOBRE los nodos existentes.
      this._refreshCurveData();
      this._structuralFingerprint = structuralFingerprint;
    }
    this._refreshDynamic();
    this._refreshTelegramUI();
    this._refreshSimUI();
  }
  connectedCallback() {
    this._watchGraphSize();
    window.addEventListener("pointerup", this._releasePointer);
    window.addEventListener("pointercancel", this._releasePointer);
    // Una actualización local no genera ninguna orden ni lectura Modbus.
    // La precisión inferior al minuto es estimada; la referencia real es 0xCC.
    if (this._segmentClockTimer === null) {
      this._segmentClockTimer = setInterval(() => {
        if (this._hass && this._programState() === 1) this._refreshTimeOnly();
      }, 500);
    }
  }
  disconnectedCallback() {
    if (this._graphResizeObserver) this._graphResizeObserver.disconnect();
    this._observedGraph = null;
    window.removeEventListener("pointerup", this._releasePointer);
    window.removeEventListener("pointercancel", this._releasePointer);
    if (this._releaseTimer !== null) clearTimeout(this._releaseTimer);
    if (this._scrollGuardTimer !== null) clearTimeout(this._scrollGuardTimer);
    if (this._segmentClockTimer !== null) clearInterval(this._segmentClockTimer);
    this._segmentClockTimer = null;
    this._releaseTimer = null;
    this._scrollGuardTimer = null;
    this._pointerActive = false;
    this._renderDeferred = false;
  }
  getCardSize() { return 10; }
  getGridOptions() { return { columns: 12, min_columns: 6 }; }

  _entity(id) { return this._hass?.states?.[id] || null; }
  _attrs(id) { return this._entity(id)?.attributes || {}; }
  _online(id) { return this._entity(id)?.state === "on"; }
  _usable(id) { return this._entity(id)?.state !== "unavailable" && this._entity(id)?.state !== "unknown" && !!this._entity(id); }
  _escape(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  _numeric(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  _n(v, unit = "") { const n = this._numeric(v); return n === null ? "—" : `${Number.isInteger(n) ? n : n.toFixed(1)}${unit}`; }

  _simState() {
    const s=this._entity(this._config.sim_entity);
    return s && s.state !== 'unavailable' && s.state !== 'unknown' ? s : null;
  }
  _simActive() { return this._simState()?.state === 'ACTIVO'; }
  async _simCommand(accion) {
    if (!['activar','desactivar','run','stop','pause','resume'].includes(accion) || this._simSending) return;
    const real=this._programState();
    if (accion==='activar' && [1,2].includes(real)) {
      this._simNotice='No se activa la simulación mientras el horno real está funcionando o pausado.';
      this._refreshSimUI();return;
    }
    if (!this._simState()) {
      this._simNotice='El servicio de simulación está desconectado. No se ha enviado ninguna orden al horno.';
      this._refreshSimUI();return;
    }
    this._simSending=true;
    this._simNotice='Enviando orden al simulador aislado…';
    this._refreshSimUI();
    try {
      await this._hass.callService('mqtt','publish',{
        topic:'horno/cjd9000p_sim/comando',
        payload:JSON.stringify({accion}),qos:1,retain:false
      });
      this._simNotice='';
    } catch(e) { this._simNotice='Error del simulador: '+String(e?.message||e); }
    finally { this._simSending=false;this._refreshSimUI(); }
  }
  _simPanel() {
    return `<section class="section sim-panel" aria-label="Simulador aislado">
      <div class="sim-head"><div><strong>SIMULADOR · DATOS FICTICIOS</strong><small>No controla el horno real ni modifica sus curvas o su historial.</small></div><strong data-sim="mode">Desconectado</strong></div>
      <div class="sim-stats">PV: <b data-sim="pv">—</b> · SV: <b data-sim="sv">—</b> · Tramo: <b data-sim="step">—</b> · Estado: <b data-sim="state">—</b></div>
      <div class="actions"><button class="btn quiet" data-action="sim-activar">Activar simulador</button><button class="btn quiet" data-action="sim-desactivar">Desactivar</button>
      <button class="btn quiet" data-action="sim-run">▶ Iniciar simulación</button><button class="btn quiet" data-action="sim-pause">Ⅱ Pausar</button><button class="btn quiet" data-action="sim-resume">▶ Reanudar</button><button class="btn quiet" data-action="sim-stop">■ Parar simulación</button></div>
      <small class="sim-note" data-sim="notice"></small></section>`;
  }
  _refreshSimUI() {
    const entity=this._simState(),a=entity?.attributes||{};
    const active=this._simActive(), mode=this.shadowRoot.querySelector('[data-sim="mode"]');
    if (!mode) return;
    mode.textContent=entity?(active?'ACTIVO':'DESACTIVADO'):'NO DISPONIBLE';
    const values={pv:active?(a.pv+' °C'):'—',sv:active?(a.sv+' °C'):'—',
                  step:active?a.segmento:'—',state:active?a.estado_texto:'—',notice:this._simNotice};
    Object.entries(values).forEach(([key,value])=>{
      const el=this.shadowRoot.querySelector('[data-sim="'+key+'"]');
      if(el && el.textContent!==String(value)) el.textContent=String(value);
    });
    this.shadowRoot.querySelectorAll('[data-action^="sim-"]').forEach(el=>{
      const command=el.dataset.action.replace('sim-','');
      const st=Number(a.estado);
      const on=active && entity;
      el.disabled=this._simSending || !entity || (command==='activar' ? (active || [1,2].includes(this._programState())) :
        command==='desactivar' ? !active : command==='run' ? (!on || st!==0) :
        command==='stop' ? (!on || ![1,2].includes(st)) :
        command==='pause' ? (!on || st!==1) : command==='resume' ? (!on || st!==2) : !on);
    });
    this.shadowRoot.querySelector('.sim-panel')?.classList.toggle('sim-active',active);
    // Mientras se simula, los mandos de arranque real se bloquean para
    // evitar confusiones. STOP REAL permanece operativo para seguridad.
    this.shadowRoot.querySelectorAll('[data-action="command"]').forEach(el=>{
      if (active && el.dataset.command!=='stop') el.disabled=true;
    });
  }
  _telegramState(id) {
    const state = this._entity(id)?.state;
    return state === "on" || state === "off" ? state : null;
  }
  _telegramSummary() {
    const master = this._telegramState(this._telegramMaster);
    if (master === null) return "Sin configurar · faltan ayudantes";
    if (master === "off") return "Desactivadas";
    const count = this._telegramOptions.filter(option => this._telegramState(option.id) === "on").length;
    const missing = this._telegramOptions.some(option => this._telegramState(option.id) === null);
    return `Activadas · ${count} de 8 avisos${missing ? " · revisar ayudantes" : ""}`;
  }
  _telegramTemperatureInfo() {
    const entity = this._entity(this._telegramTemperatureEntity);
    const n = Number(entity?.state);
    if (!entity || ["unknown", "unavailable", ""].includes(entity.state) || !Number.isFinite(n)) return null;
    const attrs = entity.attributes || {};
    const min = Number.isFinite(Number(attrs.min)) ? Number(attrs.min) : 0;
    const max = Number.isFinite(Number(attrs.max)) ? Number(attrs.max) : 1200;
    const step = Number.isFinite(Number(attrs.step)) && Number(attrs.step) > 0 ? Number(attrs.step) : 1;
    return {value:n, min, max, step};
  }
  _renderTelegramTemperature() {
    const info = this._telegramTemperatureInfo();
    return `<div class="telegram-temperature">
      <label for="cjd9000p-telegram-temperature">Avisar si PV supera</label>
      <div class="telegram-temperature-controls">
        <input id="cjd9000p-telegram-temperature" data-telegram-temperature type="number"
          inputmode="decimal" aria-label="Temperatura máxima de aviso en grados Celsius"
          min="${info?.min ?? 0}" max="${info?.max ?? 1200}" step="${info?.step ?? 1}"
          value="${info?.value ?? ''}" ${info && !this._telegramTemperatureSaving ? '' : 'disabled'}>
        <span aria-hidden="true">°C</span>
        <button class="btn quiet" type="button" data-action="save-telegram-temperature" disabled>Guardar</button>
      </div>
      <small class="telegram-missing" data-telegram-temperature-missing ${info ? 'hidden' : ''}>Ayudante de temperatura no disponible</small>
    </div>`;
  }
  _refreshTelegramTemperatureButton() {
    const input = this.shadowRoot?.querySelector('input[data-telegram-temperature]');
    const button = this.shadowRoot?.querySelector('[data-action="save-telegram-temperature"]');
    if (!input || !button) return;
    const info = this._telegramTemperatureInfo();
    const value = Number(input.value);
    const valid = !!info && input.value.trim() !== '' && Number.isFinite(value) &&
      value >= info.min && value <= info.max && input.checkValidity();
    button.disabled = this._telegramTemperatureSaving || !valid ||
      (this._telegramTemperaturePending !== null && this._telegramTemperaturePending === value) ||
      (!input.dataset.dirty && value === info?.value);
    button.textContent = this._telegramTemperatureSaving ? 'Guardando…' : 'Guardar';
  }
  async _setTelegramTemperature() {
    const input = this.shadowRoot?.querySelector('input[data-telegram-temperature]');
    const info = this._telegramTemperatureInfo();
    if (!input || !info || this._telegramTemperatureSaving) return;
    const value = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(value) || !input.checkValidity() ||
        value < info.min || value > info.max) {
      this._telegramError = `Introduce una temperatura válida entre ${info.min} y ${info.max} °C.`;
      this._refreshTelegramUI();
      return;
    }
    this._telegramError = '';
    this._telegramTemperatureSaving = true;
    this._refreshTelegramUI();
    try {
      await this._hass.callService('input_number', 'set_value', {
        entity_id:this._telegramTemperatureEntity, value,
      });
      this._telegramTemperaturePending = value;
    } catch (error) {
      this._telegramError = `No se pudo guardar la temperatura: ${String(error?.message || error)}`;
    } finally {
      this._telegramTemperatureSaving = false;
      this._refreshTelegramUI();
    }
  }
  _renderTelegramPanel() {
    const master = this._telegramState(this._telegramMaster);
    const input = (id,label) => {
      const state = this._telegramState(id);
      return `<label class="telegram-choice"><input type="checkbox" data-telegram-helper="${id}"
        ${state === "on" ? "checked" : ""} ${state === null || this._telegramSaving.has(id) ? "disabled" : ""}
        aria-label="${this._escape(label)}"/><span>${this._escape(label)}</span>
        ${state === null ? '<small class="telegram-missing">Ayudante no disponible</small>' : ""}</label>`;
    };
    const groups = ["Cocción", "Comunicación", "Temperatura"].map(group =>
      `<div class="telegram-group"><h3>${group}</h3><div class="telegram-options">${this._telegramOptions
        .filter(option => option.group === group).map(option => input(option.id,option.label)).join("")}
        ${group === "Temperatura" ? this._renderTelegramTemperature() : ""}</div></div>`
    ).join("");
    return `<section class="section telegram-panel" aria-label="Preferencias de notificaciones Telegram">
      <button type="button" class="telegram-toggle" data-action="toggle-telegram-panel"
        aria-expanded="${this._telegramExpanded}" aria-controls="cjd9000p-telegram-preferences">
        <span class="telegram-heading"><span class="telegram-symbol" aria-hidden="true">✉</span>
          <span><strong>Notificaciones por Telegram</strong><small data-telegram-summary>${this._escape(this._telegramSummary())}</small></span></span>
        <span data-telegram-chevron aria-hidden="true">${this._telegramExpanded ? "▴" : "▾"}</span>
      </button>
      <div id="cjd9000p-telegram-preferences" data-telegram-body ${this._telegramExpanded ? "" : "hidden"}>
        <div class="telegram-master">${input(this._telegramMaster,"Enviar notificaciones por Telegram")}</div>
        <p class="telegram-help" data-telegram-warning ${master === "off" ? "" : "hidden"}>
          Telegram está desactivado: no se enviará ningún aviso, incluidos los térmicos.
          Puedes seguir eligiendo los tipos de aviso y activarlos después.
        </p>
        <p class="telegram-help" data-telegram-missing ${master === null ? "" : "hidden"}>
          Crea los ayudantes input_boolean indicados para utilizar este panel.
        </p>
        ${groups}
        <p class="telegram-error" data-telegram-error role="alert" ${this._telegramError ? "" : "hidden"}>${this._escape(this._telegramError)}</p>
      </div>
    </section>`;
  }
  _refreshTelegramUI() {
    if (!this.shadowRoot) return;
    const body = this.shadowRoot.querySelector('[data-telegram-body]');
    if (!body) return;
    body.hidden = !this._telegramExpanded;
    const toggle = this.shadowRoot.querySelector('[data-action="toggle-telegram-panel"]');
    if (toggle) toggle.setAttribute('aria-expanded', String(this._telegramExpanded));
    const chevron = this.shadowRoot.querySelector('[data-telegram-chevron]');
    if (chevron) chevron.textContent = this._telegramExpanded ? "▴" : "▾";
    const summary = this.shadowRoot.querySelector('[data-telegram-summary]');
    if (summary) summary.textContent = this._telegramSummary();
    for (const input of this.shadowRoot.querySelectorAll('input[data-telegram-helper]')) {
      const id = input.dataset.telegramHelper;
      const state = this._telegramState(id);
      if (!this._telegramSaving.has(id)) input.checked = state === 'on';
      input.disabled = state === null || this._telegramSaving.has(id);
      const missing = input.closest('.telegram-choice')?.querySelector('.telegram-missing');
      if (missing) missing.hidden = state !== null;
    }
    const master = this._telegramState(this._telegramMaster);
    const warning = this.shadowRoot.querySelector('[data-telegram-warning]');
    if (warning) warning.hidden = master !== 'off';
    const missing = this.shadowRoot.querySelector('[data-telegram-missing]');
    if (missing) missing.hidden = master !== null;
    const error = this.shadowRoot.querySelector('[data-telegram-error]');
    if (error) {error.textContent = this._telegramError; error.hidden = !this._telegramError;}
    const input = this.shadowRoot.querySelector('input[data-telegram-temperature]');
    const info = this._telegramTemperatureInfo();
    // HA puede incorporar el ayudante después de que la tarjeta se haya dibujado.
    // Actualizar el mensaje sin reconstruir la tarjeta ni afectar a los mandos.
    const temperatureMissing = this.shadowRoot.querySelector('[data-telegram-temperature-missing]');
    if (temperatureMissing) temperatureMissing.hidden = !!info;
    if (input) {
      input.disabled = !info || this._telegramTemperatureSaving;
      if (info && this._telegramTemperaturePending !== null && info.value === this._telegramTemperaturePending) {
        this._telegramTemperaturePending = null;
        delete input.dataset.dirty;
      }
      if (info && !input.dataset.dirty && !this._telegramTemperatureSaving) input.value = String(info.value);
      this._refreshTelegramTemperatureButton();
    }
  }
  async _setTelegramHelper(id, desired) {
    const allowed = id === this._telegramMaster || this._telegramOptions.some(option => option.id === id);
    if (!allowed || this._telegramSaving.has(id) || this._telegramState(id) === null) {
      this._refreshTelegramUI();
      return;
    }
    this._telegramError = "";
    this._telegramSaving.add(id);
    this._refreshTelegramUI();
    try {
      await this._hass.callService('input_boolean', desired ? 'turn_on' : 'turn_off', {entity_id:id});
    } catch (error) {
      this._telegramError = `No se pudo guardar la preferencia: ${String(error?.message || error)}`;
    } finally {
      this._telegramSaving.delete(id);
      this._refreshTelegramUI();
    }
  }
  _telemetry() {
    const state = this._entity(this._config.state_entity);
    return this._usable(this._config.state_entity) ? (state.attributes || {}) : {};
  }
  _programState() {
    const cfg = this._config;
    if (!this._online(cfg.mqtt_entity) || !this._online(cfg.modbus_entity) ||
        !this._usable(cfg.state_entity)) return null;
    const raw = this._telemetry().estado;
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && [0,1,2].includes(n) ? n : null;
  }
  _physicalSpc() {
    if (!this._online(this._config.mqtt_entity) ||
        !this._online(this._config.modbus_entity) ||
        !this._usable(this._config.curve_entity)) return null;
    const raw = this._attrs(this._config.curve_entity).memoria_activa;
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
  }
  _syncMemorySelection() {
    // Una lectura de SPC nunca autoriza por sí misma un RUN desde Lovelace.
    // El usuario tiene que pulsar expresamente una ficha con estado PARADO.
    const state = this._programState();
    const activeProgram = state === 1 || state === 2;
    const spc = this._physicalSpc();
    const previous = this._previewMemory;
    if (activeProgram) {
      // Mientras funciona o está pausado, mostramos SOLO la memoria física
      // confirmada, pero no ofrecemos ningún selector ni armamos otro RUN.
      this._previewMemory = spc;
      this._runSelectionArmed = false;
      this._menuUnlocked = false;
      this._lastRunningSpc = spc;
    } else {
      // Al terminar conservamos el gráfico de la última cocción para poder
      // ver el tramo final. Pero ningún RUN nuevo queda preseleccionado.
      if (this._wasRunning || state === null) this._runSelectionArmed = false;
      this._menuUnlocked = false;
      this._lastRunningSpc = null;
      // NO aplicar aquí un valor SPC por defecto (ni '|| 1').
    }
    this._wasRunning = activeProgram;
    return previous !== this._previewMemory;
  }
  _memoryLocked() {
    return [1, 2].includes(this._programState());
  }
  _canStartSelected() {
    return this._programState() === 0 && this._runSelectionArmed &&
      [1, 2, 3, 4].includes(this._previewMemory) &&
      Boolean(this._memorySegments(this._previewMemory)) && this._allow('run');
  }
  _segmentIndex() {
    const raw = this._telemetry().segmento;
    if (raw === null || raw === undefined || raw === "") return null;
    const n = Number(raw);
    // Pendiente de validar en diferentes revisiones de firmware;
    // se utiliza C9 tal como lo indica el panel del programador.
    return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
  }
  _activeTramoDisplay() {
    // C9/STEP identifica el tramo actual; su objetivo es C_(STEP+1).
    // Utilizar exclusivamente los valores físicos leídos del SPC activo.
    // No deducir el objetivo a partir de SV, que varía durante las rampas.
    const state = this._programState();
    const spc = this._physicalSpc();
    const step = this._segmentIndex();
    if (![1, 2].includes(state) || spc === null || step === null) {
      return {numero:"—", objetivo:"—"};
    }
    const tramos = this._programTramos(this._memorySegments(spc));
    if (!tramos.length || step > tramos.length) {
      return {numero:"—", objetivo:"—"};
    }
    const target = tramos[step - 1].final;
    if (!Number.isFinite(target)) {
      return {numero:`${step} de ${tramos.length}`, objetivo:"—"};
    }
    return {
      numero:`${step} de ${tramos.length}`,
      objetivo:`Objetivo: ${this._n(target, " °C")}`,
    };
  }
  _segmentTiming() {
    const state = this._programState();
    const spc = this._physicalSpc();
    const step = this._segmentIndex();
    const raw = this._telemetry().tiempo_cjd;
    const minutes = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    const physical = spc === null ? null : this._memorySegments(spc);
    const tramos = this._programTramos(physical);
    const duration = step && step <= tramos.length ? tramos[step-1].tiempo : NaN;

    if (![1,2].includes(state) || !physical || step === null || step > tramos.length ||
        !Number.isInteger(minutes) || minutes < 0) {
      this._segmentClock = null;
      return {label:"—",progress:null,detail:"Sin tramo activo confirmado"};
    }

    // La pantalla del CJD-9000P real reinicia este contador en cada segmento.
    // 0xCC no contiene los segundos: los estimamos entre lecturas usando reloj local.
    // Si HA abre la tarjeta a mitad de minuto, los segundos estimados pueden ir
    // retrasados; por eso NO se presentan como un dato medido por Modbus.
    const key = `${spc}:${step}`;
    const now = Date.now();
    const old = this._segmentClock;
    if (!old || old.key !== key || old.minutes !== minutes) {
      this._segmentClock = {key,minutes,anchorMs:now,pausedSeconds:0,state};
    } else if (old.state === 1 && state === 2) {
      // Al pausar, congelamos los segundos estimados donde estaban.
      old.pausedSeconds = Math.max(0,Math.min(59,Math.floor((now-old.anchorMs)/1000)));
      old.state = state;
    } else if (old.state === 2 && state === 1) {
      // Al reanudar continúa donde se congeló, sin sumar el tiempo de PAUSA.
      old.anchorMs = now - old.pausedSeconds * 1000;
      old.state = state;
    }
    const clock = this._segmentClock;
    const seconds = state === 2 ? clock.pausedSeconds :
      Math.max(0,Math.min(59,Math.floor((now-clock.anchorMs)/1000)));
    const elapsedSeconds = minutes * 60 + seconds;
    const fmt = (min,sec) => `${min}:${String(sec).padStart(2,"0")}`;
    const measured = fmt(minutes,seconds);
    const planned = Number.isFinite(duration) && duration > 0 ? fmt(duration,0) : "—";
    if (!Number.isFinite(duration) || duration <= 0) {
      return {label:`${measured} / ${planned}`,progress:null,
        detail:state === 2 ? "Pausado · tiempo detenido" : "Segundos estimados · duración no disponible"};
    }
    const percentage = elapsedSeconds / (duration * 60) * 100;
    return {label:`${measured} / ${planned}`,
      progress:Math.min(100,Math.max(0,percentage)),
      detail:state === 2 ? "Pausado · tiempo detenido" :
        elapsedSeconds > duration * 60 ? "Tiempo programado superado · segundos estimados" :
        `${Math.round(percentage)} % · segundos estimados`};
  }

  _refreshTimeOnly() {
    // Únicamente cambia texto y anchura de la barra: no reconstruye el DOM
    // ni reinicia los scrolls (tabla o página).
    if (!this.shadowRoot.querySelector('[data-live="tiempo"]')) return;
    const timing = this._segmentTiming();
    const time = this.shadowRoot.querySelector('[data-live="tiempo"]');
    const caption = this.shadowRoot.querySelector('[data-live="time-caption"]');
    if (time && time.textContent !== timing.label) time.textContent = timing.label;
    if (caption && caption.textContent !== timing.detail) caption.textContent = timing.detail;
    const progress = this.shadowRoot.querySelector('[data-time-progress]');
    if (progress) {
      progress.hidden = timing.progress === null;
      progress.style.width = `${timing.progress ?? 0}%`;
      progress.setAttribute('aria-valuenow',String(Math.round(timing.progress ?? 0)));
    }
    if (this._programState() === 1) this._refreshGraphProgress();
  }

  _lastProgrammedSegment(segments) {
    // Hasta 19 recorridos C_i -> C_(i+1) con 20 temperaturas físicas.
    // t20 se conserva como registro independiente, sin suponer un C21.
    // Los huecos finales no se representan como enfriamientos inventados.
    if (!Array.isArray(segments) || segments.length !== 20) return null;
    let last = null;
    for (let i = 0; i < 19; i++) {
      const duration = Number(segments[i]?.tiempo);
      if (Number.isFinite(duration) && duration > 0) last = i + 1;
    }
    return last;
  }
  _programTramos(segments) {
    if (!Array.isArray(segments) || segments.length !== 20) return [];
    const last = this._lastProgrammedSegment(segments);
    if (last === null) return [];
    const tramos = [];
    for (let i = 0; i < last; i++) {
      const inicio = Number(segments[i]?.temperatura);
      const final = Number(segments[i+1]?.temperatura);
      const tiempo = Number(segments[i]?.tiempo);
      if (![inicio,final,tiempo].every(Number.isFinite)) return [];
      tramos.push({numero:i+1,inicio,final,tiempo});
    }
    return tramos;
  }
  _watchGraphSize() {
    const graph = this.shadowRoot.querySelector('[data-curve-graph]');
    if (!graph) return;
    if (typeof ResizeObserver !== 'undefined') {
      if (!this._graphResizeObserver) {
        this._graphResizeObserver = new ResizeObserver(() => this._syncGraphSize());
      }
      if (this._observedGraph !== graph) {
        this._graphResizeObserver.disconnect();
        this._observedGraph = graph;
        this._graphResizeObserver.observe(graph);
      }
    }
    this._syncGraphSize();
  }
  _syncGraphSize() {
    const graph = this.shadowRoot.querySelector('[data-curve-graph]');
    if (!graph || graph.hidden) return;
    const svg = graph.querySelector('svg[data-cjd-curve]');
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0)) return;
    // La altura lógica sigue siendo 300. Solo se modifica la anchura del
    // viewBox, conservando círculos, tipografía y escala temporal sin estirar.
    const target = Math.max(330, Math.round(300 * bounds.width / bounds.height));
    if (Math.abs(target - this._graphViewWidth) < 3) return;
    this._graphViewWidth = target;
    graph.innerHTML = this._graph(this._memorySegments(this._previewMemory));
    this._refreshGraphProgress();
  }
  _temperatureAxisMax(temps) {
    const maximum = Math.max(0, ...temps.filter(Number.isFinite));
    // 10 % de margen para no pegar el pico térmico al borde superior.
    // Escala automática, incluso por encima de 1200 °C si la curva lo exige.
    const target = Math.max(100, maximum * 1.10);
    const unit = target <= 500 ? 50 : target <= 1000 ? 100 : target <= 2000 ? 200 : 500;
    return Math.ceil(target / unit) * unit;
  }
  _plotGeometry(segments) {
    const tramos = this._programTramos(segments);
    const W = this._graphViewWidth || 720;
    if (!tramos.length) return {tramos:[],pts:[],left:45,right:W-22,top:25,bottom:265,yMax:1200};
    const left=45,right=W-22,top=25,bottom=265;
    const elapsed = [0];
    for (const tramo of tramos) elapsed.push(elapsed[elapsed.length-1]+Math.max(0,tramo.tiempo));
    const total = elapsed[elapsed.length-1];
    const temps = [tramos[0].inicio,...tramos.map(t=>t.final)];
    const yMax = this._temperatureAxisMax(temps);
    const pts = temps.map((temp,i)=>({
      x:left+(right-left)*(total>0?elapsed[i]/total:i/Math.max(1,temps.length-1)),
      y:bottom-(bottom-top)*Math.max(0,Math.min(yMax,temp))/yMax,
      temp,
    }));
    return {tramos,pts,left,right,top,bottom,total,yMax};
  }
  _progressFraction(tramo) {
    if (!tramo) return {value:0,method:'none'};
    // V7.5.2: la trayectoria naranja indica el avance de la CONSIGNA (SV),
    // no el alcance térmico real PV. PV puede ir retrasada, sobre todo durante
    // enfriamientos; usarla generaba saltos al cambiar C9 de tramo.
    if (tramo.inicio !== tramo.final) {
      const rawSv = this._telemetry().sv;
      const sv = rawSv === null || rawSv === undefined || rawSv === '' ? null : this._numeric(rawSv);
      if (sv === null) return {value:0,method:'sv-unavailable'};
      const fraction = (sv - tramo.inicio) / (tramo.final - tramo.inicio);
      return {value:Math.max(0,Math.min(1,fraction)),method:'sv'};
    }
    // En una meseta SV permanece constante. Solo considerar progreso cuando
    // Modbus 0xCC confirma un minuto > 0: si el horno espera a temperatura
    // durante una hora con 0xCC=0, el punto NO debe avanzar 59 s ficticios.
    // Una vez confirmado el primer minuto, la interpolación local de segundos
    // conserva el movimiento fluido de versiones anteriores.
    const raw = this._telemetry().tiempo_cjd;
    const minutes = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    if (!Number.isInteger(minutes) || minutes < 0) return {value:0,method:'time-unavailable'};
    if (minutes === 0) return {value:0,method:'time-wait'};
    const timing = this._segmentTiming();
    return {value:Math.max(0,Math.min(1,(timing.progress ?? 0)/100)),method:'time'};
  }
  _recentStopCommand(journey) {
    // STOP enviado desde OTRO panel HA o cliente MQTT, si Python lo notificó.
    // El evento anterior a esta sesión no puede bloquear una cocción nueva.
    const evt = this._attrs(this._config.event_entity);
    const action = String(evt?.command || evt?.operacion || "").toLowerCase();
    const instant = Date.parse(String(evt?.timestamp || ""));
    return action === "stop" && Number.isFinite(instant) &&
      Number.isFinite(journey.startedAtMs) &&
      instant >= journey.startedAtMs - 1000;
  }
  _updateJourney() {
    const state = this._programState();
    const spc = this._physicalSpc();
    const step = this._segmentIndex();
    const journey = this._journey;
    if (state === null) {
      // No afirmar que una cocción terminó cuando se pierde comunicación.
      this._journey = {
        state:null,spc:null,step:null,completed:0,seen:false,
        lastElapsedMinute:null,lastFraction:null,terminalObserved:false,
        inferredCompletion:false,startedAtMs:null,
      };
      this._runSelectionArmed = false;
      return;
    }
    if (state === 0) {
      // El CJD puede resetear C9, CC y SV en LA MISMA muestra con que pasa a
      // PARADO. Usamos el último tramo REALMENTE visto mientras funcionaba.
      const segments = journey.spc === null ? null : this._memorySegments(journey.spc);
      const last = this._lastProgrammedSegment(segments);
      const duration = last === null ? NaN : Number(segments[last - 1]?.tiempo);
      const nearEnd = Number.isFinite(duration) && duration > 0 &&
        Number.isFinite(journey.lastElapsedMinute) &&
        journey.lastElapsedMinute >= Math.max(0, duration - 1);
      const atEndpoint = Number.isFinite(journey.lastFraction) && journey.lastFraction >= 0.995;
      const afterFinal = last !== null && (
        journey.terminalObserved || (journey.step !== null && journey.step > last) ||
        (step !== null && step > last)
      );
      const onLast = last !== null && journey.step === last;
      const stoppedByCommand = this._stopRequestedForRun || this._recentStopCommand(journey);
      // La señal Modbus no distingue siempre fin natural de STOP desde el
      // teclado físico. Sin una señal de fin inequívoca, este caso es una
      // inferencia VISUAL; nunca modifica registros ni controla el horno.
      if (stoppedByCommand && journey.inferredCompletion && last !== null) {
        journey.completed = Math.min(journey.completed, last - 1);
        journey.inferredCompletion = false;
      }
      const confirmedEnd = nearEnd || atEndpoint || afterFinal;
      // Una secuencia PAUSA -> PARADO sin evidencia de fin no es una
      // finalización natural. La inferencia por último tramo requiere RUN.
      const plausibleNaturalEnd = confirmedEnd || (onLast && journey.state === 1);
      if ([1, 2].includes(journey.state) && journey.seen &&
          journey.spc === spc && last !== null && !stoppedByCommand &&
          (onLast || afterFinal) && plausibleNaturalEnd) {
        // Aunque la última lectura llegue ANTES del valor final, si el horno
        // abandona el último tramo y queda parado sin orden STOP observada,
        // completar visualmente la curva. Evita un final rojo por muestreo 1 Hz.
        journey.completed = Math.max(journey.completed, last);
        journey.inferredCompletion = !confirmedEnd;
      }
      journey.state = state;
      return;
    }
    if (![1,2].includes(state)) return;
    if (spc === null || step === null) {
      journey.state = state;
      journey.spc = null;
      journey.step = null;
      journey.completed = 0;
      journey.seen = false;
      journey.lastElapsedMinute = null;
      journey.lastFraction = null;
      journey.terminalObserved = false;
      journey.inferredCompletion = false;
      journey.startedAtMs = null;
      return;
    }
    const newRun = journey.state === 0 && state === 1;
    const switchedMemory = journey.seen && journey.spc !== spc;
    const restartedSegment = journey.seen && journey.spc === spc &&
      journey.step !== null && step < journey.step;
    if (!journey.seen || newRun || switchedMemory || restartedSegment) {
      journey.completed = 0;
      journey.seen = true;
      journey.lastElapsedMinute = null;
      journey.lastFraction = null;
      journey.terminalObserved = false;
      journey.inferredCompletion = false;
      journey.startedAtMs = Date.now();
      this._stopRequestedForRun = false;
    }
    const segments = this._memorySegments(spc);
    const tramos = this._programTramos(segments);
    const last = tramos.length;
    const crossedTerminal = last > 0 && step > last &&
      (journey.step === last || journey.terminalObserved);
    if (crossedTerminal) {
      journey.terminalObserved = true;
      journey.completed = Math.max(journey.completed, last);
    }
    if (journey.step !== step && !crossedTerminal) {
      journey.lastElapsedMinute = null;
      journey.lastFraction = null;
    }
    const rawMinute = this._telemetry().tiempo_cjd;
    const minute = rawMinute === undefined || rawMinute === null || rawMinute === '' ?
      null : Number(rawMinute);
    if (step === last && Number.isInteger(minute) && minute >= 0) {
      journey.lastElapsedMinute = Math.max(journey.lastElapsedMinute ?? 0, minute);
    }
    if (step === last && last > 0) {
      const candidate = this._progressFraction(tramos[last - 1]);
      if (candidate.method === 'sv' || candidate.method === 'time') {
        journey.lastFraction = Math.max(journey.lastFraction ?? 0, candidate.value);
      }
      // Si observamos el valor final antes de PARADO, conservamos el avance
      // incluso aunque C9 salte al registro técnico posterior (t20).
      if (Number.isFinite(journey.lastFraction) && journey.lastFraction >= 0.995) {
        journey.terminalObserved = true;
        journey.completed = Math.max(journey.completed, last);
      }
    }
    journey.spc = spc;
    journey.step = step;
    journey.completed = Math.max(journey.completed, Math.min(last, step - 1));
    journey.state = state;
  }

  _completedForPreview() {
    if (this._programState() === null || !this._journey.seen ||
        this._journey.spc !== this._previewMemory) return 0;
    return this._journey.completed;
  }

  _refreshSegmentHighlight() {
    const state = this._programState();
    const spc = this._physicalSpc();
    const step = this._segmentIndex();
    const active = [1,2].includes(state) && spc !== null &&
      this._previewMemory === spc ? step : null;
    const completed = this._completedForPreview();
    this.shadowRoot.querySelectorAll('.table-scroll tbody tr').forEach((row,index) => {
      const number = index+1;
      const isCurrent = active !== null && number === active;
      const isComplete = !isCurrent && number <= completed;
      row.classList.toggle('segment-active',isCurrent);
      row.classList.toggle('segment-completed',isComplete);
      if (isCurrent) row.setAttribute('aria-current','step');
      else row.removeAttribute('aria-current');
    });
  }
  _refreshGraphProgress() {
    // V7.5: actualiza las polilíneas y el marcador SIN sustituir el SVG.
    // Mantiene fluido el pulso naranja y evita reconstrucciones por PV/MQTT.
    const graph = this.shadowRoot.querySelector('[data-curve-graph]');
    if (!graph || graph.hidden) return;
    const svg=graph.querySelector('svg[data-cjd-curve]');
    if (!svg) return;
    const plot=this._plotGeometry(this._memorySegments(this._previewMemory));
    const {tramos,pts,top,bottom}=plot;
    if (!tramos.length) return;
    const state=this._programState();
    const step=this._segmentIndex();
    const spc=this._physicalSpc();
    const active=[1,2].includes(state) && spc === this._previewMemory &&
      step !== null && step <= tramos.length ? step : null;
    const completed=Math.min(tramos.length,Math.max(0,this._completedForPreview()));
    const poly=(array)=>array.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    let green=[],red=[],dot=null,method='';
    if (active !== null) {
      const from=pts[active-1],to=pts[active];
      const fraction=this._progressFraction(tramos[active-1]);
      method=fraction.method;
      const f=fraction.value;
      dot={x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f};
      green=[...pts.slice(0,active),dot];
      red=[dot,...pts.slice(active)];
    } else {
      const lastGreen=Math.min(completed,pts.length-1);
      green=pts.slice(0,lastGreen+1);
      red=pts.slice(lastGreen);
    }
    const greenLine=svg.querySelector('[data-progress-green]');
    const redLine=svg.querySelector('[data-progress-red]');
    if (greenLine) {greenLine.setAttribute('points',poly(green));greenLine.style.display=green.length>1?'':'none';}
    if (redLine) {redLine.setAttribute('points',poly(red));redLine.style.display=red.length>1?'':'none';}
    const marker=svg.querySelector('[data-progress-marker]');
    if (marker) {
      marker.style.display=dot?'':'none';
      if (dot) {
        marker.setAttribute('transform',`translate(${dot.x.toFixed(2)} ${dot.y.toFixed(2)})`);
        const guide=marker.querySelector('[data-progress-guide]');
        if (guide) {guide.setAttribute('y1',String(top-dot.y));guide.setAttribute('y2',String(bottom-dot.y));}
        const label=marker.querySelector('[data-progress-label]');
        if (label) {
          label.textContent=`Tramo ${active}`;
          label.setAttribute('x',String(dot.x>plot.right-100?-96:12));
          label.setAttribute('y',String(dot.y<top+18?24:-14));
        }
        const hint=marker.querySelector('title');
        if (hint) hint.textContent=method==='sv' ?
          `Tramo ${active}: posición según consigna SV` :
          method==='time' ? `Tramo ${active}: meseta, posición calculada con tiempo` :
          method==='time-wait' ? `Tramo ${active}: meseta, esperando tiempo confirmado por el horno` :
          method==='time-unavailable' ? `Tramo ${active}: contador Modbus no disponible` :
          `Tramo ${active}: consigna SV no disponible`;
      }
    }
    svg.classList.toggle('curve-running',active !== null && state === 1);
    svg.querySelectorAll('[data-plot-point]').forEach((point)=>{
      const idx=Number(point.getAttribute('data-plot-point'));
      const done=idx<=completed || (active!==null && idx<active);
      point.setAttribute('class',done?'point-completed':'graph-point');
    });
    svg.setAttribute('aria-label',`Memoria ${this._previewMemory}: ${completed} tramos completados`+
      (active!==null?`, tramo ${active} activo (${method==='sv'?'posición por consigna SV':method==='time'?'meseta, posición por tiempo':method==='time-wait'?'meseta, espera de temporizador':'sin consigna o tiempo'})`:''));
  }
  _physical() {
    const e = this._entity(this._config.curve_entity);
    const x = this._usable(this._config.curve_entity) ? e?.attributes?.memorias : null;
    return x && typeof x === "object" ? x : {};
  }
  _profiles() {
    const p = this._attrs(this._config.profiles_entity).perfiles;
    return p && typeof p === "object" ? p : {};
  }
  _memorySegments(n) {
    const seg = this._physical()[String(n)] || this._physical()[n];
    return Array.isArray(seg) && seg.length === 20 ? seg : null;
  }
  _matchProfile(segments) {
    // C01 es el punto inicial y se actualiza a la PV real al cargar o iniciar.
    // Para identificar el perfil se comparan EXACTAMENTE t01 y los 38
    // valores C02..C20/t02..t20. Las verificaciones Modbus de Python
    // siguen comparando los 40 registros reales: esto es SOLO visual.
    if (!Array.isArray(segments) || segments.length !== 20) return null;
    const matches = [];
    for (const [id, profile] of Object.entries(this._profiles())) {
      if (!Array.isArray(profile?.segmentos) || profile.segmentos.length !== 20) continue;
      const same = profile.segmentos.every((p, i) => {
        const physical = segments[i];
        if (!p || !physical) return false;
        const profileTime = Number(p.tiempo);
        const physicalTime = Number(physical.tiempo);
        if (!Number.isFinite(profileTime) || !Number.isFinite(physicalTime) ||
            p.tiempo == null || physical.tiempo == null || profileTime !== physicalTime) return false;
        if (i === 0) return true; // Ignorar UNICAMENTE la temperatura C01.
        const profileTemp = Number(p.temperatura);
        const physicalTemp = Number(physical.temperatura);
        return p.temperatura != null && physical.temperatura != null &&
          Number.isFinite(profileTemp) && Number.isFinite(physicalTemp) &&
          profileTemp === physicalTemp;
      });
      if (same) matches.push({id, nombre: profile.nombre || id});
    }
    if (!matches.length) return null;
    // Si dos perfiles solo difieren en C01 no elegir uno arbitrariamente.
    if (matches.length !== 1) return {
      id: null, nombre: `Coincidencia múltiple (${matches.length} perfiles)`, ambiguo: true
    };
    return matches[0];
  }
  _renderTramosTable(seg) {
    const tramos=this._programTramos(seg);
    if (!tramos.length) return '<p class="muted">Sin tramos temporizados reconocibles para esta memoria.</p>';
    const active=[1,2].includes(this._programState()) &&
      this._physicalSpc() === this._previewMemory ? this._segmentIndex() : null;
    const completed=this._completedForPreview();
    const rows=tramos.map(t=>{
      const cls=t.numero===active?'segment-active':t.numero<=completed?'segment-completed':'';
      return `<tr class="${cls}" ${t.numero===active?'aria-current="step"':''}>
        <td>${t.numero}</td><td>${this._escape(t.inicio)} °C</td>
        <td>${this._escape(t.tiempo)} min</td><td>${this._escape(t.final)} °C</td></tr>`;
    }).join('');
    const t20=seg && seg.length===20 ? Number(seg[19]?.tiempo):NaN;
    return `<table><thead><tr><th>Tramo</th><th>Tª inicial</th><th>Duración</th><th>Tª final</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }
  _curveStats(seg) {
    if (!seg) return "Sin datos verificados";
    const tramos=this._programTramos(seg);
    if (!tramos.length) return "Sin recorridos temporizados identificados";
    const temps=[tramos[0].inicio,...tramos.map(s=>s.final)];
    const total=tramos.reduce((sum,s)=>sum+s.tiempo,0);
    return `Máx. ${Math.max(...temps)} °C · ${total} min · ${tramos.length} tramos`;
  }
  _graph(seg) {
    const plot=this._plotGeometry(seg);
    const {tramos,pts,left,right,top,bottom,total,yMax}=plot;
    if (!tramos.length) return '<div class="graph-empty">No hay recorridos temporizados verificables para esta memoria.</div>';
    const W=this._graphViewWidth || 720,H=300;
    const coords=(items)=>items.map(p=>`${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const polygon=`${left},${bottom} ${coords(pts)} ${pts[pts.length-1].x},${bottom}`;
    return `<svg data-cjd-curve viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Curva de memoria ${this._previewMemory}">
      <line x1="${left}" y1="${top}" x2="${right}" y2="${top}" class="grid-line"/>
      <line x1="${left}" y1="${(top+bottom)/2}" x2="${right}" y2="${(top+bottom)/2}" class="grid-line"/>
      <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="graph-axis"/>
      <text x="4" y="30">${yMax}°</text><text x="4" y="${(top+bottom)/2+5}">${yMax/2}°</text><text x="4" y="269">0°</text>
      <text x="${left}" y="285">0 min</text><text x="${right}" y="285" text-anchor="end">${total} min programados</text>
      <polygon class="graph-area" points="${polygon}"/>
      <polyline class="curve-pending" data-progress-red points="${coords(pts)}"/>
      <polyline class="curve-completed" data-progress-green points="" style="display:none"/>
      ${pts.map((p,i)=>`<circle data-plot-point="${i}" cx="${p.x}" cy="${p.y}" r="3.5" class="graph-point"><title>${i+1}ª temperatura: ${p.temp} °C</title></circle>`).join('')}
      <g data-progress-marker style="display:none">
        <title>Tramo activo</title>
        <line data-progress-guide x1="0" y1="${top}" x2="0" y2="${bottom}" class="progress-guide"/>
        <circle cx="0" cy="0" r="10" class="progress-halo"/>
        <circle cx="0" cy="0" r="5.5" class="progress-dot"/>
        <text data-progress-label x="12" y="-14" class="progress-text">Tramo activo</text>
      </g>
    </svg>`;
  }
  _newId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (globalThis.crypto?.getRandomValues) {
      const x = new Uint8Array(16); globalThis.crypto.getRandomValues(x);
      x[6] = (x[6] & 15) | 64; x[8] = (x[8] & 63) | 128;
      const h = Array.from(x, n => n.toString(16).padStart(2,"0")).join("");
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }
    // Si el navegador no ofrece crypto, el servicio Python HA genera el UUID.
    return null;
  }
  _commandName(command) {
    return ({run:"Iniciar",stop:"Parar",pause:"Pausar",resume:"Reanudar",seleccionar_curva:"Seleccionar memoria",escritura_curva:"Cargar curva en el horno"})[command] || command;
  }
  _eventTitle(event, valid) {
    if (!valid) return "Sin eventos";
    const status = event.status ? this._statusLabel(String(event.status)) : "";
    if (event.evento === "RESULTADO_ORDEN") {
      // Python publica command en el resultado MQTT. No deducirlo del
      // último botón, pues otro cliente también podría enviar comandos.
      const command = event.command ? this._commandName(String(event.command)) : "Comando no informado";
      return `Comando: ${command} · Resultado: ${status || "Sin resultado"}`;
    }
    const action = event.operacion ? ` · ${this._commandName(String(event.operacion))}` : "";
    return `${String(event.evento || "Evento")}${action}${status ? ` · ${status}` : ""}`;
  }
  _refreshDynamic() {
    // Actualizar valores en el DOM existente; ningún scroll se reinicia.
    if (!this.shadowRoot.querySelector('[data-live="pv"]')) { this._render(); return; }
    const cfg = this._config;
    const mqtt = this._online(cfg.mqtt_entity), modbus = this._online(cfg.modbus_entity);
    const state = this._programState(), stateKnown = state !== null;
    const live = this._telemetry(), active = this._physicalSpc();
    this._updateJourney();
    const put = (name, value) => {
      const el = this.shadowRoot.querySelector(`[data-live="${name}"]`);
      if (el && el.textContent !== String(value)) el.textContent = String(value);
    };
    put('pv',stateKnown ? this._n(live.pv,' °C') : '—');
    put('sv',stateKnown ? this._n(live.sv,' °C') : '—');
    put('estado',stateKnown ? String(live.estado_texto ?? '—').toUpperCase() : 'DESCONOCIDO');
    const tramoDisplay = this._activeTramoDisplay();
    put('tramo', tramoDisplay.numero);
    put('tramo-objetivo', tramoDisplay.objetivo);
    this._refreshTimeOnly();
    this._refreshSimUI();
    const stateCard = this.shadowRoot.querySelector('[data-state-card]');
    if (stateCard) {
      stateCard.classList.toggle('state-running',state === 1);
      stateCard.classList.toggle('state-paused',state === 2);
      stateCard.classList.toggle('state-stopped',state === 0);
      stateCard.classList.toggle('state-unknown',state === null);
    }
    put('spc',active === null ? 'Desconocida' : `Memoria ${active}`);
    const mqttChip = this.shadowRoot.querySelector('[data-live-chip="mqtt"]');
    const modbusChip = this.shadowRoot.querySelector('[data-live-chip="modbus"]');
    if (mqttChip) {mqttChip.classList.toggle('ok',mqtt);mqttChip.classList.toggle('offline',!mqtt);mqttChip.textContent=`MQTT · ${mqtt ? 'Conectado' : 'Desconectado'}`;}
    if (modbusChip) {modbusChip.classList.toggle('ok',mqtt && modbus);modbusChip.classList.toggle('offline',!mqtt || !modbus);modbusChip.textContent=`MODBUS · ${!mqtt ? 'Desconocido' : (modbus ? 'Conectado' : 'Desconectado')}`;}
    this.shadowRoot.querySelectorAll('[data-action="command"]').forEach(button => {
      const command = button.dataset.command;
      button.disabled = this._sending || !this._allow(command) ||
        (command === 'run' && !this._canStartSelected());
      // REANUDAR se destaca en verde solo cuando PAUSADO está confirmado.
      button.classList.toggle('resume-ready',
        command === 'resume' && state === 2 && !button.disabled);
    });
    this._refreshSimUI();
    const refresh = this.shadowRoot.querySelector('[data-action="refresh"]');
    if (refresh) refresh.disabled = !(mqtt && modbus);
    const unlock = this.shadowRoot.querySelector('[data-action="toggle-memory-lock"]');
    if (unlock) unlock.hidden = true;
    // No ocultar la gráfica: solo el bloque de selección durante RUN/PAUSA.
    const selector = this.shadowRoot.querySelector('[data-memory-selector]');
    if (selector) selector.hidden = [1, 2].includes(state);
    const chooseNotice = this.shadowRoot.querySelector('[data-choose-memory]');
    if (chooseNotice) chooseNotice.hidden = state !== 0 || this._runSelectionArmed;
    const runHint = this.shadowRoot.querySelector('[data-run-hint]');
    if (runHint) runHint.textContent = state === 0 && !this._runSelectionArmed ?
      'Para iniciar otra cocción, selecciona expresamente una de las cuatro memorias.' :
      'Al confirmar Iniciar, Python seleccionará y verificará la memoria elegida antes del RUN.';
    for (let n = 1; n <= 4; n++) {
      const card = this.shadowRoot.querySelector(`[data-memory-card="${n}"]`);
      if (!card) continue;
      const locked = this._memoryLocked();
      card.disabled = locked;
      const selectedForRun = state === 0 && this._runSelectionArmed && this._previewMemory === n;
      card.classList.toggle('selected', selectedForRun);
      card.setAttribute('aria-pressed', String(selectedForRun));
    }
    const memoryNotice = this.shadowRoot.querySelector('[data-memory-notice]');
    if (memoryNotice) {
      const unlocked = state === 1 && this._menuUnlocked;
      const spcUnknown = state === 1 && active === null;
      memoryNotice.hidden = !(unlocked || state === 1);
      memoryNotice.classList.toggle('warning',unlocked || spcUnknown);
      memoryNotice.textContent = unlocked ?
        `Menú desbloqueado solo para consulta. ${active === null ? 'SPC real desconocida.' : `El horno ejecuta la memoria ${active}.`} Ver otras curvas no modifica la cocción.` :
        spcUnknown ? 'Horno funcionando: SPC sin confirmar; no se muestra ninguna memoria como ejecutada.' :
        `Menú bloqueado durante la cocción: memoria ${active} en ejecución.`;
    }
    const evt = this._attrs(cfg.event_entity);
    const evtValid = this._usable(cfg.event_entity);
    const status = evtValid ? String(evt.status || '') : '';
    if (this._pending?.id && evt.command_id === this._pending.id &&
        ['succeeded','failed','rejected','expired','cancelled','duplicate'].includes(status)) {
      this._lastOutcome = {command_id:this._pending.id,status,message:String(evt.mensaje || '')};
    }
    put('event-name',this._eventTitle(evt,evtValid));
    put('event-message',evtValid ? String(evt.mensaje || 'Sin mensaje') : 'No hay evento reciente');
    put('event-meta',evtValid ? `${evt.timestamp || ''}${evt.command_id ? ` · ID ${evt.command_id}` : ''}` : '');
    const notice = this.shadowRoot.querySelector('[data-live="error-notice"]');
    if (notice) {
      const isError = ['No se pudo','Error','Acción bloqueada','Sin comunicación'].some(p => this._notice.startsWith(p));
      notice.hidden = !isError;
      notice.textContent = isError ? this._notice : '';
    }
    this._refreshSegmentHighlight();
    this._refreshGraphProgress();
  }
  _refreshCurveData() {
    // Mantiene los nodos de la página y el contenedor desplazable de segmentos.
    // Es importante: shadowRoot.innerHTML = ... haría saltar el scroll al inicio.
    const setText = (element, value) => {
      const text = String(value);
      if (element && element.textContent !== text) element.textContent = text;
    };
    const active = this._physicalSpc();
    for (let n = 1; n <= 4; n++) {
      const card = this.shadowRoot.querySelector(`[data-memory-card="${n}"]`);
      if (!card) continue;
      const segments = this._memorySegments(n);
      const matching = this._matchProfile(segments);
      setText(card.querySelector('[data-memory-name]'), matching?.nombre || "Sin coincidencia HA");
      setText(card.querySelector('[data-memory-stats]'), this._curveStats(segments));
      const selectedForRun = this._programState() === 0 &&
        this._runSelectionArmed && this._previewMemory === n;
      card.classList.toggle("selected", selectedForRun);
      card.setAttribute("aria-pressed", String(selectedForRun));
    }
    const selected = this._previewMemory;
    const seg = this._memorySegments(selected);
    const name = this._matchProfile(seg)?.nombre;
    setText(this.shadowRoot.querySelector('[data-selected-memory]'),
      selected === null ? 'Selecciona una memoria para consultar la curva' :
      `Memoria ${selected} · ${name || 'Sin perfil asociado'}`);
    setText(this.shadowRoot.querySelector('[data-selected-stats]'), this._curveStats(seg));

    // Reconstruir el SVG solo si cambia la curva, no cada vez que llega PV.
    const graph=this.shadowRoot.querySelector('[data-curve-graph]');
    if (graph) {
      const key=JSON.stringify([selected,seg]);
      if (graph.dataset.curveKey!==key) {
        graph.innerHTML=this._graph(seg);
        graph.dataset.curveKey=key;
      }
      this._refreshGraphProgress();
    }

    // Conservar .table-scroll y su posición; 19 tramos posibles, no 20 filas crudas.
    const tableContainer=this.shadowRoot.querySelector('.table-scroll');
    if (tableContainer && this._showAllSegments) {
      const tramos=this._programTramos(seg);
      const key=JSON.stringify([selected,tramos,seg?.[19]?.tiempo]);
      if (tableContainer.dataset.tramosKey!==key) {
        const scroll=tableContainer.scrollTop;
        tableContainer.innerHTML=this._renderTramosTable(seg);
        tableContainer.dataset.tramosKey=key;
        tableContainer.scrollTop=scroll;
      }
    }
    this._refreshSegmentHighlight();
  }

  _statusLabel(status) {
    return ({
      succeeded: "Confirmada", failed: "Fallida", rejected: "Rechazada",
      expired: "Caducada", cancelled: "Cancelada", duplicate: "Duplicada",
      accepted: "Aceptada (pendiente)", executing: "En ejecución (pendiente)",
      unknown: "Resultado desconocido",
    })[status] || status;
  }
  _allow(command) {
    const conn = this._online(this._config.mqtt_entity) && this._online(this._config.modbus_entity);
    const state = this._programState();
    if (!conn || state === null) return false;
    return command === "run" ? state === 0
      : command === "stop" ? [1,2].includes(state)
      : command === "pause" ? state === 1
      : command === "resume" ? state === 2
      : command === "seleccionar_curva" ? state === 0 : false;
  }
  async _publish(command, memoria) {
    if (command !== 'stop' && this._simActive()) {
      this._notice='Simulador activo: los mandos de inicio/pausa/reanudar del HORNO REAL están bloqueados. Desactiva primero el simulador.';
      this._render();return;
    }
    if (this._sending) return;
    if (!this._allow(command)) { this._notice = "Acción bloqueada: comunicación o estado del horno no válidos."; this._render(); return; }
    const id = this._newId();
    const data = { command };
    if (command === "run") {
      if (!this._canStartSelected() || memoria !== this._previewMemory) {
        this._notice = "No se puede iniciar: selecciona expresamente una memoria válida antes de RUN.";
        this._render();
        return;
      }
      data.memoria = memoria;
    }
    if (id) data.command_id = id;
    // No repetir un RUN pendiente con la misma selección si MQTT tarda
    // en confirmar el cambio de estado. Un nuevo intento exige otro clic.
    if (command === 'run') this._runSelectionArmed = false;
    this._sending = true;
    if (command === 'stop') this._stopRequestedForRun = true;
    this._lastOutcome = null;
    this._notice = "Enviando solicitud MQTT…";
    this._render();
    try {
      await this._hass.callService("cjd9000p_curves", "send_command", data);
      this._pending = {command, memoria, id, issued_at: Date.now()};
      this._notice = "";
    } catch (e) {
      if (command === 'stop') this._stopRequestedForRun = false;
      this._notice = `No se pudo publicar: ${e?.message || "error desconocido"}`;
    } finally { this._sending = false; this._render(); }
  }
  async _requestCurves() {
    if (!this._online(this._config.modbus_entity) || !this._online(this._config.mqtt_entity)) {
      this._notice = "Sin comunicación: no se solicitará la sincronización."; this._render(); return;
    }
    try {
      await this._hass.callService("mqtt", "publish", {topic:"horno/cjd9000p/curvas/get",payload:"{}",qos:1,retain:false});
      this._notice = "Consulta solicitada a Python. Espera la nueva publicación de las memorias.";
    } catch (e) { this._notice = `Error al solicitar lectura: ${e?.message || e}`; }
    this._render();
  }
  _onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    const act = target.dataset.action;
    if (act.startsWith('sim-')) { this._simCommand(act.slice(4));return; }
    if (act === "preview") {
      if (this._memoryLocked()) return;
      const n = Number(target.dataset.memory);
      if (!Number.isInteger(n) || n < 1 || n > 4) return;
      if (this._programState() !== 0) return;
      this._previewMemory = n;
      this._runSelectionArmed = true;
      this._confirmation = null;
      this._refreshCurveData();
      this._refreshDynamic();
      return;
    }

    if (act === "save-telegram-temperature") {
      this._setTelegramTemperature();
      return;
    }
    if (act === "toggle-telegram-panel") {
      this._telegramExpanded = !this._telegramExpanded;
      this._refreshTelegramUI();
      return;
    }
    if (act === "refresh") { this._requestCurves(); return; }
    if (act === "toggle-segments") { this._showAllSegments = !this._showAllSegments; this._render(); return; }
    if (act === "toggle-graph") {
      // Cambiar únicamente la visibilidad del gráfico: no reconstruir
      // el DOM, para preservar los botones y la posición de scroll.
      this._showGraph = !this._showGraph;
      const graph = this.shadowRoot.querySelector('[data-curve-graph]');
      if (graph) graph.hidden = !this._showGraph;
      if (this._showGraph) { this._syncGraphSize(); this._refreshGraphProgress(); }
      const button = this.shadowRoot.querySelector('[data-action="toggle-graph"]');
      if (button) {
        button.textContent = this._showGraph ? "Ocultar gráfica" : "Mostrar gráfica";
        button.setAttribute("aria-expanded", String(this._showGraph));
      }
      return;
    }
    if (act === "cancel") { this._confirmation = null; this._render(); return; }
    if (act === "confirm") {
      const pending = this._confirmation; this._confirmation = null;
      if (pending && (pending.command !== 'run' ||
          (this._canStartSelected() && pending.memoria === this._previewMemory))) {
        this._publish(pending.command, pending.memoria);
      }
      return;
    }
    if (act === "command") {
      const command = target.dataset.command;
      if (!this._allow(command)) return;
      const memoria = command === "run" ? this._previewMemory : null;
      if (command === "run" && !this._canStartSelected()) return;
      this._confirmation = {command, memoria};
      this._render();
    }
  }
  _render() {
    if (!this.shadowRoot) return;
    if (this._pointerActive) {
      this._renderDeferred = true;
      return;
    }
    this._renderDeferred = false;
    this._syncMemorySelection();
    this._updateJourney();
    const cfg = this._config;
    // Cabecera unificada: el prefijo CJD-9000P se muestra una sola vez,
    // como rótulo verde. Se respetan los títulos personalizados de Lovelace.
    const headerTitle = String(cfg.title ?? "").replace(/^CJD-9000P\s*[·:–-]\s*/i, "").trim() || "Control del horno";
    const live = this._telemetry();
    const mqtt = this._online(cfg.mqtt_entity), modbus = this._online(cfg.modbus_entity);
    const physical = this._physical();
    const active = this._physicalSpc();
    const state = this._programState();
    const selected = this._previewMemory;
    const memoryLocked = this._memoryLocked();
    const timing = this._segmentTiming();
    const tramoDisplay = this._activeTramoDisplay();
    const seg = this._memorySegments(selected);
    const match = this._matchProfile(seg);
    const event = this._attrs(cfg.event_entity);
    const evtValid = this._usable(cfg.event_entity);
    const evtIsPending = this._pending && this._pending.id && event.command_id === this._pending.id;
    const evtStatus = evtValid ? String(event.status || "") : "";
    const statusEnd = ["succeeded", "failed", "rejected", "expired", "cancelled", "duplicate"].includes(evtStatus);
    // El resultado se correlaciona por command_id, nunca por el último evento sin más.
    // Guardamos el resultado final para que otro evento MQTT posterior no lo oculte.
    if (evtIsPending && statusEnd) {
      this._lastOutcome = {
        command_id: this._pending.id,
        status: evtStatus,
        message: String(event.mensaje || ""),
      };
    }
    const lastOutcome = this._lastOutcome?.command_id === this._pending?.id ? this._lastOutcome : null;
    let noticeText = this._notice;
    if (lastOutcome) {
      if (lastOutcome.status === "succeeded") {
        noticeText = `✓ Ejecución confirmada por Python (${this._commandName(this._pending.command)}). ${lastOutcome.message}`;
      } else {
        noticeText = `Resultado de la orden (${this._commandName(this._pending.command)}): ${lastOutcome.status}. ${lastOutcome.message} Verifica el estado del horno antes de repetirla.`;
      }
    } else if (evtIsPending && ["accepted", "executing"].includes(evtStatus)) {
      noticeText = `Solicitud ${evtStatus === "accepted" ? "aceptada y en cola" : "en ejecución"}; todavía sin confirmación física.`;
    }
    const eventLine = evtValid ? `${this._escape(event.mensaje || "Sin mensaje")}` : "No hay evento reciente";
    const stateKnown = state !== null;
    const currentState = stateKnown ? String(live.estado_texto ?? "—").toUpperCase() : "DESCONOCIDO";
    const previewItems = [1,2,3,4].map(n => {
      const segments = this._memorySegments(n), label = this._matchProfile(segments);
      const selectedForRun = state === 0 && this._runSelectionArmed && selected === n;
      return `<button class="memory ${selectedForRun ? "selected" : ""}" data-action="preview" data-memory="${n}" data-memory-card="${n}" aria-pressed="${selectedForRun}" ${memoryLocked ? 'disabled' : ''}>
          <span>MEMORIA ${n}</span>
          <strong data-memory-name>${this._escape(label?.nombre || "Sin coincidencia HA")}</strong>
          <small data-memory-stats>${this._escape(this._curveStats(segments))}</small>
        </button>`;
    }).join("");
    const telegramHtml = this._renderTelegramPanel();
    const btn = (command, label, variant="") => `<button class="btn ${variant}" data-action="command" data-command="${command}" ${(command !== "run" || this._canStartSelected()) && this._allow(command) && !this._sending ? "" : "disabled"}>${label}</button>`;
    const highlightRow = [1,2].includes(state) && active === selected ? this._segmentIndex() : null;
    const completedRow = this._completedForPreview();
    const table = this._renderTramosTable(seg);
    // Mantener la tabla como un nodo DOM estable evita saltos a scrollTop=0
    // cuando Home Assistant publica cada segundo PV, SV o eventos MQTT.
    const tableKey = JSON.stringify([selected, seg]);
    const reusableTable = this._showAllSegments && this._tableCacheKey === tableKey
      ? this.shadowRoot.querySelector(".table-scroll") : null;
    const savedTableScrollTop = reusableTable?.scrollTop ?? 0;
    const tableBody = !this._showAllSegments ? "" : reusableTable
      ? '<div data-reuse-table="1"></div>' : `<div class="table-scroll">${table}</div>`;
    const notice = noticeText ? `<div class="notice" role="status" aria-live="polite">${this._escape(noticeText)}</div>` : "";
    const dialog = this._confirmation ? `<div class="overlay" role="dialog" aria-modal="true" aria-label="Confirmar acción"><div class="dialog">
      <strong>Confirmar: ${this._escape(this._commandName(this._confirmation.command))}</strong>
      ${this._confirmation.command === "run" ? `<p><b>Memoria seleccionada:</b> ${this._confirmation.memoria}</p>
        <p><b>Curva asociada en Home Assistant:</b> ${this._escape(this._matchProfile(this._memorySegments(this._confirmation.memoria))?.nombre || "Sin coincidencia en Home Assistant")}</p>
        <p>Al confirmar, Python verificará que el horno esté parado, seleccionará y comprobará SPC ${this._confirmation.memoria} y solo entonces enviará RUN. Si falla una comprobación, no iniciará la cocción.</p>`
        : `<p>Se enviará una orden real al programador. La publicación MQTT no demuestra que el horno la haya ejecutado.</p>`}
      <div class="actions"><button class="btn quiet" data-action="cancel">Cancelar</button><button class="btn primary" data-action="confirm">${this._confirmation.command === "run" ? "Confirmar inicio" : "Confirmar envío"}</button></div></div></div>` : "";
    this.shadowRoot.innerHTML = `<style>
      :host { display:block; color:var(--primary-text-color,#222); --accent:#29bc6c; }
      * {box-sizing:border-box;} [hidden] {display:none !important;} .wrap {font-family:inherit; padding:22px; border-radius:18px; background:color-mix(in srgb,var(--ha-card-background,var(--card-background-color,#fff)) 95%,var(--primary-text-color,#222) 5%);box-shadow:var(--ha-card-box-shadow,0 3px 15px #0000000d);}
      h1 {margin:0;font-size:27px;line-height:1.15;font-weight:750;color:var(--primary-text-color,#212121);} h2 {font-size:18px;margin:0 0 14px;} p {line-height:1.5;} .muted,small {color:var(--secondary-text-color,#6b7480);} .top {display:flex; flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:17px;}
      .header-heading {min-width:0;flex:1 1 220px;} .eyebrow {font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--accent);font-weight:800;margin-bottom:5px;} .subtitle {margin-top:7px;color:var(--secondary-text-color,#757575);font-size:14px;}
      .statuses {display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;} .chip {min-width:152px;text-align:center;font-size:12px;font-weight:700;border-radius:11px;padding:10px 15px;border:1px solid transparent;} .chip::before {content:'●';margin-right:7px;} .chip.ok {background:rgba(41,188,108,.18);border-color:rgba(41,188,108,.50);color:var(--primary-text-color,#222);} .chip.ok::before {color:#29bc6c;} .chip.offline {background:rgba(195,64,64,.14);border-color:rgba(195,64,64,.40);color:var(--primary-text-color,#222);} .chip.offline::before {color:#cc4242;}
      /* Los mandos son la primera acción. Indicadores compactos en escritorio. */
      .stats {display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:0 0 14px;}
      .stat {border:1px solid var(--divider-color,#e6e8ec);border-radius:12px;padding:9px 12px;min-width:0;min-height:0;background:var(--ha-card-background,var(--card-background-color,#fff));display:flex;flex-direction:column;justify-content:center;}
      .stat label {font-size:12px;color:var(--secondary-text-color,#888);display:block;margin-bottom:4px;line-height:1.25;}
      .stat strong {font-size:22px;line-height:1.2;overflow-wrap:anywhere;}
      .stat strong.state {font-size:15px;}
      .stat[data-state-card] {transition:background .18s ease,border-color .18s ease;}
      .stat.state-running {background:rgba(41,188,108,.12);border-color:rgba(41,188,108,.55);}
      .stat.state-paused {background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.55);}
      .stat.state-stopped {background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.48);}
      .stat.state-unknown {background:var(--secondary-background-color,#f0f1f2);}
      .stat.state-running strong {color:#29bc6c;}
      .stat.state-paused strong {color:#2877c7;}
      .stat.state-stopped strong {color:var(--error-color,#b42318);}
      .tramo-objetivo {display:block;color:#29bc6c;font-size:13px;font-weight:700;margin-top:5px;line-height:1.3;overflow-wrap:anywhere;}
      .time-caption {display:block;color:var(--secondary-text-color,#777);font-size:10px;margin-top:4px;line-height:1.25;}
      .time-track {height:8px;background:#545960;border:1px solid #747b83;border-radius:10px;margin-top:6px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);}
      .time-fill {height:100%;background:#29bc6c;width:0;transition:width .3s ease;border-radius:10px;}
      strong[data-live="tiempo"] {font-size:17px;white-space:nowrap;}
      .monitor-panel {padding:15px;border:1px solid var(--divider-color,#e6e8ec);border-radius:15px;background:color-mix(in srgb,var(--ha-card-background,var(--card-background-color,#fff)) 90%,var(--primary-text-color,#222) 10%);margin:13px 0;}
      .monitor-heading {display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px 14px;margin-bottom:12px;}
      .monitor-heading h2 {margin:0;font-size:16px;}
      .curve-panel {border:1px solid var(--divider-color,#e6e8ec);background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:13px;padding:13px;min-width:0;}
      .curve-heading h2 {font-size:17px;}
      .curve-heading [data-selected-stats] {font-size:12px;}
      .table-heading {margin-top:13px;}
      .table-heading h2 {font-size:15px;}
      .section {border:1px solid var(--divider-color,#e6e8ec);border-radius:14px;padding:17px;margin:15px 0;} .bar {display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px;} .bar h2 {margin:0;}
      .sim-panel{border:2px solid #806223;background:rgba(226,170,39,.055);}
      .sim-panel.sim-active{border:2px solid #ecac27;background:rgba(240,175,38,.13);}
      .sim-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;}
      .sim-head strong{font-size:14px;color:#e2a33c;letter-spacing:.03em;}
      .sim-head small{display:block;margin-top:5px;font-size:12px;color:var(--secondary-text-color,#aaa);}
      .sim-stats{margin-top:12px;padding:10px;border-radius:8px;background:var(--secondary-background-color,#292929);font-size:13px;}
      .sim-note{display:block;color:var(--secondary-text-color,#999);margin-top:7px;}
      .sim-panel .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
      .sim-panel .actions button{min-height:37px;padding:7px 10px;}
      .telegram-panel {padding:0;overflow:hidden;background:var(--ha-card-background,var(--card-background-color,#fff));margin:13px 0;}
      .telegram-toggle {display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:15px 17px;background:transparent;border:0;color:inherit;text-align:left;cursor:pointer;font:inherit;}
      .telegram-toggle:hover {background:color-mix(in srgb,var(--ha-card-background,var(--card-background-color,#fff)) 90%,var(--primary-text-color,#222) 10%);}
      .telegram-toggle:focus-visible,.telegram-choice input:focus-visible {outline:2px solid #29bc6c;outline-offset:-3px;}
      .telegram-heading {display:flex;align-items:center;gap:10px;min-width:0;}
      .telegram-heading strong {display:block;font-size:15px;font-weight:650;line-height:1.3;}
      .telegram-heading small {display:block;color:var(--secondary-text-color,#888);font-size:12px;margin-top:4px;}
      .telegram-symbol {display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:9px;background:rgba(41,188,108,.11);color:#29bc6c;font-size:20px;}
      [data-telegram-chevron] {flex:none;font-size:19px;color:var(--secondary-text-color,#888);}
      [data-telegram-body] {padding:0 17px 16px;border-top:1px solid var(--divider-color,#ddd);}
      .telegram-master {padding:13px 0 6px;}
      .telegram-master .telegram-choice {font-weight:650;}
      .telegram-choice {display:flex;align-items:center;gap:11px;min-height:39px;font-size:13px;line-height:1.4;cursor:pointer;}
      .telegram-choice input {width:18px;height:18px;flex:none;accent-color:#29bc6c;cursor:pointer;}
      .telegram-choice input:disabled {opacity:.5;cursor:not-allowed;}
      .telegram-choice span {flex:1;min-width:0;}
      .telegram-missing {font-size:10px;color:var(--error-color,#b42318);}
      .telegram-options {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 16px;}
      .telegram-group {margin-top:9px;border-top:1px solid var(--divider-color,#ddd);padding-top:8px;}
      .telegram-group h3 {font-size:12px;font-weight:650;color:var(--secondary-text-color,#888);margin:4px 0;}
      .telegram-temperature {display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 4px;padding:12px 0 0;border-top:1px solid var(--divider-color,#ddd);}
      .telegram-temperature>label {font-size:13px;font-weight:600;}
      .telegram-temperature-controls {display:flex;align-items:center;gap:8px;}
      .telegram-temperature-controls input {width:92px;min-width:0;max-width:100%;padding:9px;border:1px solid var(--divider-color,#ccc);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#222);font:inherit;font-size:14px;}
      .telegram-temperature-controls input:focus-visible {outline:2px solid #29bc6c;outline-offset:2px;}
      .telegram-temperature-controls input:disabled {opacity:.55;}
      .telegram-temperature-controls .btn {padding:9px 13px;font-size:12px;}
      .telegram-help {color:var(--secondary-text-color,#888);font-size:12px;line-height:1.45;margin:7px 0;}
      .telegram-error {color:var(--error-color,#b42318);font-size:12px;line-height:1.4;margin:9px 0;}
      @media(max-width:600px){.telegram-options{grid-template-columns:1fr;}.telegram-toggle{padding:12px 13px;}[data-telegram-body]{padding:0 13px 13px;}.telegram-choice{min-height:42px;}}
      .command-panel {background:var(--ha-card-background,var(--card-background-color,#fff));border-left:3px solid var(--accent);margin-top:0;padding:14px 16px;}
      .command-panel .bar {margin-bottom:10px;}
      .command-panel .bar h2 {font-size:17px;}
      .command-panel [data-run-hint] {margin:9px 0 0;line-height:1.35;}
      .control-actions .btn {min-width:115px;}
      .control-actions [data-command="stop"] {margin-left:auto;}
      .actions {display:flex;flex-wrap:wrap;gap:8px;} button {font-family:inherit;cursor:pointer;} button:disabled {opacity:.38;cursor:not-allowed;} .btn {border-radius:10px;background:var(--secondary-background-color,#edf1f4);border:1px solid var(--divider-color,#cfd6dc);color:var(--primary-text-color,#222);padding:12px 17px;font-size:14px;font-weight:700;} .btn.primary {background:#29bc6c;color:#072316;border-color:#29bc6c;} .btn.resume-ready:not(:disabled) {background:#29bc6c;color:#072316;border-color:#29bc6c;} .btn.danger {background:#a44740;color:white;border-color:#a44740;} .btn.quiet {background:transparent;}
      .memories {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;} .memory {border:1px solid var(--divider-color,#ddd);border-radius:12px;padding:12px;text-align:left;background:var(--card-background-color,#fff);color:inherit;min-width:0;} .memory.selected {outline:2px solid var(--accent);outline-offset:-2px;background:rgba(41,188,108,.19);} .memory:disabled:not(.selected) {opacity:.45;cursor:not-allowed;} .memory span {display:block;font-size:11px;font-weight:700;color:var(--secondary-text-color,#777);margin-bottom:7px;} .memory em {font-style:normal;color:#29bc6c;} .memory strong {display:block;font-size:13px;overflow-wrap:anywhere;margin-bottom:6px;} .memory small {font-size:11px;line-height:1.4;display:block;}
      .graph {background:var(--secondary-background-color,#f7f9fb);border:1px solid var(--divider-color,#ddd);border-radius:12px;padding:12px 14px;min-width:0;} svg {width:100%;height:clamp(280px,27vw,390px);display:block;} svg text {font:12px sans-serif;fill:var(--secondary-text-color,#777);} .grid-line {stroke:var(--divider-color,#ddd);stroke-width:1;} .graph-axis {stroke:var(--secondary-text-color,#aaa);stroke-width:1.2;} .graph-area {fill:rgba(41,188,108,.055);} .curve-pending {stroke:#e35b58;stroke-width:2.8;fill:none;stroke-linejoin:round;} .graph-point {stroke:#e35b58;fill:var(--card-background-color,#fff);stroke-width:1.3;} .point-completed {stroke:#29bc6c;fill:#29bc6c;stroke-width:1.3;} .curve-completed {stroke:#29bc6c;stroke-width:4;fill:none;stroke-linecap:round;stroke-linejoin:round;} .progress-guide {stroke:#ef9b26;stroke-width:1.3;stroke-dasharray:5 5;} .progress-halo {fill:rgba(239,155,38,.18);} .progress-dot {fill:#ef9b26;stroke:#fff;stroke-width:1.4;} .curve-running .progress-halo {animation:cjd722-pulse 1s ease-in-out infinite;} .curve-running .progress-dot {animation:cjd722-glow 1s ease-in-out infinite;} @keyframes cjd722-pulse {0%,100%{opacity:.45;}50%{opacity:1;}} @keyframes cjd722-glow {0%,100%{stroke-width:1.4;}50%{stroke-width:3;}} @media (prefers-reduced-motion:reduce) {.curve-running .progress-halo,.curve-running .progress-dot{animation:none;}} svg .progress-text {fill:#f2a63d;font-weight:700;font-size:12px;} .graph-empty {padding:45px;text-align:center;color:var(--secondary-text-color,#888);}
      table {border-collapse:collapse;width:100%;text-align:left;font-size:13px;} th,td {padding:9px 10px;border-bottom:1px solid var(--divider-color,#ddd);white-space:nowrap;} th {color:var(--secondary-text-color,#666);font-size:12px;} .table-scroll {max-height:390px;overflow:auto;} tr.segment-active {background:rgba(245,158,11,.22);font-weight:700;} tr.segment-active td:first-child {border-left:3px solid #f59e0b;} tr.segment-completed {background:rgba(41,188,108,.17);} tr.segment-completed td:first-child {border-left:3px solid #29bc6c;} .memory-notice {padding:10px 12px;border-radius:9px;font-size:12px;background:var(--secondary-background-color,#eef2f4);margin-top:10px;} .memory-notice.warning {background:rgba(216,150,37,.12);border:1px solid rgba(216,150,37,.35);} .notice {padding:12px 14px;border-radius:10px;background:var(--secondary-background-color,#f1f4f7);margin:12px 0;font-size:13px;}
      .event-row {display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;} .event-name {font-weight:700;} .event-row p {margin:5px 0 0;font-size:13px;} .event-meta {font-size:11px;color:var(--secondary-text-color,#888);overflow-wrap:anywhere;} .caution {font-size:12px;color:var(--secondary-text-color,#777);margin:10px 0 0;}
      .overlay {position:fixed;inset:0;z-index:10;background:#0009;display:flex;align-items:center;justify-content:center;padding:16px;} .dialog {background:var(--ha-card-background,var(--card-background-color,#fff));color:var(--primary-text-color,#222);padding:25px;border-radius:16px;max-width:460px;width:100%;box-shadow:0 9px 32px #0004;} .dialog strong {font-size:20px;} .dialog .actions {justify-content:flex-end;}
      @media(max-width:1000px){.stats{grid-template-columns:repeat(3,minmax(0,1fr));}.memories{grid-template-columns:repeat(2,minmax(0,1fr));}}
      @media(max-width:560px){.wrap{padding:14px}.top{gap:12px}.top h1{font-size:25px}.monitor-panel{padding:11px}.curve-panel{padding:10px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.stats>.stat:last-child:nth-child(odd){grid-column:1 / -1;}.stat{padding:12px;min-height:91px;}.memories{grid-template-columns:1fr;}.stat strong{font-size:19px;}strong[data-live="tiempo"]{font-size:18px;}.control-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));}.control-actions .btn{min-width:0;padding:12px 8px;}.control-actions [data-command="stop"]{margin-left:0;}.graph{padding:7px 5px;}svg{height:290px;}}
      @media(max-width:430px){.top h1{font-size:23px}.subtitle{font-size:12px}.statuses{width:100%}.statuses .chip{min-width:0;flex:1 1 140px;padding:9px 11px;}}
    </style>
    <ha-card><div class="wrap"><header class="top"><div class="header-heading"><div class="eyebrow">CJD-9000P</div><h1>${this._escape(headerTitle)}</h1><div class="subtitle">Control y seguimiento del horno</div></div>
      <div class="statuses"><div data-live-chip="mqtt" class="chip ${mqtt ? 'ok' : 'offline'}">MQTT · ${mqtt ? 'Conectado' : 'Desconectado'}</div><div data-live-chip="modbus" class="chip ${mqtt && modbus ? 'ok' : 'offline'}">MODBUS · ${!mqtt ? 'Desconocido' : (modbus ? 'Conectado' : 'Desconectado')}</div></div></header>
      ${telegramHtml}
      ${this._simPanel()}
      <section class="section command-panel"><div class="bar"><h2>Mandos del programador</h2><span class="muted">Acciones sobre el horno</span></div><div class="actions control-actions">
        ${btn("run","▶ Iniciar","primary")}${btn("pause","Ⅱ Pausar")}${btn("resume","▶ Reanudar",state === 2 ? "resume-ready" : "")}${btn("stop","■ Parar","danger")}</div>
        <p class="caution" data-run-hint>${state === 0 && !this._runSelectionArmed ? 'Para iniciar otra cocción, selecciona expresamente una de las cuatro memorias.' : 'Al confirmar Iniciar, Python seleccionará y verificará la memoria elegida antes del RUN.'}</p></section>
      <section class="section" data-memory-selector ${[1,2].includes(state) ? 'hidden' : ''}>
        <div class="bar"><h2>Selecciona la memoria de la próxima cocción</h2><div class="actions"><button class="btn quiet" data-action="refresh" ${mqtt && modbus ? "" : "disabled"}>↻ Leer de nuevo</button></div></div>
        <p class="memory-notice" data-choose-memory ${state !== 0 || this._runSelectionArmed ? 'hidden' : ''}>Ninguna memoria seleccionada. Pulsa la curva que quieres ejecutar para habilitar Iniciar.</p>
        <div class="memories">${previewItems}</div>
      </section>
      <section class="monitor-panel" aria-label="Seguimiento de la cocción">
        <div class="monitor-heading"><h2>Seguimiento de la cocción</h2><span class="muted">SPC activo en el horno: <b data-live="spc">${active === null ? 'Desconocida' : `Memoria ${active}`}</b></span></div>
      <div class="stats"><div class="stat"><label>Temperatura real (PV)</label><strong data-live="pv">${stateKnown ? this._n(live.pv," °C") : "—"}</strong></div>
        <div class="stat"><label>Consigna (SV)</label><strong data-live="sv">${stateKnown ? this._n(live.sv," °C") : "—"}</strong></div>
        <div class="stat ${state === 1 ? 'state-running' : state === 2 ? 'state-paused' : state === 0 ? 'state-stopped' : 'state-unknown'}" data-state-card><label>Estado</label><strong data-live="estado" class="state">${this._escape(currentState)}</strong></div>
        <div class="stat"><label>Tramo actual</label><strong data-live="tramo">${this._escape(tramoDisplay.numero)}</strong><small class="tramo-objetivo" data-live="tramo-objetivo">${this._escape(tramoDisplay.objetivo)}</small></div>
        <div class="stat"><label>Tiempo del tramo (min:seg)</label><strong data-live="tiempo">${this._escape(timing.label)}</strong><div class="time-track"><div class="time-fill" data-time-progress role="progressbar" aria-label="Progreso temporal del tramo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(timing.progress ?? 0)}" style="width:${timing.progress ?? 0}%" ${timing.progress === null ? 'hidden' : ''}></div></div><small class="time-caption" data-live="time-caption">${this._escape(timing.detail)}</small></div></div>
      <div class="curve-panel"><div class="bar curve-heading"><h2 data-selected-memory>${selected === null ? 'Selecciona una memoria para consultar la curva' : `Memoria ${selected} · ${this._escape(match?.nombre || 'Sin perfil asociado')}`}</h2><span class="muted" data-selected-stats>${this._escape(this._curveStats(seg))}</span><button class="btn quiet" data-action="toggle-graph" aria-controls="cjd9000p-621-graph" aria-expanded="${this._showGraph}">${this._showGraph ? "Ocultar gráfica" : "Mostrar gráfica"}</button></div><div class="graph" id="cjd9000p-621-graph" data-curve-graph ${this._showGraph ? "" : "hidden"}>${this._graph(seg)}</div>
        <div class="bar table-heading"><h2>Tramos (solo lectura)</h2><button class="btn quiet" data-action="toggle-segments">${this._showAllSegments ? "Ocultar tabla" : "Mostrar tabla"}</button></div>
        ${tableBody}</div>
      </section>
      <section class="section"><h2>Último evento comunicado por Python</h2><div class="event-row"><div><div class="event-name" data-live="event-name">${this._escape(this._eventTitle(event, evtValid))}</div>
        <p data-live="event-message">${eventLine}</p><div class="event-meta" data-live="event-meta">${this._escape(evtValid ? (event.timestamp || "") : "")}${evtValid && event.command_id ? ` · ID ${this._escape(event.command_id)}` : ""}</div></div></div>
      <p class="caution" role="alert" data-live="error-notice" ${["No se pudo", "Error", "Acción bloqueada", "Sin comunicación"].some(p => this._notice.startsWith(p)) ? "" : "hidden"}>${this._escape(this._notice)}</p></section>
      ${dialog}</div></ha-card>`;
    // Reinsertar el MISMO nodo de tabla cuando su curva no cambió: preserva
    // posición del scroll, selección de texto y arrastre del scrollbar.
    if (reusableTable) {
      this.shadowRoot.querySelector('[data-reuse-table="1"]')?.replaceWith(reusableTable);
      // Los navegadores reinician scrollTop al separar un nodo del árbol.
      reusableTable.scrollTop = savedTableScrollTop;
    }
    this._tableCacheKey = this._showAllSegments ? tableKey : null;
    this._structuralFingerprint = JSON.stringify([
      this._physical(), this._profiles(), this._config.title,
    ]);
    this._watchGraphSize();
    this._refreshGraphProgress();
    this._refreshTelegramUI();
    this._refreshSimUI();
  }
}
if (!customElements.get("cjd9000p-control-card-621")) customElements.define("cjd9000p-control-card-621", CJD9000PControl621);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === "cjd9000p-control-card-621")) window.customCards.push({type:"cjd9000p-control-card-621",name:"CJD-9000P Control V7.5.9.2 · Simulador aislado",description:"Control, SPC protegido y cuatro memorias físicas CJD-9000P."});
