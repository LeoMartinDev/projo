# Cinematic backdrops

Created on 2026-11-05 with the built-in ImageGen tool for Projo's existing entry screens. These six original environments replace the sample backdrops; they are not movie artwork.

The runtime files live in `packages/design/backdrops/` and retain their existing names so web, mobile and the ready-screen wall use the same series. Each is a 1600 × 900 opaque WebP, encoded with libwebp at quality 84 and compression level 6. Original generation size: 1672 × 941. No baked-in UI, lettering or gradients; the app supplies the shading. Web entry backdrops are static. Sign-in adds restrained desaturation and a soft vignette in CSS; mobile retains its native treatment.

| Asset | Direction | Usage |
|---|---|---|
| dunes.webp | Amber rim-lit dune crests, wind-etched sand | Welcome, ready wall, mobile |
| ocean.webp | Silver surf, volcanic cliffs, storm light | Sign-in, OAuth, ready wall, mobile |
| mountains.webp | Alpine rock, pale dawn, layered cloud | Administrator account, ready wall |
| lighthouse.webp | Weathered coastal lighthouse, warm lantern in mist | First library, ready wall |
| forest.webp | Old-growth forest, wet ferns, champagne light | Invitations, pairing, ready wall, mobile |
| city.webp | Rainy blue-hour skyline, amber windows | Ready wall, mobile |

The original sample artwork remains in `design/artboards/blobs/` as part of the archived design canvas. The runtime assets above are the current backdrop reference.

## Exact generation prompts

### dunes

```text
Use case: photorealistic-natural.
Asset type: full-bleed cinematic environment background for Projo, an elegant dark movie library app, monochrome white type and smoked-glass panels over near-black #0A0A0B.
Create one extraordinary photorealistic cinema frame, landscape 16:9, preferably 2560x1440 or larger. An immersive premium film still with believable natural textures, restrained color, deep layered shadows, soft halation, extremely subtle 35mm grain and atmospheric perspective. Fine detail, beautiful controlled highlights, not an illustration, not plastic CGI, not a travel advertisement, not HDR. Image only, edge to edge; absolutely no text, letters, logos, watermark, borders, letterboxing, UI, collages or panels. Keep enough image detail in shadows for the app's own shading overlays. Scene: a vast remote desert just before sunrise, monumental sweeping dunes receding into pale airborne dust. Elegant S-curves, finely wind-etched sand, a razor thin molten amber rim of dawn along the central dune crest, charcoal umber foreground, muted burnt copper and soft champagne haze. A tiny sun obscured by haze, no giant glowing disc. Epic scale and tactile realism, camera low with a 40mm anamorphic feel. Composition: sculptural main ridgeline at 58% width, upper middle height; upper half atmospheric, lower-left 45% is quiet dark sand for a very large white welcome title. Centre crop must still feel compelling on a portrait phone. No people, buildings, vegetation or props.
```

### ocean

```text
Use case: photorealistic-natural.
Asset type: full-bleed cinematic environment background for Projo, an elegant dark movie library app, monochrome white type and smoked-glass panels over near-black #0A0A0B.
Create one extraordinary photorealistic cinema frame, landscape 16:9, preferably 2560x1440 or larger. An immersive premium film still with believable natural textures, restrained color, deep layered shadows, soft halation, extremely subtle 35mm grain and atmospheric perspective. Fine detail, beautiful controlled highlights, not an illustration, not plastic CGI, not a travel advertisement, not HDR. Image only, edge to edge; absolutely no text, letters, logos, watermark, borders, letterboxing, UI, collages or panels. Keep enough image detail in shadows for the app's own shading overlays. Scene: a rugged black volcanic coastline at blue hour, viewed from a dark rocky shore, a long elegant curling Atlantic wave breaking diagonally through the left and central middle distance, delicate silver foam and drifting sea spray lit by a narrow break in dense storm clouds. Rich ink blue and desaturated petrol water, faint pearl light on the horizon, monumental dark sea stacks dissolved into distant mist at 40% width. Not a fantasy tsunami; physically convincing ocean, calm cinematic tension. Composition: main illuminated foam at 38-55% width, broad breathing space, the rightmost 35% quieter dark water and shadow for a login glass panel. Centre composition works in portrait crops. No obvious moon, people, boats, structures or props.
```

### mountains

```text
Use case: photorealistic-natural.
Asset type: full-bleed cinematic environment background for Projo, an elegant dark movie library app, monochrome white type and smoked-glass panels over near-black #0A0A0B.
Create one extraordinary photorealistic cinema frame, landscape 16:9, preferably 2560x1440 or larger. An immersive premium film still with believable natural textures, restrained color, deep layered shadows, soft halation, extremely subtle 35mm grain and atmospheric perspective. Fine detail, beautiful controlled highlights, not an illustration, not plastic CGI, not a travel advertisement, not HDR. Image only, edge to edge; absolutely no text, letters, logos, watermark, borders, letterboxing, UI, collages or panels. Keep enough image detail in shadows for the app's own shading overlays. Scene: a majestic alpine valley at the threshold of dawn, needle-like rock spires rising through slow layers of cloud, fresh snow caught in their crevices. A blade of pale apricot sunlight touches only the highest central peak, the lower rock is slate blue, graphite, and muted steel, with luminous silver fog flowing across the valley below. Shot from across a dark rocky ridge, immense depth and scale. Composition: the dominant peak at 53% width and 35% height, its silhouette stays beautiful in a centre portrait crop; lower-left is dark mountain shadow for a white headline, rightmost third quiet atmospheric charcoal fog for a smoked-glass form. Restrained natural photographic grade, not orange-and-teal blockbuster saturation. No people, huts, trees, roads or fantasy architecture.
```

### lighthouse

```text
Use case: photorealistic-natural.
Asset type: full-bleed cinematic environment background for Projo, an elegant dark movie library app, monochrome white type and smoked-glass panels over near-black #0A0A0B.
Create one extraordinary photorealistic cinema frame, landscape 16:9, preferably 2560x1440 or larger. An immersive premium film still with believable natural textures, restrained color, deep layered shadows, soft halation, extremely subtle 35mm grain and atmospheric perspective. Fine detail, beautiful controlled highlights, not an illustration, not plastic CGI, not a travel advertisement, not HDR. Image only, edge to edge; absolutely no text, letters, logos, watermark, borders, letterboxing, UI, collages or panels. Keep enough image detail in shadows for the app's own shading overlays. Scene: an isolated weathered lighthouse on a windswept black-rock promontory at dusk, a small warm ivory lantern glowing through fine coastal mist. A single subtle plausible beam dissolves into humid air. The lighthouse sits just left of centre at 45% width, enough to be visible in a portrait centre crop; layered jagged cliffs lead towards it through the foreground; a dark desaturated Atlantic rolls below; horizon lost in smoky blue-grey rain and a tiny distant streak of amber twilight. Luminous fog, textured basalt and wild grass, quiet mystery and invitation. Composition: wide breathing room, main lighthouse occupies no more than 18% image height, lower-left shadows support a headline, rightmost third dark quiet sea and fog for a library setup form. No people, boats, oversized moon, extra buildings, fantastical lasers or lettering.
```

### forest

```text
Use case: photorealistic-natural.
Asset type: full-bleed cinematic environment background for Projo, an elegant dark movie library app, monochrome white type and smoked-glass panels over near-black #0A0A0B.
Create one extraordinary photorealistic cinema frame, landscape 16:9, preferably 2560x1440 or larger. An immersive premium film still with believable natural textures, restrained color, deep layered shadows, soft halation, extremely subtle 35mm grain and atmospheric perspective. Fine detail, beautiful controlled highlights, not an illustration, not plastic CGI, not a travel advertisement, not HDR. Image only, edge to edge; absolutely no text, letters, logos, watermark, borders, letterboxing, UI, collages or panels. Keep enough image detail in shadows for the app's own shading overlays. Scene: a towering old-growth conifer forest in a remote temperate rainforest at first light, almost black trunks framing a deep mist-filled corridor through the centre, light entering diagonally from far above and behind at 48% width. A small patch of warm champagne morning light touches wet fern leaves and moss along a barely visible woodland trail in the middle distance; the rest is desaturated pine green, charcoal, slate and silver fog. Shafts of sunlight are gentle, believable, veiled by depth, never theatrical laser beams. Tactile bark, fine fern silhouettes and richly layered atmosphere. Composition: tall strong graphic silhouettes and tranquil negative space, main luminous opening centred for phone crops, rightmost third quietly dark for a glass invitation form, bottom in soft shadow. No people, animals, buildings or fantasy lights.
```

### city

```text
Use case: photorealistic-natural.
Asset type: full-bleed cinematic environment background for Projo, an elegant dark movie library app, monochrome white type and smoked-glass panels over near-black #0A0A0B.
Create one extraordinary photorealistic cinema frame, landscape 16:9, preferably 2560x1440 or larger. An immersive premium film still with believable natural textures, restrained color, deep layered shadows, soft halation, extremely subtle 35mm grain and atmospheric perspective. Fine detail, beautiful controlled highlights, not an illustration, not plastic CGI, not a travel advertisement, not HDR. Image only, edge to edge; absolutely no text, letters, logos, watermark, borders, letterboxing, UI, collages or panels. Keep enough image detail in shadows for the app's own shading overlays. Scene: an immense anonymous modern city after rain at blue hour, cinematic aerial viewpoint from a mid-rise rooftop over a canyon of dark glass and stone towers receding into low silver mist. Slender amber reflections from a few apartment windows and tiny street lamps trace a road far below; delicate diffuse pearl light catches a rooftop edge near the centre. Realistic dense urban geometry, rich wet surfaces, layers of atmospheric depth, ink blue, smoke grey, restrained amber. Sophisticated neo-noir mood, no overwhelming neon. Composition: broad panoramic view, main architectural cluster in central half and at 45% width so portrait cropping remains striking; quietly shadowed right third and lower foreground suit overlay panels and white typography. No visible signs, advertising, readable text, logos, people, futuristic flying vehicles, giant sun or moon.
```

