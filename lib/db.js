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

  const stmtCountCache = db.prepare(`
    SELECT COUNT(*) AS count FROM cache WHERE type = ?
  `)

  function putCache(key, type, payload) {
    stmtPutCache.run(key, type, Date.now(), payload)
  }

  function getCache(key, type) {
    const row = stmtGetCache.get(key, type)
    return row?.payload
  }

  function countSecurities() {
    return stmtCountCache.get('security').count
  }

  function putSecurity(row) {
    if (!row?.ISIN) {
      throw new Error('Security row without ISIN')
    }
    putCache(row.ISIN, 'security', zlib.gzipSync(JSON.stringify(row)))
  }

  const putSecurities = db.transaction((rows) => {
    for (const row of rows) {
      putSecurity(row)
    }
    return rows.length
  })

  function getSecurity(ISIN) {
    const payload = getCache(ISIN, 'security')
    return payload ? JSON.parse(zlib.gunzipSync(payload)) : undefined
  }

  return {
    db,
    getSecurity,
    putSecurity,
    putSecurities,
    countSecurities,
  }
}
