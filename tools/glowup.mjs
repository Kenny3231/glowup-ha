#!/usr/bin/env node
// Client + CLI pour l'API locale de GlowUp TV (Node 18+, aucune dépendance).
//   GLOWUP_HOST=192.168.1.50 GLOWUP_TOKEN=... node tools/glowup.mjs status
// Le navigateur ne peut pas appeler la TV (pas de CORS, Host vérifié) : ce script tourne dans Node.
import { pathToFileURL } from "node:url";

// Capacités annoncées par la doc du launcher (03-config.md, 02-api-launcher.md).
export const ZONES = {
  aura: { bubbles: 6, bottom_bars: 2 },
  epure: { top_bar: 1, clock_above: 2, clock_below: 3 },
  widgets: { clock_below: 3, panel_left: 4, panel_right: 4 },
};
export const LIMITS = { ttlMax: 604800, toastSeconds: [1, 30], imageBytes: 1_000_000, bodyBytes: 65536, reqPerSec: 20 };

export class GlowUpError extends Error {
  constructor(status, body) {
    super(body?.detail || body?.error || `HTTP ${status}`);
    this.status = status;
    this.code = body?.error;
  }
}

export class GlowUp {
  constructor(host, token, port = 8765) {
    this.base = `http://${host.includes(":") ? `[${host}]` : host}:${port}/api/v1`;
    this.token = token;
  }

  async #req(method, path, body, ctype = "application/json") {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["Content-Type"] = ctype;
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new GlowUpError(res.status, data);
    return data;
  }

  // Lecture
  health = () => this.#req("GET", "/health");
  info = () => this.#req("GET", "/info");
  config = () => this.#req("GET", "/config");
  state = () => this.#req("GET", "/state");
  apps = () => this.#req("GET", "/apps");
  wallpapers = () => this.#req("GET", "/wallpapers");
  // Écriture
  pair = (code, client = "glowup-js") => this.#req("POST", "/pair", { code, client });
  patchConfig = (patch) => this.#req("PATCH", "/config", patch, "application/merge-patch+json");
  setLayout = (layout) => this.patchConfig({ layout });
  setWidget = (id, content, ttl = 1800) => this.#req("PUT", `/state/widgets/${id}`, { ...content, ttl });
  clearWidget = (id) => this.#req("DELETE", `/state/widgets/${id}`);
  toast = (text, icon, seconds) => this.#req("POST", "/actions/toast", { text, ...(icon && { icon }), ...(seconds && { seconds }) });
  launch = (pkg) => this.#req("POST", "/actions/launch", { package: pkg });
  home = () => this.#req("POST", "/actions/home", {});

  // Combien d'emplacements de notification sont pris / libres dans la mise en page active.
  async slots() {
    const [cfg, st] = await Promise.all([this.config(), this.state()]);
    const layout = cfg.layout;
    const conf = cfg.layouts?.[layout] ?? {};
    // shortcut: forme exacte de GET /state non documentée, on accepte {widgets:{…}} ou {…}.
    const live = new Set(Object.keys(st.widgets ?? st ?? {}));
    const zones = Object.entries(ZONES[layout] ?? {}).map(([zone, max]) => {
      const ids = conf.zones?.[zone] ?? [];
      return { zone, max, placed: ids.length, shown: ids.filter((i) => live.has(i)).length };
    });
    return { layout, zones, inline_weather: conf.clock?.inline_weather ?? null };
  }
}

// --- CLI ---------------------------------------------------------------
const HELP = `glowup.mjs <commande> [args]   (env : GLOWUP_HOST, GLOWUP_TOKEN, GLOWUP_PORT)
  pair <code>                      échange le code de la TV contre un token
  health | info | config | state | apps | wallpapers | status
  toast "texte" [icône] [secondes] message sur l'accueil (1 à 30 s)
  set <widget> '<json>' [ttl]      ex. set garage '{"text":"Porte ouverte","icon":"mdi:garage-open","color":"warning"}' 1800
  clear <widget>                   vide un widget
  layout <aura|epure|widgets>      change de mise en page
  patch '<json>'                   JSON Merge Patch sur la config
  launch <package> | home          lance une app / revient à l'accueil
  demo                             remplit Aura : 3 bulles + 2 imprimantes (widgets de glowup-themes/aura)`;

const json = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`JSON invalide : ${s}`);
  }
};

async function main([cmd, ...a]) {
  const host = process.env.GLOWUP_HOST;
  if (!cmd || cmd === "help" || !host) return console.log(HELP + (host ? "" : "\n\n⚠ GLOWUP_HOST non défini"));
  const tv = new GlowUp(host, process.env.GLOWUP_TOKEN, Number(process.env.GLOWUP_PORT) || 8765);
  const out = (v) => console.log(JSON.stringify(v, null, 2));
  const cmds = {
    pair: async () => out(await tv.pair(a[0])),
    health: async () => out(await tv.health()),
    info: async () => out(await tv.info()),
    config: async () => out(await tv.config()),
    state: async () => out(await tv.state()),
    apps: async () => out(await tv.apps()),
    wallpapers: async () => out(await tv.wallpapers()),
    status: async () => {
      const [info, s] = await Promise.all([tv.info(), tv.slots()]);
      console.log(`${info.device} · launcher ${info.version} · ${info.screen.w}×${info.screen.h} · profil ${info.profile}`);
      console.log(`Mise en page : ${s.layout}${s.inline_weather ? ` (météo inline : ${s.inline_weather})` : ""}`);
      for (const z of s.zones) console.log(`  ${z.zone.padEnd(12)} ${z.shown} affiché(s) / ${z.placed} placé(s) / ${z.max} max`);
    },
    toast: async () => out(await tv.toast(a[0], a[1], a[2] && Number(a[2]))),
    set: async () => out(await tv.setWidget(a[0], json(a[1]), a[2] === undefined ? 1800 : Number(a[2]))),
    clear: async () => out(await tv.clearWidget(a[0])),
    layout: async () => out(await tv.setLayout(a[0])),
    patch: async () => out(await tv.patchConfig(json(a[0]))),
    launch: async () => out(await tv.launch(a[0])),
    home: async () => out(await tv.home()),
    demo: async () => {
      await tv.setLayout("aura");
      await tv.setWidget("garage", { text: "Porte du garage ouverte", icon: "mdi:garage-open", color: "warning" });
      await tv.setWidget("colis", { text: "Colis livré", icon: "mdi:package-variant" });
      await tv.setWidget("lave_linge", { label: "Lave-linge", value: 42, text: "fin dans 42 min" });
      await tv.setWidget("imprimante_1", { label: "Bambu 1", value: 62, text: "reste 1 h 34 · fin 21:48", detail: "Support caméra · couche 142/230" });
      await tv.setWidget("imprimante_2", { label: "Bambu 2", value: 18, text: "reste 3 h 05", detail: "Boîtier · couche 40/310" });
      console.log("Démo envoyée (30 min).");
    },
  };
  if (!cmds[cmd]) return console.log(HELP);
  try {
    await cmds[cmd]();
  } catch (e) {
    console.error(`Erreur : ${e.message}${e.status ? ` (HTTP ${e.status})` : ""}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
