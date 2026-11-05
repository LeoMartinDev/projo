// Every text of the website, in French and in English. Values are trusted HTML (they may hold
// <strong>, <code>, <a>, <br />): write `&lt;` for a literal `<`, and no double quote in a text
// that lands in an attribute. Types are taken from the French text, like @projo/i18n.

export const fr = {
  meta: {
    homeTitle: 'projo — serveur multimédia open source',
    homeDescription:
      'Un serveur multimédia open source pour vos films et séries. Il identifie vos fichiers, les lit dans le navigateur et tient dans un seul conteneur Docker.',
    ogDescription: 'Vos films et séries, sur votre serveur. Un seul conteneur Docker.',
    changelogTitle: 'Versions — projo',
    changelogDescription:
      'Toutes les versions publiées de projo avec leur date de publication et leurs notes de version.',
    docsTitle: 'Installation — projo',
    docsDescription:
      'Installer projo avec Docker Compose : prérequis, docker-compose.yml, permissions, transcodage matériel, reverse proxy, mises à jour et sauvegarde.',
  },
  nav: {
    skip: 'Aller au contenu',
    main: 'Navigation principale',
    homeLabel: 'projo, accueil',
    features: 'Fonctionnalités',
    interface: 'Interface',
    docs: 'Documentation',
    github: 'GitHub',
    install: 'Installer',
    menu: 'Menu',
    close: 'Fermer',
    home: 'Accueil',
    versions: 'Versions',
    language: 'Langue',
  },
  home: {
    badge: 'Open source · auto-hébergé',
    title: 'Vos films,<br />sur votre serveur.',
    lead: 'Un serveur multimédia open source pour vos films et séries. Il identifie vos fichiers, les lit dans le navigateur et tient dans un seul conteneur Docker.',
    install: 'Installer projo',
    source: 'Code source',
    preview: {
      label: "Aperçu de l'application",
      home: 'Accueil',
      series: 'Séries',
      movies: 'Films',
      list: 'Ma liste',
      meta: 'Série · 2 saisons · S1 É3 dans 12 min',
      resume: 'Reprendre',
    },
    features: {
      title: 'Ce que fait projo',
      lead: "L'essentiel d'un serveur multimédia, sans plugins ni réglages à rallonge.",
    },
    skip: {
      button: "Passer l'intro",
      title: "Passer l'intro, passer le générique",
      text: "Intros et génériques repérés via TheIntroDB, IntroDB et SkipDB, ou par analyse audio locale. L'épisode suivant démarre tout seul.",
    },
    profiles: {
      title: 'Comptes et profils',
      text: "Invitations par lien, jusqu'à 5 profils par compte avec code PIN, accès par bibliothèque et classification maximale.",
    },
    tmdb: {
      title: 'Identification TMDB',
      text: 'Affiches, résumés et casting. Une correction manuelle est conservée aux scans suivants.',
      genre: 'Thriller',
      genre2: 'Policier',
    },
    playback: {
      title: 'Lecture dans le navigateur',
      text: 'Lecture directe, remux ou transcodage, avec un choix de qualité. Transcodage matériel Intel en option.',
      quality: 'Qualité',
    },
    tracks: {
      title: 'Audio et sous-titres',
      text: 'Choisis selon les langues du profil, puis mémorisés par série.',
      language: 'Français',
      forced: 'Forcés',
    },
    libraries: {
      title: 'Bibliothèques en vrac',
      text: "Films et épisodes peuvent être mélangés. Un fichier en cours de copie attend d'être complet.",
      series: 'Série',
      movie: 'Film',
      copying: 'En copie',
    },
    updates: {
      title: "Mises à jour depuis l'admin",
      text: 'Sans toucher au conteneur, avec retour automatique si la nouvelle version ne démarre pas.',
      ready: 'Prête à installer',
      button: 'Mettre à jour',
    },
    screens: {
      title: 'Web, mobile, PWA',
      text: 'Installable comme une app. Interface en français et en anglais.',
      computer: 'Ordi',
      tablet: 'Tablette',
      phone: 'Téléphone',
    },
    room: {
      title: "L'interface",
      text: "Sombre, centrée sur les images, avec le moins de texte possible. Chaque écran est dessiné avant d'être codé.",
      alt: 'Deux personnes regardent un film dans leur salon, le soir',
    },
    player: {
      episode: 'S1 É2 · Sans équipage',
    },
    who: {
      label: 'Choix du profil',
      title: 'Qui regarde ?',
      add: 'Ajouter',
    },
    notDoing: {
      title: 'Ce que projo ne fait pas',
      text: 'Et il ne modifie, ne renomme ni ne déplace jamais vos fichiers.',
      music: 'Musique',
      photos: 'Photos',
      live: 'TV en direct',
      tvApps: 'Apps TV natives',
      cloud: 'Cloud',
      renaming: 'Renommage de fichiers',
    },
    install2: {
      title: 'Installation',
      step1: 'Copiez le <code>docker-compose.yml</code> dans un dossier vide.',
      step2: 'Montez vos dossiers de vidéos, en lecture seule.',
      step3: 'Lancez-le, puis ouvrez <code>http://&lt;machine&gt;:8080</code>.',
      guide: "Guide d'installation",
    },
    footer: 'Open source et auto-hébergé. Les contributions sont bienvenues.',
    links: 'Liens',
  },
  changelog: {
    title: 'Versions',
    lead: 'Toutes les versions publiées de projo, de la plus récente à la plus ancienne. Les notes de version sont en anglais.',
    latest: 'Dernière',
    github: 'Voir sur GitHub',
    empty: 'Voir les versions sur GitHub',
  },
  docs: {
    title: 'Installation',
    lead: 'projo tourne dans un conteneur Docker, avec vos dossiers de vidéos montés en lecture seule.',
    toc: 'Sommaire',
    sections: {
      requirements: 'Prérequis',
      install: 'Installer',
      permissions: 'Utilisateur et permissions',
      gpu: 'Transcodage matériel',
      proxy: 'Derrière un reverse proxy',
      firstRun: 'Premier lancement',
      tmdb: 'Clé TMDB',
      naming: 'Nommer vos fichiers',
      updates: 'Mises à jour',
      backup: 'Sauvegarde et restauration',
      troubleshooting: "Un fichier n'apparaît pas",
    },
    requirements: {
      machine:
        'Une machine <strong>Linux x86_64 ou arm64</strong> avec Docker et Docker Compose v2. Un NAS Synology convient.',
      videos: '<strong>Vos vidéos</strong> sur un disque que cette machine peut lire.',
      tmdb: 'Une <strong>clé API TMDB</strong>, gratuite, sur <a href="https://www.themoviedb.org/">themoviedb.org</a> (Paramètres → API). Sans elle, pas d\'affiches ni d\'identification.',
      browser:
        'Un <strong>navigateur récent</strong> : Chrome, Edge, Firefox, Safari, sur ordinateur ou mobile.',
      note: "Le transcodage se fait par défaut sur le processeur. Son cache occupe jusqu'à 10 Go dans <code>/data</code> (réglable).",
    },
    install: {
      step1: '1. Créez le fichier <code>docker-compose.yml</code>',
      folder: 'Dans un dossier vide dédié à projo :',
      moviesDir: 'films',
      showsDir: 'series',
      system: 'Système',
      synologyHint: 'Container Manager › Projet › Créer, avec ce fichier',
      synologyUser: "l'utilisateur propriétaire de vos vidéos",
      step2: '2. Adaptez-le',
      data: "Tout ce que projo écrit : base de données, images, caches, versions de l'app. <strong>Le seul dossier à sauvegarder.</strong>",
      media:
        "Vos vidéos, en lecture seule, une ligne par dossier. Vous les choisirez ensuite dans l'interface.",
      port: 'Le port publié. Pour un autre, changez le premier nombre : <code>9000:8080</code>.',
      trustProxy:
        '<code>false</code> si les navigateurs se connectent directement à projo. Voir <a href="#proxy">reverse proxy</a>.',
      grace: "Laisse 30 s à projo pour s'arrêter proprement (lectures, tâches en cours).",
      step3: '3. Démarrez',
      logs: 'Ctrl+C pour quitter, projo continue de tourner',
    },
    permissions: {
      user: "Dans le conteneur, projo tourne en tant qu'utilisateur <strong>uid 1000, gid 1000</strong>, jamais en root. Au démarrage, il s'approprie <code>/data</code> si besoin, puis abandonne les droits root.",
      readable:
        "Vos vidéos doivent être <strong>lisibles par l'uid 1000</strong>. Vérifiez avec <code>ls -ln /srv/films</code>. Sinon, rendez-les lisibles par tous, ou lancez projo avec l'utilisateur propriétaire des fichiers :",
      orCompose: 'ou, dans docker-compose.yml :',
      owner: 'uid:gid propriétaire de vos vidéos',
      chown:
        "Avec <code>user:</code>, rien n'est modifié au démarrage : <code>projo-data</code> doit appartenir à cet utilisateur (<code>sudo chown -R 1001:1001 projo-data</code>).",
    },
    gpu: {
      tag: 'Optionnel · Intel iGPU',
      text: "Sur une machine x86_64 avec un GPU Intel intégré, projo peut transcoder avec VAAPI plutôt qu'avec le processeur. Si le GPU refuse un fichier, projo repasse seul sur le processeur et le signale.",
      step1:
        'Trouvez le groupe propriétaire du nœud de rendu : <code>ls -ln /dev/dri</code> (4ᵉ colonne de <code>renderD128</code>). Sur Synology : <code>grep videodriver /etc/group</code>.',
      step2: 'Dans <code>docker-compose.yml</code>, ajoutez :',
      number: "le numéro trouvé à l'étape 1",
      step3:
        '<code>docker compose up -d</code>, puis activez <strong>Administration › Lecture › Transcodage matériel (VAAPI)</strong>.',
    },
    proxy: {
      text: "Pour un accès depuis l'extérieur en HTTPS avec un nom de domaine, placez projo derrière un reverse proxy (Caddy, Traefik, Nginx Proxy Manager…) et passez <strong><code>TRUST_PROXY=true</code></strong>. projo connaît alors la vraie IP de chaque visiteur et son adresse publique, nécessaires à la connexion.",
      warning:
        "N'activez jamais <code>TRUST_PROXY</code> si projo reste joignable sans passer par le proxy : publiez le port en local uniquement.",
      caddy: 'Exemple avec Caddy, certificat HTTPS automatique :',
      nginx:
        "Avec Nginx : transmettez <code>Host</code>, <code>X-Forwarded-For</code> et <code>X-Forwarded-Proto</code>, désactivez le buffering (<code>proxy_buffering off</code>) et autorisez 10 Mo d'envoi (<code>client_max_body_size 10m</code>).",
    },
    firstRun: {
      step1: 'Ouvrez <code>http://&lt;machine&gt;:8080</code>.',
      step2:
        'Créez le compte administrateur, puis choisissez les dossiers de la première bibliothèque dans <code>/media</code>.',
      step3: "Le premier scan démarre : les fichiers apparaissent au fil de l'eau.",
      then: "Ensuite, depuis l'avatar → <strong>Administration</strong> : ajoutez d'autres bibliothèques, invitez votre famille (<strong>Comptes</strong> → lien d'invitation à usage unique, valable 7 jours), réglez la lecture.",
    },
    tmdb: {
      key: "<strong>Administration → Métadonnées → Clé API TMDB</strong> : collez la clé API ou le jeton d'accès en lecture. projo la vérifie, puis relance l'identification de tous les fichiers en attente.",
      review:
        "Les fichiers que projo ne peut pas identifier avec certitude vont dans <strong>À vérifier</strong>. Un titre mal reconnu se corrige depuis sa fiche (menu ⋮ → Corriger l'identification), et projo s'en souvient.",
    },
    naming: {
      intro:
        "projo ne renomme et ne déplace rien : il lit le titre, l'année et le numéro d'épisode dans les noms. Les noms de release habituels conviennent (<code>1080p</code>, <code>x265</code>, <code>MULTi</code>, <code>VFF</code>, <code>[groupe]</code>… sont ignorés).",
      movies: 'Films : <code>Titre (année)</code>',
      moviesFolder: 'Films',
      shows: 'Séries : un dossier par série, un par saison',
      showsFolder: 'Series',
      year: "<strong>L'année</strong> est facultative mais départage les homonymes : <code>Dune (1984)</code> / <code>Dune (2021)</code>.",
      id: '<strong>Un identifiant</strong> évite la recherche : <code>Inception (2010) {tmdb-27205}.mkv</code> ou <code>Breaking Bad (2008) [tmdbid-1396]</code>.',
      editions:
        "<strong>Éditions</strong> : <code>{edition-Extended Cut}</code>, ou <code>Director's Cut</code>, <code>IMAX</code>… après un tiret. Deux fichiers d'un même film en sont deux versions.",
    },
    updates: {
      app: "L'application",
      appText:
        "<strong>Administration → Mises à jour.</strong> projo vérifie chaque jour, affiche les notes de version et s'installe en un clic. La base est sauvegardée avant ; si la nouvelle version ne démarre pas en 60 s, projo revient seul à la précédente.",
      image: "L'image Docker",
      imageText:
        'Rarement nécessaire : la page Mises à jour le signale quand une version demande une image plus récente.',
    },
    backup: {
      intro: "Tout l'état de projo est dans <code>projo-data</code> :",
      db: 'la base : comptes, progression, métadonnées, réglages',
      backups: 'sauvegardes automatiques et exports',
      images: 'affiches, fonds, images envoyées',
      app: "versions installées de l'application",
      cache: 'régénéré, inutile de le sauvegarder',
      save: 'Sauvegarder',
      save1:
        '<strong>Administration → Serveur → Exporter la base</strong> : une copie cohérente, sans arrêter projo.',
      save2:
        'Copiez <code>projo-data</code> sans <code>cache/</code> : <code>rsync -a --exclude cache/ projo-data/ /backup/projo-data/</code>.',
      restore: 'Restaurer',
      restore2:
        'Remettez le dossier sauvegardé à la place de <code>projo-data</code>. Depuis un export : copiez-le en <code>db/projo.db</code> et supprimez <code>db/projo.db-wal</code> et <code>db/projo.db-shm</code>.',
      restore3:
        "<code>docker compose start</code>. Rien n'est perdu tant que les chemins sous <code>/media</code> sont les mêmes.",
    },
    troubleshooting: {
      intro: "Tout se diagnostique depuis l'administration, sans terminal :",
      pending: 'En attente',
      pendingText:
        "Vu mais pas encore affiché : en cours d'écriture, illisible, endommagé ou trop petit. La raison est indiquée.",
      review: 'À vérifier',
      reviewText:
        "Affiché sous le nom du fichier, faute d'identification certaine. « Identifier » cherche le bon titre.",
      missing: 'Manquants',
      missingText: "Disparu du disque. Il revient tel quel s'il réapparaît au même endroit.",
      jobs: 'Tâches',
      jobsText:
        'Scans, analyses et identifications en attente, en cours ou en échec, avec « Réessayer ».',
      last: "Absent de toutes ces listes ? Vérifiez l'extension (<code>mkv mp4 m4v mov avi webm ts m2ts wmv</code>), que le dossier fait partie d'une bibliothèque et qu'il est lisible par l'uid 1000. En dernier recours : <code>docker compose logs projo</code>.",
    },
    help: 'Une question, un bug ?',
    issue: 'Ouvrir une issue',
  },
}

export type Messages = typeof fr

export const en: Messages = {
  meta: {
    homeTitle: 'projo — open source media server',
    homeDescription:
      'An open source media server for your movies and shows. It identifies your files, plays them in the browser and fits in a single Docker container.',
    ogDescription: 'Your movies and shows, on your own server. One Docker container.',
    changelogTitle: 'Releases — projo',
    changelogDescription:
      'Every published version of projo with its publication date and release notes.',
    docsTitle: 'Installation — projo',
    docsDescription:
      'Install projo with Docker Compose: requirements, docker-compose.yml, permissions, hardware transcoding, reverse proxy, updates and backups.',
  },
  nav: {
    skip: 'Skip to content',
    main: 'Main navigation',
    homeLabel: 'projo, home',
    features: 'Features',
    interface: 'Interface',
    docs: 'Documentation',
    github: 'GitHub',
    install: 'Install',
    menu: 'Menu',
    close: 'Close',
    home: 'Home',
    versions: 'Releases',
    language: 'Language',
  },
  home: {
    badge: 'Open source · self-hosted',
    title: 'Your movies,<br />on your server.',
    lead: 'An open source media server for your movies and shows. It identifies your files, plays them in the browser and fits in a single Docker container.',
    install: 'Install projo',
    source: 'Source code',
    preview: {
      label: 'Preview of the app',
      home: 'Home',
      series: 'Shows',
      movies: 'Movies',
      list: 'My list',
      meta: 'Show · 2 seasons · S1 E3, 12 min left',
      resume: 'Resume',
    },
    features: {
      title: 'What projo does',
      lead: 'The essentials of a media server, without plugins or endless settings.',
    },
    skip: {
      button: 'Skip intro',
      title: 'Skip the intro, skip the credits',
      text: 'Intros and credits found through TheIntroDB, IntroDB and SkipDB, or by local audio analysis. The next episode starts on its own.',
    },
    profiles: {
      title: 'Accounts and profiles',
      text: 'Invitations by link, up to 5 profiles per account with a PIN, per-library access and a maximum content rating.',
    },
    tmdb: {
      title: 'TMDB identification',
      text: 'Posters, overviews and cast. A manual fix is kept on later scans.',
      genre: 'Thriller',
      genre2: 'Crime',
    },
    playback: {
      title: 'Plays in the browser',
      text: 'Direct play, remux or transcode, with a quality picker. Optional Intel hardware transcoding.',
      quality: 'Quality',
    },
    tracks: {
      title: 'Audio and subtitles',
      text: "Picked from the profile's languages, then remembered per show.",
      language: 'English',
      forced: 'Forced',
    },
    libraries: {
      title: 'Messy libraries',
      text: 'Movies and episodes can be mixed together. A file still being copied waits until it is complete.',
      series: 'Show',
      movie: 'Movie',
      copying: 'Copying',
    },
    updates: {
      title: 'Updates from the admin',
      text: 'No need to touch the container, and an automatic rollback if the new version does not start.',
      ready: 'Ready to install',
      button: 'Update',
    },
    screens: {
      title: 'Web, mobile, PWA',
      text: 'Installable as an app. Interface in English and French.',
      computer: 'Desktop',
      tablet: 'Tablet',
      phone: 'Phone',
    },
    room: {
      title: 'The interface',
      text: 'Dark, built around the artwork, with as little text as possible. Every screen is designed before it is coded.',
      alt: 'Two people watching a film in their living room, in the evening',
    },
    player: {
      episode: 'S1 E2 · No crew',
    },
    who: {
      label: 'Profile picker',
      title: "Who's watching?",
      add: 'Add',
    },
    notDoing: {
      title: 'What projo does not do',
      text: 'And it never modifies, renames or moves your files.',
      music: 'Music',
      photos: 'Photos',
      live: 'Live TV',
      tvApps: 'Native TV apps',
      cloud: 'Cloud',
      renaming: 'File renaming',
    },
    install2: {
      title: 'Installation',
      step1: 'Copy <code>docker-compose.yml</code> into an empty folder.',
      step2: 'Mount your video folders, read-only.',
      step3: 'Start it, then open <code>http://&lt;machine&gt;:8080</code>.',
      guide: 'Installation guide',
    },
    footer: 'Open source and self-hosted. Contributions are welcome.',
    links: 'Links',
  },
  changelog: {
    title: 'Releases',
    lead: 'Every published version of projo, newest first.',
    latest: 'Latest',
    github: 'View on GitHub',
    empty: 'See the releases on GitHub',
  },
  docs: {
    title: 'Installation',
    lead: 'projo runs in a Docker container, with your video folders mounted read-only.',
    toc: 'Contents',
    sections: {
      requirements: 'Requirements',
      install: 'Install',
      permissions: 'User and permissions',
      gpu: 'Hardware transcoding',
      proxy: 'Behind a reverse proxy',
      firstRun: 'First launch',
      tmdb: 'TMDB key',
      naming: 'Naming your files',
      updates: 'Updates',
      backup: 'Backup and restore',
      troubleshooting: 'A file does not show up',
    },
    requirements: {
      machine:
        'A <strong>Linux x86_64 or arm64</strong> machine with Docker and Docker Compose v2. A Synology NAS works.',
      videos: '<strong>Your videos</strong> on a disk this machine can read.',
      tmdb: 'A free <strong>TMDB API key</strong> from <a href="https://www.themoviedb.org/">themoviedb.org</a> (Settings → API). Without it, no posters and no identification.',
      browser:
        'A <strong>recent browser</strong>: Chrome, Edge, Firefox, Safari, on a computer or a phone.',
      note: 'Transcoding runs on the CPU by default. Its cache takes up to 10 GB in <code>/data</code> (configurable).',
    },
    install: {
      step1: '1. Create <code>docker-compose.yml</code>',
      folder: 'In an empty folder for projo:',
      moviesDir: 'movies',
      showsDir: 'shows',
      system: 'System',
      synologyHint: 'Container Manager › Project › Create, with this file',
      synologyUser: 'the user who owns your videos',
      step2: '2. Adapt it',
      data: 'Everything projo writes: database, images, caches, app versions. <strong>The only folder to back up.</strong>',
      media: 'Your videos, read-only, one line per folder. You pick them later in the interface.',
      port: 'The published port. For another one, change the first number: <code>9000:8080</code>.',
      trustProxy:
        '<code>false</code> when browsers connect to projo directly. See <a href="#proxy">reverse proxy</a>.',
      grace: 'Gives projo 30 s to shut down cleanly (playback, running jobs).',
      step3: '3. Start it',
      logs: 'Ctrl+C to quit, projo keeps running',
    },
    permissions: {
      user: 'Inside the container, projo runs as user <strong>uid 1000, gid 1000</strong>, never as root. On startup it takes ownership of <code>/data</code> if needed, then drops root privileges.',
      readable:
        'Your videos must be <strong>readable by uid 1000</strong>. Check with <code>ls -ln /srv/movies</code>. Otherwise, make them world-readable, or run projo as the user who owns the files:',
      orCompose: 'or, in docker-compose.yml:',
      owner: 'uid:gid owning your videos',
      chown:
        'With <code>user:</code>, nothing is changed on startup: <code>projo-data</code> must belong to that user (<code>sudo chown -R 1001:1001 projo-data</code>).',
    },
    gpu: {
      tag: 'Optional · Intel iGPU',
      text: 'On an x86_64 machine with an Intel integrated GPU, projo can transcode with VAAPI instead of the CPU. If the GPU refuses a file, projo falls back to the CPU on its own and says so.',
      step1:
        'Find the group that owns the render node: <code>ls -ln /dev/dri</code> (4th column of <code>renderD128</code>). On Synology: <code>grep videodriver /etc/group</code>.',
      step2: 'In <code>docker-compose.yml</code>, add:',
      number: 'the number found in step 1',
      step3:
        '<code>docker compose up -d</code>, then turn on <strong>Administration › Playback › Hardware transcoding (VAAPI)</strong>.',
    },
    proxy: {
      text: 'For access from outside with HTTPS and a domain name, put projo behind a reverse proxy (Caddy, Traefik, Nginx Proxy Manager…) and set <strong><code>TRUST_PROXY=true</code></strong>. projo then knows the real IP of each visitor and its public address, both needed to sign in.',
      warning:
        'Never enable <code>TRUST_PROXY</code> if projo can be reached without going through the proxy: only publish the port locally.',
      caddy: 'Example with Caddy, automatic HTTPS certificate:',
      nginx:
        'With Nginx: forward <code>Host</code>, <code>X-Forwarded-For</code> and <code>X-Forwarded-Proto</code>, turn off buffering (<code>proxy_buffering off</code>) and allow 10 MB uploads (<code>client_max_body_size 10m</code>).',
    },
    firstRun: {
      step1: 'Open <code>http://&lt;machine&gt;:8080</code>.',
      step2:
        'Create the administrator account, then pick the folders of the first library in <code>/media</code>.',
      step3: 'The first scan starts: files show up as it goes.',
      then: 'Then, from the avatar → <strong>Administration</strong>: add more libraries, invite your family (<strong>Accounts</strong> → single-use invitation link, valid for 7 days), tune playback.',
    },
    tmdb: {
      key: '<strong>Administration → Metadata → TMDB API key</strong>: paste the API key or the read access token. projo checks it, then retries identification of every waiting file.',
      review:
        'Files projo cannot identify with certainty go to <strong>To review</strong>. A wrongly identified title is fixed from its page (⋮ menu → Fix the match), and projo remembers it.',
    },
    naming: {
      intro:
        'projo renames and moves nothing: it reads the title, year and episode number from the names. Usual release names are fine (<code>1080p</code>, <code>x265</code>, <code>MULTi</code>, <code>VFF</code>, <code>[group]</code>… are ignored).',
      movies: 'Movies: <code>Title (year)</code>',
      moviesFolder: 'Movies',
      shows: 'Shows: one folder per show, one per season',
      showsFolder: 'Shows',
      year: '<strong>The year</strong> is optional but separates titles with the same name: <code>Dune (1984)</code> / <code>Dune (2021)</code>.',
      id: '<strong>An id</strong> skips the search: <code>Inception (2010) {tmdb-27205}.mkv</code> or <code>Breaking Bad (2008) [tmdbid-1396]</code>.',
      editions:
        "<strong>Editions</strong>: <code>{edition-Extended Cut}</code>, or <code>Director's Cut</code>, <code>IMAX</code>… after a dash. Two files of the same movie are two versions of it.",
    },
    updates: {
      app: 'The application',
      appText:
        '<strong>Administration → Updates.</strong> projo checks every day, shows the release notes and installs in one click. The database is backed up first; if the new version does not start within 60 s, projo goes back to the previous one on its own.',
      image: 'The Docker image',
      imageText: 'Rarely needed: the Updates page says so when a version needs a newer image.',
    },
    backup: {
      intro: 'All of projo’s state is in <code>projo-data</code>:',
      db: 'the database: accounts, progress, metadata, settings',
      backups: 'automatic backups and exports',
      images: 'posters, backdrops, uploaded images',
      app: 'installed application versions',
      cache: 'regenerated, no need to back it up',
      save: 'Back up',
      save1:
        '<strong>Administration → Server → Export the database</strong>: a consistent copy, without stopping projo.',
      save2:
        'Copy <code>projo-data</code> without <code>cache/</code>: <code>rsync -a --exclude cache/ projo-data/ /backup/projo-data/</code>.',
      restore: 'Restore',
      restore2:
        'Put the backed-up folder in place of <code>projo-data</code>. From an export: copy it to <code>db/projo.db</code> and delete <code>db/projo.db-wal</code> and <code>db/projo.db-shm</code>.',
      restore3:
        '<code>docker compose start</code>. Nothing is lost as long as the paths under <code>/media</code> stay the same.',
    },
    troubleshooting: {
      intro: 'Everything can be diagnosed from the admin, without a terminal:',
      pending: 'Pending',
      pendingText:
        'Seen but not shown yet: being written, unreadable, damaged or too small. The reason is given.',
      review: 'To review',
      reviewText:
        'Shown under its file name, for lack of a certain identification. “Identify” searches for the right title.',
      missing: 'Missing',
      missingText: 'Gone from the disk. It comes back as it was if it returns to the same place.',
      jobs: 'Jobs',
      jobsText: 'Scans, analyses and identifications queued, running or failed, with “Retry”.',
      last: 'In none of these lists? Check the extension (<code>mkv mp4 m4v mov avi webm ts m2ts wmv</code>), that the folder is part of a library and that uid 1000 can read it. As a last resort: <code>docker compose logs projo</code>.',
    },
    help: 'A question, a bug?',
    issue: 'Open an issue',
  },
}
