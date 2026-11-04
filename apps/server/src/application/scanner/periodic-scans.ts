import type { Clock } from '../../core/clock.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import { NAMING_RULES_VERSION } from '../../core/naming/index.ts'
import type {
  NamingRulesVersionStore,
  ScanRequester,
  ScanRunRepository,
} from '../../core/scanner/ports.ts'

type Deps = {
  libraryRepository: Pick<LibraryRepository, 'list'>
  scanRunRepository: Pick<ScanRunRepository, 'latest'>
  requestScan: ScanRequester
  namingRules: NamingRulesVersionStore
  clock: Clock
}

export const periodicScansFactory = ({
  libraryRepository,
  scanRunRepository,
  requestScan,
  namingRules,
  clock,
}: Deps) => {
  let started = false
  return (): string[] => {
    const now = clock.now().getTime()
    const startup = !started
    started = true
    const rulesChanged = startup && namingRules.read() !== NAMING_RULES_VERSION
    const due = libraryRepository.list().filter((library) => {
      if (startup) return true
      const latest = scanRunRepository.latest(library.id)
      return (
        latest === undefined ||
        now - latest.startedAt.getTime() >= library.scanIntervalMinutes * 60_000
      )
    })
    const kind = rulesChanged ? 'rules_update' : startup ? 'startup' : 'periodic'
    for (const library of due) requestScan({ libraryId: library.id, kind })
    if (rulesChanged) namingRules.write({ version: NAMING_RULES_VERSION, at: clock.now() })
    return due.map((library) => library.id)
  }
}
