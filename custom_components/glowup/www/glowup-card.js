/* Carte Lovelace GlowUp TV : tout ce que l'API de la TV permet de lire et d'envoyer.
 *
 * Chargée automatiquement par l'intégration (aucune ressource à ajouter). L'éditeur visuel active ou non chaque section.
 * Les données (infos, config, état, apps, fonds) viennent du service glowup.get_data (intégration 0.3.0 ou plus).
 *
 *   type: custom:glowup-card
 *   title: Salon                  # facultatif
 *   device_id: abcdef…            # facultatif (plusieurs TV)
 *   show_status: true             # toutes les sections ci-dessous : true par défaut, false pour les masquer
 *   show_layout / show_wallpaper / show_apps / show_toast / show_widget / show_live / show_config / show_info
 *   widgets:                      # facultatif : boutons qui poussent un widget préparé
 *     - {label: Garage, widget: garage, text: Porte du garage ouverte, icon: "mdi:garage-open", color: warning, ttl: 1800}
 */
const SECTIONS = {
  show_status: "État de la TV",
  show_layout: "Mise en page",
  show_wallpaper: "Fond d'écran",
  show_apps: "Applications lançables",
  show_toast: "Envoyer un message (toast)",
  show_widget: "Envoyer un widget",
  show_live: "Widgets actuellement affichés",
  show_config: "Réglages (accent, voile, patch JSON)",
  show_info: "Infos détaillées et emplacements",
};
// Emplacements max par zone (doc du launcher).
const ZONES = {
  aura: { bubbles: 6, bottom_bars: 2 },
  epure: { top_bar: 1, clock_above: 2, clock_below: 3 },
  widgets: { clock_below: 3, panel_left: 4, panel_right: 4 },
};
const COLORS = ["accent", "ok", "warning", "alert", "muted"];
const FIELDS = {
  chip: [["text", "Texte"], ["icon", "Icône (mdi:…)"], ["color", "Couleur", "color"]],
  stat: [["value", "Valeur"], ["unit", "Unité"], ["label", "Libellé"], ["secondary", "Secondaire"], ["trend", "Tendance", "trend"]],
  progress: [["label", "Libellé"], ["value", "Valeur 0-100"], ["text", "Texte"], ["detail", "Détail (Aura)"]],
  list: [["items", "Éléments, un par ligne : texte;secondaire", "area"]],
  image: [["camera_entity", "Entité caméra (camera.…)"], ["caption", "Légende"]],
};

const CSS = `
:host{display:block}
ha-card{padding:16px;background:#080C1A;color:#EEF2FA;border:1px solid rgba(255,255,255,.16);border-radius:18px;font-family:Outfit,system-ui,sans-serif}
.head{display:flex;justify-content:space-between;align-items:center;gap:8px}
h2{margin:0;font:300 26px Fraunces,Georgia,serif}
h3{margin:18px 0 6px;font-size:13px;font-weight:500;color:#C9D2E3;text-transform:uppercase;letter-spacing:.06em}
.st{display:flex;align-items:center;gap:8px;color:#C9D2E3;font-size:14px;margin-top:4px}
.dot{width:10px;height:10px;border-radius:50%;background:#8896B0;flex:none}
.dot.on{background:#7FD1B9}.dot.off{background:#FF6B6B}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button,input,select,textarea{font:inherit;color:#EEF2FA;background:#03060F;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 12px;min-height:40px}
textarea{width:100%;box-sizing:border-box;font-family:ui-monospace,Consolas,monospace;font-size:13px}
input[type=color]{padding:2px;width:48px}
button{cursor:pointer}
button:hover{border-color:#7FD8FF}
button.on{border-color:#7FD8FF;color:#7FD8FF}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #7FD8FF;outline-offset:2px}
input{flex:1 1 140px;min-width:0}
input.sm{flex:0 0 80px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:8px}
.grid button{text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:14px;color:#C9D2E3}
.kv b{font-weight:500;color:#EEF2FA}
.live{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:14px;color:#C9D2E3}
.live:last-child{border:0}
details{margin-top:10px;color:#C9D2E3;font-size:14px}
pre{margin:6px 0 0;padding:10px;background:#03060F;border-radius:10px;overflow:auto;max-height:260px;font-size:12px}
.msg{min-height:18px;font-size:13px;color:#C9D2E3;margin-top:12px}
.msg.err{color:#FF6B6B}
.hide{display:none}
`;

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.flat().filter(Boolean));
  return e;
};
const select = (options, value) => {
  const s = el("select");
  for (const o of options) s.add(new Option(o, o));
  if (value !== undefined) s.value = value;
  return s;
};

class GlowUpCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("glowup-card-editor");
  }

  static getStubConfig() {
    return { title: "GlowUp TV" };
  }

  setConfig(config) {
    this._config = config;
    this._built = false;
    this._data = null;
    this._loaded = false;
  }

  getCardSize() {
    return 8;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._built) this._build();
    this._paintStatus();
    if (!this._loaded) {
      this._loaded = true;
      this._load();
    }
  }

  _on(key) {
    return this._config[key] !== false;
  }

  // Entités de l'intégration : détection par plateforme (état en ligne, version).
  _ents() {
    const mine = Object.entries(this._hass.entities || {})
      .filter(([, e]) => e.platform === "glowup" && (!this._config.device_id || e.device_id === this._config.device_id))
      .map(([id, e]) => ({ id, dev: e.device_id }));
    const of = (d) => mine.find((m) => m.id.startsWith(d + "."));
    return { online: of("binary_sensor"), version: of("sensor") };
  }

  _target() {
    const dev = this._config.device_id || this._ents().online?.dev;
    return dev ? { device_id: dev } : {};
  }

  async _load() {
    try {
      const res = await this._hass.callWS({
        type: "call_service",
        domain: "glowup",
        service: "get_data",
        service_data: this._target(),
        return_response: true,
      });
      this._data = res.response?.tvs?.[0] || null;
      this._say(this._data ? "" : "Aucune TV GlowUp trouvée.", !this._data);
      const errs = Object.entries(this._data?.errors || {});
      if (errs.length) this._say(errs.map(([k, v]) => `${k} : ${v}`).join(" · "), true);
    } catch (e) {
      this._data = null;
      this._say(`Lecture impossible (intégration 0.3.0 ou plus ?) : ${e.message || e.code || e}`, true);
    }
    this._paint();
  }

  async _call(domain, service, data, okText, reload = false) {
    try {
      await this._hass.callService(domain, service, data);
      this._say(okText);
      if (reload) await this._load();
    } catch (e) {
      this._say(e.message || String(e), true);
    }
  }

  _glow(service, data, okText, reload = false) {
    return this._call("glowup", service, { ...this._target(), ...data }, okText, reload);
  }

  _say(text, err = false) {
    const m = this.shadowRoot?.querySelector(".msg");
    if (!m) return;
    m.textContent = text;
    m.className = "msg" + (err ? " err" : "");
  }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = "";
    const cfg = this._config;
    const q = {};
    const sec = (key, title, ...kids) => {
      const box = el("div", { class: this._on(key) ? "" : "hide" }, el("h3", { text: title }), kids);
      return box;
    };

    // État
    q.dot = el("span", { class: "dot" });
    q.status = el("span");
    const refresh = el("button", { type: "button", "aria-label": "Rafraîchir", text: "↻", onclick: () => this._load() });
    const head = el("div", { class: "head" }, el("h2", { text: cfg.title || "GlowUp TV" }), refresh);
    const status = el("div", { class: this._on("show_status") ? "st" : "hide" }, q.dot, q.status);

    // Mise en page
    q.layouts = el("div", { class: "row" });
    // Fond
    q.wp = el("select", { "aria-label": "Fond d'écran", onchange: (e) => this._glow("patch_config", { patch: { theme: { wallpaper: { mode: "image", ids: [e.target.value] } } } }, "Fond appliqué.", true) });
    // Apps
    q.search = el("input", { placeholder: "Filtrer les apps", "aria-label": "Filtrer les apps", oninput: () => this._paintApps() });
    q.apps = el("div", { class: "grid" });
    const home = el("button", { type: "button", text: "Accueil", onclick: () => this._glow("go_home", {}, "Retour à l'accueil.") });
    // Toast
    q.tText = el("input", { placeholder: "Texte", "aria-label": "Texte du toast" });
    q.tIcon = el("input", { placeholder: "mdi:bell", "aria-label": "Icône", style: "flex:0 1 130px" });
    q.tSec = el("input", { class: "sm", type: "number", min: "1", max: "30", value: "6", "aria-label": "Secondes" });
    const tSend = el("button", { type: "button", text: "Envoyer", onclick: () => {
      const text = q.tText.value.trim();
      if (!text) return this._say("Écris un texte.", true);
      const data = { text, seconds: Number(q.tSec.value) || 6 };
      if (q.tIcon.value.trim()) data.icon = q.tIcon.value.trim();
      this._glow("toast", data, "Toast envoyé.");
    } });
    // Widget
    q.wId = el("input", { placeholder: "id du widget", "aria-label": "Identifiant du widget", list: "glow-widgets", onchange: () => this._paintWidgetFields() });
    q.wList = el("datalist", { id: "glow-widgets" });
    q.wTtl = el("input", { class: "sm", type: "number", min: "0", value: "1800", "aria-label": "TTL en secondes", title: "TTL (s), 0 = jamais" });
    q.wFields = el("div", { class: "row", style: "margin-top:8px" });
    q.wType = el("span", { class: "st" });
    const wSend = el("button", { type: "button", text: "Pousser", onclick: () => this._pushWidget() });
    const wClear = el("button", { type: "button", text: "Vider", onclick: () => {
      const widget = q.wId.value.trim();
      if (!widget) return this._say("Indique l'id du widget.", true);
      this._glow("clear_widget", { widget }, "Widget vidé.", true);
    } });
    q.presets = el("div", { class: "row", style: "margin-top:8px" });
    for (const p of cfg.widgets || []) {
      const { label, ...data } = p;
      q.presets.append(el("button", { type: "button", text: label || p.widget, onclick: () => this._glow("set_widget", data, `${label || p.widget} envoyé.`, true) }));
    }
    // Widgets affichés
    q.live = el("div");
    // Réglages
    q.accent = el("input", { type: "color", "aria-label": "Couleur d'accent" });
    q.scrim = el("input", { class: "sm", type: "number", min: "0", max: "100", "aria-label": "Voile Aura (0-100)", title: "Voile Aura (0-100)" });
    const cApply = el("button", { type: "button", text: "Appliquer", onclick: () => {
      const patch = { theme: { accent: q.accent.value } };
      if (q.scrim.value !== "") patch.layouts = { aura: { scrim: Number(q.scrim.value) } };
      this._glow("patch_config", { patch }, "Réglages appliqués.", true);
    } });
    q.patch = el("textarea", { rows: "3", placeholder: '{"clock": {"seconds": false}}', "aria-label": "Patch JSON" });
    const pSend = el("button", { type: "button", text: "Envoyer le patch", onclick: () => {
      let patch;
      try { patch = JSON.parse(q.patch.value); } catch { return this._say("JSON invalide.", true); }
      this._glow("patch_config", { patch }, "Patch appliqué.", true);
    } });
    // Infos
    q.info = el("div");

    root.append(
      el("style", { text: CSS }),
      el("ha-card", {},
        head, status,
        sec("show_layout", "Mise en page", q.layouts),
        sec("show_wallpaper", "Fond d'écran", q.wp),
        sec("show_apps", "Applications", el("div", { class: "row" }, q.search, home), q.apps),
        sec("show_toast", "Message (toast)", el("div", { class: "row" }, q.tText, q.tIcon, q.tSec, tSend)),
        sec("show_widget", "Widget", el("div", { class: "row" }, q.wId, q.wList, q.wTtl, wSend, wClear), q.wType, q.wFields, q.presets),
        sec("show_live", "Widgets affichés", q.live),
        sec("show_config", "Réglages",
          el("div", { class: "row" }, q.accent, q.scrim, cApply),
          el("div", { style: "margin-top:8px" }, q.patch), el("div", { class: "row", style: "margin-top:8px" }, pSend)),
        sec("show_info", "Infos et emplacements", q.info),
        el("div", { class: "msg", role: "status" })
      )
    );
    this._q = q;
    this._built = true;
    this._paintWidgetFields();
  }

  _pushWidget() {
    const q = this._q, widget = q.wId.value.trim();
    if (!widget) return this._say("Indique l'id du widget.", true);
    const data = { widget, ttl: Number(q.wTtl.value) || 0 };
    for (const f of q.wFields.querySelectorAll("[data-k]")) {
      let v = f.value.trim();
      if (v === "") continue;
      if (f.dataset.k === "items") v = v.split("\n").filter(Boolean).map((r) => { const [text, secondary] = r.split(";"); return secondary ? { text, secondary } : { text }; });
      else if (f.dataset.k === "value" && !isNaN(v)) v = Number(v);
      data[f.dataset.k] = v;
    }
    this._glow("set_widget", data, `Widget ${widget} poussé.`, true);
  }

  _paintWidgetFields() {
    const q = this._q, declared = this._data?.config?.widgets || {};
    q.wList.innerHTML = "";
    for (const id of Object.keys(declared)) q.wList.append(el("option", { value: id }));
    const type = declared[q.wId.value.trim()]?.type;
    q.wType.textContent = type ? `Type : ${type}` : Object.keys(declared).length ? "Widget non déclaré dans la config de la TV" : "";
    const fields = FIELDS[type] || FIELDS.chip;
    q.wFields.innerHTML = "";
    for (const [k, label, kind] of fields) {
      let f;
      if (kind === "color") f = select(COLORS, "accent");
      else if (kind === "trend") f = select(["flat", "up", "down"], "flat");
      else if (kind === "area") f = el("textarea", { rows: "3" });
      else f = el("input", { placeholder: label });
      f.dataset.k = k;
      f.setAttribute("aria-label", label);
      f.title = label;
      q.wFields.append(f);
    }
  }

  _paintStatus() {
    if (!this._built) return;
    const h = this._hass, e = this._ents(), q = this._q;
    const online = e.online ? h.states[e.online.id]?.state : this._data ? "on" : undefined;
    const version = (e.version && h.states[e.version.id]?.state) || this._data?.info?.version;
    q.dot.className = "dot " + (online === "on" ? "on" : online === "off" ? "off" : "");
    q.status.textContent = !e.online && !this._data
      ? "Aucune entité GlowUp trouvée"
      : `${online === "off" ? "Hors ligne" : "En ligne"}${version && !["unknown", "unavailable"].includes(version) ? ` · launcher ${version}` : ""}`;
  }

  _paint() {
    if (!this._built) return;
    this._paintStatus();
    this._paintLayouts();
    this._paintWallpaper();
    this._paintApps();
    this._paintWidgetFields();
    this._paintLive();
    this._paintConfig();
    this._paintInfo();
  }

  _paintLayouts() {
    const q = this._q, d = this._data;
    q.layouts.innerHTML = "";
    const cur = d?.config?.layout;
    for (const o of d?.info?.layouts || []) {
      q.layouts.append(el("button", { type: "button", text: o, class: o === cur ? "on" : "", onclick: () => this._glow("set_layout", { layout: o }, `Mise en page : ${o}.`, true) }));
    }
  }

  _paintWallpaper() {
    const q = this._q, d = this._data;
    q.wp.innerHTML = "";
    const list = d?.wallpapers || [];
    for (const w of list) q.wp.add(new Option(w.id, w.id));
    const cur = d?.config?.theme?.wallpaper?.ids?.[0];
    if (cur && list.some((w) => w.id === cur)) q.wp.value = cur;
  }

  _paintApps() {
    const q = this._q, f = q.search.value.trim().toLowerCase();
    q.apps.innerHTML = "";
    const apps = (this._data?.apps || []).filter((a) => !f || `${a.label} ${a.package}`.toLowerCase().includes(f));
    for (const a of apps) {
      q.apps.append(el("button", { type: "button", text: a.label || a.package, title: a.package, onclick: () => this._glow("launch_app", { package: a.package }, `${a.label || a.package} lancée.`) }));
    }
    if (!apps.length) q.apps.append(el("span", { class: "st", text: this._data ? "Aucune app" : "…" }));
  }

  _paintLive() {
    const q = this._q, st = this._data?.state;
    q.live.innerHTML = "";
    const src = st && typeof st === "object" ? st.widgets ?? st : {};
    const ids = Object.entries(src).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v));
    for (const [id, v] of ids) {
      const c = v.content || v;
      const sum = c.text ?? c.label ?? c.value ?? "";
      q.live.append(el("div", { class: "live" }, el("span", { text: `${id} · ${sum}` }), el("button", { type: "button", text: "Vider", onclick: () => this._glow("clear_widget", { widget: id }, `${id} vidé.`, true) })));
    }
    if (!ids.length) q.live.append(el("span", { class: "st", text: "Aucun widget poussé" }));
  }

  _paintConfig() {
    const q = this._q, c = this._data?.config;
    const acc = c?.theme?.accent;
    if (acc && /^#[0-9a-f]{6}$/i.test(acc)) q.accent.value = acc;
    const scrim = c?.layouts?.aura?.scrim;
    if (scrim !== undefined && document.activeElement !== q.scrim) q.scrim.value = scrim;
  }

  _paintInfo() {
    const q = this._q, d = this._data;
    q.info.innerHTML = "";
    if (!d) return;
    const i = d.info || {}, c = d.config || {};
    const rows = [
      ["Appareil", i.device], ["Android", i.android], ["Launcher", i.version], ["API", i.api], ["Profil", i.profile],
      ["Écran", i.screen ? `${i.screen.w}×${i.screen.h}` : ""], ["Capacités", (i.capabilities || []).join(", ")],
      ["Nom", c.name], ["Mise en page", c.layout], ["Révision config", c.revision], ["Démarrage (boot_id)", i.boot_id],
    ].filter(([, v]) => v !== undefined && v !== "");
    q.info.append(el("div", { class: "kv" }, rows.map(([k, v]) => [el("span", { text: k }), el("b", { text: String(v) })]).flat()));

    // Emplacements : widgets placés par zone / max de la mise en page active.
    const zones = ZONES[c.layout];
    if (zones) {
      const placed = c.layouts?.[c.layout]?.zones || {};
      q.info.append(el("h3", { text: "Emplacements" }), el("div", { class: "kv" },
        Object.entries(zones).map(([z, max]) => [el("span", { text: z }), el("b", { text: `${(placed[z] || []).length} / ${max}` })]).flat()));
    }
    q.info.append(
      el("details", {}, el("summary", { text: "Config complète" }), el("pre", { text: JSON.stringify(c, null, 2) })),
      el("details", {}, el("summary", { text: "État poussé" }), el("pre", { text: JSON.stringify(d.state, null, 2) })),
      el("details", {}, el("summary", { text: "Infos brutes" }), el("pre", { text: JSON.stringify(i, null, 2) }))
    );
  }
}

// Éditeur visuel : un interrupteur par section.
class GlowUpCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => ({ title: "Titre", device_id: "TV (si plusieurs)", ...SECTIONS }[s.name] || s.name);
      this._form.addEventListener("value-changed", (e) => {
        const config = { ...this._config, ...e.detail.value };
        for (const k of ["title", "device_id"]) if (!config[k]) delete config[k];
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.append(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = [
      { name: "title", selector: { text: {} } },
      { name: "device_id", selector: { device: { integration: "glowup" } } },
      ...Object.keys(SECTIONS).map((name) => ({ name, selector: { boolean: {} } })),
    ];
    this._form.data = { ...Object.fromEntries(Object.keys(SECTIONS).map((k) => [k, true])), ...this._config };
  }
}

customElements.define("glowup-card", GlowUpCard);
customElements.define("glowup-card-editor", GlowUpCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({ type: "glowup-card", name: "GlowUp TV", description: "Infos, apps, messages, widgets et réglages de la TV GlowUp (sections au choix)" });
