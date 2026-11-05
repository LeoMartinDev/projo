# projo — Ouverture

Pack de production du logo « Ouverture », choisi parmi les propositions de logo. Le symbole a été redessiné en courbes vectorielles d’après la planche `design/icon-concepts/16-projo-rideau.png`. Tous les exports partagent le même tracé dans `source/symbol.svg` ; les tailles et marges changent selon l’usage. Le mot-symbole utilise Geist Bold, comme l’interface, et ses lettres sont converties en tracés dans les SVG : aucune police à installer pour utiliser les fichiers.

## Choisir un fichier

| Usage | Fichiers |
|---|---|
| Modifier le dessin | `source/symbol.svg` — tracé seul, cadrage serré |
| Symbole sans fond | `svg/symbol-white.svg`, `symbol-black.svg`, `symbol-ivory.svg` |
| Couleur pilotée par CSS | `svg/symbol-current-color.svg` — intégration SVG inline |
| Logo avec le nom | `svg/logo-horizontal-*.svg` et `svg/logo-stacked-*.svg` |
| Logo avec fond | `svg/logo-{horizontal,stacked}-on-{dark,light,ambient}.svg` et mêmes noms sous `png/lockups/` |
| PNG sans fond | `png/transparent/{white,black,ivory}/` — 32 à 2048 px |
| PNG avec fond | `png/background/{dark,light,ambient}/` — 64 à 2048 px |
| PNG du logo avec le nom | `png/lockups/` — horizontal et vertical, blanc/noir/ivoire |
| Favicons adaptatifs | `favicon/favicon.svg` + `favicon/favicon-dark.ico` en repli |
| Favicons fixes | `favicon/{dark,light,transparent-white,transparent-black}/` — 16, 20, 24, 32, 48, 64, 96, 128, 256 px |
| Safari épinglé | `favicon/safari-pinned-tab.svg` — silhouette noire transparente |
| PWA | `pwa/{dark,light,ambient}/icon-{192,512}.png` |
| PWA découpable | `pwa/{dark,light,ambient}/icon-maskable-{192,512,1024}.png` |
| Écran d’accueil Apple | `apple/{dark,light,ambient}/` — 120, 152, 167, 180 px |
| Application iOS | `native/ios-{dark,light,ambient}-1024.png`, `ios-tinted-1024.png` |
| Android adaptatif | `native/android-adaptive-foreground-1024.png` + `android-background-dark-1024.png` ; paire noire/claire également fournie |
| Android monochrome | `native/android-monochrome-1024.png` — couche alpha du symbole |
| Windows | `native/windows-{dark,light}.ico` — 16, 24, 32, 48, 64, 128 et 256 px dans chaque fichier |
| macOS | `native/macos.icns` — 16, 32, 64, 128, 256, 512 et 1024 px |
| Vue d’ensemble | `preview.png` et `preview.html` |
| Inventaire | `inventory.json` |

`white` désigne le symbole blanc sur transparence. `dark` désigne le fond sombre avec symbole blanc. `black` désigne le symbole noir sur transparence. `light` désigne le fond clair avec symbole noir.

## Palette

- Fond sombre et symbole noir : `#0A0A0B`.
- Fond clair : `#F4F4F5`.
- Symbole blanc : `#FFFFFF`.
- Symbole ivoire alternatif, proche de la planche choisie : `#F5F3EA`.
- Ambiance : bleu ardoise et vert sauge, réservés au fond. Le symbole reste monochrome.

Les SVG sont vectoriels ; les PNG sont des exports sRGB. Les fichiers transparents ont un véritable canal alpha. Les icônes PWA, Apple Touch et iOS ont un fond opaque sur toute la surface et aucun coin arrondi intégré : le système applique sa propre découpe. Le dessin occupe environ 62,5 % de la largeur des icônes normales, 52,7 % des icônes maskable, et 46,9 % de la couche Android adaptative. Les favicons utilisent un symbole plus grand pour rester lisibles.

## Utilisation web

L’application web utilise déjà les fichiers sous `apps/web/public/icons/ouverture/`, avec les liens dans `apps/web/index.html` et les déclarations dans `apps/web/public/manifest.webmanifest`.

`web/head.html` contient les balises prêtes à copier ; `web/manifest.webmanifest` fournit un manifeste autonome avec les chemins utilisés par l’application. Les variantes claires et ambiantes restent disponibles dans le pack ; le manifeste sélectionne le fond sombre. Le favicon SVG suit la préférence claire/sombre du navigateur, indépendamment du thème sombre de l’application. Le fichier ICO sert de repli. Un SVG chargé comme `<img>` ne récupère pas la couleur CSS de son parent : pour `currentColor`, utiliser le SVG inline.

Les icônes déjà installées peuvent être mises en cache par le système. Après remplacement, le lanceur peut conserver l’ancienne icône jusqu’à sa mise à jour ou à une nouvelle installation.

## Applications natives

Les fichiers iOS sont opaques, carrés et sans arrondis intégrés. La variante `ios-tinted` est monochrome, blanche sur fond noir, pour une utilisation comme source de teinte. Les couches Android sont livrées séparément : ne pas fusionner le foreground avec le fond avant de les fournir au système d’icônes adaptatives. Les exports sont prêts à utiliser ; la configuration de l’application mobile n’a pas été modifiée.

## Reproduire les exports

Depuis le dépôt, avec Node.js et `sharp` 0.35.5 accessibles :

```powershell
node design/brand/ouverture/build-icons.mjs
node design/brand/ouverture/verify-icons.mjs
```

Le petit `package.json` local documente la dépendance d’export ; elle n’est pas ajoutée à l’application. Le générateur lit la police fournie par `apps/web/node_modules/geist`. Il régénère le pack et les fichiers sous `apps/web/public/icons/ouverture/`. Il ne modifie pas le HTML ni le manifeste de l’application.

Les lettres converties en tracés proviennent de Geist ; sa licence est conservée dans `LICENSE-Geist.txt`.

## Références techniques

- [Icônes du manifeste — MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons).
- [Zone de sécurité des icônes maskable — web.dev](https://web.dev/articles/maskable-icon) : le dessin reste dans le cercle central de rayon 40 % de l’image.
- [Déclaration des favicons — MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel#icon).

Le choix créatif provient de la planche générée avec l’outil image intégré ; les exports de ce pack sont produits depuis le tracé SVG, sans nouvelle génération du symbole à chaque taille.
