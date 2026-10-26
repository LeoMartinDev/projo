/** Real-world names "en vrac", library hints, mixed folders and ambiguous cases. The §8 table itself is in `naming-table.test.ts`. */
import { describe, expect, test } from 'bun:test'

import { analyzeMediaPath } from './analyze'
import type { LibraryHint, ParsedName } from './types'

const analyze = (relativePath: string, hint: LibraryHint = 'auto') =>
  analyzeMediaPath({ relativePath, hint })

describe('films : noms de release réels', () => {
  test.each<[string, ParsedName]>([
    // scene
    ['Inception.2010.1080p.BluRay.x264-SPARKS.mkv', { title: 'Inception', year: 2010 }],
    [
      'The.French.Connection.1971.REMASTERED.1080p.BluRay.x264.mkv',
      { title: 'The French Connection', year: 1971, edition: 'remastered' },
    ],
    [
      'Blade.Runner.2049.2017.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-EPSiLON.mkv',
      { title: 'Blade Runner 2049', year: 2017 },
    ],
    [
      'Spider-Man.No.Way.Home.2021.1080p.WEB-DL.DDP5.1.H.264-EVO.mkv',
      { title: 'Spider-Man No Way Home', year: 2021 },
    ],
    ["Ocean's.Eleven.2001.720p.BRRip.mkv", { title: "Ocean's Eleven", year: 2001 }],
    ['Kill.Bill.Vol.1.2003.1080p.mkv', { title: 'Kill Bill Vol 1', year: 2003 }],
    ['1917.2019.1080p.BluRay.mkv', { title: '1917', year: 2019 }],
    ['2001.A.Space.Odyssey.1968.1080p.mkv', { title: '2001 A Space Odyssey', year: 1968 }],
    ['E.T.the.Extra-Terrestrial.1982.mkv', { title: 'E.T the Extra-Terrestrial', year: 1982 }],
    [
      'Mission.Impossible.Dead.Reckoning.Part.One.2023.mkv',
      { title: 'Mission Impossible Dead Reckoning Part One', year: 2023 },
    ],
    [
      'Harry.Potter.and.the.Deathly.Hallows.Part.1.2010.1080p.mkv',
      { title: 'Harry Potter and the Deathly Hallows Part 1', year: 2010 },
    ],
    ['the.matrix.1999.mkv', { title: 'The Matrix', year: 1999 }],
    ['INCEPTION.2010.DVDRip.avi', { title: 'Inception', year: 2010 }],
    ['Heat.1995.DC.1080p.mkv', { title: 'Heat', year: 1995 }],
    ['Avatar.2009.EXTENDED.Cut.1080p.mkv', { title: 'Avatar', year: 2009, edition: 'extended' }],
    // torrents
    ['Inception (2010) [1080p] [BluRay] [5.1] [YTS.MX].mp4', { title: 'Inception', year: 2010 }],
    ['[YTS.MX] Inception (2010).mp4', { title: 'Inception', year: 2010 }],
    ['Inception 2010 1080p BrRip x264 - YIFY.mp4', { title: 'Inception', year: 2010 }],
    // Radarr
    ['The Matrix (1999)/The Matrix (1999) Bluray-1080p.mkv', { title: 'The Matrix', year: 1999 }],
    [
      'The Matrix (1999) [imdbid-tt0133093]/The Matrix (1999) {edition-Remastered} [imdbid-tt0133093] Bluray-2160p.mkv',
      { title: 'The Matrix', year: 1999, editionName: 'Remastered', ids: { imdb: 'tt0133093' } },
    ],
    [
      'WALL-E (2008)/WALL-E (2008) [tmdbid-10681] - WEBDL-1080p.mkv',
      { title: 'Wall-E', year: 2008, ids: { tmdb: 10681 } },
    ],
    // French releases
    [
      'Astérix.et.Obélix.Mission.Cléopâtre.2002.FRENCH.1080p.BluRay.x264-LOST.mkv',
      { title: 'Astérix et Obélix Mission Cléopâtre', year: 2002 },
    ],
    ['Intouchables.2011.TRUEFRENCH.DVDRip.XviD-xxx.avi', { title: 'Intouchables', year: 2011 }],
    [
      'Inception.2010.MULTi.TRUEFRENCH.1080p.BluRay.x264-FtLi.mkv',
      { title: 'Inception', year: 2010 },
    ],
    ['Le.Diner.de.Cons.1998.VFF.1080p.mkv', { title: 'Le Diner de Cons', year: 1998 }],
    ['Les.Visiteurs.1993.VOSTFR.720p.mkv', { title: 'Les Visiteurs', year: 1993 }],
    [
      'OSS.117.Le.Caire.Nid.D.Espions.2006.FRENCH.mkv',
      { title: 'OSS 117 Le Caire Nid D Espions', year: 2006 },
    ],
    ['La.Haine.MULTi.VFF.1080p.mkv', { title: 'La Haine' }],
    // channel layout glued to the codec (`5.1x265`) or a resolution: not an `NxNN` episode
    [
      'Furiosa.une.Saga.Mad Max.2024.MULTi.VFF.4K.2160p.10bit.HDR10Plus.DV.WEBRip.DDP.Atmos.5.1x265-Elcrackito (Furiosa A Mad Max Saga).mkv',
      { title: 'Furiosa une Saga Mad Max', year: 2024 },
    ],
    [
      'Dune.Deuxieme.Partie.2024.MULTi.TRUEFRENCH.1080p.WEB.H264.DDP5.1x264-FW.mkv',
      { title: 'Dune Deuxieme Partie', year: 2024 },
    ],
    ['Oppenheimer.2023.MULTi.1080p.WEB.DDP.5.1x264-GRP.mkv', { title: 'Oppenheimer', year: 2023 }],
    [
      'Oppenheimer.2023.MULTi.2160p.UHD.BluRay.TrueHD.Atmos.7.1.x265-GRP.mkv',
      { title: 'Oppenheimer', year: 2023 },
    ],
    ['Barbie.2023.VFF.1080p.WEB.AAC.2.0.x265-GRP.mkv', { title: 'Barbie', year: 2023 }],
    ['Barbie.2023.VFF.1080p.WEB.AAC2.0x265-GRP.mkv', { title: 'Barbie', year: 2023 }],
    ['Barbie.VFF.1080p.WEB.AAC2.0x265-GRP.mkv', { title: 'Barbie' }],
    [
      'Le.Comte.de.Monte-Cristo.2024.1920x1080.x264.mkv',
      { title: 'Le Comte de Monte-Cristo', year: 2024 },
    ],
    ['Heat.1995.DTS-HD.MA.7.1x264-GRP.mkv', { title: 'Heat', year: 1995 }],
    ['Heat.1995.TrueHD.Atmos.7.1.4x265-GRP.mkv', { title: 'Heat', year: 1995 }],
    ['Heat [5.1x265].mkv', { title: 'Heat' }],
    // `H.264` without a year: not an absolute episode number
    ['Heat.1080p.WEB-DL.DDP5.1.H.264-GRP.mkv', { title: 'Heat' }],
    ['Heat.1080p.WEB-DL.DDP5.1.H.265-GRP.mkv', { title: 'Heat' }],
    ['The.French.Dispatch.MULTi.1080p.WEB.mkv', { title: 'The French Dispatch' }],
    // folders
    [
      'Downloads/Inception.2010.1080p.BluRay.x264-GRP/Inception.2010.1080p.BluRay.x264-GRP.mkv',
      { title: 'Inception', year: 2010 },
    ],
    [
      'Inception.2010.1080p.BluRay.x264-GRP/grp-inception-1080p.mkv',
      { title: 'Inception', year: 2010 },
    ],
    ['Films/Action/Heat (1995).mkv', { title: 'Heat', year: 1995 }],
    ['Collection Star Wars (1977-2019)/Thor.mkv', { title: 'Thor' }],
    ['Fahrenheit 451 (1966)/Fahrenheit.451.mkv', { title: 'Fahrenheit 451', year: 1966 }],
    ['Fahrenheit 451/Fahrenheit 451.mkv', { title: 'Fahrenheit 451' }],
    ['Apollo 13/Apollo.13.1080p.mkv', { title: 'Apollo 13' }],
    ['Toy.Story.3.1080p.mkv', { title: 'Toy Story 3' }],
    // a number outside a show folder belongs to the title (§8.2 "Absolute numbering")
    ['OSS.117.Rio.ne.répond.plus.mkv', { title: 'OSS 117 Rio ne répond plus' }],
    ['Films/Fahrenheit.451.1080p.mkv', { title: 'Fahrenheit 451' }],
    ['The 355.mkv', { title: 'The 355' }],
    ['(500) Days of Summer (2009).mkv', { title: '(500) Days of Summer', year: 2009 }],
    // tags that are never title words, and title-like words at the end
    ['Le.Film.MULTi.HDLight.mkv', { title: 'Le Film' }],
    [
      'The.Informer.2019.MULTi.1080p.HDLight.x264.AC3-EXTREME.mkv',
      { title: 'The Informer', year: 2019 },
    ],
    ['Under the Skin 2013 MULTIFRENCH 1080p x264.mkv', { title: 'Under the Skin', year: 2013 }],
    ['Le.Film.VOSTA.mkv', { title: 'Le Film' }],
    ['Le Film FR HD.mkv', { title: 'Le Film' }],
  ])('%s', (path, parsed) => {
    const result = analyze(path)
    expect(result.classification).toBe('movie')
    expect(result.parsed).toEqual(parsed)
    expect(result.displayTitle).toBe(parsed.title ?? '')
  })

  test('nom décomposé (NFD, macOS) recomposé', () => {
    expect(analyze('Amélie (2001).mkv').parsed.title).toBe('Amélie')
  })

  test('le fichier gagne quand son année contredit celle du dossier', () => {
    expect(analyze('Heat (1995)/Heat.1986.mkv').parsed).toEqual({ title: 'Heat', year: 1986 })
  })
})

describe('épisodes : noms de release réels', () => {
  test.each<[string, ParsedName]>([
    // scene
    [
      'The.Office.US.S01E01.720p.HDTV.x264-CTU.mkv',
      { series: 'The Office US', season: 1, episode: 1 },
    ],
    [
      'The.Mandalorian.S02E01.Chapter.9.1080p.DSNP.WEB-DL.DDP5.1.Atmos.H.264-NOSIVID.mkv',
      { series: 'The Mandalorian', season: 2, episode: 1, episodeTitle: 'Chapter 9' },
    ],
    [
      "Marvel's.Agents.of.S.H.I.E.L.D.S01E01.mkv",
      { series: "Marvel's Agents of S.H.I.E.L.D", season: 1, episode: 1 },
    ],
    ['Mr.Robot.S01E01.mkv', { series: 'Mr Robot', season: 1, episode: 1 }],
    ['9-1-1.S01E01.mkv', { series: '9-1-1', season: 1, episode: 1 }],
    ['S.W.A.T.2017.S01E01.mkv', { series: 'S.W.A.T', year: 2017, season: 1, episode: 1 }],
    [
      'Doctor.Who.2005.S01E01.Rose.mkv',
      { series: 'Doctor Who', year: 2005, season: 1, episode: 1, episodeTitle: 'Rose' },
    ],
    ['the.bear.s03e01.mkv', { series: 'The Bear', season: 3, episode: 1 }],
    ['FBI.S01E01.mkv', { series: 'FBI', season: 1, episode: 1 }],
    ['Top Gear - 22x01.mkv', { series: 'Top Gear', season: 22, episode: 1 }],
    [
      'Babylon.5.1x02.Midnight.on.the.Firing.Line.mkv',
      { series: 'Babylon 5', season: 1, episode: 2, episodeTitle: 'Midnight on the Firing Line' },
    ],
    [
      'The.Bear.S03E01.MULTi.1080p.WEB.DDP5.1x264-GRP.mkv',
      { series: 'The Bear', season: 3, episode: 1 },
    ],
    ['Plus.Belle.la.Vie.1x264.mkv', { series: 'Plus Belle la Vie', season: 1, episode: 264 }],
    // Sonarr
    [
      'The Office (US)/Season 01/The Office (US) - S01E01 - Pilot [HDTV-720p].mkv',
      { series: 'The Office (US)', season: 1, episode: 1, episodeTitle: 'Pilot' },
    ],
    [
      'Frieren (2023) [tvdbid-424536]/Season 1/Frieren - S01E12 - 012 - A Real Hero [WEBDL-1080p].mkv',
      {
        series: 'Frieren',
        year: 2023,
        season: 1,
        episode: 12,
        episodeTitle: 'A Real Hero',
        ids: { tvdb: 424536 },
      },
    ],
    [
      'Breaking Bad (2008)/Season 05/Breaking Bad - S05E09-E10 - Blood Money [Bluray-1080p].mkv',
      {
        series: 'Breaking Bad',
        year: 2008,
        season: 5,
        episode: 9,
        episodeEnd: 10,
        episodeTitle: 'Blood Money',
      },
    ],
    // French releases
    [
      'Les.Revenants.S01E01.FRENCH.720p.HDTV.x264.mkv',
      { series: 'Les Revenants', season: 1, episode: 1 },
    ],
    ['Lupin.S01E01.MULTi.1080p.NF.WEB-DL.mkv', { series: 'Lupin', season: 1, episode: 1 }],
    [
      'Le.Bureau.des.Legendes.S05E01.VOSTFR.mkv',
      { series: 'Le Bureau des Legendes', season: 5, episode: 1 },
    ],
    [
      'Kaamelott/Livre I/Kaamelott.S01E01.Heat.mkv',
      { series: 'Kaamelott', season: 1, episode: 1, episodeTitle: 'Heat' },
    ],
    // season packs and release folders
    [
      'The.Office.US.S01.COMPLETE.720p/The.Office.US.S01E03.720p.mkv',
      { series: 'The Office US', season: 1, episode: 3 },
    ],
    [
      'Breaking.Bad.S01.1080p.BluRay/Breaking.Bad.S01E01.1080p.BluRay.mkv',
      { series: 'Breaking Bad', season: 1, episode: 1 },
    ],
    [
      'Game of Thrones/S01/Game.of.Thrones.S01E01.mkv',
      { series: 'Game of Thrones', season: 1, episode: 1 },
    ],
    ['Game of Thrones/S01/S01E02.mkv', { series: 'Game of Thrones', season: 1, episode: 2 }],
    ['Downloads/The.Bear.S03E01.mkv', { series: 'The Bear', season: 3, episode: 1 }],
    // anime
    [
      'Sousou no Frieren/[Erai-raws] Sousou no Frieren - 12 [1080p][Multiple Subtitle].mkv',
      { series: 'Sousou no Frieren', absoluteEpisode: 12 },
    ],
    [
      'One Piece/[HorribleSubs] One Piece - 1000 [1080p].mkv',
      { series: 'One Piece', absoluteEpisode: 1000 },
    ],
    ['Bleach/Season 2/Bleach - 21.mkv', { series: 'Bleach', season: 2, episode: 21 }],
    ['Bleach/Bleach 265.mkv', { series: 'Bleach', absoluteEpisode: 265 }],
    // SubsPlease / fansub naming of later seasons
    [
      'Shingeki no Kyojin/[SubsPlease] Shingeki no Kyojin S3 - 05 (1080p) [ABCD1234].mkv',
      { series: 'Shingeki no Kyojin', season: 3, episode: 5 },
    ],
  ])('%s', (path, parsed) => {
    const result = analyze(path)
    expect(result.classification).toBe('episode')
    expect(result.parsed).toEqual(parsed)
    expect(result.reviewReason).toBeUndefined()
  })

  test('dossier saison sans numéro dans le nom : à vérifier, pas de numéro', () => {
    expect(
      analyze('The Bear/Season 3/The.Bear.Tomorrow.1080p.WEB.DDP.5.1.H.265-GRP.mkv'),
    ).toMatchObject({
      classification: 'episode',
      parsed: { series: 'The Bear', season: 3 },
      reviewReason: 'no_episode_number',
    })
  })
})

describe('dossier en vrac : films et épisodes mélangés', () => {
  const library: readonly [string, 'movie' | 'episode' | 'unknown', string][] = [
    ['Vrac/Inception.2010.1080p.mkv', 'movie', 'Inception'],
    ['Vrac/The.Bear.S03E01.1080p.WEB.mkv', 'episode', 'The Bear'],
    ['Vrac/The.Bear.S03E02.1080p.WEB.mkv', 'episode', 'The Bear'],
    ['Vrac/Heat (1995) - 2160p.mkv', 'movie', 'Heat'],
    ['Vrac/Lupin.S01E01.MULTi.1080p.mkv', 'episode', 'Lupin'],
    ['Vrac/Fleabag/Fleabag S02E01.mkv', 'episode', 'Fleabag'],
    ['Vrac/Dune (2021)/Dune (2021).mkv', 'movie', 'Dune'],
    ['Vrac/Le.Diner.de.Cons.1998.FRENCH.mkv', 'movie', 'Le Diner de Cons'],
    ['Vrac/[SubsPlease] Frieren - 12 (1080p).mkv', 'unknown', 'Frieren - 12'],
  ]
  test.each(library)('%s → %s', (path, classification, displayTitle) => {
    const result = analyze(path)
    expect(result.classification).toBe(classification)
    expect(result.displayTitle).toBe(displayTitle)
  })
})

describe('indice de librairie', () => {
  describe('movies : film forcé sauf motif d’épisode explicite', () => {
    test('motif explicite : épisode, mais signalé hint_conflict', () => {
      expect(analyze('Films/Show.S01E01.mkv', 'movies')).toEqual({
        classification: 'episode',
        parsed: { series: 'Show', season: 1, episode: 1 },
        displayTitle: 'Show',
        reviewReason: 'hint_conflict',
      })
    })

    test.each([
      ['Show/Season 1/Pilot.mkv', 'Pilot'],
      ['Naruto - 101.mkv', 'Naruto - 101'],
      ['Concert.2017.04.20.mkv', 'Concert 2017 04 20'],
      ['Show/Season 1/Episode 02.mkv', 'Episode 02'],
      ['1080p.mkv', '1080p'],
    ])('%s → movie', (path, displayTitle) => {
      const result = analyze(path, 'movies')
      expect(result.classification).toBe('movie')
      expect(result.displayTitle).toBe(displayTitle)
      expect(result.reviewReason).toBeUndefined()
    })
  })

  describe('series : épisode forcé', () => {
    test('nom de film : épisode sans numéro, no_episode_number', () => {
      expect(analyze('Inception (2010).mkv', 'series')).toEqual({
        classification: 'episode',
        parsed: { series: 'Inception', year: 2010 },
        displayTitle: 'Inception',
        reviewReason: 'no_episode_number',
      })
    })

    test.each<[string, ParsedName]>([
      ['Show - 05.mkv', { series: 'Show', absoluteEpisode: 5 }],
      ['Downloads/Naruto - 101.mkv', { series: 'Naruto', absoluteEpisode: 101 }],
      ['Show/05 - Title.mkv', { series: 'Show', season: 1, episode: 5, episodeTitle: 'Title' }],
      ['Show/Episode 3.mkv', { series: 'Show', season: 1, episode: 3 }],
      ['04.02 Title.mkv', { season: 4, episode: 2, episodeTitle: 'Title' }],
    ])('%s', (path, parsed) => {
      const result = analyze(path, 'series')
      expect(result.classification).toBe('episode')
      expect(result.parsed).toEqual(parsed)
      expect(result.reviewReason).toBeUndefined()
    })

    test('épisode daté : date_based', () => {
      expect(analyze('Show/Show.2017.04.20.mkv', 'series').reviewReason).toBe('date_based')
    })
  })
})

describe('cas ambigus : unknown', () => {
  test.each<[string, ParsedName]>([
    // absolute numbering without a series folder
    ['Naruto - 101.mkv', { title: 'Naruto - 101', series: 'Naruto', absoluteEpisode: 101 }],
    [
      'Downloads/Naruto - 101.mkv',
      { title: 'Naruto - 101', series: 'Naruto', absoluteEpisode: 101 },
    ],
    // dated episode at the root
    ['Show.20.04.2017.mkv', { title: 'Show', airDate: '2017-04-20' }],
    // nothing but release tags
    ['1080p.mkv', {}],
    ['MULTi.1080p.x264.mkv', {}],
  ])('%s', (path, parsed) => {
    const result = analyze(path)
    expect(result.classification).toBe('unknown')
    expect(result.reviewReason).toBe('classification_ambiguous')
    expect(result.parsed).toEqual(parsed)
    expect(result.displayTitle.length).toBeGreaterThan(0)
  })

  test('épisode sans série identifiable : épisode, série absente', () => {
    expect(analyze('Season 1/S01E01.mkv')).toEqual({
      classification: 'episode',
      parsed: { season: 1, episode: 1 },
      displayTitle: 'S01E01',
    })
  })

  // Ambiguity: §8.2 lists `Episode 02` and `02 - Titre` only under a season folder; elsewhere (auto) they stay movies.
  test('`Episode 02` hors dossier saison : pas un épisode (Star Wars Episode 1…)', () => {
    expect(analyze('Star.Wars.Episode.1.The.Phantom.Menace.1999.mkv').classification).toBe('movie')
    expect(analyze('Show/Episode 02.mkv').classification).toBe('movie')
  })
})

describe('propriétés absentes omises', () => {
  test('aucune clé undefined dans parsed', () => {
    for (const path of [
      'Inception.mkv',
      'Show/Season 1/Pilot.mkv',
      'Naruto - 101.mkv',
      'Show.S01E01.mkv',
      '1080p.mkv',
    ]) {
      const { parsed } = analyze(path)
      expect(Object.values(parsed).some((value) => value === undefined)).toBe(false)
    }
  })
})
