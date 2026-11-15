/* ==========================================================================
 * CJD-9000P · Mis curvas
 *
 * Tarjeta Lovelace personalizada.
 * Versión: 7.6.0 · inventario físico, editor PV y vista móvil · C01 adaptable
 *
 * IMPORTANTE: esta versión utiliza exclusivamente los servicios:
 *   cjd9000p_curves.create_profile
 *   cjd9000p_curves.update_profile
 *   cjd9000p_curves.duplicate_profile
 *   cjd9000p_curves.delete_profile
 *   cjd9000p_curves.load_profile
 *
 * No depende de ApexCharts ni de ninguna librería externa.
 *
 * Funciones:
 *   - Lista de curvas almacenadas en Home Assistant.
 *   - Crear curva.
 *   - Editar curva.
 *   - Duplicar curva.
 *   - Eliminar curva.
 *   - Editar 19 recorridos entre 20 temperaturas; conservar t20.
 *   - Gráfica SVG de temperatura frente a tiempo programado.
 *   - En lista ancha: datos y acciones a la izquierda, gráfica a la derecha.
 *   - Escala gráfica automática con margen superior (no altera los límites de edición).
 *   - Cargar una curva en una memoria física 1-4.
 *
 * IMPORTANTE:
 *   Esta tarjeta NO escribe directamente Modbus.
 *   La carga se realiza mediante:
 *
 *   cjd9000p_curves.load_profile
 *
 * ========================================================================== */

class Cjd9000pCurvesCard extends HTMLElement {
  constructor() {
    super();

    this._hass = null;

    this._config = {
      entity: "sensor.cjd9000p_curvas",
      title: "Mis curvas",
      curve_entity: "sensor.cjd9000p_panel_curvas_fisicas",
      modbus_entity: "binary_sensor.cjd9000p_panel_modbus",
      mqtt_entity: "binary_sensor.cjd9000p_panel_mqtt",
    };

    this._view = "list";

    this._editingProfileId = null;

    this._draft = null;
    this._originalDraft = null;

    this._selectedMemory = 1;

    this._notification = null;

    this._confirmDeleteProfileId = null;
    this._memoryChoice = null; // Solo para coincidencias ambiguas; nunca escribe SPC.

    this._boundClickHandler = this._handleClick.bind(this);
    this._boundInputHandler = this._handleInput.bind(this);
    this._boundChangeHandler = this._handleChange.bind(this);
  }

  /* ========================================================================
   * Home Assistant
   * ======================================================================== */

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Configuración inválida para CJD-9000P Curvas.");
    }

    this._config = {
      ...this._config,
      ...config,
    };

    this._render();
  }

  set hass(hass) {
    // El resto del panel (PV/SV, MQTT, etc.) puede actualizarse cada segundo.
    // No se debe reconstruir esta tarjeta si el sensor de perfiles no cambia:
    // reemplazar botones entre pointerdown y click pierde pulsaciones.
    const previousEntity = this._hass?.states?.[this._config.entity];
    const nextEntity = hass?.states?.[this._config.entity];
    const previousPhysical = this._hass?.states?.[this._config.curve_entity];
    const nextPhysical = hass?.states?.[this._config.curve_entity];
    const previousModbus = this._hass?.states?.[this._config.modbus_entity];
    const nextModbus = hass?.states?.[this._config.modbus_entity];
    const previousMqtt = this._hass?.states?.[this._config.mqtt_entity];
    const nextMqtt = hass?.states?.[this._config.mqtt_entity];
    const firstUpdate = !this._hass;
    this._hass = hass;

    // No sustituimos inputs cuando el usuario edita o elige una memoria.
    if (this._view === "editor" || this._view === "load") {
      return;
    }

    if (firstUpdate || previousEntity !== nextEntity) {
      this._render();
      return;
    }

    // Solo actualizar las etiquetas, no las tarjetas ni sus botones.
    // Los mensajes MQTT pueden llegar cada segundo y no deben reiniciar
    // el scroll ni interrumpir pulsaciones en el escritorio.
    if (previousPhysical !== nextPhysical || previousModbus !== nextModbus ||
        previousMqtt !== nextMqtt) {
      this._refreshPhysicalBadges();
      const inventory = this.querySelector("[data-memory-inventory]");
      if (inventory) inventory.innerHTML = this._renderMemoryInventory();
    }
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 8;
  }

  connectedCallback() {
    // El click se escucha en fase de captura para evitar que alguna
    // actualización del DOM de Home Assistant haga que se pierda
    // la pulsación del botón.
    this.addEventListener(
      "click",
      this._boundClickHandler,
      true,
    );

    this.addEventListener(
      "input",
      this._boundInputHandler,
    );

    this.addEventListener(
      "change",
      this._boundChangeHandler,
    );

    this._render();
  }

  disconnectedCallback() {
    this.removeEventListener(
      "click",
      this._boundClickHandler,
      true,
    );

    this.removeEventListener(
      "input",
      this._boundInputHandler,
    );

    this.removeEventListener(
      "change",
      this._boundChangeHandler,
    );
  }

  /* ========================================================================
   * Datos
   * ======================================================================== */

  _getEntityState() {
    if (!this._hass || !this._hass.states) {
      return null;
    }

    return this._hass.states[this._config.entity] || null;
  }

  _getProfiles() {
    const entity = this._getEntityState();

    if (!entity || !entity.attributes) {
      return {};
    }

    const profiles = entity.attributes.perfiles;

    if (!profiles || typeof profiles !== "object") {
      return {};
    }

    return profiles;
  }

  _verifiedPhysicalMemories() {
    const physical = this._hass?.states?.[this._config.curve_entity];
    const modbus = this._hass?.states?.[this._config.modbus_entity];
    const mqtt = this._hass?.states?.[this._config.mqtt_entity];
    // Un atributo retenido no confirma el estado actual del programador.
    if (!physical || ["unknown", "unavailable"].includes(physical.state) ||
        !modbus || modbus.state !== "on" || !mqtt || mqtt.state !== "on") {
      return null;
    }
    const memories = physical.attributes?.memorias;
    if (!memories || typeof memories !== "object") return null;
    const valid = (segments) => Array.isArray(segments) && segments.length === 20 &&
      segments.every(segment => segment && typeof segment === "object" &&
        segment.temperatura !== null && segment.temperatura !== undefined &&
        segment.tiempo !== null && segment.tiempo !== undefined &&
        Number.isFinite(Number(segment.temperatura)) &&
        Number.isFinite(Number(segment.tiempo)));
    // Hasta tener las CUATRO memorias no podemos afirmar una no coincidencia.
    for (let n = 1; n <= 4; n++) {
      if (!valid(memories[String(n)])) return null;
    }
    return memories;
  }

  // El valor de C01 se adapta a PV. El resto de los 39 registros
  // sí deben coincidir exactamente para identificar el mismo programa.
  _sameProgramExceptC01(first, second) {
    return Array.isArray(first) && Array.isArray(second) &&
      first.length === 20 && second.length === 20 && first.every((segment, index) => {
        const real = second[index];
        if (!segment || !real) return false;
        if (segment.tiempo === null || segment.tiempo === undefined ||
            real.tiempo === null || real.tiempo === undefined) return false;
        const t1 = Number(segment.tiempo), t2 = Number(real.tiempo);
        if (!Number.isFinite(t1) || !Number.isFinite(t2) || t1 !== t2) return false;
        if (index === 0) return true;
        if (segment.temperatura === null || segment.temperatura === undefined ||
            real.temperatura === null || real.temperatura === undefined) return false;
        const c1 = Number(segment.temperatura), c2 = Number(real.temperatura);
        return Number.isFinite(c1) && Number.isFinite(c2) && c1 === c2;
      });
  }

  _matchingProfilesForMemory(memory, memories = this._verifiedPhysicalMemories()) {
    const physical = memories?.[String(memory)];
    if (!physical) return [];
    return Object.entries(this._getProfiles()).filter(([, profile]) =>
      this._sameProgramExceptC01(profile?.segmentos, physical))
      .map(([id, profile]) => ({id, nombre: profile.nombre || "Sin nombre"}));
  }

  _physicalMatchInfo(profile, memories = this._verifiedPhysicalMemories()) {
    if (!memories) return {kind: "unverified", label: "Sin verificar · horno desconectado o sin lectura completa"};
    if (!profile || !Array.isArray(profile.segmentos) || profile.segmentos.length !== 20) {
      return {kind: "unverified", label: "Sin verificar · perfil incompleto"};
    }
    const matches = [1, 2, 3, 4].filter(memory =>
      this._sameProgramExceptC01(profile.segmentos, memories[String(memory)]));
    if (!matches.length) return {kind: "none", label: "Sin coincidencia con memorias del horno"};
    const numbers = matches.length === 1 ? String(matches[0]) :
      matches.slice(0, -1).join(", ") + " y " + matches[matches.length - 1];
    return {kind: "match", label: `Coincide con ${matches.length === 1 ? "memoria" : "memorias"} ${numbers} del horno`};
  }

  _renderMemoryInventory() {
    const memories = this._verifiedPhysicalMemories();
    return [1, 2, 3, 4].map(memory => {
      if (!memories) {
        return `<div class="physical-slot unavailable" aria-label="Memoria ${memory}, sin lectura confirmada">
          <span class="slot-number">${memory}</span><span class="slot-text">Sin datos
          <small>Lectura no disponible</small></span></div>`;
      }
      const segments = memories[String(memory)];
      const hasProgram = segments.slice(0, 19).some(s => Number(s.tiempo) > 0);
      if (!hasProgram) {
        return `<div class="physical-slot empty" aria-label="Memoria ${memory}, sin tramos programados">
          <span class="slot-number">${memory}</span><span class="slot-text">Vacía
          <small>Sin tramos temporizados</small></span></div>`;
      }
      const matches = this._matchingProfilesForMemory(memory, memories);
      const ambiguous = matches.length > 1;
      const text = matches.length === 1 ? matches[0].nombre :
        ambiguous ? `${matches.length} perfiles coincidentes` : "Desconocida";
      const description = matches.length === 1 ? "Ir al perfil" :
        ambiguous ? "Elegir perfil" : "Crear perfil desde esta memoria";
      const expanded = ambiguous && this._memoryChoice === memory;
      return `<div class="physical-slot-wrap">
        <button type="button" class="physical-slot ${matches.length ? "known" : "unknown"}"
          data-action="open-physical-memory" data-memory="${memory}"
          aria-expanded="${expanded}" title="${this._escapeAttribute(description)}">
          <span class="slot-number">${memory}</span>
          <span class="slot-text">${this._escapeHtml(text)}<small>${description}</small></span>
          <span aria-hidden="true" class="slot-chevron">›</span>
        </button>
        ${expanded ? `<div class="physical-slot-choices" aria-label="Perfiles que coinciden con memoria ${memory}">
          ${matches.map(match => `<button type="button" data-action="jump-to-profile"
            data-profile-id="${this._escapeAttribute(match.id)}">${this._escapeHtml(match.nombre)}</button>`).join("")}
        </div>` : ""}
      </div>`;
    }).join("");
  }

  _openPhysicalMemory(memory) {
    if (!Number.isInteger(memory) || memory < 1 || memory > 4) return;
    const memories = this._verifiedPhysicalMemories();
    if (!memories) {
      this._showNotification("No hay una lectura Modbus confirmada de las cuatro memorias.", "error");
      return;
    }
    const segments = memories[String(memory)];
    if (!segments.slice(0, 19).some(s => Number(s.tiempo) > 0)) return;
    const matches = this._matchingProfilesForMemory(memory, memories);
    if (matches.length === 1) {
      this._jumpToProfile(matches[0].id);
    } else if (matches.length > 1) {
      this._memoryChoice = this._memoryChoice === memory ? null : memory;
      const inventory = this.querySelector("[data-memory-inventory]");
      if (inventory) inventory.innerHTML = this._renderMemoryInventory();
    } else {
      // Copia LOCAL de una lectura validada. No se graba un perfil ni se
      // escribe un registro Modbus antes de que el usuario pulse Guardar.
      this._draft = {
        id: null, nombre: "", descripcion: "", creado: null, actualizado: null,
        segmentos: this._cloneSegments(segments),
      };
      this._editingProfileId = null;
      this._originalDraft = JSON.stringify(this._draft);
      this._importedFromMemory = memory;
      this._view = "editor";
      this._render();
      this.querySelector('[data-field="profile-name"]')?.focus();
    }
  }

  _jumpToProfile(profileId) {
    const card = [...this.querySelectorAll("[data-profile-card]")].find(
      element => element.dataset.profileCard === profileId);
    if (!card) return;
    this.querySelectorAll(".profile-card.profile-highlight").forEach(
      element => element.classList.remove("profile-highlight"));
    card.classList.add("profile-highlight");
    card.scrollIntoView({behavior: "smooth", block: "center"});
  }

  _profileMetrics(segments) {
    const last = this._lastTimedTramo(segments);
    if (last === null) return {maximum: null, minutes: 0};
    const finals = segments.slice(1, last + 1).map(s => Number(s?.temperatura));
    const validFinals = finals.filter(Number.isFinite);
    const minutes = segments.slice(0, last).reduce((sum, s) => {
      const t = Number(s?.tiempo);
      return sum + (Number.isFinite(t) && t > 0 ? t : 0);
    }, 0);
    return {maximum: validFinals.length ? Math.max(...validFinals) : null, minutes};
  }

  _formatMinutes(total) {
    const minutes = Math.round(Number(total) || 0);
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
  }

  _refreshPhysicalBadges() {
    if (this._view !== "list") return;
    const profiles = this._getProfiles();
    const memories = this._verifiedPhysicalMemories();
    this.querySelectorAll("[data-physical-match]").forEach(badge => {
      const profile = profiles[badge.dataset.physicalMatch];
      const info = this._physicalMatchInfo(profile, memories);
      if (badge.textContent !== info.label) badge.textContent = info.label;
      badge.className = `physical-match ${info.kind}`;
    });
  }

  _getProfile(profileId) {
    const profiles = this._getProfiles();

    if (!profiles || !profiles[profileId]) {
      return null;
    }

    return profiles[profileId];
  }

  _getProfileCount() {
    return Object.keys(this._getProfiles()).length;
  }

  _isEntityUnavailable() {
    const entity = this._getEntityState();

    if (!entity) {
      return true;
    }

    return (
      entity.state === "unknown" ||
      entity.state === "unavailable"
    );
  }

  /* ========================================================================
   * Utilidades
   * ======================================================================== */

  _escapeHtml(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _escapeAttribute(value) {
    return this._escapeHtml(value);
  }

  _formatDate(value) {
    if (!value || typeof value !== "string") {
      return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    try {
      return new Intl.DateTimeFormat("es-ES", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
    } catch (error) {
      return value;
    }
  }

  _showNotification(message, type = "info") {
    this._notification = {
      message,
      type,
    };

    this._render();

    window.clearTimeout(this._notificationTimer);

    this._notificationTimer = window.setTimeout(() => {
      this._notification = null;
      this._render();
    }, 4500);
  }

  _cloneSegments(segments) {
    if (!Array.isArray(segments)) {
      return this._createEmptySegments();
    }

    return Array.from(
      { length: 20 },
      (_, index) => {
        const source = segments[index];

        const temperature = this._safeInteger(
          source?.temperatura,
          0,
        );

        const duration = this._safeInteger(
          source?.tiempo,
          0,
        );

        return {
          segmento: index + 1,
          temperatura: temperature,
          tiempo: duration,
        };
      },
    );
  }

  _createEmptySegments() {
    return Array.from(
      { length: 20 },
      (_, index) => ({
        segmento: index + 1,
        temperatura: index === 0 ? 1 : 0,
        tiempo: 0,
      }),
    );
  }

  _safeInteger(value, fallback = 0) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      value === "unknown" ||
      value === "unavailable"
    ) {
      return fallback;
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.trunc(number);
  }

  /* ========================================================================
   * Creación / edición de borrador
   * ======================================================================== */

  _createNewDraft() {
    this._draft = {
      id: null,
      nombre: "",
      descripcion: "",
      creado: null,
      actualizado: null,
      segmentos: this._createEmptySegments(),
    };
    this._importedFromMemory = null;

    this._editingProfileId = null;
    this._originalDraft = JSON.stringify(this._draft);
    this._view = "editor";

    this._render();

    window.setTimeout(() => {
      const input = this.querySelector(
        '[data-field="profile-name"]',
      );

      if (input) {
        input.focus();
      }
    }, 50);
  }

  _editProfile(profileId) {
    const profile = this._getProfile(profileId);

    if (!profile) {
      this._showNotification(
        "No se ha encontrado la curva seleccionada.",
        "error",
      );
      return;
    }

    this._editingProfileId = profileId;
    this._importedFromMemory = null;

    this._draft = {
      id: profile.id || profileId,
      nombre: profile.nombre || "",
      descripcion: profile.descripcion || "",
      creado: profile.creado || null,
      actualizado: profile.actualizado || null,
      segmentos: this._cloneSegments(
        profile.segmentos,
      ),
    };

    this._originalDraft = JSON.stringify(this._draft);
    this._view = "editor";

    this._render();
  }

  _duplicateProfile(profileId) {
    this._callService(
      "duplicate_profile",
      {
        profile_id: profileId,
      },
      "Curva duplicada correctamente.",
    );
  }

  /* ========================================================================
   * Servicios Home Assistant
   * ======================================================================== */

  async _callService(
    service,
    data,
    successMessage = null,
  ) {
    if (!this._hass) {
      this._showNotification(
        "Home Assistant todavía no está disponible.",
        "error",
      );
      return false;
    }

    try {
      await this._hass.callService(
        "cjd9000p_curves",
        service,
        data,
      );

      if (successMessage) {
        this._showNotification(
          successMessage,
          "success",
        );
      }
      return true;
    } catch (error) {
      console.error(
        "CJD-9000P Curvas:",
        error,
      );

      const message =
        error?.message ||
        "No se pudo ejecutar la operación.";

      this._showNotification(
        message,
        "error",
      );
      return false;
    }
  }

  async _saveDraft() {
    if (!this._draft) {
      return;
    }

    const name = this._draft.nombre.trim();

    if (!name) {
      this._showNotification(
        "El nombre de la curva no puede estar vacío.",
        "error",
      );
      return;
    }

    if (!Array.isArray(this._draft.segmentos)) {
      this._showNotification(
        "La curva no contiene los 20 segmentos.",
        "error",
      );
      return;
    }

    if (this._draft.segmentos.length !== 20) {
      this._showNotification(
        "La curva debe contener exactamente 20 segmentos.",
        "error",
      );
      return;
    }

    const segments = [];
    for (let index = 0; index < 20; index++) {
      const segment = this._draft.segmentos[index];
      const rawTemperature = String(segment.temperatura ?? "").trim();
      const rawTime = String(segment.tiempo ?? "").trim();
      if (!/^\d+$/.test(rawTemperature) || Number(rawTemperature) > 1200) {
        this._showNotification(
          `Temperatura inválida en el segmento ${index + 1} (0–1200 °C, entero).`,
          "error",
        );
        return;
      }
      if (!/^\d+$/.test(rawTime) || Number(rawTime) > 999) {
        this._showNotification(
          `Tiempo inválido en el segmento ${index + 1} (0–999 min, entero).`,
          "error",
        );
        return;
      }
      segments.push({
        segmento: index + 1,
        temperatura: Number(rawTemperature),
        tiempo: Number(rawTime),
      });
    }

    const data = {
      name,
      description:
        this._draft.descripcion.trim(),
      segments,
    };

    if (this._editingProfileId) {
      data.profile_id = this._editingProfileId;

      if (!await this._callService(
        "update_profile",
        data,
        "Curva guardada correctamente.",
      )) return;
    } else {
      if (!await this._callService(
        "create_profile",
        data,
        "Curva creada correctamente.",
      )) return;
    }

    this._view = "list";
    this._draft = null;
    this._originalDraft = null;
    this._editingProfileId = null;
    this._importedFromMemory = null;

    this._render();
  }

  _deleteProfile(profileId) {
    const profile = this._getProfile(profileId);

    if (!profile) {
      return;
    }

    this._confirmDeleteProfileId = profileId;

    this._render();
  }

  async _confirmDelete() {
    const profileId =
      this._confirmDeleteProfileId;

    if (!profileId) {
      return;
    }

    this._confirmDeleteProfileId = null;

    await this._callService(
      "delete_profile",
      {
        profile_id: profileId,
      },
      "Curva eliminada correctamente.",
    );

    this._render();
  }

  _cancelDelete() {
    this._confirmDeleteProfileId = null;
    this._render();
  }

  _openLoadDialog(profileId) {
    const profile = this._getProfile(profileId);

    if (!profile) {
      return;
    }

    this._editingProfileId = profileId;
    this._selectedMemory = 1;
    this._view = "load";

    this._render();
  }

  async _loadProfile() {
    if (!this._editingProfileId) {
      return;
    }

    const profile = this._getProfile(
      this._editingProfileId,
    );

    if (!profile) {
      this._showNotification(
        "La curva seleccionada ya no existe.",
        "error",
      );
      return;
    }

    if (!await this._callService(
      "load_profile",
      {
        profile_id: this._editingProfileId,
        memoria_destino: this._selectedMemory,
      },
      "Solicitud enviada por MQTT. Espera el resultado de Python para confirmar la escritura.",
    )) return;

    this._view = "list";
    this._editingProfileId = null;

    this._render();
  }

  /* ========================================================================
   * Eventos
   * ======================================================================== */

  _handleClick(event) {
    /*
     * Delegación robusta de eventos.
     *
     * No utilizamos:
     *
     *   event.target.closest(...)
     *
     * porque algunos elementos internos de Home Assistant pueden
     * interferir con la resolución del target.
     *
     * composedPath() nos permite localizar directamente el elemento
     * que contiene data-action.
     */

    const path =
      typeof event.composedPath === "function"
        ? event.composedPath()
        : [];

    const target = path.find(
      (node) =>
        node &&
        node.dataset &&
        node.dataset.action,
    );

    if (!target) {
      return;
    }

    const action = target.dataset.action;

    /*
     * Evitamos que otros listeners externos interfieran con las
     * acciones de nuestra tarjeta.
     */
    event.preventDefault();
    event.stopPropagation();

    switch (action) {
      case "new":
        this._createNewDraft();
        break;

      case "open-physical-memory":
        this._openPhysicalMemory(Number(target.dataset.memory));
        break;

      case "jump-to-profile":
        this._jumpToProfile(target.dataset.profileId);
        break;

      case "edit":
        this._editProfile(
          target.dataset.profileId,
        );
        break;

      case "duplicate":
        this._duplicateProfile(
          target.dataset.profileId,
        );
        break;

      case "delete":
        this._deleteProfile(
          target.dataset.profileId,
        );
        break;

      case "cancel-delete":
        this._cancelDelete();
        break;

      case "confirm-delete":
        this._confirmDelete();
        break;

      case "cancel-editor":
        this._cancelEditor();
        break;

      case "save":
        this._saveDraft();
        break;

      case "load":
        this._openLoadDialog(
          target.dataset.profileId,
        );
        break;

      case "confirm-load":
        this._loadProfile();
        break;

      case "cancel-load":
        this._cancelLoadDialog();
        break;

      case "select-memory": {
        const memory = Number(
          target.dataset.memory,
        );

        if (
          Number.isInteger(memory) &&
          memory >= 1 &&
          memory <= 4
        ) {
          this._selectedMemory = memory;

        /*
         * Volvemos a dibujar únicamente después de cambiar
         * la memoria seleccionada.
         */
          this._render();
        }

        break;
      }
    }
  }

  _handleInput(event) {
    const target = event.target;

    if (!target || !target.dataset) {
      return;
    }

    if (!this._draft) {
      return;
    }

    const field = target.dataset.field;

    if (field === "profile-name") {
      this._draft.nombre = target.value;
      return;
    }

    if (field === "profile-description") {
      this._draft.descripcion = target.value;
      return;
    }

    if (field === "temperature") {
      const index = Number(
        target.dataset.index,
      );

      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < 20
      ) {
        this._draft.segmentos[index].temperatura = target.value;
        // Reflejar en la siguiente fila el nuevo origen sin sustituir inputs:
        // conserva foco, cursor, selección y scroll durante la edición.
        const inherited = this.querySelector(`[data-start-temp="${index}"]`);
        if (inherited) inherited.textContent = `${target.value === '' ? '—' : target.value} °C`;
        this._updateGraphOnly();
      }

      return;
    }

    if (field === "time") {
      const index = Number(
        target.dataset.index,
      );

      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < 20
      ) {
        this._draft.segmentos[index].tiempo = target.value;
        if (index < 19) this._updateGraphOnly();
      }
    }
  }

  _handleChange(event) {
    const target = event.target;

    if (!target || !target.dataset) {
      return;
    }

    if (
      target.dataset.field === "memory"
    ) {
      const value = Number(
        target.value,
      );

      if (
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 4
      ) {
        this._selectedMemory = value;
      }
    }
  }

  /* ========================================================================
   * Navegación
   * ======================================================================== */

  _cancelEditor() {
    if (this._draft && this._originalDraft &&
        JSON.stringify(this._draft) !== this._originalDraft &&
        !window.confirm("Hay cambios sin guardar. ¿Descartarlos?")) return;
    this._draft = null;
    this._originalDraft = null;
    this._editingProfileId = null;
    this._importedFromMemory = null;
    this._view = "list";

    this._render();
  }

  _cancelLoadDialog() {
    this._editingProfileId = null;
    this._view = "list";

    this._render();
  }

  /* ========================================================================
   * Render principal
   * ======================================================================== */

  _render() {
    if (!this.isConnected) {
      return;
    }

    if (!this._hass) {
      this.innerHTML = `
        <ha-card>
          <div class="loading">
            Esperando a Home Assistant…
          </div>
        </ha-card>
      `;

      this._applyStyles();
      return;
    }

    let content = "";

    if (this._view === "editor") {
      content = this._renderEditor();
    } else if (this._view === "load") {
      content = this._renderLoadDialog();
    } else {
      content = this._renderList();
    }

    this.innerHTML = `
      <ha-card>
        ${content}
      </ha-card>
    `;

    this._applyStyles();
  }

  /* ========================================================================
   * Lista de curvas
   * ======================================================================== */

  _renderList() {
    const profiles = this._getProfiles();
    const profileIds = Object.keys(
      profiles,
    );

    const unavailable =
      this._isEntityUnavailable();

    const notification =
      this._renderNotification();

    const cards = profileIds.map(
      (profileId) =>
        this._renderProfileCard(
          profiles[profileId],
        ),
    );

    return `
      <div class="card">
        <div class="header">
          <div>
            <div class="eyebrow">
              CJD-9000P
            </div>

            <h1>Mis curvas</h1>

            <div class="subtitle">
              Perfiles de curvas almacenados
              en Home Assistant
            </div>
          </div>

          <button
            class="primary-button"
            data-action="new"
            title="Crear una nueva curva"
          >
            <span class="button-icon">＋</span>
            Nueva curva
          </button>
        </div>

        ${notification}

        ${
          unavailable
            ? `
              <div class="warning">
                <span class="warning-icon">⚠</span>
                <div>
                  <strong>
                    Datos de curvas no disponibles
                  </strong>
                  <div>
                    No se puede leer
                    ${this._escapeHtml(
                      this._config.entity,
                    )}
                    en este momento.
                  </div>
                </div>
              </div>
            `
            : ""
        }

        <div class="summary">
          <div class="summary-item">
            <span class="summary-value">${profileIds.length}</span>
            <span class="summary-label">${profileIds.length === 1 ? "curva guardada" : "curvas guardadas"}</span>
          </div>
          <div class="summary-separator"></div>
          <div class="summary-item">
            <span class="summary-icon">▦</span>
            <span class="summary-label">20 registros (19 tramos) por memoria</span>
          </div>
          <div class="summary-separator"></div>
          <div class="summary-item">
            <span class="summary-icon">▣</span>
            <span class="summary-label">4 memorias físicas</span>
          </div>
        </div>

        <section class="inventory-section" aria-label="Memorias del programador físico">
          <div class="inventory-heading">
            <h2>Memorias en el programador</h2>
            <span>Selecciona una memoria para abrir o crear un perfil</span>
          </div>
          <div class="physical-inventory" data-memory-inventory>
            ${this._renderMemoryInventory()}
          </div>
        </section>

        ${
          profileIds.length === 0
            ? this._renderEmptyState()
            : `
              <div class="profiles">
                ${cards.join("")}
              </div>
            `
        }

        <div class="footer-note">
          Editar una curva no modifica el programador.
          Solo <strong>Cargar en programador</strong>
          envía una curva mediante MQTT.
        </div>
      </div>

      ${this._renderDeleteDialog()}
    `;
  }

  _renderEmptyState() {
    return `
      <div class="empty">
        <div class="empty-icon">
          ⌁
        </div>

        <h2>
          Todavía no tienes curvas guardadas
        </h2>

        <p>
          Crea tu primera curva para comenzar
          a construir tu biblioteca de programas.
        </p>

        <button
          class="primary-button"
          data-action="new"
        >
          ＋ Crear primera curva
        </button>
      </div>
    `;
  }

  _renderProfileCard(profile) {
    if (!profile) {
      return "";
    }

    const profileId =
      profile.id || "";

    const name =
      profile.nombre ||
      profileId ||
      "Sin nombre";

    const description =
      profile.descripcion ||
      "";

    const segments =
      Array.isArray(profile.segmentos)
        ? profile.segmentos
        : [];
    const physicalMatch = this._physicalMatchInfo(profile);
    const metrics = this._profileMetrics(segments);

    return `
      <article class="profile-card" data-profile-card="${this._escapeAttribute(profileId)}">

        <div class="profile-main">

          <div class="profile-heading">

            <div>
              <div class="profile-title-row">
                <h2>
                  ${this._escapeHtml(name)}
                </h2>
                <span class="physical-match ${physicalMatch.kind}"
                  data-physical-match="${this._escapeAttribute(profileId)}"
                  >${this._escapeHtml(physicalMatch.label)}</span>
              </div>

            </div>

            <div class="profile-metrics">
              <span class="metric-pill">♨ ${metrics.maximum === null ? "—" : `${metrics.maximum} °C`} máx.</span>
              <span class="metric-pill">◷ ${this._formatMinutes(metrics.minutes)} programados</span>
            </div>
          </div>

          ${
            description
              ? `
                <p class="profile-description">
                  ${this._escapeHtml(
                    description,
                  )}
                </p>
              `
              : `
                <p class="profile-description empty-description">
                  Sin descripción
                </p>
              `
          }

          <div class="profile-meta">

            <span>
              Creada:
              ${this._formatDate(
                profile.creado,
              )}
            </span>

            <span>
              Modificada:
              ${this._formatDate(
                profile.actualizado,
              )}
            </span>

          </div>

        </div>

        <!-- Información de la curva y gráfica son secciones independientes. -->
        <div class="mini-graph" aria-label="Vista previa de la curva">
          ${this._renderMiniGraph(segments)}
        </div>

        <div class="profile-actions">

          <button
            class="action-button primary-outline"
            data-action="load"
            data-profile-id="${this._escapeAttribute(
              profileId,
            )}"
          >
            <span>⇧</span>
            Cargar
          </button>

          <button
            class="action-button"
            data-action="edit"
            data-profile-id="${this._escapeAttribute(
              profileId,
            )}"
          >
            ✎ Editar
          </button>

          <button
            class="action-button"
            data-action="duplicate"
            data-profile-id="${this._escapeAttribute(
              profileId,
            )}"
          >
            ⧉ Duplicar
          </button>

          <button
            class="action-button danger"
            data-action="delete"
            data-profile-id="${this._escapeAttribute(
              profileId,
            )}"
          >
            ♲ Eliminar
          </button>

        </div>

      </article>
    `;
  }

  /* ========================================================================
   * V7.5 · Interpretación VISUAL por tramos (sin alterar registros)
   * C01 --t01--> C02 --t02--> C03 ... C19 --t19--> C20
   * t20 queda guardado y editable, sin inventar un C21.
   * El último tramo graficable es el que posee la última duración > 0.
   * Se respetan los ceros intermedios: posición temporal instantánea.
   * ======================================================================== */

  _lastTimedTramo(segments) {
    if (!Array.isArray(segments) || segments.length !== 20) return null;
    let last = null;
    for (let index = 0; index < 19; index++) {
      const raw = segments[index]?.tiempo;
      const time = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
      if (Number.isFinite(time) && time > 0) last = index + 1;
    }
    return last;
  }

  _programTramos(segments) {
    if (!Array.isArray(segments) || segments.length !== 20) return [];
    const last = this._lastTimedTramo(segments);
    if (last === null) return [];
    const tramos = [];
    for (let index = 0; index < last; index++) {
      const start = Number(segments[index]?.temperatura);
      const end = Number(segments[index + 1]?.temperatura);
      const minutes = Number(segments[index]?.tiempo);
      if (![start, end, minutes].every(Number.isFinite)) return [];
      tramos.push({ numero: index + 1, inicio: start, final: end, tiempo: minutes });
    }
    return tramos;
  }

  /* ========================================================================
   * Editor
   * ======================================================================== */

  _renderEditor() {
    if (!this._draft) {
      return "";
    }

    const editing =
      Boolean(this._editingProfileId);

    const segments =
      this._draft.segmentos ||
      this._createEmptySegments();

    return `
      <div class="card">

        <div class="editor-header">

          <button
            class="back-button"
            data-action="cancel-editor"
          >
            ← Mis curvas
          </button>

          <div>
            <div class="eyebrow">
              ${editing ? "EDITAR CURVA" : "NUEVA CURVA"}
            </div>

            <h1>
              ${
                editing
                  ? "Editar curva"
                  : "Crear nueva curva"
              }
            </h1>

            <div class="subtitle">
              Los cambios se guardan en Home Assistant.
              No modifican el programador.
            </div>

          </div>

        </div>

        <div class="editor-top">

          <div class="profile-form">

            <label>
              <span>Nombre de la curva</span>

              <input
                type="text"
                data-field="profile-name"
                value="${this._escapeAttribute(
                  this._draft.nombre,
                )}"
                placeholder="Ej.: Fusing 6mm"
                maxlength="100"
              />
            </label>

            <label>
              <span>Descripción</span>

              <textarea
                data-field="profile-description"
                placeholder="Descripción opcional"
                rows="5"
                maxlength="500"
              >${this._escapeHtml(
                this._draft.descripcion,
              )}</textarea>
            </label>

            ${editing ? `<div class="technical-info"><div>
              <span>Última modificación</span><strong>${this._formatDate(this._draft.actualizado || this._draft.creado)}</strong>
            </div></div>` : ""}

          </div>

          <div class="large-graph">
            ${this._renderLargeGraph(
              segments,
            )}
          </div>

        </div>

        <div class="segments-header">

          <div>
            <h2>
              Programa térmico · 19 recorridos posibles
            </h2>

            <p>Cada tramo muestra la temperatura inicial, su duración y la temperatura final.
              La temperatura inicial de los siguientes tramos se hereda del anterior.</p>
            <p class="pv-explanation"><strong>PV</strong> significa temperatura real de la sonda.
              Al iniciar desde Home Assistant, C01 se adaptará a la temperatura de la sonda antes de RUN.</p>
            ${this._importedFromMemory ? `<p class="import-note">Datos recuperados de la memoria ${this._importedFromMemory}.
              Revisa y guarda el perfil si deseas incorporarlo a «Mis curvas». C01 se adaptará a PV al iniciar.</p>` : ""}

          </div>

          <div class="range-info">
            Temperatura: 0–1200 °C
            <br />
            Tiempo: 0–999 min
          </div>

        </div>

        <div class="segments-table-wrapper">

          <table class="segments-table">

            <thead>
              <tr>
                <th>TRAMO</th>
                <th>Tª INICIAL °C</th>
                <th>DURACIÓN min</th>
                <th>Tª FINAL °C</th>
              </tr>
            </thead>

            <tbody>
              ${segments.slice(0, 19)
                .map((segment, index) =>
                  this._renderSegmentRow(segments, index),
                )
                .join("")}
            </tbody>

          </table>

        </div>

        <!-- t20 se conserva internamente sin editarlo en esta pantalla. -->

        <div class="editor-footer">

          <button
            class="secondary-button"
            data-action="cancel-editor"
          >
            Cancelar
          </button>

          <button
            class="primary-button save-button"
            data-action="save"
          >
            ✓ Guardar curva
          </button>

        </div>

      </div>
    `;
  }

  _renderSegmentRow(segments, index) {
    // Solamente C01 es entrada inicial independiente.
    // Para el tramo N, la temperatura final es siempre C_(N+1).
    const from = this._safeInteger(segments[index]?.temperatura, 0);
    const to = this._safeInteger(segments[index + 1]?.temperatura, 0);
    const minutes = this._safeInteger(segments[index]?.tiempo, 0);
    return `
      <tr data-tramo="${index + 1}">
        <td class="segment-number">${index + 1}</td>
        <td>
          ${index === 0 ? `
            <span class="tramo-start tramo-pv" title="Temperatura real del horno al iniciar la cocción">PV</span>
          ` : `
            <span class="tramo-start" data-start-temp="${index}"
              title="Temperatura heredada de la fila anterior (C${String(index+1).padStart(2, '0')})"
            >${from} °C</span>
          `}
        </td>
        <td>
          <input type="number" min="0" max="999" step="1"
            aria-label="Duración del tramo ${index+1}, t${String(index+1).padStart(2, '0')}"
            data-field="time" data-index="${index}"
            value="${minutes}" />
        </td>
        <td>
          <input type="number" min="0" max="1200" step="1"
            aria-label="Temperatura final del tramo ${index+1}, C${String(index+2).padStart(2, '0')}"
            data-field="temperature" data-index="${index + 1}"
            value="${to}" />
        </td>
      </tr>
    `;
  }

  /* ========================================================================
   * Diálogo de carga
   * ======================================================================== */

  _renderLoadDialog() {
    const profile =
      this._getProfile(
        this._editingProfileId,
      );

    if (!profile) {
      return `
        <div class="card">
          <div class="warning">
            No se ha encontrado la curva.
          </div>
        </div>
      `;
    }

    const name =
      profile.nombre ||
      profile.id;

    return `
      <div class="card dialog-page">

        <div class="dialog-header">

          <button
            class="back-button"
            data-action="cancel-load"
          >
            ← Cancelar
          </button>

          <div>
            <div class="eyebrow">
              CARGAR EN PROGRAMADOR
            </div>

            <h1>
              ${this._escapeHtml(name)}
            </h1>

            <div class="subtitle">
              Selecciona la memoria física
              del CJD-9000P.
            </div>
          </div>

        </div>

        <div class="load-warning">

          <div class="load-warning-icon">
            ⚠
          </div>

          <div>
            <strong>
              Esta operación escribirá la memoria
              seleccionada del programador.
            </strong>

            <p>
              La curva guardada en Home Assistant
              no será modificada.
            </p>

            <p>
              Cargar la curva <strong>no inicia</strong>
              el horno.
            </p>
          </div>

        </div>

        <div class="memory-selector">

          <div class="memory-title">
            Memoria destino
          </div>

          <div class="memory-options">

            ${[1, 2, 3, 4]
              .map(
                (memory) => `
                  <button
                    type="button"
                    class="memory-option ${
                      this._selectedMemory === memory
                          ? "selected"
                          : ""
                    }"
                    data-action="select-memory"
                    data-memory="${memory}"
                    aria-pressed="${
                      this._selectedMemory === memory
                    }"
                  >

                    <span class="memory-number">
                      ${memory}
                    </span>

                    <span class="memory-label">
                      Memoria ${memory}
                    </span>

                  </button>
              `,
            )
            .join("")}

          </div>

        </div>

        <div class="load-preview">

          <div class="preview-title">
            Resumen de la curva
          </div>

          <div class="preview-grid">

            <div>
              <span>Nombre</span>
              <strong>
                ${this._escapeHtml(name)}
              </strong>
            </div>

            <div>
              <span>Temperatura máxima · Duración</span>
              <strong>${this._profileMetrics(profile.segmentos).maximum ?? "—"} °C · ${this._formatMinutes(this._profileMetrics(profile.segmentos).minutes)}</strong>
            </div>

            <div>
              <span>Memoria</span>
              <strong>
                ${this._selectedMemory}
              </strong>
            </div>

          </div>

        </div>

        <div class="editor-footer">

          <button
            class="secondary-button"
            data-action="cancel-load"
          >
            Cancelar
          </button>

          <button
            class="primary-button load-button"
            data-action="confirm-load"
          >
            ⇧ Cargar curva
          </button>

        </div>

      </div>
    `;
  }

  /* ========================================================================
   * Confirmación de borrado
   * ======================================================================== */

  _renderDeleteDialog() {
    if (!this._confirmDeleteProfileId) {
      return "";
    }

    const profile =
      this._getProfile(
        this._confirmDeleteProfileId,
      );

    if (!profile) {
      return "";
    }

    const name =
      profile.nombre ||
      profile.id;

    return `
      <div class="modal-backdrop">

        <div class="modal">

          <div class="modal-icon danger-icon">
            !
          </div>

          <h2>
            Eliminar curva
          </h2>

          <p>
            ¿Seguro que quieres eliminar
            <strong>
              ${this._escapeHtml(name)}
            </strong>?
          </p>

          <p class="modal-note">
            Esta acción elimina la curva de
            "Mis curvas". No modifica ninguna
            memoria del programador.
          </p>

          <div class="modal-actions">

            <button
              class="secondary-button"
              data-action="cancel-delete"
            >
              Cancelar
            </button>

            <button
              class="danger-button"
              data-action="confirm-delete"
            >
              Eliminar curva
            </button>

          </div>

        </div>

      </div>
    `;
  }

  /* ========================================================================
   * Gráfica
   * ======================================================================== */

  _renderMiniGraph(segments) {
    // La lista y el editor comparten los mismos tramos y la misma escala térmica.
    // La disposición horizontal se realiza con CSS y no modifica los datos.
    return this._renderLargeGraph(segments);
  }

  _temperatureAxisMax(temperatures) {
    const maximum = Math.max(0, ...temperatures.filter(Number.isFinite));
    // Mismo criterio del Control V7.5.1: ~10 % de margen y divisiones legibles.
    // Escala gráfica: admite mostrar curvas más altas sin recortar los valores.
    // Esto NO modifica la validación ni los límites de edición de registros.
    const target = Math.max(100, maximum * 1.10);
    const unit = target <= 500 ? 50 : target <= 1000 ? 100 : target <= 2000 ? 200 : 500;
    return Math.ceil(target / unit) * unit;
  }

  _renderLargeGraph(segments) {
    const width = 720;
    const height = 300;
    const points = this._buildGraphPoints(segments, width, height);
    if (!points.length) {
      return `<div class="large-graph-empty">Sin recorridos temporizados para mostrar</div>`;
    }
    const polyline = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const areaPoints = [
      `${points[0].x.toFixed(2)},${height - 35}`,
      polyline,
      `${points[points.length - 1].x.toFixed(2)},${height - 35}`,
    ].join(' ');
    const last = this._lastTimedTramo(segments);
    const totalMinutes = points[points.length - 1].elapsed;
    const axisMax = this._temperatureAxisMax(points.map(p => p.temperature));
    return `
      <svg class="large-graph-svg" data-profile-graph="true"
        viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"
        role="img" aria-label="Perfil térmico programado con ${last} tramos, ${totalMinutes} minutos">
        <line x1="45" y1="25" x2="700" y2="25" class="graph-grid" />
        <line x1="45" y1="150" x2="700" y2="150" class="graph-grid" />
        <line x1="45" y1="265" x2="700" y2="265" class="graph-axis" />
        <text x="4" y="30" class="graph-label">${axisMax}°</text>
        <text x="4" y="150" class="graph-label">${axisMax / 2}°</text>
        <text x="4" y="269" class="graph-label">0°</text>
        <polygon points="${areaPoints}" class="graph-area" />
        <polyline points="${polyline}" class="graph-line large" fill="none" />
        ${points.map((point,index) => `
          <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.8"
             class="graph-point">
            <title>${index === 0 ? 'C01 · Inicio automático (PV)' : `C${String(index+1).padStart(2,'0')} · Final del tramo ${index}: ${point.temperature} °C · ${point.elapsed} min`}</title>
          </circle>
        `).join('')}
        <text x="45" y="288" class="graph-label">0 min</text>
        <text x="700" y="288" text-anchor="end" class="graph-label">${totalMinutes} min programados</text>
      </svg>
    `;
  }

  _buildGraphPoints(segments, width, height) {
    const tramos = this._programTramos(segments);
    if (!tramos.length) return [];
    const left = 45, right = width - 20, top = 25, bottom = height - 35;
    const elapsed = [0];
    for (const tramo of tramos) {
      elapsed.push(elapsed[elapsed.length - 1] + Math.max(0, tramo.tiempo));
    }
    const total = elapsed[elapsed.length - 1];
    const temperatures = [tramos[0].inicio, ...tramos.map(t => t.final)];
    const axisMax = this._temperatureAxisMax(temperatures);
    return temperatures.map((temperature,index) => ({
      x: left + (right - left) * (total > 0
        ? elapsed[index] / total
        : index / Math.max(1, temperatures.length - 1)),
      y: bottom - (bottom - top) * Math.max(0, Math.min(axisMax,temperature)) / axisMax,
      elapsed: elapsed[index],
      temperature,
    }));
  }

  _updateGraphOnly() {
    const graph =
      this.querySelector(".large-graph");

    if (!graph || !this._draft) {
      return;
    }

    graph.innerHTML =
      this._renderLargeGraph(
        this._draft.segmentos,
      );
  }

  /* ========================================================================
   * Notificaciones
   * ======================================================================== */

  _renderNotification() {
    if (!this._notification) {
      return "";
    }

    const type =
      this._notification.type;

    const icon =
      type === "success"
        ? "✓"
        : type === "error"
          ? "!"
          : "i";

    return `
      <div class="notification ${type}">
        <span class="notification-icon">
          ${icon}
        </span>

        <span>
          ${this._escapeHtml(
            this._notification.message,
          )}
        </span>
      </div>
    `;
  }

  /* ========================================================================
   * Estilos
   * ======================================================================== */

  _applyStyles() {
    let style = this.querySelector("#cjd9000p-curves-style");

    if (!style) {
      style = document.createElement("style");
      style.id = "cjd9000p-curves-style";
      this.prepend(style);
    }

    style.textContent = `
       cjd9000p-curves-card-621 {
        /* Tipografía sencilla y legible, sin fuentes externas ni negritas excesivas. */
        font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-weight: 400;
        display: block;
        width: 100%;
        max-width: none;
        min-width: 0;

        --cjd-primary:
          #29bc6c;

        --cjd-primary-text:
          var(--text-primary-color, #ffffff);

        --cjd-text:
          var(--primary-text-color, #212121);

        --cjd-secondary-text:
          var(--secondary-text-color, #757575);

        --cjd-card:
          var(--ha-card-background,
            var(--card-background-color, #ffffff));

        --cjd-divider:
          var(--divider-color, rgba(127,127,127,0.2));

        --cjd-border:
          var(--ha-card-border-color,
            rgba(127,127,127,0.25));

        --cjd-background:
          var(--primary-background-color, #f7f7f7);

        --cjd-error:
          var(--error-color, #db4437);

        --cjd-warning:
          var(--warning-color, #f5a623);

        --cjd-success:
          var(--success-color, #43a047);
      }

       cjd9000p-curves-card-621 * {
        box-sizing: border-box;
      }

      cjd9000p-curves-card-621 button,
      cjd9000p-curves-card-621 input,
      cjd9000p-curves-card-621 textarea {
        font-family: inherit;
      }

      cjd9000p-curves-card-621 strong {
        font-weight: 600;
      }

       cjd9000p-curves-card-621 ha-card {
        display: block;
        width: 100%;
        max-width: none;
        min-width: 0;

        /*
         * No dejamos que un contenido interno fuerce un ancho
         * superior al disponible.
         */
        overflow: hidden;

        border-radius: 18px;
      }

       cjd9000p-curves-card-621 .card {
        display: block;
        width: 100%;
        max-width: none;
        min-width: 0;

        /*
         * El ancho lo determina el dashboard.
         * La tarjeta utiliza todo el espacio que recibe.
         */
        padding: 24px;
      }

       cjd9000p-curves-card-621 .header,
      cjd9000p-curves-card-621 .editor-header,
      cjd9000p-curves-card-621 .dialog-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 22px;
      }

       cjd9000p-curves-card-621 .eyebrow {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 1.6px;
        color: var(--cjd-primary);
        margin-bottom: 5px;
      }

       cjd9000p-curves-card-621 h1 {
        margin: 0;
        font-size: 27px;
        line-height: 1.15;
        font-weight: 500;
        color: var(--cjd-text);
      }

       cjd9000p-curves-card-621 h2 {
        color: var(--cjd-text);
      }

       cjd9000p-curves-card-621 .subtitle {
        margin-top: 7px;
        color: var(--cjd-secondary-text);
        font-size: 14px;
      }

       cjd9000p-curves-card-621 .primary-button,
      cjd9000p-curves-card-621 .secondary-button,
      cjd9000p-curves-card-621 .danger-button,
      cjd9000p-curves-card-621 .action-button,
      cjd9000p-curves-card-621 .back-button {
        border: 0;
        border-radius: 11px;
        min-height: 42px;
        padding: 0 17px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }

       cjd9000p-curves-card-621 button:hover,
      cjd9000p-curves-card-621 button:active {
        opacity: 1;
        transform: none;
        filter: none;
        box-shadow: none;
      }

       cjd9000p-curves-card-621 button:focus-visible {
        outline: 2px solid var(--cjd-primary);
        outline-offset: 3px;
      }

       cjd9000p-curves-card-621 .primary-button {
        background: var(--cjd-primary);
        color: var(--cjd-primary-text);
      }

       cjd9000p-curves-card-621 .secondary-button {
        background: var(--cjd-background);
        color: var(--cjd-text);
        border: 1px solid var(--cjd-border);
      }

       cjd9000p-curves-card-621 .danger-button {
        background: var(--cjd-error);
        color: #fff;
      }

       cjd9000p-curves-card-621 .button-icon {
        font-size: 19px;
        margin-right: 4px;
      }

       cjd9000p-curves-card-621 .back-button {
        background: transparent;
        color: var(--cjd-primary);
        padding-left: 0;
        padding-right: 5px;
      }

       cjd9000p-curves-card-621 .summary {
        display: flex;
        align-items: center;
        gap: 18px;
        border-top: 1px solid var(--cjd-divider);
        border-bottom: 1px solid var(--cjd-divider);
        padding: 14px 2px;
        margin-bottom: 20px;
      }

       cjd9000p-curves-card-621 .summary-item {
        display: flex;
        align-items: baseline;
        gap: 7px;
      }

       cjd9000p-curves-card-621 .summary-value {
        font-size: 22px;
        font-weight: 600;
        color: var(--cjd-text);
      }

       cjd9000p-curves-card-621 .summary-icon {
        font-size: 18px;
        color: var(--cjd-primary);
      }

       cjd9000p-curves-card-621 .summary-label {
        color: var(--cjd-secondary-text);
        font-size: 13px;
      }

       cjd9000p-curves-card-621 .summary-separator {
        width: 1px;
        height: 23px;
        background: var(--cjd-divider);
      }

       cjd9000p-curves-card-621 .profiles {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        /* El ancho útil de esta lista decide la distribución, incluso
           cuando Home Assistant la sitúa en una columna estrecha. */
        container-type: inline-size;
        container-name: cjd-profile-list;
      }

       cjd9000p-curves-card-621 .profile-card {
        border: 1px solid var(--cjd-border);
        border-radius: 15px;
        overflow: hidden;
        background: var(--cjd-card);
      }

       cjd9000p-curves-card-621 .profile-main {
        padding: 18px;
      }

       cjd9000p-curves-card-621 .profile-heading {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }

       cjd9000p-curves-card-621 .profile-heading h2 {
        margin: 0;
        font-size: 19px;
        line-height: 1.25;
        font-weight: 500;
      }

       cjd9000p-curves-card-621 .profile-title-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 12px;
      }

       cjd9000p-curves-card-621 .physical-match {
        display: inline-flex;
        align-items: center;
        max-width: 100%;
        padding: 5px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.4;
        overflow-wrap: anywhere;
        color: var(--cjd-secondary-text);
        background: var(--cjd-background);
        border: 1px solid var(--cjd-border);
      }

       cjd9000p-curves-card-621 .physical-match.match {
        color: var(--success-color, #15744a);
        border-color: var(--success-color, #15744a);
      }

       cjd9000p-curves-card-621 .profile-id {
        margin-top: 4px;
        font-family:
          ui-monospace,
          SFMono-Regular,
          Menlo,
          Monaco,
          Consolas,
          monospace;
        font-size: 11px;
        color: var(--cjd-secondary-text);
      }

       cjd9000p-curves-card-621 .segment-badge {
        white-space: nowrap;
        border-radius: 999px;
        padding: 6px 9px;
        background: var(--cjd-background);
        color: var(--cjd-secondary-text);
        font-size: 11px;
        font-weight: 500;
      }

       cjd9000p-curves-card-621 .profile-description {
        margin: 13px 0 10px;
        min-height: 19px;
        color: var(--cjd-secondary-text);
        font-size: 13px;
        line-height: 1.4;
      }

       cjd9000p-curves-card-621 .empty-description {
        opacity: 0.65;
        font-style: italic;
      }

       cjd9000p-curves-card-621 .profile-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 15px;
        color: var(--cjd-secondary-text);
        font-size: 11px;
      }

       cjd9000p-curves-card-621 .mini-graph {
        height: 300px;
        margin: 4px 18px 18px;
        border: 1px solid var(--cjd-border);
        border-radius: 12px;
        overflow: hidden;
        background:
          color-mix(
            in srgb,
            var(--cjd-primary) 3%,
            var(--cjd-card)
          );
      }

       cjd9000p-curves-card-621 .mini-graph .large-graph-svg {
        width: 100%;
        height: 300px;
      }

       cjd9000p-curves-card-621 .graph-svg {
        display: block;
        width: 100%;
        height: 100%;
      }

       cjd9000p-curves-card-621 .graph-axis {
        stroke: var(--cjd-divider);
        stroke-width: 1;
      }

       cjd9000p-curves-card-621 .graph-grid {
        stroke: var(--cjd-divider);
        stroke-width: 0.7;
        stroke-dasharray: 4 5;
      }

       cjd9000p-curves-card-621 .graph-line {
        stroke: var(--cjd-primary);
        stroke-width: 2.8;
        stroke-linejoin: round;
        stroke-linecap: round;
      }

       cjd9000p-curves-card-621 .graph-line.large {
        stroke-width: 3.5;
      }

       cjd9000p-curves-card-621 .graph-area {
        fill:
          color-mix(
            in srgb,
            var(--cjd-primary) 10%,
            transparent
          );
      }

       cjd9000p-curves-card-621 .graph-point {
        fill: var(--cjd-primary);
        stroke: var(--cjd-card);
        stroke-width: 2;
      }

       cjd9000p-curves-card-621 .graph-label {
        fill: var(--cjd-secondary-text);
        font-size: 11px;
      }

       cjd9000p-curves-card-621 .profile-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        padding: 12px;
        border-top: 1px solid var(--cjd-divider);
        background:
          color-mix(
            in srgb,
            var(--cjd-background) 45%,
            var(--cjd-card)
          );
      }

       cjd9000p-curves-card-621 .action-button {
        min-height: 36px;
        padding: 0 11px;
        font-size: 12px;
        background: transparent;
        color: var(--cjd-text);
        border: 1px solid var(--cjd-border);
      }

       cjd9000p-curves-card-621 .action-button.primary-outline {
        color: var(--cjd-primary);
        border-color: var(--cjd-primary);
        font-weight: 500;
      }

       cjd9000p-curves-card-621 .action-button.danger {
        color: var(--cjd-error);
      }

       cjd9000p-curves-card-621 .empty {
        padding: 55px 20px;
        text-align: center;
        border: 1px dashed var(--cjd-border);
        border-radius: 15px;
      }

       cjd9000p-curves-card-621 .empty-icon {
        font-size: 50px;
        color: var(--cjd-primary);
        opacity: 0.7;
      }

       cjd9000p-curves-card-621 .empty h2 {
        margin: 15px 0 8px;
        font-size: 20px;
      }

       cjd9000p-curves-card-621 .empty p {
        max-width: 470px;
        margin: 0 auto 20px;
        color: var(--cjd-secondary-text);
        line-height: 1.5;
      }

       cjd9000p-curves-card-621 .footer-note {
        margin-top: 20px;
        padding-top: 15px;
        border-top: 1px solid var(--cjd-divider);
        color: var(--cjd-secondary-text);
        font-size: 12px;
        line-height: 1.5;
      }

       cjd9000p-curves-card-621 .warning,
      cjd9000p-curves-card-621 .load-warning,
      cjd9000p-curves-card-621 .notification {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        border-radius: 12px;
        padding: 13px 15px;
        margin-bottom: 18px;
        font-size: 13px;
        line-height: 1.4;
      }

       cjd9000p-curves-card-621 .warning {
        background:
          color-mix(
            in srgb,
            var(--cjd-warning) 12%,
            transparent
          );
        border: 1px solid
          color-mix(
            in srgb,
            var(--cjd-warning) 35%,
            transparent
          );
      }

       cjd9000p-curves-card-621 .warning-icon,
      cjd9000p-curves-card-621 .load-warning-icon {
        font-size: 19px;
        color: var(--cjd-warning);
        font-weight: 600;
      }

       cjd9000p-curves-card-621 .notification {
        margin-bottom: 18px;
      }

       cjd9000p-curves-card-621 .notification.success {
        background:
          color-mix(
            in srgb,
            var(--cjd-success) 12%,
            transparent
          );
      }

       cjd9000p-curves-card-621 .notification.error {
        background:
          color-mix(
            in srgb,
            var(--cjd-error) 12%,
            transparent
          );
      }

       cjd9000p-curves-card-621 .notification-icon {
        font-weight: 600;
      }

       cjd9000p-curves-card-621 .loading {
        padding: 30px;
        text-align: center;
        color: var(--cjd-secondary-text);
      }

      /* Editor */

       cjd9000p-curves-card-621 .editor-top {
        display: grid;
        grid-template-columns:
          minmax(0, 0.85fr)
          minmax(0, 1.15fr);

        gap: 22px;
        width: 100%;
        min-width: 0;
        margin-bottom: 25px;
      }

       cjd9000p-curves-card-621 .editor-top > * {
        width: 100%;
        min-width: 0;
        max-width: 100%;
      }

       cjd9000p-curves-card-621 .profile-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

       cjd9000p-curves-card-621 .profile-form label {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }

       cjd9000p-curves-card-621 .profile-form label > span {
        font-size: 13px;
        font-weight: 500;
        color: var(--cjd-text);
      }

       cjd9000p-curves-card-621 .profile-form input,
      cjd9000p-curves-card-621 .profile-form textarea,
      cjd9000p-curves-card-621 .segments-table input {
        width: 100%;
        border: 1px solid var(--cjd-border);
        border-radius: 9px;
        background: var(--cjd-card);
        color: var(--cjd-text);
        padding: 10px 11px;
        font-size: 14px;
        outline: none;
      }

       cjd9000p-curves-card-621 .profile-form input:focus,
      cjd9000p-curves-card-621 .profile-form textarea:focus,
      cjd9000p-curves-card-621 .segments-table input:focus {
        border-color: var(--cjd-primary);
        box-shadow:
          0 0 0 2px
          color-mix(
            in srgb,
            var(--cjd-primary) 18%,
            transparent
          );
      }

       cjd9000p-curves-card-621 .profile-form textarea {
        resize: vertical;
        min-height: 100px;
      }

       cjd9000p-curves-card-621 .technical-info {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 10px;
        background: var(--cjd-background);
        color: var(--cjd-secondary-text);
        font-size: 11px;
      }

       cjd9000p-curves-card-621 .technical-info div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

       cjd9000p-curves-card-621 .technical-info strong {
        color: var(--cjd-text);
        font-family:
          ui-monospace,
          SFMono-Regular,
          Menlo,
          Monaco,
          Consolas,
          monospace;
      }

       cjd9000p-curves-card-621 .large-graph {
        width: 100%;
        min-width: 0;
        max-width: 100%;
        min-height: 300px;

        border: 1px solid var(--cjd-border);
        border-radius: 14px;

        overflow: hidden;

        background:
          color-mix(
            in srgb,
            var(--cjd-primary) 3%,
            var(--cjd-card)
          );
      }

       cjd9000p-curves-card-621 .large-graph-svg {
        display: block;
        width: 100%;
        max-width: 100%;
        height: 300px;
      }

       cjd9000p-curves-card-621 .large-graph-empty {
        min-height: 300px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--cjd-secondary-text);
      }

       cjd9000p-curves-card-621 .segments-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 15px;
        margin-bottom: 12px;
      }

       cjd9000p-curves-card-621 .segments-header h2 {
        margin: 0;
        font-size: 18px;
      }

       cjd9000p-curves-card-621 .segments-header p {
        margin: 4px 0 0;
        color: var(--cjd-secondary-text);
        font-size: 12px;
      }

       cjd9000p-curves-card-621 .range-info {
        color: var(--cjd-secondary-text);
        text-align: right;
        font-size: 11px;
        line-height: 1.5;
      }

       cjd9000p-curves-card-621 .segments-table-wrapper {
        overflow-x: auto;
        border: 1px solid var(--cjd-border);
        border-radius: 13px;
      }

       cjd9000p-curves-card-621 .segments-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 460px;
      }

       cjd9000p-curves-card-621 .segments-table th {
        text-align: left;
        padding: 11px 12px;
        background: var(--cjd-background);
        color: var(--cjd-secondary-text);
        font-size: 11px;
        letter-spacing: 0.5px;
      }

       cjd9000p-curves-card-621 .segments-table td {
        padding: 6px 9px;
        border-top: 1px solid var(--cjd-divider);
      }

       cjd9000p-curves-card-621 .segments-table td:first-child,
      cjd9000p-curves-card-621 .segments-table th:first-child {
        width: 90px;
      }

       cjd9000p-curves-card-621 .segments-table input {
        max-width: 220px;
        padding: 8px 10px;
      }

       cjd9000p-curves-card-621 .segment-number {
        font-weight: 600;
        color: var(--cjd-primary);
        text-align: center;
      }

       cjd9000p-curves-card-621 .tramo-start {
        display: inline-flex;
        align-items: center;
        min-height: 38px;
        padding: 8px 10px;
        font-weight: 500;
        color: var(--cjd-text);
        border-radius: 9px;
        background: color-mix(in srgb, var(--cjd-primary) 8%, var(--cjd-card));
        border: 1px solid var(--cjd-divider);
        white-space: nowrap;
      }
       cjd9000p-curves-card-621 .tramo-technical {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 14px 16px;
        margin-top: 14px;
        border: 1px solid var(--cjd-border);
        border-radius: 12px;
        background: var(--cjd-background);
      }
       cjd9000p-curves-card-621 .tramo-technical strong {font-size:13px;}
       cjd9000p-curves-card-621 .tramo-technical p {
        margin: 5px 0 0;
        max-width: 650px;
        color: var(--cjd-secondary-text);
        font-size: 12px;
        line-height: 1.5;
      }
       cjd9000p-curves-card-621 .tramo-technical-input {
        display: flex;
        flex-direction: column;
        gap: 5px;
        flex: 0 0 120px;
        font-size: 12px;
        font-weight: 500;
      }
       cjd9000p-curves-card-621 .tramo-technical-input input {
        width: 100%;
        background: var(--cjd-card);
        color: var(--cjd-text);
        border: 1px solid var(--cjd-border);
        border-radius: 9px;
        padding: 8px 10px;
        font: inherit;
      }
       cjd9000p-curves-card-621 .tramo-technical-input input:focus {
        outline: 2px solid var(--cjd-primary);
      }
       cjd9000p-curves-card-621 .editor-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 20px;
        padding-top: 17px;
        border-top: 1px solid var(--cjd-divider);
      }

       cjd9000p-curves-card-621 .save-button,
      cjd9000p-curves-card-621 .load-button {
        min-width: 160px;
      }

      /* Carga */

       cjd9000p-curves-card-621 .dialog-page {
        max-width: 900px;
        margin: 0 auto;
      }

       cjd9000p-curves-card-621 .load-warning {
        background:
          color-mix(
            in srgb,
            var(--cjd-warning) 11%,
            transparent
          );
        border: 1px solid
          color-mix(
            in srgb,
            var(--cjd-warning) 30%,
            transparent
          );
        padding: 18px;
      }

       cjd9000p-curves-card-621 .load-warning p {
        margin: 7px 0 0;
        color: var(--cjd-secondary-text);
      }

       cjd9000p-curves-card-621 .memory-selector {
        margin-top: 25px;
      }

       cjd9000p-curves-card-621 .memory-title,
      cjd9000p-curves-card-621 .preview-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--cjd-text);
        margin-bottom: 12px;
      }

       cjd9000p-curves-card-621 .memory-options {
        display: grid;

        /*
         * SIEMPRE 2 × 2:
         *
         * ┌─────────┐ ┌─────────┐
         * │ Memoria1│ │ Memoria2│
         * └─────────┘ └─────────┘
         * ┌─────────┐ ┌─────────┐
         * │ Memoria3│ │ Memoria4│
         * └─────────┘ └─────────┘
         */
        grid-template-columns:
          repeat(2, minmax(0, 1fr));

        gap: 10px;

        width: 100%;
        min-width: 0;
      }

       cjd9000p-curves-card-621 .memory-option {
        display: flex;
        align-items: center;

        gap: 9px;

        width: 100%;
        min-width: 0;
        min-height: 72px;

        padding: 13px;

        border: 1px solid var(--cjd-border);
        border-radius: 12px;

        cursor: pointer;

        color: var(--cjd-text);
        background: transparent;

        font: inherit;
        text-align: left;

        appearance: none;
        -webkit-appearance: none;

        transition:
          border-color 0.12s ease,
          background 0.12s ease,
          transform 0.08s ease;
      }

       cjd9000p-curves-card-621 .memory-option:hover {
        border-color: var(--cjd-primary);
      }

       cjd9000p-curves-card-621 .memory-option:focus-visible {
        outline: 2px solid var(--cjd-primary);
        outline-offset: 2px;
      }

       cjd9000p-curves-card-621 .memory-option:active {
        transform: scale(0.98);
      }

       cjd9000p-curves-card-621 .memory-option.selected {
        border-color: var(--cjd-primary);

        background:
          color-mix(
            in srgb,
            var(--cjd-primary) 8%,
            var(--cjd-card)
          );
      }

       cjd9000p-curves-card-621 .memory-number {
        display: flex;
        align-items: center;
        justify-content: center;

        width: 35px;
        height: 35px;

        flex: 0 0 35px;

        border-radius: 50%;

        background: var(--cjd-background);
        color: var(--cjd-primary);

        font-size: 16px;
        font-weight: 600;
      }

       cjd9000p-curves-card-621 .memory-label {
        min-width: 0;

        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        color: var(--cjd-text);
        font-size: 14px;
        font-weight: 500;
      }

       cjd9000p-curves-card-621 .load-preview {
        margin-top: 25px;
        padding: 17px;
        border-radius: 13px;
        background: var(--cjd-background);
      }

       cjd9000p-curves-card-621 .preview-grid {
        display: grid;
        grid-template-columns:
          repeat(3, 1fr);
        gap: 12px;
      }

       cjd9000p-curves-card-621 .preview-grid div {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

       cjd9000p-curves-card-621 .preview-grid span {
        color: var(--cjd-secondary-text);
        font-size: 11px;
      }

       cjd9000p-curves-card-621 .preview-grid strong {
        color: var(--cjd-text);
        font-size: 14px;
      }

      /* Modal */

       cjd9000p-curves-card-621 .modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(0, 0, 0, 0.42);
      }

       cjd9000p-curves-card-621 .modal {
        width: min(440px, 100%);
        padding: 25px;
        border-radius: 17px;
        background: var(--cjd-card);
        box-shadow:
          0 20px 70px rgba(0, 0, 0, 0.28);
      }

       cjd9000p-curves-card-621 .modal-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 43px;
        height: 43px;
        margin-bottom: 13px;
        border-radius: 50%;
        font-weight: 600;
        font-size: 22px;
      }

       cjd9000p-curves-card-621 .danger-icon {
        background:
          color-mix(
            in srgb,
            var(--cjd-error) 13%,
            transparent
          );
        color: var(--cjd-error);
      }

       cjd9000p-curves-card-621 .modal h2 {
        margin: 0 0 9px;
        font-size: 21px;
      }

       cjd9000p-curves-card-621 .modal p {
        color: var(--cjd-text);
        line-height: 1.5;
      }

       cjd9000p-curves-card-621 .modal-note {
        color: var(--cjd-secondary-text) !important;
        font-size: 13px;
      }

       cjd9000p-curves-card-621 .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        margin-top: 22px;
      }

      /* V7.5.1: perfiles compactos para escritorio/portátil. Se mantiene
         la tarjeta apilada original para móvil y columnas estrechas de HA.
         No cambiamos la distribución del editor. */
      @container cjd-profile-list (min-width: 800px) {
         cjd9000p-curves-card-621 .profile-card {
          display: grid;
          grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
          grid-template-rows: minmax(0, 1fr) auto;
          grid-template-areas: "details graph" "actions graph";
          column-gap: 14px;
          padding: 12px;
          align-items: stretch;
        }
         cjd9000p-curves-card-621 .profile-main {
          grid-area: details;
          padding: 7px 8px 12px;
          min-width: 0;
        }
         cjd9000p-curves-card-621 .mini-graph {
          grid-area: graph;
          min-width: 0;
          min-height: 265px;
          height: auto;
          margin: 0;
          display: flex;
          align-items: stretch;
          justify-content: center;
        }
         cjd9000p-curves-card-621 .mini-graph .large-graph-svg {
          height: 100%;
          min-height: 265px;
        }
         cjd9000p-curves-card-621 .profile-actions {
          grid-area: actions;
          align-self: end;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          padding: 8px;
          border-top: 1px solid var(--cjd-divider);
          background: transparent;
        }
         cjd9000p-curves-card-621 .profile-actions .action-button {
          width: 100%;
          min-width: 0;
          padding: 0 6px;
        }
      }

      @media (max-width: 900px) {
         cjd9000p-curves-card-621 .editor-top {
          grid-template-columns: 1fr;
        }
      }

      /* V7.6: inventario interactivo y tabla compacta sin scroll lateral. */
      cjd9000p-curves-card-621 .inventory-section { margin: 0 0 22px; }
      cjd9000p-curves-card-621 .inventory-heading {display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:5px 12px; margin-bottom:12px;}
      cjd9000p-curves-card-621 .inventory-heading h2 {margin:0; font-size:17px;}
      cjd9000p-curves-card-621 .inventory-heading>span {font-size:11px; color:var(--cjd-secondary-text);}
      cjd9000p-curves-card-621 .physical-inventory {display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px;}
      cjd9000p-curves-card-621 .physical-slot-wrap {min-width:0;}
      cjd9000p-curves-card-621 .physical-slot {appearance:none; display:flex; width:100%; min-width:0; min-height:72px; align-items:center; text-align:left; gap:9px; padding:10px; background:var(--cjd-background); border:1px solid var(--cjd-border); border-radius:12px; color:var(--cjd-text); font:inherit; overflow:hidden;}
      cjd9000p-curves-card-621 button.physical-slot {cursor:pointer;}
      cjd9000p-curves-card-621 .physical-slot.known {border-color:color-mix(in srgb,var(--cjd-primary) 58%,var(--cjd-border));}
      cjd9000p-curves-card-621 .physical-slot.unknown {border-style:dashed;}
      cjd9000p-curves-card-621 .physical-slot.unavailable {opacity:.65;}
      cjd9000p-curves-card-621 .slot-number {flex:none; display:flex; align-items:center; justify-content:center; width:29px; height:29px; border-radius:8px; background:color-mix(in srgb,var(--cjd-primary) 13%,var(--cjd-card)); color:var(--cjd-primary); font-size:16px; font-weight:600;}
      cjd9000p-curves-card-621 .slot-text {min-width:0; flex:1; font-size:12px; font-weight:500; overflow-wrap:anywhere; line-height:1.3;}
      cjd9000p-curves-card-621 .slot-text small {display:block; font-size:10px; font-weight:500; color:var(--cjd-secondary-text); margin-top:3px;}
      cjd9000p-curves-card-621 .slot-chevron {flex:none; font-size:22px; color:var(--cjd-primary);}
      cjd9000p-curves-card-621 .physical-slot-choices {margin-top:5px; display:flex; flex-direction:column; gap:4px;}
      cjd9000p-curves-card-621 .physical-slot-choices button {min-height:34px; padding:5px; border:1px solid var(--cjd-primary); background:var(--cjd-card); color:var(--cjd-text); border-radius:8px; cursor:pointer; font-size:11px; text-align:left;}
      cjd9000p-curves-card-621 .profile-highlight {border:2px solid var(--cjd-primary); box-shadow:0 0 0 3px color-mix(in srgb,var(--cjd-primary) 13%,transparent);}
      cjd9000p-curves-card-621 .profile-metrics {display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;}
      cjd9000p-curves-card-621 .metric-pill {background:color-mix(in srgb,var(--cjd-primary) 9%,var(--cjd-card)); border:1px solid var(--cjd-border); border-radius:99px; padding:5px 8px; font-size:11px; font-weight:500; white-space:nowrap;}
      cjd9000p-curves-card-621 .pv-explanation {padding:9px 12px; border-left:3px solid var(--cjd-primary); background:color-mix(in srgb,var(--cjd-primary) 8%,var(--cjd-card)); border-radius:6px;}
      cjd9000p-curves-card-621 .import-note {font-weight:600;}
      cjd9000p-curves-card-621 .segments-table-wrapper {overflow-x:hidden;}
      cjd9000p-curves-card-621 .segments-table {min-width:0; width:100%; table-layout:fixed;}
      cjd9000p-curves-card-621 .segments-table th:first-child, cjd9000p-curves-card-621 .segments-table td:first-child {width:12%;}
      cjd9000p-curves-card-621 .segments-table th:nth-child(2) {width:26%;}
      cjd9000p-curves-card-621 .segments-table th:nth-child(3) {width:29%;}
      cjd9000p-curves-card-621 .segments-table th:nth-child(4) {width:33%;}
      cjd9000p-curves-card-621 .segments-table th {padding:9px 4px; white-space:normal; overflow-wrap:anywhere; font-size:10px; letter-spacing:0; line-height:1.3;}
      cjd9000p-curves-card-621 .segments-table td {padding:6px 4px; min-width:0; overflow:hidden;}
      cjd9000p-curves-card-621 .segments-table input {display:block; width:100%; min-width:0; max-width:100%; padding:8px 5px; font-variant-numeric:tabular-nums; text-align:center; font-size:16px;}
      cjd9000p-curves-card-621 .segments-table input[type=number] {appearance:textfield; -moz-appearance:textfield;}
      cjd9000p-curves-card-621 .segments-table input[type=number]::-webkit-inner-spin-button, cjd9000p-curves-card-621 .segments-table input[type=number]::-webkit-outer-spin-button {appearance:none; -webkit-appearance:none; margin:0;}
      cjd9000p-curves-card-621 .tramo-start {max-width:100%; min-width:0; width:100%; justify-content:center; padding:7px 3px; font-size:12px; text-align:center;}
      cjd9000p-curves-card-621 .tramo-pv {color:var(--cjd-primary); font-size:15px; font-weight:600;}
      @media (max-width:680px) {cjd9000p-curves-card-621 .physical-inventory {grid-template-columns:repeat(2,minmax(0,1fr));}
        cjd9000p-curves-card-621 .profile-metrics {justify-content:flex-start;}
        cjd9000p-curves-card-621 .segments-table th {font-size:9px;}
      }

      @media (max-width: 600px) {
         cjd9000p-curves-card-621 .card {
          padding: 16px;
        }

         cjd9000p-curves-card-621 .header,
      cjd9000p-curves-card-621 .editor-header,
      cjd9000p-curves-card-621 .dialog-header {
          flex-direction: column;
        }

         cjd9000p-curves-card-621 .summary {
          flex-wrap: wrap;
        }

         cjd9000p-curves-card-621 .summary-separator {
          display: none;
        }

         cjd9000p-curves-card-621 .profiles {
          grid-template-columns: 1fr;
        }

         cjd9000p-curves-card-621 .profile-actions {
          display: grid;
          grid-template-columns:
            repeat(2, 1fr);
        }

         cjd9000p-curves-card-621 .profile-actions .action-button {
          width: 100%;
        }

         cjd9000p-curves-card-621 .segments-header {
          align-items: flex-start;
          flex-direction: column;
        }

         cjd9000p-curves-card-621 .range-info {
          text-align: left;
        }

         cjd9000p-curves-card-621 .editor-footer {
          flex-direction: column-reverse;
        }

         cjd9000p-curves-card-621 .editor-footer button {
          width: 100%;
        }

         cjd9000p-curves-card-621 .memory-options {
          grid-template-columns: 1fr 1fr;
        }

         cjd9000p-curves-card-621 .preview-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
  }
}


/* ==========================================================================
 * Registro del elemento personalizado
 * ========================================================================== */

if (!customElements.get("cjd9000p-curves-card-621")) {
  customElements.define(
    "cjd9000p-curves-card-621",
    Cjd9000pCurvesCard,
  );
}


/* ==========================================================================
 * Información para Home Assistant
 * ========================================================================== */

window.customCards = window.customCards || [];

window.customCards.push({
  type: "cjd9000p-curves-card-621",
  name: "CJD-9000P · Mis curvas V7.6 · PV y memorias",
  description:
    "Editor y gestor de curvas del CJD-9000P.",
  preview: true,
});