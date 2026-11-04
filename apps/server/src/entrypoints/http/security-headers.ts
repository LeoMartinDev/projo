import { secureHeaders } from 'hono/secure-headers'

const self = "'self'"

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
    referrerPolicy: 'same-origin',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    crossOriginResourcePolicy: 'same-origin',
    crossOriginOpenerPolicy: 'same-origin',
  })
