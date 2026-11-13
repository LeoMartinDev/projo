import { runEngineContract } from './engine-contract.ts'
import { createFakeEngine } from './fake-engine.ts'

runEngineContract('fake engine', () => {
  const fake = createFakeEngine()
  return {
    engine: fake.engine,
    driver: {
      loaded: fake.loaded,
      advance: fake.advance,
      stall: fake.stall,
      resume: fake.resume,
    },
  }
})
