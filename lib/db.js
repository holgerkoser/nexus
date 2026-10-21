import zlib from 'node:zlib'
import Database from 'better-sqlite3'

export default (filename) => {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT NOT NULL,
      type TEXT NOT NULL,
      timestamp INTEGER,
      payload BLOB,
      PRIMARY KEY (key, type)
    );
  `)

  const stmtPutCache = db.prepare(`
    INSERT INTO cache (key, type, timestamp, payload)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key, type) DO UPDATE SET
      timestamp = excluded.timestamp,
      payload = excluded.payload
  `)

  const stmtGetCache = db.prepare(`
    SELECT payload FROM cache WHERE key = ? AND type = ?
  `)

  function putCache(key, type, payload) {
    stmtPutCache.run(key, type, Date.now(), payload)
  }

  function getCache(key, type) {
    const row = stmtGetCache.get(key, type)
    return row?.payload
  }

  function putSecurity(ISIN, row) {
    if (!row) {
      row = ISIN
      ISIN = row.ISIN
    }
    putCache(ISIN, 'security', zlib.gzipSync(JSON.stringify(row)))
  }

  function putSecurities(rows) {
    return db.transaction((rows) => {
      let count = 0
      for (const row of rows) {
        putSecurity(row.ISIN, row)
        count++
      }
      return count
    })(rows)
  }

  function getSecurity(ISIN) {
    const payload = getCache(ISIN, 'security')
    return JSON.parse(zlib.gunzipSync(payload))
  }

  return {
    db,
    getSecurity,
    putSecurity,
    putSecurities,
  }
}
