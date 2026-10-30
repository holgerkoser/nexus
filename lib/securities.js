export const secIdMap = new Map([
  ['F00001443S', 'GB00B02GQ528'],
  ['F00001443Y', 'GB00B02GQQ30'],
  ['F00001444C', 'GB00B02GQN09'],
  ['F00001444D', 'GB00B03HB047'],
])

function toDomain(url) {
  return new URL(url).hostname.split('.').slice(-2).join('.')
}

export const MANAGER_MAGAZIN_URL = 'https://boersen.manager-magazin.de'
export const MANAGER_MAGAZIN_DOMAIN = toDomain(MANAGER_MAGAZIN_URL)
export const TAGESSCHAU_URL = 'https://www.tagesschau.de'
export const TAGESSCHAU_DOMAIN = toDomain(TAGESSCHAU_URL)
export const UNION_INVESTMENT_URL = 'https://internal.api.union-investment.de'
export const UNION_INVESTMENT_DOMAIN = toDomain(UNION_INVESTMENT_URL)

const urlMap = new Map()
urlMap.set('GB00B02GQ528', {
  [TAGESSCHAU_DOMAIN]: '11869994',
  [MANAGER_MAGAZIN_DOMAIN]: 'cmign-cont-eurp-eq-sub-fd',
})
urlMap.set('GB00B02GQQ30', {
  [TAGESSCHAU_DOMAIN]: '44944495',
  [MANAGER_MAGAZIN_DOMAIN]: 'cmign-eurp-enh-eq-sub-fd',
})
urlMap.set('GB00B02GQN09', {
  [TAGESSCHAU_DOMAIN]: '108972805',
  [MANAGER_MAGAZIN_DOMAIN]: 'cmign-us-enh-eq-sub-fd',
})
urlMap.set('GB00B03HB047', {
  [TAGESSCHAU_DOMAIN]: '108972795',
  [MANAGER_MAGAZIN_DOMAIN]: 'cmign-us-idx-tracking-fd',
})

function getScrapeUrl(id, domain) {
  const part = urlMap.get(id.toUpperCase())?.[domain]
  if (!part) {
    throw new Error(`No scrape URL known for ${id} on ${domain}`)
  }
  switch (domain) {
    case MANAGER_MAGAZIN_DOMAIN: {
      return new URL(`/fonds/${part}/${id.toUpperCase()}/`, MANAGER_MAGAZIN_URL)
    }
    case TAGESSCHAU_DOMAIN: {
      return new URL(`/wirtschaft/boersenkurse/${id.toLowerCase()}-${part}/`, TAGESSCHAU_URL)
    }
    default: {
      throw new Error(`Unsupported scrape domain: ${domain}`)
    }
  }
}

function localDateString(time) {
  const date = new Date(time)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTimestamp(date) {
  return new Date(`${date}T00:00:00`).getTime()
}

const historyRegex = /^\s*\$\.extend\(true,\s*s\.USFdata\.history,(.*)\);\s*$/

function extractHistory(text) {
  if (text && text.includes('s.USFdata.history')) {
    const match = historyRegex.exec(text)
    if (match && match[1]) {
      return JSON.parse(match[1])
    }
  }
}

const interdayRegex = /^\s*\$\.extend\(true,\s*s\.USFdata\.interday,(.*)\);\s*$/

function extractInterday(text) {
  if (text && text.includes('s.USFdata.interday')) {
    const match = interdayRegex.exec(text)
    if (match && match[1]) {
      return JSON.parse(match[1])
    }
  }
}

const historyStartTime = new Date('2018-01-01').getTime()

export async function scrapeSecurityData(id, domain = MANAGER_MAGAZIN_DOMAIN) {
  const url = getScrapeUrl(id, domain)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`)
  }
  const textStream = response.body.pipeThrough(new TextDecoderStream('utf-8'))
  let remainder = ''
  let intraday
  let history
  for await (let chunk of textStream) {
    const text = remainder + chunk
    const lines = text.split(/\r?\n/)
    remainder = lines.pop()
    for (const line of lines) {
      if (!intraday) {
        intraday = extractInterday(line)
      }
      if (!history) {
        history = extractHistory(line)
      }
      if (intraday && history) {
        return {
          ISIN: id,
          lastTimestamp: intraday.lastTimestamp,
          lastprice: intraday.lastprice,
          lowtime: history.lowtime,
          low: history.low,
          hightime: history.hightime,
          high: history.high,
          data: history.data
            .filter(([time]) => time > historyStartTime)
            .map(([time, closePrice]) => [localDateString(time), closePrice]),
        }
      }
    }
  }
  throw new Error(`No price data found for ${id} at URL: ${url}`)
}

export function scrapeAllSecurities() {
  const ISINs = Array.from(secIdMap.values())
  return Promise.all(ISINs.map((ISIN) => scrapeSecurityData(ISIN)))
}

export async function fetchUnionFund(ISIN) {
  const { UNION_INVESTMENT_API_KEY } = process.env
  if (!UNION_INVESTMENT_API_KEY) {
    throw new Error('API key is required for the Union Investment API')
  }
  const url = new URL('/beta/web/calc/union-tools-wtru/public/product/timeseries', UNION_INVESTMENT_URL)
  url.search =
    '?' +
    new URLSearchParams({
      'api-version': 'beta-1.0.3',
      organization: 'ROOT',
      isin: ISIN,
      redemption: 'true',
      firstDay: localDateString(historyStartTime),
    })
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'x-api-key': UNION_INVESTMENT_API_KEY,
    },
  })
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`)
  }
  const { isinsTimeSeries } = await response.json()
  const timeSeries = isinsTimeSeries?.[ISIN]?.timeSeries
  if (!timeSeries || Object.keys(timeSeries).length === 0) {
    throw new Error(`No time series found for ${ISIN} at URL: ${url}`)
  }

  let low = Number.MAX_VALUE
  let high = 0
  let lowtime
  let hightime
  const data = []
  for (const { date, value } of Object.values(timeSeries)) {
    data.push([date, value])
    if (low > value) {
      low = value
      lowtime = localTimestamp(date)
    }
    if (high < value) {
      high = value
      hightime = localTimestamp(date)
    }
  }
  const last = data[data.length - 1]
  return {
    ISIN,
    lastTimestamp: localTimestamp(last[0]),
    lastprice: last[1],
    low,
    lowtime,
    high,
    hightime,
    data,
  }
}
