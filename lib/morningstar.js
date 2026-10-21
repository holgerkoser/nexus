export const MORNINGSTAR_API_URL = 'https://www.emea-api.morningstar.com'

export async function fetchMorningstarToken() {
  const url = new URL('/token/oauth', MORNINGSTAR_API_URL)
  const credentials = Buffer.from(`${MORNINGSTAR_API_USERNAME}:${MORNINGSTAR_API_PASSWORD}`).toString('base64')
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  })
  const { access_token: token } = await response.json()
  if (!token) {
    throw new Error('Failed to retrieve token from Morningstar API')
  }
  return token
}

export async function fetchMorningstarData(secIdMap) {
  try {
    const url = new URL('/ecint/v1/screener', MORNINGSTAR_API_URL)
    url.search =
      '?' +
      new URLSearchParams({
        page: 1,
        pageSize: 100,
        sortOrder: 'SecId asc',
        outputType: 'json',
        version: 1,
        currencyId: 'EUR',
        languageId: 'de-DE',
        universeIds: 'FOALL$$ALL_1293',
        securityDataPoints: 'SecId|ClosePrice|ClosePriceDate',
        filters: 'ProviderCompanyId:EQ:0C00001MAQ',
      })
    const token = await fetchMorningstarToken()
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await response.json()
    const rows = []
    for (const { SecId, ClosePriceDate, ClosePrice } of data.rows) {
      if (secIdMap.has(SecId)) {
        rows.push([secIdMap.get(SecId), ClosePriceDate, ClosePrice])
      }
    }
    const count = insertOrReplaceSecurities(rows)
    console.log(`[${new Date().toISOString()}] Updated ${count} quotes.`)
    return count
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error fetching data:`, err.message)
    throw err
  }
}
