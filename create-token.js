// Usage: NEXUS_SECRET=... node create-token.js [subject] [expiresIn]
// expiresIn: e.g. 30d, 12h or 1y; omitted means the token does not expire
import { loadSecret, createToken } from './lib/auth.js'

const [subject, expiresIn] = process.argv.slice(2)

try {
  const secret = loadSecret()
  if (secret.generated) {
    throw new Error('NEXUS_SECRET is not set, a token signed with a random secret would be useless')
  }
  console.log(await createToken(secret.key, { subject, expiresIn }))
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
