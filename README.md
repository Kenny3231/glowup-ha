# GlowUp TV pour Home Assistant

Intégration locale pour le launcher Android TV **GlowUp TV** : Home Assistant affiche des infos de la maison sur
l'écran d'accueil de la TV (météo au-dessus de l'heure, porte du garage, lave-linge, impression 3D…), change la mise
en page, envoie des messages. Tout passe par l'API de la TV (port 8765) sur le réseau local, sans cloud.

*A local Home Assistant integration for the GlowUp TV launcher: push widgets, layouts and toasts to the TV's home
screen over the LAN. Docs are in French.*

## Installation (HACS)

1. HACS, menu des trois points, **Dépôts personnalisés** : `https://github.com/Kenny3231/glowup-ha`, catégorie
   **Intégration**.
2. Installe **GlowUp TV**, puis redémarre Home Assistant.
3. **Paramètres, Appareils et services, Ajouter une intégration, GlowUp TV**. Si le mDNS passe (`_glowup._tcp`), la TV
   est proposée toute seule ; sinon saisis son adresse (ex. `192.168.1.50`, port `8765`).

Sans HACS : copie `custom_components/glowup` dans le dossier `config/custom_components` de Home Assistant.

## Appairage

Sur la TV : **Réglages, Appairer un appareil**. Laisse la fenêtre ouverte et saisis dans Home Assistant le code à
6 chiffres affiché. Le code ne sert qu'une fois. Le token reste dans la config de HA ; s'il est révoqué sur la TV
(**Réglages, Appareils appairés**), HA demande un nouvel appairage.

## Entités (une TV = un appareil)

| Entité | Rôle |
|---|---|
| En ligne | la TV répond |
| Version | version du launcher |
| Mise en page | Épuré ou Widgets |
| Fond | fond d'écran parmi ceux stockés sur la TV |

## Services

Sans cible, tous les GlowUp configurés sont visés ; avec plusieurs TV, ajoute `target: {device_id: …}`.

| Service | Effet |
|---|---|
| `glowup.set_widget` | remplit un widget déclaré dans la config de la TV (`widget`, contenu, `ttl`) |
| `glowup.clear_widget` | vide un widget (il se masque) |
| `glowup.set_layout` | `epure` ou `widgets` |
| `glowup.patch_config` | modification partielle de la config (JSON Merge Patch) |
| `glowup.toast` | message de quelques secondes sur l'accueil |
| `glowup.launch_app` | ouvre une app installée (quand l'accueil est affiché) |

Le contenu dépend du type du widget :

| Type | Champs |
|---|---|
| `chip` | `text`, `icon`, `color` (`accent`, `ok`, `warning`, `alert`, `muted` ou `#RRGGBB`) |
| `stat` | `value`, `label`, `unit`, `secondary`, `trend` (`up`, `down`, `flat`) |
| `progress` | `label`, `value` (0 à 100), `text` |
| `list` | `items` : `[{text, secondary, icon}]` |
| `image` | `camera_entity` (instantané envoyé, 1 Mo au plus), `caption` |

```yaml
action: glowup.set_widget
data:
  widget: garage
  text: Porte du garage ouverte
  icon: mdi:garage-open
  color: warning
  ttl: 1800
```

## Le `ttl` et le maintien

Chaque contenu a une durée de vie (`ttl`, en secondes) : si Home Assistant s'arrête, la TV n'affiche pas une info
périmée pour toujours. Pour garder un widget affiché, renvoie-le régulièrement (par exemple toutes les 10 minutes
avec un `ttl` de 30 minutes) : l'intégration n'envoie un contenu identique qu'une fois la moitié de son `ttl`
écoulée, donc ça ne coûte rien. `ttl: 0` = jamais d'expiration, à éviter pour une alerte.

Quand la TV redémarre, l'intégration le voit (champ `boot_id`, vérifié toutes les 60 s) et repousse les widgets
encore valables.

## Exemples

[`examples/automations.yaml`](examples/automations.yaml) : météo, porte du garage, lave-linge, lumières restées
allumées, impression 3D, et Widgets le jour / Épuré le soir. Les entités sont des exemples à remplacer par les
tiennes ; les widgets (`meteo`, `garage`…) doivent exister dans la config de la TV.

## Carte Lovelace (JS)

[`dist/glowup-card.js`](dist/glowup-card.js) : une carte pour le tableau de bord. Elle montre l'état de la TV (en ligne,
version), change la mise en page (Épuré, Widgets, Aura si la TV la propose), choisit le fond, envoie un toast, pousse ou
vide un widget, et peut avoir des boutons de widgets préparés.

1. Copie `dist/glowup-card.js` dans `config/www/` de Home Assistant.
2. **Paramètres, Tableaux de bord, ⋮, Ressources, Ajouter** : URL `/local/glowup-card.js`, type **Module JavaScript**
   (mode avancé de ton profil actif). Recharge la page sans cache.
3. Ajoute la carte en YAML :

```yaml
type: custom:glowup-card
title: Salon
widgets:                       # facultatif : un bouton = un widget poussé
  - {label: Garage, widget: garage, text: Porte du garage ouverte, icon: "mdi:garage-open", color: warning, ttl: 1800}
# device_id: …                 # seulement avec plusieurs TV
```

Les entités sont trouvées toutes seules ; sinon donne-les dans `entities:` (`online`, `version`, `layout`, `wallpaper`).

## Script Node et page de guide

- [`tools/glowup.mjs`](tools/glowup.mjs) : client et CLI Node 18+ qui parlent directement à la TV (hors Home Assistant).
  `GLOWUP_HOST=<ip> node tools/glowup.mjs pair <code>`, puis `GLOWUP_TOKEN=… node tools/glowup.mjs status`
  (aussi `toast`, `set`, `clear`, `layout`, `patch`, `launch`, `demo`).
- [`docs/index.html`](docs/index.html) : page de guide (emplacements de notifications par mise en page, champs envoyables,
  générateur de commandes). À ouvrir dans un navigateur.

## Pas encore là

`glowup.set_wallpaper` (fond temporaire) et l'événement `glowup_widget_pressed` (widget cliquable) viendront plus tard.

## Licence

MIT.
