const port = parseInt(process.env.PORT ?? '3000', 10)

async function main() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(3000),
    })
    process.exit(response.ok ? 0 : 1)
  } catch {
    process.exit(1)
  }
}

main()
