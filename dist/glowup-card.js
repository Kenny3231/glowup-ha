/* Carte Lovelace GlowUp TV : état de la TV, mise en page, toast, widgets en un clic.
 *
 * Ressource : /local/glowup-card.js (type : module). Carte :
 *   type: custom:glowup-card
 *   title: Salon                 # facultatif
 *   device_id: abcdef…           # facultatif, nécessaire seulement avec plusieurs TV
 *   widgets:                     # facultatif : boutons qui poussent un widget
 *     - {label: Garage, widget: garage, text: Porte du garage ouverte, icon: "mdi:garage-open", color: warning, ttl: 1800}
 *   entities:                    # facultatif : seulement si la détection automatique échoue
 *     online: binary_sensor.…
 *     version: sensor.…
 *     layout: select.…
 *     wallpaper: select.…
 */
const COLORS = ["accent", "ok", "warning", "alert", "muted"];

const CSS = `
:host{display:block}
ha-card{padding:16px;background:#080C1A;color:#EEF2FA;border:1px solid rgba(255,255,255,.16);border-radius:18px;font-family:Outfit,system-ui,sans-serif}
h2{margin:0 0 4px;font:300 26px Fraunces,Georgia,serif}
.st{display:flex;align-items:center;gap:8px;color:#C9D2E3;font-size:14px;margin-bottom:12px}
.dot{width:10px;height:10px;border-radius:50%;background:#8896B0}
.dot.on{background:#7FD1B9}.dot.off{background:#FF6B6B}
h3{margin:14px 0 6px;font-size:13px;font-weight:500;color:#C9D2E3;text-transform:uppercase;letter-spacing:.06em}
.row{display:flex;flex-wrap:wrap;gap:8px}
button,input,select{font:inherit;color:#EEF2FA;background:#03060F;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 12px;min-height:40px}
button{cursor:pointer}
button:hover{border-color:#7FD8FF}
button.on{border-color:#7FD8FF;color:#7FD8FF}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #7FD8FF;outline-offset:2px}
input{flex:1 1 140px;min-width:0}
input.sm{flex:0 0 72px}
.msg{min-height:18px;font-size:13px;color:#C9D2E3;margin-top:8px}
.msg.err{color:#FF6B6B}
`;

class GlowUpCard extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._built = false;
  }

  getCardSize() {
    return 5;
  }

  static getStubConfig() {
    return { title: "GlowUp TV" };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._built) this._build();
    this._update();
  }

  // Entités de l'intégration : config explicite, sinon détection par plateforme.
  _ents() {
    const c = this._config.entities || {};
    const mine = Object.entries(this._hass.entities || {})
      .filter(([, e]) => e.platform === "glowup" && (!this._config.device_id || e.device_id === this._config.device_id))
      .map(([id]) => id);
    const of = (d) => mine.filter((i) => i.startsWith(d + "."));
    const selects = of("select");
    const isLayout = (i) => (this._hass.states[i]?.attributes.options || []).some((o) => ["epure", "widgets", "aura"].includes(o));
    return {
      online: c.online || of("binary_sensor")[0],
      version: c.version || of("sensor")[0],
      layout: c.layout || selects.find(isLayout),
      wallpaper: c.wallpaper || selects.find((i) => !isLayout(i)),
    };
  }

  _target() {
    return this._config.device_id ? { device_id: this._config.device_id } : {};
  }

  async _call(domain, service, data, okText) {
    try {
      await this._hass.callService(domain, service, data);
      this._say(okText);
    } catch (e) {
      this._say(e.message || String(e), true);
    }
  }

  _say(text, err = false) {
    const m = this.shadowRoot.querySelector(".msg");
    m.textContent = text;
    m.className = "msg" + (err ? " err" : "");
  }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    const cfg = this._config;
    root.innerHTML = `<style>${CSS}</style><ha-card>
      <h2></h2>
      <div class="st"><span class="dot"></span><span class="status"></span></div>
      <h3>Mise en page</h3><div class="row layouts"></div>
      <div class="wp-box"><h3>Fond</h3><select class="wp" aria-label="Fond d'écran"></select></div>
      <h3>Message (toast)</h3>
      <div class="row"><input class="t-text" placeholder="Texte" aria-label="Texte du toast"><input class="t-icon" placeholder="mdi:bell" aria-label="Icône" style="flex:0 1 130px"><input class="t-sec sm" type="number" min="1" max="30" value="6" aria-label="Secondes"><button class="t-send">Envoyer</button></div>
      <h3>Widget</h3>
      <div class="row"><input class="w-id" placeholder="id (ex. garage)" aria-label="Identifiant du widget"><input class="w-text" placeholder="Texte" aria-label="Texte du widget"><select class="w-color" aria-label="Couleur">${COLORS.map((c) => `<option>${c}</option>`).join("")}</select><button class="w-send">Pousser</button><button class="w-clear">Vider</button></div>
      <div class="row presets"></div>
      <div class="msg" role="status"></div></ha-card>`;
    root.querySelector("h2").textContent = cfg.title || "GlowUp TV";
    const q = (s) => root.querySelector(s);

    q(".t-send").onclick = () => {
      const text = q(".t-text").value.trim();
      if (!text) return this._say("Écris un texte.", true);
      const data = { ...this._target(), text, seconds: Number(q(".t-sec").value) || 6 };
      if (q(".t-icon").value.trim()) data.icon = q(".t-icon").value.trim();
      this._call("glowup", "toast", data, "Toast envoyé.");
    };
    q(".w-send").onclick = () => {
      const widget = q(".w-id").value.trim();
      if (!widget) return this._say("Indique l'id du widget.", true);
      this._call("glowup", "set_widget", { ...this._target(), widget, text: q(".w-text").value, color: q(".w-color").value, ttl: 1800 }, "Widget poussé (30 min).");
    };
    q(".w-clear").onclick = () => {
      const widget = q(".w-id").value.trim();
      if (!widget) return this._say("Indique l'id du widget.", true);
      this._call("glowup", "clear_widget", { ...this._target(), widget }, "Widget vidé.");
    };
    q(".wp").onchange = (e) => this._select("wallpaper", e.target.value);

    const presets = q(".presets");
    for (const p of cfg.widgets || []) {
      const b = document.createElement("button");
      b.textContent = p.label || p.widget;
      b.onclick = () => {
        const { label, ...data } = p;
        this._call("glowup", "set_widget", { ...this._target(), ...data }, `${p.label || p.widget} envoyé.`);
      };
      presets.append(b);
    }
    this._built = true;
  }

  _select(key, option) {
    const entity_id = this._ents()[key];
    if (entity_id) this._call("select", "select_option", { entity_id, option }, "Appliqué.");
  }

  _update() {
    const root = this.shadowRoot, h = this._hass, e = this._ents();
    const st = (id) => (id ? h.states[id] : undefined);
    const online = st(e.online)?.state, version = st(e.version)?.state;
    root.querySelector(".dot").className = "dot " + (online === "on" ? "on" : online === "off" ? "off" : "");
    root.querySelector(".status").textContent = !e.online
      ? "Aucune entité GlowUp trouvée"
      : `${online === "on" ? "En ligne" : "Hors ligne"}${version && !["unknown", "unavailable"].includes(version) ? ` · launcher ${version}` : ""}`;

    const lay = st(e.layout);
    const box = root.querySelector(".layouts");
    const opts = lay?.attributes.options || [];
    if (box.dataset.sig !== opts.join() + lay?.state) {
      box.dataset.sig = opts.join() + lay?.state;
      box.innerHTML = "";
      for (const o of opts) {
        const b = document.createElement("button");
        b.textContent = o;
        b.className = o === lay.state ? "on" : "";
        b.onclick = () => this._select("layout", o);
        box.append(b);
      }
    }

    const wp = st(e.wallpaper), sel = root.querySelector(".wp");
    root.querySelector(".wp-box").style.display = wp ? "" : "none";
    const wopts = wp?.attributes.options || [];
    if (sel.dataset.sig !== wopts.join()) {
      sel.dataset.sig = wopts.join();
      sel.innerHTML = "";
      for (const o of wopts) sel.add(new Option(o, o));
    }
    if (wp && wopts.includes(wp.state)) sel.value = wp.state;
  }
}

customElements.define("glowup-card", GlowUpCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "glowup-card", name: "GlowUp TV", description: "État, mise en page, toast et widgets de la TV GlowUp" });
