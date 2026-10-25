import { systemClock } from './clock'
import { appEnv, loadConfig } from './config'
import { prepareAppFactory } from './boot'
import { healthUrl, httpHealthProbeFactory, waitForHealthFactory } from './health'
import { errorFields, jsonLoggerFactory } from './logger'
import { bunLauncher } from './process'
import { defaultRestartPolicy } from './restart-policy'
import { installSeedFactory } from './seed'
import { supervisorFactory } from './supervisor'
import { dbLayout, switchHandlerFactory } from './switch'
import { appLayout } from './version-state'

const config = loadConfig(process.env)
if (!config.ok) {
  jsonLoggerFactory({ level: 'info' }).error('invalid configuration', errorFields(config.error))
  process.exit(1)
}

const { dataDir, port, logLevel, seedDir, runtimeVersion, bunPath, shutdownGraceMs } = config.value
const logger = jsonLoggerFactory({ level: logLevel })
const layout = appLayout(dataDir)

const supervisor = supervisorFactory({
  prepareApp: prepareAppFactory({
    layout,
    runtimeVersion,
    installSeed: installSeedFactory({ layout, seedDir, logger }),
    logger,
  }),
  launch: bunLauncher,
  bunPath,
  appEnv: appEnv(process.env, config.value),
  switchHandler: switchHandlerFactory({
    layout,
    db: dbLayout(dataDir),
    clock: systemClock,
    logger,
  }),
  waitForHealth: waitForHealthFactory({
    probe: httpHealthProbeFactory({ url: healthUrl(port), timeoutMs: 2_000 }),
    clock: systemClock,
  }),
  restartPolicy: defaultRestartPolicy,
  shutdownGraceMs,
  clock: systemClock,
  logger,
})

process.on('SIGTERM', () => supervisor.stop('SIGTERM'))
process.on('SIGINT', () => supervisor.stop('SIGINT'))

logger.info('supervisor started', { runtimeVersion, bun: Bun.version, dataDir, pid: process.pid })
const exitCode = await supervisor.run()
logger.info('supervisor exiting', { exitCode })
process.exit(exitCode)
