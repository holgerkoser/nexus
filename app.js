import { homedir } from 'node:os'
import { join as joinPath } from 'node:path'
import express from 'express'
import morgan from 'morgan'
import cron from 'node-cron'
import { scrapeAllSecurities, fetchUnionFund } from './lib/securities.js'
import createDatabase from './lib/db.js'
import { loadSecret, createToken, createRequireToken } from './lib/auth.js'

const UNION_FUND_ISIN = 'DE0008491002'
const DB_FILE = process.env.DB_FILE ?? joinPath(homedir(), 'cache.db')
const PORT = parseInt(process.env.PORT ?? '3000', 10)
const secret = loadSecret()
const requireToken = createRequireToken(secret.key)

if (secret.generated) {
  const token = await createToken(secret.key)
  const line = '='.repeat(78)
  console.warn(
    [
      line,
      '  NEXUS_SECRET is not set, generated a random secret for this run.',
      '  Use this bearer token for protected endpoints:',
      '',
      `  ${token}`,
      '',
      '  It becomes invalid on restart. Set NEXUS_SECRET to keep tokens valid',
      '  and create tokens with: node create-token.js [subject] [expiresIn]',
      line,
    ].join('\n'),
  )
}

// The server keeps running if the database cannot be initialized,
// so that the health check is able to report the failure.
let database
let databaseError
try {
  database = createDatabase(DB_FILE)
} catch (err) {
  databaseError = err
  console.error(`Initialization of database ${DB_FILE} failed:`, err.message)
}

const app = express()
app.use(
  morgan('combined', {
    skip: (req, res) => req.originalUrl === '/api/health' && res.statusCode < 400,
  })
)
app.set('trust proxy', 1)
app.set('x-powered-by', false)
app.set('etag', false)

const api = express.Router()

api.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  })
  next()
})

api.get('/health', (req, res) => {
  if (!database) {
    return res.status(503).json({
      status: 'error',
      message: `Database initialization failed: ${databaseError.message}`,
    })
  }
  try {
    const count = database.countSecurities()
    if (count === 0) {
      return res.status(503).json({
        status: 'error',
        message: 'Database contains no securities',
        count,
      })
    }
    res.json({ status: 'ok', count })
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message })
  }
})

api.use((req, res, next) => {
  if (!database) {
    return res.status(503).json({ status: 'error', message: 'Database not available' })
  }
  next()
})

api.post('/scrapeAllSecurities', requireToken, async (req, res) => {
  try {
    const count = await updateAllSecurities()
    res.json({
      status: 'success',
      count,
    })
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    })
  }
})

api.get('/security/:isin', (req, res) => {
  const security = database.getSecurity(req.params.isin.toUpperCase())
  if (!security) {
    return res.status(404).json({ status: 'error', message: `Unknown security ${req.params.isin}` })
  }
  res.json(security)
})

app.use('/api', api)

const cronTask = cron.schedule(
  '0 19,21,23 * * *',
  async () => {
    try {
      const count = await updateAllSecurities()
      console.log(`Regular update of all ${count} securities succeeded`)
    } catch (err) {
      console.error('Regular update of all securities failed:', err.message)
    }
  },
  { timezone: 'Europe/Berlin' },
)

const server = app.listen(PORT, () => {
  console.log(`Nexus server running on port ${PORT}`)
})

let shuttingDown = false

const shutdown = (signal) => {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  console.log(`Received ${signal}, shutting down gracefully`)

  cronTask.stop()
  console.log('Cron task stopped')

  server.close(() => {
    console.log('Nexus server closed')
    database?.db.close()
    console.log('Database closed')
    process.exit(0)
  })

  // Force exit after timeout
  setTimeout(() => {
    console.error('Forceful shutdown after timeout')
    process.exit(1)
  }, 10000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Concurrent callers (cron, API, startup) share a running update
let runningUpdate

async function updateAllSecurities() {
  // Reset via .finally(), as it always runs after the assignment below
  const runUpdate = () =>
    fetchAndStoreSecurities().finally(() => {
      runningUpdate = undefined
    })

  return (runningUpdate ??= runUpdate())
}

async function fetchAndStoreSecurities() {
  if (!database) {
    throw new Error('Database not available')
  }
  const [rows, unionFund] = await Promise.all([scrapeAllSecurities(), fetchUnionFund(UNION_FUND_ISIN)])
  return database.putSecurities([...rows, unionFund])
}

async function main() {
  try {
    const count = await updateAllSecurities()
    console.log(`Initial update of all ${count} securities succeeded`)
  } catch (err) {
    console.error('Initial update of all securities failed:', err.message)
  }
}

main()
