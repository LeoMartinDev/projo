import { secureHeaders } from 'hono/secure-headers'

const self = "'self'"

/**
 * §20: strict CSP (no inline, no external domain), nosniff, Referrer-Policy. `blob:` is needed
 * for MSE playback (hls.js) and its worker. HSTS is left to the reverse proxy (projo speaks HTTP).
 */
export const securityHeaders = () =>
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: [self],
      scriptSrc: [self],
      styleSrc: [self],
      imgSrc: [self, 'data:', 'blob:'],
      fontSrc: [self],
      mediaSrc: [self, 'blob:'],
      connectSrc: [self],
      workerSrc: [self, 'blob:'],
      manifestSrc: [self],
      objectSrc: ["'none'"],
      baseUri: [self],
      formAction: [self],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: false,
    // `same-origin`: no referrer leaves the origin, and WebKit keeps the real `Origin` on a
    // `sendBeacon` (with `no-referrer` it sends `Origin: null`).
    referrerPolicy: 'same-origin',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    crossOriginResourcePolicy: 'same-origin',
    crossOriginOpenerPolicy: 'same-origin',
  })
