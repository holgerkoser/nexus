import { randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const ALGORITHM = 'HS256'
const ISSUER = 'nexus'
const MIN_SECRET_LENGTH = 32

export function loadSecret() {
  const { NEXUS_SECRET } = process.env
  if (!NEXUS_SECRET) {
    return { key: new TextEncoder().encode(randomBytes(32).toString('base64url')), generated: true }
  }
  if (NEXUS_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(`NEXUS_SECRET must be at least ${MIN_SECRET_LENGTH} characters long`)
  }
  return { key: new TextEncoder().encode(NEXUS_SECRET), generated: false }
}

export function createToken(key, { subject = 'nexus', expiresIn } = {}) {
  const jwt = new SignJWT().setProtectedHeader({ alg: ALGORITHM }).setIssuer(ISSUER).setSubject(subject).setIssuedAt()
  if (expiresIn) {
    jwt.setExpirationTime(expiresIn)
  }
  return jwt.sign(key)
}

export function createRequireToken(key) {
  return async (req, res, next) => {
    const [scheme, token] = req.get('Authorization')?.split(' ') ?? []
    try {
      if (scheme !== 'Bearer' || !token) {
        throw new Error('Missing bearer token')
      }
      const { payload } = await jwtVerify(token, key, { algorithms: [ALGORITHM], issuer: ISSUER })
      req.auth = payload
    } catch {
      res.set('WWW-Authenticate', 'Bearer')
      return res.status(401).json({ status: 'error', message: 'Unauthorized' })
    }
    next()
  }
}
