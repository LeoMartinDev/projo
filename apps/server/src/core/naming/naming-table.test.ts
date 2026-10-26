/**
 * PRODUCT.md §8, line by line: every row of the naming table has at least one case here (§22).
 * Real-world release names and ambiguous cases live in `analyze.test.ts`.
 */
import { describe, expect, test } from 'bun:test'

import { analyzeMediaPath, showFolderOf } from './analyze'
import { isValidSeason, parseSeasonFolder } from './episode'
import { filterDirectory, filterFile } from './filters'
import { resolveStacks } from './stacks'
import { matchExternalSubtitles } from './subtitles'
import type { LibraryHint, ParsedName } from './types'

const analyze = (relativePath: string, hint: LibraryHint = 'auto') =>
  analyzeMediaPath({ relativePath, hint })
const BIG = 50_000_000
const fileKind = (relativePath: string) => filterFile({ relativePath, sizeBytes: BIG })

describe('§8.1 Films', () => {
  test('Fichier à plat', () => {
    expect(analyze('Inception (2010).mkv')).toEqual({
      classification: 'movie',
      parsed: { title: 'Inception', year: 2010 },
      displayTitle: 'Inception',
    })
  })

  test('Dossier par film, fichier au nom différent du dossier', () => {
    expect(analyze('Inception (2010)/Inception.2010.1080p.BluRay.x264-GRP.mkv').parsed).toEqual({
      title: 'Inception',
      year: 2010,
    })
    expect(analyze('Inception (2010)/inc-grp-1080p.mkv').parsed).toEqual({
      title: 'Inception',
      year: 2010,
    })
  })

  describe('Année', () => {
    test('premier 19xx/20xx précédé d’un délimiteur, tout ce qui suit est jeté', () => {
      expect(analyze('Inception.2010.1080p.mkv').parsed).toEqual({ title: 'Inception', year: 2010 })
      expect(analyze('Inception_2010_Remux.mkv').parsed).toEqual({ title: 'Inception', year: 2010 })
      expect(analyze('Inception [2010].mkv').parsed).toEqual({ title: 'Inception', year: 2010 })
    })

    test('un nombre en tête de nom n’est pas une année (pas de délimiteur avant)', () => {
      expect(analyze('1917 (2019).mkv').parsed).toEqual({ title: '1917', year: 2019 })
      expect(analyze('2012.mkv').parsed).toEqual({ title: '2012' })
    })

    test('non suivi de chiffres ni d’une date', () => {
      expect(analyze('Movie 20101.mkv').parsed).toEqual({ title: 'Movie 20101' })
      expect(analyze('Movie 1920x1080.mkv').parsed).toEqual({ title: 'Movie 1920x1080' })
      expect(analyze('Concert.2017.04.20.mkv', 'movies').parsed).toEqual({
        title: 'Concert 2017 04 20',
      })
    })

    // Ambiguity: "premier" would turn `Blade Runner 2049 (2017)` into "Blade Runner" (2049). We keep the year in
    // parentheses if any, otherwise the last candidate before the release tags, like Jellyfin.
    test('ambiguïté : une année dans le titre (2049) cède la place à la vraie année', () => {
      expect(analyze('Blade Runner 2049 (2017).mkv').parsed).toEqual({
        title: 'Blade Runner 2049',
        year: 2017,
      })
      expect(analyze('Blade.Runner.2049.2017.2160p.mkv').parsed).toEqual({
        title: 'Blade Runner 2049',
        year: 2017,
      })
    })
  })

  test('Sans année', () => {
    expect(analyze('Inception.mkv')).toEqual({
      classification: 'movie',
      parsed: { title: 'Inception' },
      displayTitle: 'Inception',
    })
  })

  describe('Nettoyage des noms de release', () => {
    test('exemple de la spec : [groupe] en tête, tokens français, points', () => {
      expect(
        analyze("[GRP] Le.Fabuleux.Destin.d'Amélie.Poulain.2001.FRENCH.1080p.mkv").parsed,
      ).toEqual({
        title: "Le Fabuleux Destin d'Amélie Poulain",
        year: 2001,
      })
    })

    test.each([
      ['Heat.1080p.BluRay.x264.mkv', 'Heat'],
      ['Heat.720p.mkv', 'Heat'],
      ['Heat.2160p.UHD.mkv', 'Heat'],
      ['Heat 4K HDR.mkv', 'Heat'],
      ['Heat.x265-GRP.mkv', 'Heat'],
      ['Heat.H264.mkv', 'Heat'],
      ['Heat.HEVC.mkv', 'Heat'],
      ['Heat.BDRip.mkv', 'Heat'],
      ['Heat.BRRip.mkv', 'Heat'],
      ['Heat.WEB-DL.mkv', 'Heat'],
      ['Heat.WEBRip.mkv', 'Heat'],
      ['Heat.HDTV.mkv', 'Heat'],
      ['Heat.DVDRip.XviD.avi', 'Heat'],
      ['Heat.PROPER.mkv', 'Heat'],
      ['Heat.REPACK.mkv', 'Heat'],
      ['Heat.MULTi.mkv', 'Heat'],
      ['Heat.SUBS.mkv', 'Heat'],
      ['Heat.UNRATED.mkv', 'Heat'],
      ['Heat.EXTENDED.mkv', 'Heat'],
      ['Heat.LIMITED.mkv', 'Heat'],
      ['Heat.INTERNAL.mkv', 'Heat'],
      ['Heat.REMUX.mkv', 'Heat'],
      ['Heat.VOSTFR.mkv', 'Heat'],
      ['Heat.VFF.mkv', 'Heat'],
      ['Heat.VFQ.mkv', 'Heat'],
      ['Heat.VFI.mkv', 'Heat'],
      ['Heat.VF2.mkv', 'Heat'],
      ['Heat.TRUEFRENCH.mkv', 'Heat'],
      ['Heat.FRENCH.mkv', 'Heat'],
      ['Heat.MULTIFRENCH.mkv', 'Heat'],
      ['Heat.VOSTA.mkv', 'Heat'],
      ['Heat.HDLight.mkv', 'Heat'],
      ['Heat.4KLight.mkv', 'Heat'],
      ['Heat.mHD.mkv', 'Heat'],
      ['Heat.BDRemux.mkv', 'Heat'],
      ['Heat.TVRip.mkv', 'Heat'],
      ['Heat.HDCAM.mkv', 'Heat'],
      ['Heat.NF.WEB-DL.mkv', 'Heat'],
      ['Heat.DV.HDR.mkv', 'Heat'],
      ['Heat.HD.mkv', 'Heat'],
      ['Heat.FHD.mkv', 'Heat'],
      ['Heat.SD.mkv', 'Heat'],
      ['Heat.VO.mkv', 'Heat'],
      ['Heat.FR.mkv', 'Heat'],
    ])('coupe au token de release : %s', (path, title) => {
      expect(analyze(path).parsed.title).toBe(title)
    })

    test('[...] en fin retirés, underscores en espaces', () => {
      expect(analyze('Heat_Director_Commentary [Criterion] [x].mkv').parsed).toEqual({
        title: 'Heat Director Commentary',
      })
    })

    test('[...] avant l’année retirés aussi, édition reconnue dedans', () => {
      expect(analyze('La Reine des Neiges 2 [FR-EN] (2019).mkv').parsed).toEqual({
        title: 'La Reine des Neiges 2',
        year: 2019,
      })
      expect(analyze("Avatar [Extended Collector's Edition] [FR-EN] (2009).mkv").parsed).toEqual({
        title: 'Avatar',
        year: 2009,
        edition: 'extended',
      })
    })
  })

  describe('Tag d’identifiant', () => {
    test.each([
      ['Inception (2010) [tmdbid-27205].mkv', { tmdb: 27205 }],
      ['Inception (2010) [tmdb-27205].mkv', { tmdb: 27205 }],
      ['Inception (2010) (tmdbid=27205).mkv', { tmdb: 27205 }],
      ['Inception {imdb-tt1375666}.mkv', { imdb: 'tt1375666' }],
      ['Inception [imdbid-tt1375666].mkv', { imdb: 'tt1375666' }],
      ['Inception {tvdbid-1234}.mkv', { tvdb: 1234 }],
      ['Inception (tvdb=1234).mkv', { tvdb: 1234 }],
    ])('%s', (path, ids) => {
      const { parsed } = analyze(path)
      expect(parsed.title).toBe('Inception')
      expect(parsed.ids).toEqual(ids)
    })

    test('sur le dossier', () => {
      expect(analyze('Inception (2010) [tmdbid-27205]/Inception.1080p.mkv').parsed).toEqual({
        title: 'Inception',
        year: 2010,
        ids: { tmdb: 27205 },
      })
    })

    test('tag malformé : retiré du titre, ignoré', () => {
      expect(analyze('Inception [tmdbid-abc].mkv').parsed).toEqual({ title: 'Inception' })
    })
  })

  describe('Édition', () => {
    test('{edition-Libellé}', () => {
      expect(analyze('Blade Runner (1982) {edition-Final Cut}.mkv').parsed).toEqual({
        title: 'Blade Runner',
        year: 1982,
        editionName: 'Final Cut',
      })
    })

    test.each([
      ["Blade Runner (1982) - Director's Cut.mkv", 'directors_cut'],
      ['Blade.Runner.1982.Directors.Cut.1080p.mkv', 'directors_cut'],
      ['Blade Runner (1982) - Extended Cut.mkv', 'extended'],
      ['Blade Runner (1982) - Extended Edition.mkv', 'extended'],
      ["Blade Runner (1982) - Extended Collector's Edition.mkv", 'extended'],
      ['Blade Runner (1982) - Theatrical Cut.mkv', 'theatrical'],
      ['Blade Runner (1982) - Final Cut.mkv', 'final_cut'],
      ['Blade Runner (1982) - Unrated Cut.mkv', 'unrated'],
      ['Blade Runner (1982) - Uncut.mkv', 'uncut'],
      ['Blade Runner (1982) - Special Edition.mkv', 'special_edition'],
      ['Blade Runner (1982) - Ultimate Edition.mkv', 'ultimate_edition'],
      ['Blade.Runner.1982.IMAX.2160p.mkv', 'imax'],
      ['Blade Runner (1982) Remastered.mkv', 'remastered'],
      ["Blade Runner - Director's Cut.mkv", 'directors_cut'],
    ])('libellé Infuse reconnu seul : %s', (path, edition) => {
      expect(analyze(path).parsed).toMatchObject({ title: 'Blade Runner', edition })
    })

    // Ambiguity: "alone after a separator" read as after the year, after ` - `, or among release tags,
    // otherwise `The Final Cut (2004)` would lose its title.
    test('un libellé qui fait partie du titre reste dans le titre', () => {
      expect(analyze('The Final Cut (2004).mkv').parsed).toEqual({
        title: 'The Final Cut',
        year: 2004,
      })
    })
  })

  test('Versions multiples : même parse, le regroupement se fait par TMDB', () => {
    const a = analyze('Dune (2021) - 2160p.mkv')
    const b = analyze('Dune (2021) - 1080p.mkv')
    const c = analyze('Ailleurs/Dune.2021.MULTi.1080p.WEB.mkv')
    expect(a.parsed).toEqual({ title: 'Dune', year: 2021 })
    expect(b.parsed).toEqual(a.parsed)
    expect(c.parsed).toEqual(a.parsed)
  })

  describe('Parties', () => {
    test.each([
      ['Film-cd1.mkv', 1, 'CD 1'],
      ['Film (2010) - part a.mkv', 1, 'Part A'],
      ['Film.dvd2.mkv', 2, 'DVD 2'],
      ['Film pt-b.mkv', 2, 'Pt B'],
      ['Film - disc 3.mkv', 3, 'Disc 3'],
      ['Film_disk4.mkv', 4, 'Disk 4'],
      ['Film-PART2.mkv', 2, 'Part 2'],
      ['Film (2010) - cd d.mkv', 4, 'CD D'],
    ])('%s', (path, index, label) => {
      const { parsed } = analyze(path)
      expect(parsed.title).toBe('Film')
      expect(parsed.part).toEqual({ index, label })
    })

    test('dans le même dossier : empilées par resolveStacks', () => {
      const paths = ['Film (2010)/Film (2010) - cd2.mkv', 'Film (2010)/Film (2010) - cd1.mkv']
      const resolution = resolveStacks(
        paths.map((relativePath) => ({
          key: relativePath,
          relativePath,
          parsed: analyze(relativePath).parsed,
        })),
      )
      expect(resolution.stacks).toEqual([
        {
          groupKey: 'Film (2010)|film|2010|',
          title: 'Film',
          members: [
            { key: 'Film (2010)/Film (2010) - cd1.mkv', partIndex: 1 },
            { key: 'Film (2010)/Film (2010) - cd2.mkv', partIndex: 2 },
          ],
        },
      ])
      expect(resolution.unstacked).toEqual([])
    })
  })

  describe('VIDEO_TS, BDMV, .iso, stubs .disc, 3D : ignorés', () => {
    test.each(['Film (2010)/VIDEO_TS', 'Film (2010)/BDMV', 'Film/bdmv'])(
      'dossier %s',
      (relativePath) => {
        expect(filterDirectory({ relativePath, entryNames: [] })).toEqual({
          kind: 'skip',
          reason: 'unsupported_layout',
        })
      },
    )

    test.each([
      'Film (2010)/VIDEO_TS/VTS_01_1.mkv',
      'Film (2010)/BDMV/STREAM/00001.m2ts',
      'Film (2010).iso',
      'Film (2010).disc',
      'Avatar.2009.3D.HSBS.1080p.mkv',
      'Avatar (2009) - 3D Half-OU.mkv',
      'Avatar.2009.3D.SBS.mkv',
      'Avatar.2009.MVC.mkv',
    ])('fichier %s', (path) => {
      expect(fileKind(path)).toEqual({ kind: 'ignored', reason: 'unsupported_layout' })
    })

    // Ambiguity: "3D" alone is part of real titles, only explicit stereo layouts are excluded.
    test('« 3D » seul reste un film', () => {
      expect(fileKind('Step Up 3D (2010).mkv')).toEqual({ kind: 'video' })
    })
  })
})

describe('§8.2 Séries', () => {
  test('Dossier série `Nom (année) [tmdbid-id]`', () => {
    expect(
      analyze('Breaking Bad (2008) [tmdbid-1396]/Season 01/Breaking.Bad.S01E01.Pilot.1080p.mkv'),
    ).toEqual({
      classification: 'episode',
      parsed: {
        series: 'Breaking Bad',
        year: 2008,
        season: 1,
        episode: 1,
        episodeTitle: 'Pilot',
        ids: { tmdb: 1396 },
      },
      displayTitle: 'Breaking Bad',
    })
    expect(analyze('Breaking Bad/Season 1/Breaking Bad S01E02.mkv').parsed).toEqual({
      series: 'Breaking Bad',
      season: 1,
      episode: 2,
    })
  })

  describe('Dossier saison', () => {
    test.each([
      ['Season 01', 1],
      ['Season 1', 1],
      ['season 12', 12],
      ['S01', 1],
      ['s3', 3],
      ['Saison 1', 1],
      ['Staffel 1', 1],
      ['Temporada 1', 1],
      ['Stagione 1', 1],
      ['Series 1', 1],
      ['Säsong 2', 2],
      ['Sæson 2', 2],
      ['Seizoen 2', 2],
      ['Sezon 2', 2],
      ['Kausi 2', 2],
      ['Сезон 2', 2],
      ['1st Season', 1],
      ['01', 1],
      ['7', 7],
    ])('%s → saison %d', (name, season) => {
      expect(parseSeasonFolder(name)).toEqual({ season })
    })

    test('titre optionnel après le numéro', () => {
      expect(parseSeasonFolder('Saison 2 - La fuite')).toEqual({ season: 2, title: 'La fuite' })
      expect(parseSeasonFolder('Season 3 Redemption')).toEqual({ season: 3, title: 'Redemption' })
      expect(
        analyze('Prison Break/Saison 2 - La fuite/Prison.Break.S02E01.mkv').parsed,
      ).toMatchObject({ series: 'Prison Break', season: 2 })
    })

    // Ambiguity: "purely numeric with an optional title" would make `21 Jump Street (2012)/` a season folder.
    // Only keyword folders take a title; numeric folders must be digits only (max 3).
    test('dossier numérique : chiffres seuls', () => {
      expect(parseSeasonFolder('21 Jump Street (2012)')).toBeUndefined()
      expect(parseSeasonFolder('2019')).toBeUndefined()
      expect(analyze('21 Jump Street (2012)/21.Jump.Street.2012.1080p.mkv').classification).toBe(
        'movie',
      )
    })

    test('pas un dossier saison', () => {
      for (const name of ['Breaking Bad', 'The.Bear.S03.1080p.WEB', 'Season', 'S01E01', 'Extras']) {
        expect(parseSeasonFolder(name)).toBeUndefined()
      }
    })
  })

  describe('Spéciaux', () => {
    test.each(['Season 00', 'Season 0', 'Specials', 'specials'])('%s → saison 0', (name) => {
      expect(parseSeasonFolder(name)).toEqual({ season: 0 })
    })

    test('épisode sous Specials', () => {
      expect(analyze('Doctor Who/Specials/Doctor.Who.S00E05.mkv').parsed).toMatchObject({
        season: 0,
        episode: 5,
      })
      expect(analyze('Doctor Who/Specials/Episode 02.mkv').parsed).toMatchObject({
        series: 'Doctor Who',
        season: 0,
        episode: 2,
      })
    })

    test('Extras n’est pas un dossier de spéciaux mais de bonus (§8.5)', () => {
      expect(fileKind('Doctor Who/Extras/Making Of.mkv')).toEqual({
        kind: 'ignored',
        reason: 'bonus',
      })
    })
  })

  describe('Motifs d’épisode', () => {
    test.each([
      ['Dexter.S04E02.Remains.to.Be.Seen.HDTV.mkv', 4, 2],
      ['Dexter S04 E02.mkv', 4, 2],
      ['Dexter.S04.E02.mkv', 4, 2],
      ['Dexter_S04_E02.mkv', 4, 2],
      ['Dexter-S04-E02.mkv', 4, 2],
      ['Dexter s4e2.mkv', 4, 2],
      ['Dexter S04xE02.mkv', 4, 2],
      ['Dexter 4x02.mkv', 4, 2],
      ['Dexter se4.ep2.mkv', 4, 2],
      ['Dexter season4.episode2.mkv', 4, 2],
      ['Dexter Season 4 Episode 2.mkv', 4, 2],
      ['Dexter S03 E09.mkv', 3, 9],
    ])('explicite : %s', (path, season, episode) => {
      const result = analyze(path)
      expect(result.classification).toBe('episode')
      expect(result.parsed).toMatchObject({ series: 'Dexter', season, episode })
    })

    test('exemple de la spec avec titre d’épisode', () => {
      expect(analyze('Dexter.S04E02.Remains.to.Be.Seen.HDTV.mkv').parsed).toEqual({
        series: 'Dexter',
        season: 4,
        episode: 2,
        episodeTitle: 'Remains to Be Seen',
      })
    })

    test.each([
      ['Dexter/Season 4/Episode 02.mkv', 2, undefined],
      ['Dexter/Season 4/02 - Remains to Be Seen.mkv', 2, 'Remains to Be Seen'],
      ['Dexter/Season 4/02.Remains.to.Be.Seen.mkv', 2, 'Remains to Be Seen'],
      ['Dexter/Season 4/02.mkv', 2, undefined],
    ])('sous un dossier saison : %s', (path, episode, episodeTitle) => {
      const result = analyze(path)
      expect(result.classification).toBe('episode')
      expect(result.parsed).toEqual({
        series: 'Dexter',
        season: 4,
        episode,
        ...(episodeTitle === undefined ? {} : { episodeTitle }),
      })
    })

    test('`01.02 Titre` (saison.épisode) sous un dossier série', () => {
      expect(analyze('Dexter/04.02 Remains to Be Seen.mkv').parsed).toEqual({
        series: 'Dexter',
        season: 4,
        episode: 2,
        episodeTitle: 'Remains to Be Seen',
      })
    })
  })

  test('Épisode sans dossier saison, dans le dossier série : saison lue dans le nom, sinon 1', () => {
    expect(analyze('Fleabag/Fleabag S02E01.mkv').parsed).toEqual({
      series: 'Fleabag',
      season: 2,
      episode: 1,
    })
    expect(analyze('Fleabag/Episode 3.mkv', 'series').parsed).toEqual({
      series: 'Fleabag',
      season: 1,
      episode: 3,
    })
  })

  test('Épisode à plat à la racine : série = ce qui précède le motif', () => {
    expect(analyze('The.Bear.S03E01.1080p.WEB.mkv')).toEqual({
      classification: 'episode',
      parsed: { series: 'The Bear', season: 3, episode: 1 },
      displayTitle: 'The Bear',
    })
  })

  describe('Multi-épisodes', () => {
    test.each([
      ['Show.S01E01-E02.mkv', 1, 2],
      ['Show.S01E01E02.mkv', 1, 2],
      ['Show.S01E01-02.mkv', 1, 2],
      ['Show 1x01-1x02.mkv', 1, 2],
      ['Show.S01E01E02E03.mkv', 1, 3],
      ['Show/Season 1/Episode 16-17.mkv', 16, 17],
    ])('%s', (path, episode, episodeEnd) => {
      expect(analyze(path).parsed).toMatchObject({ season: 1, episode, episodeEnd })
    })

    test.each([
      ['Show.S09E14-1080p.mkv', 14],
      ['Show.S01E05-03.mkv', 5],
      ['Show.S01E05-720i.mkv', 5],
      ['Show.S01E05-123456.mkv', 5],
    ])('fin rejetée : %s', (path, episode) => {
      const { parsed } = analyze(path)
      expect(parsed.episode).toBe(episode)
      expect(parsed.episodeEnd).toBeUndefined()
    })
  })

  describe('Numérotation absolue', () => {
    test.each([
      ['Naruto/Naruto - 101.mkv', 101],
      ['Frieren/[SubsPlease] Frieren - 12 [1080p].mkv', 12],
      ['Frieren/[SubsPlease] Frieren - 12 (1080p) [A1B2C3D4].mkv', 12],
      ['One Piece/One Piece 1071.mkv', 1071],
      ['Naruto/Naruto - 101v2.mkv', 101],
    ])('avec dossier série : %s', (path, absoluteEpisode) => {
      const result = analyze(path)
      expect(result.classification).toBe('episode')
      expect(result.parsed).toEqual({ series: path.split('/')[0] ?? '', absoluteEpisode })
      expect(result.reviewReason).toBeUndefined()
    })

    test('sans dossier série : unknown', () => {
      expect(analyze('[SubsPlease] Frieren - 12 (1080p).mkv')).toEqual({
        classification: 'unknown',
        parsed: { title: 'Frieren - 12', series: 'Frieren', absoluteEpisode: 12 },
        displayTitle: 'Frieren - 12',
        reviewReason: 'classification_ambiguous',
      })
      expect(analyze('Downloads/Naruto - 101.mkv').classification).toBe('unknown')
    })

    test.each([
      ['Fullmetal Alchemist Brotherhood/Fullmetal Alchemist Brotherhood 64.mkv', 64],
      ['Show/Show 5.mkv', 5],
      ['Show/Show 12 MULTI.mkv', 12],
    ])('bibliothèque séries, `Name 12` : %s', (path, absoluteEpisode) => {
      const result = analyze(path, 'series')
      expect(result.parsed).toEqual({ series: path.split('/')[0] ?? '', absoluteEpisode })
      expect(result.reviewReason).toBeUndefined()
    })

    test('`Name 12` : seulement en bibliothèque séries, après les autres motifs', () => {
      expect(analyze('Show/Show 12.mkv').classification).toBe('movie')
      expect(analyze('Show/05 Title 2.mkv', 'series').parsed).toMatchObject({ episode: 5 })
      expect(analyze('Show/Show.FRENCH.AAC.5.1.mkv', 'series')).toMatchObject({
        parsed: { series: 'Show' },
        reviewReason: 'no_episode_number',
      })
    })
  })

  describe('Contexte série : bibliothèque séries ou dossier saison', () => {
    test.each<[string, LibraryHint, ParsedName]>([
      ['Show/Season 2/Show 05.mkv', 'auto', { series: 'Show', season: 2, episode: 5 }],
      [
        'Show/Season 1/E01 - Pilot.mkv',
        'auto',
        { series: 'Show', season: 1, episode: 1, episodeTitle: 'Pilot' },
      ],
      ['Show/S1/E01.mkv', 'auto', { series: 'Show', season: 1, episode: 1 }],
      ['Show/Show E05.mkv', 'series', { series: 'Show', season: 1, episode: 5 }],
      ['Show/Show Ep05.mkv', 'series', { series: 'Show', season: 1, episode: 5 }],
      [
        'Fullmetal Alchemist Brotherhood/Fullmetal Alchemist Brotherhood 64 HD Multi.mkv',
        'series',
        { series: 'Fullmetal Alchemist Brotherhood', absoluteEpisode: 64 },
      ],
      ['Show/Show 01 [Team].mkv', 'series', { series: 'Show', absoluteEpisode: 1 }],
      ['Show (2019) 05.mkv', 'series', { series: 'Show', year: 2019, absoluteEpisode: 5 }],
      [
        'Show - 05 - The Return Part 2.mkv',
        'series',
        { series: 'Show', absoluteEpisode: 5, episodeTitle: 'The Return Part 2' },
      ],
      // the last number before the tags; a number of the folder's title never counts
      [
        'Mob Psycho 100/Mob Psycho 100 05.mkv',
        'series',
        { series: 'Mob Psycho 100', absoluteEpisode: 5 },
      ],
      ['Mob Psycho 100 05.mkv', 'series', { series: 'Mob Psycho 100', absoluteEpisode: 5 }],
      ['Show 2/Show 2 05.mkv', 'series', { series: 'Show 2', absoluteEpisode: 5 }],
      // a season marker right before the number
      [
        'Shingeki no Kyojin S3 - 05.mkv',
        'series',
        { series: 'Shingeki no Kyojin', season: 3, episode: 5 },
      ],
      ['Show - Saison 2 - 05.mkv', 'series', { series: 'Show', season: 2, episode: 5 }],
      ['Show Season 2 05.mkv', 'series', { series: 'Show', season: 2, episode: 5 }],
      // a numeric folder at the root is a show, not a season
      ['24/24 - 12.mkv', 'series', { series: '24', absoluteEpisode: 12 }],
      ['24/S01E01.mkv', 'auto', { series: '24', season: 1, episode: 1 }],
      [
        '24/01 - Pilot.mkv',
        'series',
        { series: '24', season: 1, episode: 1, episodeTitle: 'Pilot' },
      ],
      ['24/Season 2/01.mkv', 'auto', { series: '24', season: 2, episode: 1 }],
    ])('%s (%s)', (path, hint, parsed) => {
      const result = analyze(path, hint)
      expect(result.classification).toBe('episode')
      expect(result.parsed).toEqual(parsed)
      expect(result.reviewReason).toBeUndefined()
    })

    test('hors contexte série, un nombre isolé reste dans le titre', () => {
      expect(analyze('Bleach/Bleach 26.mkv').classification).toBe('movie')
      expect(analyze('Toy Story/Toy Story 3 (2010).mkv').parsed).toEqual({
        title: 'Toy Story 3',
        year: 2010,
      })
    })
  })

  describe('Épisode daté', () => {
    test.each([
      ['The Daily Show/The.Daily.Show.2017.04.20.mkv', '2017-04-20'],
      ['The Daily Show/The Daily Show 2017-04-20.mkv', '2017-04-20'],
      ['The Daily Show/The Daily Show 20.04.2017.mkv', '2017-04-20'],
    ])('%s', (path, airDate) => {
      expect(analyze(path)).toEqual({
        classification: 'episode',
        parsed: { series: 'The Daily Show', airDate },
        displayTitle: 'The Daily Show',
        reviewReason: 'date_based',
      })
    })

    test('date invalide : pas un épisode daté', () => {
      expect(analyze('The Daily Show/The Daily Show 2017.13.40.mkv').parsed.airDate).toBeUndefined()
    })
  })

  describe('Garde-fou', () => {
    test.each([
      [199, true],
      [200, false],
      [1080, false],
      [1927, false],
      [1928, true],
      [2500, true],
      [2501, false],
    ])('saison %d valide : %p', (season, valid) => {
      expect(isValidSeason(season)).toBe(valid)
    })

    test('1920x1080 n’est pas S1920E1080', () => {
      expect(analyze('Movie.1920x1080.mkv').classification).toBe('movie')
      expect(analyze('Show/Show.S1920E1080.mkv').parsed.season).toBeUndefined()
      expect(parseSeasonFolder('Season 1080')).toBeUndefined()
    })

    test.each([
      'Movie.2024.WEB.DDP.5.1x265-GRP.mkv',
      'Movie.2024.WEB.DDP5.1x264-GRP.mkv',
      'Movie.2024.WEB.AAC2.0x265-GRP.mkv',
      'Movie.2024.WEB.AAC2.0x266-GRP.mkv',
      'Movie.2024.TrueHD.7.1x264-GRP.mkv',
      'Movie.2024.TrueHD.Atmos.7.1.4x265-GRP.mkv',
      'Films/Movie (2024)/Movie.2024.WEB.DDP5.1x264.mkv',
    ])(
      '`NxNN` après une disposition de canaux, avec un codec, n’est pas un épisode : %s',
      (path) => {
        expect(analyze(path)).toEqual({
          classification: 'movie',
          parsed: { title: 'Movie', year: 2024 },
          displayTitle: 'Movie',
        })
      },
    )

    test('`NxNN` reste un épisode hors de ce cas', () => {
      expect(analyze('Babylon.5.1x02.mkv').parsed).toEqual({
        series: 'Babylon 5',
        season: 1,
        episode: 2,
      })
      expect(analyze('Show 1x265.mkv').parsed).toEqual({ series: 'Show', season: 1, episode: 265 })
      expect(analyze('Show.2004.1x264.mkv').parsed).toEqual({
        series: 'Show',
        year: 2004,
        season: 1,
        episode: 264,
      })
      expect(analyze('Show 01x02.mkv').parsed).toEqual({ series: 'Show', season: 1, episode: 2 })
      expect(analyze('Show 1x02-03.mkv').parsed).toMatchObject({ episode: 2, episodeEnd: 3 })
    })

    test('`H.264`, `H.265` ne sont pas une numérotation absolue', () => {
      expect(analyze('Movie.1080p.WEB.DDP5.1.H.265-GRP.mkv')).toEqual({
        classification: 'movie',
        parsed: { title: 'Movie' },
        displayTitle: 'Movie',
      })
      expect(analyze('Show/Season 1/Show.Pilot.1080p.WEB.H.264.mkv').parsed).toEqual({
        series: 'Show',
        season: 1,
      })
      expect(
        analyze('Show/Show.Pilot.1080p.WEB.x.265.mkv', 'series').parsed.absoluteEpisode,
      ).toBeUndefined()
      expect(analyze('Bleach/Bleach 264.mkv').parsed).toEqual({
        series: 'Bleach',
        absoluteEpisode: 264,
      })
    })
  })

  test.each([
    ['Show/Season 1/Show.S01E01.mkv', 'Show'],
    ['Shows/Show (2019)/Saison 2/E01.mkv', 'Shows/Show (2019)'],
    ['Show/Show 05.mkv', 'Show'],
    ['Season 1/S01E01.mkv', ''],
    ['Show.S01E01.mkv', ''],
  ])('dossier de série (§7.8) : %s → %p', (path, folder) => {
    expect(showFolderOf(path)).toBe(folder)
  })

  test('Versions d’un épisode : même parse', () => {
    const a = analyze('Show/Season 1/S01E01 - 1080p.mkv')
    const b = analyze('Show/Season 1/S01E01 - 2160p.mkv')
    expect(a.parsed).toEqual({ series: 'Show', season: 1, episode: 1 })
    expect(b.parsed).toEqual(a.parsed)
  })

  test('Mini-série : saison 1', () => {
    expect(analyze('Chernobyl (2019)/Chernobyl - Episode 2.mkv', 'series').parsed).toEqual({
      series: 'Chernobyl',
      year: 2019,
      season: 1,
      episode: 2,
    })
  })

  describe('Classification (auto)', () => {
    test('motif dans le nom de fichier = episode', () => {
      expect(analyze('Vrac/Show.S01E01.mkv').classification).toBe('episode')
    })

    test('dossier saison au-dessus = episode (sans numéro : no_episode_number)', () => {
      expect(analyze('Show/Season 2/Pilot.mkv')).toEqual({
        classification: 'episode',
        parsed: { series: 'Show', season: 2 },
        displayTitle: 'Show',
        reviewReason: 'no_episode_number',
      })
    })

    test('un numéro d’épisode placé avant le motif ne change rien : le motif gagne', () => {
      expect(analyze('Show/Season 1/03 - Show.S01E05.mkv').parsed).toEqual({
        series: 'Show',
        season: 1,
        episode: 5,
      })
      expect(analyze('Show/Season 2/Show.S01E05.mkv').parsed.season).toBe(1)
    })

    test('sinon movie', () => {
      expect(analyze('Vrac/Heat (1995).mkv').classification).toBe('movie')
    })

    test('numérotation absolue sans dossier série = unknown', () => {
      expect(analyze('Naruto - 101.mkv').classification).toBe('unknown')
    })
  })
})

describe('§8.3 Sous-titres externes', () => {
  const match = (videoPaths: string[], subtitlePaths: string[]) =>
    matchExternalSubtitles({ videoPaths, subtitlePaths })
  const base = { forced: false, sdh: false, isDefault: false }

  test('même dossier, suffixe par points (Jellyfin)', () => {
    expect(
      match(
        ['Film/Film.mkv'],
        [
          'Film/Film.fr.srt',
          'Film/Film.fr.forced.srt',
          'Film/Film.en.sdh.srt',
          'Film/Film.default.fr.ass',
        ],
      ),
    ).toEqual([
      {
        ...base,
        language: 'fr',
        subtitlePath: 'Film/Film.fr.srt',
        videoPath: 'Film/Film.mkv',
        format: 'srt',
        rendering: 'text',
      },
      {
        ...base,
        language: 'fr',
        forced: true,
        subtitlePath: 'Film/Film.fr.forced.srt',
        videoPath: 'Film/Film.mkv',
        format: 'srt',
        rendering: 'text',
      },
      {
        ...base,
        language: 'en',
        sdh: true,
        subtitlePath: 'Film/Film.en.sdh.srt',
        videoPath: 'Film/Film.mkv',
        format: 'srt',
        rendering: 'text',
      },
      {
        ...base,
        language: 'fr',
        isDefault: true,
        subtitlePath: 'Film/Film.default.fr.ass',
        videoPath: 'Film/Film.mkv',
        format: 'ass',
        rendering: 'text',
      },
    ])
  })

  test('même nom de base, suffixe par tiret (Infuse)', () => {
    expect(match(['Film.mkv'], ['Film-fr.srt', 'Film-en.forced.srt'])).toEqual([
      {
        ...base,
        language: 'fr',
        subtitlePath: 'Film-fr.srt',
        videoPath: 'Film.mkv',
        format: 'srt',
        rendering: 'text',
      },
      {
        ...base,
        language: 'en',
        forced: true,
        subtitlePath: 'Film-en.forced.srt',
        videoPath: 'Film.mkv',
        format: 'srt',
        rendering: 'text',
      },
    ])
  })

  test('même nom de base sans langue : langue inconnue', () => {
    expect(match(['Film.mkv'], ['Film.srt'])).toEqual([
      {
        ...base,
        subtitlePath: 'Film.srt',
        videoPath: 'Film.mkv',
        format: 'srt',
        rendering: 'text',
      },
    ])
  })

  describe('Codes de langue', () => {
    test.each([
      ['Film.fr.srt', 'fr'],
      ['Film.fre.srt', 'fr'],
      ['Film.fra.srt', 'fr'],
      ['Film.pt-BR.srt', 'pt-BR'],
      ['Film.french.srt', 'fr'],
      ['Film.english.srt', 'en'],
      ['Film.français.srt', 'fr'],
      ['Film.ger.srt', 'de'],
      ['Film.deu.srt', 'de'],
      ['Film.hi.srt', 'hi'],
    ])('%s → %s', (subtitle, language) => {
      expect(match(['Film.mkv'], [subtitle])[0]?.language).toBe(language)
    })

    test('`en.hi` = anglais malentendants', () => {
      expect(match(['Film.mkv'], ['Film.en.hi.srt'])[0]).toMatchObject({
        language: 'en',
        sdh: true,
      })
    })
  })

  describe('Flags', () => {
    test.each([
      ['Film.fr.forced.srt', { forced: true }],
      ['Film.fr.foreign.srt', { forced: true }],
      ['Film.en.sdh.srt', { sdh: true }],
      ['Film.en.cc.srt', { sdh: true }],
      ['Film.en.hi.srt', { sdh: true }],
      ['Film.fr.default.srt', { isDefault: true }],
    ])('%s', (subtitle, flags) => {
      expect(match(['Film.mkv'], [subtitle])[0]).toMatchObject(flags)
    })

    test('tout autre texte devient le titre de la piste', () => {
      expect(match(['Film.mkv'], ['Film.en.Director Commentary.srt'])[0]).toMatchObject({
        language: 'en',
        title: 'Director Commentary',
      })
    })
  })

  describe('Dossier Subs/', () => {
    test('une seule vidéo dans le dossier parent : tous les sous-titres lui sont rattachés', () => {
      const result = match(
        ['Film (2010)/Film.2010.1080p.mkv'],
        [
          'Film (2010)/Subs/2_French.srt',
          'Film (2010)/Subs/English.srt',
          'Film (2010)/subs/fre.srt',
        ],
      )
      expect(result.map((s) => [s.videoPath, s.language])).toEqual([
        ['Film (2010)/Film.2010.1080p.mkv', 'fr'],
        ['Film (2010)/Film.2010.1080p.mkv', 'en'],
        ['Film (2010)/Film.2010.1080p.mkv', 'fr'],
      ])
    })

    test('plusieurs vidéos : seuls ceux au nom d’une vidéo sont rattachés', () => {
      const result = match(
        ['Show/S01E01.mkv', 'Show/S01E02.mkv'],
        ['Show/Subs/English.srt', 'Show/Subs/S01E02.fr.srt'],
      )
      expect(result.map((s) => [s.subtitlePath, s.videoPath, s.language])).toEqual([
        ['Show/Subs/S01E02.fr.srt', 'Show/S01E02.mkv', 'fr'],
      ])
    })
  })

  describe('Formats', () => {
    test('texte : srt ass ssa vtt', () => {
      const result = match(
        ['Film.mkv'],
        ['Film.fr.srt', 'Film.fr.ass', 'Film.fr.ssa', 'Film.fr.vtt'],
      )
      expect(result.map((s) => [s.format, s.rendering])).toEqual([
        ['srt', 'text'],
        ['ass', 'text'],
        ['ssa', 'text'],
        ['vtt', 'text'],
      ])
    })

    test('sub+idx (VobSub) et sup (PGS) : incrustation', () => {
      const result = match(['Film.mkv'], ['Film.fr.idx', 'Film.fr.sub', 'Film.en.sup'])
      expect(result.map((s) => [s.subtitlePath, s.format, s.rendering])).toEqual([
        ['Film.fr.idx', 'vobsub', 'bitmap'],
        ['Film.en.sup', 'pgs', 'bitmap'],
      ])
    })

    // Ambiguity: a lone `.sub` may be MicroDVD text; only the VobSub pair is supported.
    test('.sub sans .idx, .idx sans .sub : ignorés', () => {
      expect(match(['Film.mkv'], ['Film.fr.sub', 'Film.en.idx'])).toEqual([])
    })
  })
})

describe('§8.4 Multi-épisodes et parties : sémantique', () => {
  test('S01E01-E02 : une source, deux épisodes', () => {
    expect(analyze('Show/Season 1/Show.S01E01-E02.mkv').parsed).toEqual({
      series: 'Show',
      season: 1,
      episode: 1,
      episodeEnd: 2,
    })
  })

  test('film en parties : un item, N sources ordonnées', () => {
    const paths = ['Film/Film-cd3.avi', 'Film/Film-cd1.avi', 'Film/Film-cd2.avi']
    const { stacks } = resolveStacks(
      paths.map((relativePath) => ({
        key: relativePath,
        relativePath,
        parsed: analyze(relativePath).parsed,
      })),
    )
    expect(stacks).toHaveLength(1)
    expect(stacks[0]?.members.map((m) => m.partIndex)).toEqual([1, 2, 3])
  })
})

describe('§8.5 Bonus, ignorés en v1', () => {
  test.each([
    'Trailers',
    'Trailer',
    'Behind The Scenes',
    'Deleted Scenes',
    'Interviews',
    'Scenes',
    'Featurettes',
    'Shorts',
    'Extras',
    'Extra',
    'Other',
    'Clips',
    'Samples',
    'Sample',
    'Backdrops',
    'Theme-music',
    'EXTRAS',
    'behind the scenes',
  ])('dossier %s, à n’importe quel niveau', (folder) => {
    expect(fileKind(`Film (2010)/${folder}/Making of.mkv`)).toEqual({
      kind: 'ignored',
      reason: 'bonus',
    })
    expect(fileKind(`Show/Season 1/${folder}/a/b.mkv`)).toEqual({
      kind: 'ignored',
      reason: 'bonus',
    })
    expect(filterDirectory({ relativePath: `Film (2010)/${folder}`, entryNames: [] })).toEqual({
      kind: 'skip',
      reason: 'bonus',
    })
  })

  test('la racine n’est jamais un bonus (elle ne fait pas partie du chemin relatif)', () => {
    expect(filterDirectory({ relativePath: '', entryNames: [] })).toEqual({ kind: 'descend' })
  })

  test.each([
    'Film-trailer.mkv',
    'Film.trailer.mkv',
    'Film_trailer.mkv',
    'Film - trailer.mkv',
    'Film-trailer2.mkv',
    'Film-sample.mkv',
    'Film-scene.mkv',
    'Film-clip.mkv',
    'Film-interview.mkv',
    'Film-behindthescenes.mkv',
    'Film-deleted.mkv',
    'Film-deletedscene.mkv',
    'Film-featurette.mkv',
    'Film-featurette 3.mkv',
    'Film-short.mkv',
    'Film-extra.mkv',
    'Film-other.mkv',
    'FILM-TRAILER.MKV',
  ])('suffixe : %s', (name) => {
    expect(fileKind(`Film (2010)/${name}`)).toEqual({ kind: 'ignored', reason: 'bonus' })
  })

  test.each([
    'trailer.mkv',
    'sample.mkv',
    'Sample.mp4',
    'film.sample.mkv',
    'Film.2010.1080p-GRP.sample.mkv',
  ])('fichier %s', (name) => {
    expect(fileKind(`Film (2010)/${name}`)).toEqual({ kind: 'ignored', reason: 'bonus' })
  })

  test('pas un bonus', () => {
    expect(fileKind('Film (2010)/Film (2010).mkv')).toEqual({ kind: 'video' })
    expect(fileKind('The Others (2001)/The Others (2001).mkv')).toEqual({ kind: 'video' })
    expect(fileKind('Trailer Park Boys/Season 1/S01E01.mkv')).toEqual({ kind: 'video' })
  })
})

describe('§8.6 Exclusions', () => {
  test.each(['.ignore', '.nomedia'])(
    'un fichier %s exclut le dossier et son sous-arbre',
    (marker) => {
      expect(
        filterDirectory({ relativePath: 'Film (2010)', entryNames: ['Film.mkv', marker] }),
      ).toEqual({ kind: 'skip', reason: 'ignore_marker' })
      expect(filterDirectory({ relativePath: '', entryNames: [marker] })).toEqual({
        kind: 'skip',
        reason: 'ignore_marker',
      })
    },
  )

  test.each([
    ['.hidden/Film.mkv', 'hidden'],
    ['Films/.Film.mkv', 'hidden'],
    ['Films/._Film.mkv', 'hidden'],
    ['@eaDir/Film.mkv', 'excluded'],
    ['#recycle/Film.mkv', 'excluded'],
    ['@Recycle/Film.mkv', 'excluded'],
    ['$RECYCLE.BIN/Film.mkv', 'excluded'],
    ['System Volume Information/Film.mkv', 'excluded'],
    ['lost+found/Film.mkv', 'excluded'],
    ['Film/.grab/x.mkv', 'hidden'],
    ['Film/metadata/x.mkv', 'excluded'],
    ['Film/extrafanart/x.mkv', 'excluded'],
    ['Film/extrathumbs/x.mkv', 'excluded'],
    ['Film/.actors/x.mkv', 'hidden'],
    ['Film/Film.trickplay/x.mkv', 'excluded'],
    ['Film/Thumbs.db', 'excluded'],
    ['Film/.DS_Store', 'hidden'],
  ] as const)('ignoré partout : %s', (path, reason) => {
    expect(fileKind(path)).toEqual({ kind: 'ignored', reason })
  })

  test.each(['@eaDir', 'Film/#recycle', 'Film.trickplay', '.git'])(
    'dossier %s non parcouru',
    (relativePath) => {
      expect(filterDirectory({ relativePath, entryNames: [] }).kind).toBe('skip')
    },
  )

  test('caractères interdits : le parser ne plante pas', () => {
    for (const name of [
      'Fi<l>m: "x" | y? * (2010).mkv',
      'Show\\S01E01.mkv',
      'a|b?c*.mkv',
      '<>:"|?*.mkv',
    ]) {
      const result = analyze(name)
      expect(result.displayTitle.length).toBeGreaterThan(0)
    }
    expect(analyze('Fi<l>m: "x" (2010).mkv').parsed.year).toBe(2010)
  })
})
