const {
  MORNINGSTAR_API_URL = 'https://www.emea-api.morningstar.com',
  MORNINGSTAR_API_USERNAME,
  MORNINGSTAR_API_PASSWORD,
} = process.env

export async function fetchMorningstarToken() {
  if (!MORNINGSTAR_API_USERNAME || !MORNINGSTAR_API_PASSWORD) {
    throw new Error('Username and Password are required for the Morningstar API')
  }
  const credentials = Buffer.from(`${MORNINGSTAR_API_USERNAME}:${MORNINGSTAR_API_PASSWORD}`).toString('base64')
  const url = new URL('/token/oauth', MORNINGSTAR_API_URL)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`)
  }
  const { access_token: token } = await response.json()
  if (!token) {
    throw new Error('Failed to retrieve token from Morningstar API')
  }
  return token
}

export async function fetchMorningstarData(...ids) {
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
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`)
    }
    const data = await response.json()
    const map = new Map()
    for (const { SecId, ClosePriceDate, ClosePrice } of data.rows ?? []) {
      if (ids.includes(SecId)) {
        map.set(SecId, {
          date: ClosePriceDate,
          closePrice: ClosePrice,
        })
      }
    }
    console.log(`Fetched close price of ${map.size} securities from Morningstar API`)
    return map
  } catch (err) {
    console.error('Error fetching Morningstar data:', err.message)
    throw err
  }
}
