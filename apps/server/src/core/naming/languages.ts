/** [ISO 639-1, ISO 639-2/B, ISO 639-2/T, names (English, native, French)…] */
const LANGUAGES: readonly (readonly [string, string, string, ...string[]])[] = [
  ['fr', 'fre', 'fra', 'french', 'français', 'francais'],
  ['en', 'eng', 'eng', 'english', 'anglais'],
  ['es', 'spa', 'spa', 'spanish', 'español', 'espanol', 'castellano', 'espagnol'],
  ['de', 'ger', 'deu', 'german', 'deutsch', 'allemand'],
  ['it', 'ita', 'ita', 'italian', 'italiano', 'italien'],
  ['pt', 'por', 'por', 'portuguese', 'português', 'portugues', 'portugais'],
  ['nl', 'dut', 'nld', 'dutch', 'nederlands', 'néerlandais', 'flemish'],
  ['ja', 'jpn', 'jpn', 'japanese', '日本語', 'japonais'],
  ['zh', 'chi', 'zho', 'chinese', '中文', 'chinois', 'mandarin'],
  ['ko', 'kor', 'kor', 'korean', '한국어', 'coréen', 'coreen'],
  ['ru', 'rus', 'rus', 'russian', 'русский', 'russe'],
  ['ar', 'ara', 'ara', 'arabic', 'العربية', 'arabe'],
  ['hi', 'hin', 'hin', 'hindi', 'हिन्दी'],
  ['pl', 'pol', 'pol', 'polish', 'polski', 'polonais'],
  ['sv', 'swe', 'swe', 'swedish', 'svenska', 'suédois', 'suedois'],
  ['no', 'nor', 'nor', 'norwegian', 'norsk', 'norvégien', 'norvegien'],
  ['nb', 'nob', 'nob', 'bokmål', 'bokmal'],
  ['da', 'dan', 'dan', 'danish', 'dansk', 'danois'],
  ['fi', 'fin', 'fin', 'finnish', 'suomi', 'finnois'],
  ['is', 'ice', 'isl', 'icelandic', 'íslenska', 'islandais'],
  ['tr', 'tur', 'tur', 'turkish', 'türkçe', 'turc'],
  ['el', 'gre', 'ell', 'greek', 'ελληνικά', 'grec'],
  ['he', 'heb', 'heb', 'hebrew', 'עברית', 'hébreu', 'hebreu'],
  ['cs', 'cze', 'ces', 'czech', 'čeština', 'tchèque', 'tcheque'],
  ['sk', 'slo', 'slk', 'slovak', 'slovenčina', 'slovaque'],
  ['hu', 'hun', 'hun', 'hungarian', 'magyar', 'hongrois'],
  ['ro', 'rum', 'ron', 'romanian', 'română', 'roumain'],
  ['bg', 'bul', 'bul', 'bulgarian', 'български', 'bulgare'],
  ['uk', 'ukr', 'ukr', 'ukrainian', 'українська', 'ukrainien'],
  ['hr', 'hrv', 'hrv', 'croatian', 'hrvatski', 'croate'],
  ['sr', 'srp', 'srp', 'serbian', 'srpski', 'serbe'],
  ['sl', 'slv', 'slv', 'slovenian', 'slovenščina', 'slovène', 'slovene'],
  ['bs', 'bos', 'bos', 'bosnian', 'bosanski'],
  ['mk', 'mac', 'mkd', 'macedonian'],
  ['sq', 'alb', 'sqi', 'albanian', 'shqip'],
  ['lt', 'lit', 'lit', 'lithuanian', 'lietuvių'],
  ['lv', 'lav', 'lav', 'latvian', 'latviešu'],
  ['et', 'est', 'est', 'estonian', 'eesti'],
  ['ca', 'cat', 'cat', 'catalan', 'català'],
  ['eu', 'baq', 'eus', 'basque', 'euskara'],
  ['gl', 'glg', 'glg', 'galician', 'galego'],
  ['ga', 'gle', 'gle', 'irish', 'gaeilge'],
  ['cy', 'wel', 'cym', 'welsh', 'cymraeg'],
  ['br', 'bre', 'bre', 'breton', 'brezhoneg'],
  ['co', 'cos', 'cos', 'corsican', 'corsu', 'corse'],
  ['oc', 'oci', 'oci', 'occitan'],
  ['la', 'lat', 'lat', 'latin'],
  ['fa', 'per', 'fas', 'persian', 'farsi', 'فارسی', 'persan'],
  ['ur', 'urd', 'urd', 'urdu'],
  ['bn', 'ben', 'ben', 'bengali', 'বাংলা'],
  ['ta', 'tam', 'tam', 'tamil', 'தமிழ்'],
  ['te', 'tel', 'tel', 'telugu', 'తెలుగు'],
  ['ml', 'mal', 'mal', 'malayalam'],
  ['kn', 'kan', 'kan', 'kannada'],
  ['mr', 'mar', 'mar', 'marathi'],
  ['pa', 'pan', 'pan', 'punjabi', 'panjabi'],
  ['th', 'tha', 'tha', 'thai', 'ไทย'],
  ['vi', 'vie', 'vie', 'vietnamese', 'tiếng việt', 'vietnamien'],
  ['id', 'ind', 'ind', 'indonesian', 'bahasa indonesia', 'indonésien'],
  ['ms', 'may', 'msa', 'malay', 'bahasa melayu'],
  ['tl', 'tgl', 'tgl', 'tagalog', 'filipino'],
  ['sw', 'swa', 'swa', 'swahili', 'kiswahili'],
  ['af', 'afr', 'afr', 'afrikaans'],
  ['hy', 'arm', 'hye', 'armenian'],
  ['ka', 'geo', 'kat', 'georgian'],
  ['kk', 'kaz', 'kaz', 'kazakh'],
  ['mn', 'mon', 'mon', 'mongolian'],
]

const BY_CODE_OR_NAME: ReadonlyMap<string, string> = new Map(
  LANGUAGES.flatMap(([iso1, iso2b, iso2t, ...names]) =>
    [iso1, iso2b, iso2t, ...names].map((key) => [key, iso1] as const),
  ),
)

const REGION = /^[a-z]{2}$|^\d{3}$/iu

/**
 * Normalizes a language code or name to BCP 47 style: ISO 639-1 when it exists, region kept (`pt-BR`).
 * Accepts 639-1, 639-2/B and /T (`fre`, `fra`), plain names (`french`, `français`). Unknown input gives `undefined`.
 * Also meant for embedded track tags (ffprobe reports 639-2) so both sides compare equal.
 */
export const normalizeLanguage = (raw: string): string | undefined => {
  const value = raw.normalize('NFC').trim().toLowerCase()
  const direct = BY_CODE_OR_NAME.get(value)
  if (direct !== undefined) return direct
  const [base, region, ...rest] = value.split(/[-_]/u)
  if (base === undefined || region === undefined || rest.length > 0 || !REGION.test(region))
    return undefined
  const language = BY_CODE_OR_NAME.get(base)
  return language === undefined ? undefined : `${language}-${region.toUpperCase()}`
}
