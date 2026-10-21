import { homedir } from 'os'
import { join as joinPath } from 'path'
import express from 'express'
import morgan from 'morgan'
import cron from 'node-cron'
import { scrapeAllSecurities, fetchUnionFund } from './lib/securities.js'
import createDatabase from './lib/db.js'

const { db, getSecurity, putSecurities } = createDatabase(process.env.DB_FILE ?? joinPath(homedir(), 'cache.db'))

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const app = express()
app.use(morgan('combined'))
app.set('trust proxy', 1)
app.set('x-powered-by', false)

const api = express()
api.set('trust proxy', 1)
api.set('x-powered-by', false)
api.set('etag', false)

api.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  })
  next()
})

api.post('/scrapeAllSecurities', async (req, res) => {
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
  res.json(getSecurity(req.params.isin))
})

app.use('/api', api)

cron.schedule('0 19,21,23 * * *', async () => {
  try {
    const count = await updateAllSecurities()
    console.log(`Regular update of all ${count} securities succeeded`)
  } catch (err) {
    console.error('Regular update of all securities failed:', err.message)
  }
})

const server = app.listen(PORT, () => {
  console.log(`Nexus server running on port ${PORT}`)
})

const shutdown = (signal) => {
  console.log(`Received ${signal}, shutting down gracefully`)

  server.close(() => {
    console.log('Nexus server closed')
    db.close()
    console.log('Database closed')
    cronTask.stop()
    console.log('Cron taks stopped')
    process.exit(0)
  })

  // Force exit after timeout
  setTimeout(() => {
    console.error('Forceful shutdown after timeout')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

async function updateAllSecurities() {
  const rows = await scrapeAllSecurities()
  const row = await fetchUnionFund('DE0008491002')
  rows.push(row)
  const count = putSecurities(rows)
  return count
}

updateAllSecurities()
