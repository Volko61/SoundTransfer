const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  // Precache important pages for offline access
  cacheOnFrontEndNav: true,
  // Build offline support directly into the PWA
  buildExcludes: [/middleware-manifest\.json$/, /app-build-manifest\.json$/],
  // Fallback to offline page when offline
  fallbacks: {
    document: '/offline',
  },
  // Customize workbox to enable full offline support
  cacheStartUrl: true,
  dynamicStartUrl: false,
  // Only precache files that actually exist
  publicExcludes: ['!app-build-manifest.json', '!ngsw.json'],
  runtimeCaching: [
    // Start URL - Cache first for true offline support
    {
      urlPattern: ({ url }) => url.pathname === '/',
      handler: 'CacheFirst',
      options: {
        cacheName: 'start-url',
        expiration: {
          maxEntries: 1,
          maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
        },
        cacheableResponse: {
          statuses: [0, 200]
        },
        plugins: [
          {
            handlerDidError: async () => caches.match('/offline')
          }
        ]
      }
    },
    // External fonts - cache first for offline support
    {
      urlPattern: /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts',
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 365 * 24 * 60 * 60 // 1 year
        }
      }
    },
    // Static assets - cache first for offline support
    {
      urlPattern: /\.(?:js|css|woff2?|eot|ttf|otf)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-assets',
        expiration: {
          maxEntries: 60,
          maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
        }
      }
    },
    // Images - cache first for offline support
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'images',
        expiration: {
          maxEntries: 60,
          maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
        }
      }
    },
    // Next.js static files - cache first for best offline experience
    {
      urlPattern: /^\/_next\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-assets',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
        }
      }
    },
    // HTML pages - Cache first with network fallback for true offline support
    {
      urlPattern: ({ url, request }) => {
        return url.origin === self.location.origin &&
               request.destination === 'document';
      },
      handler: 'CacheFirst',
      options: {
        cacheName: 'pages',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
        },
        cacheableResponse: {
          statuses: [0, 200]
        }
      }
    },
    // API and other same-origin requests
    {
      urlPattern: ({ url, request }) => {
        return url.origin === self.location.origin &&
               request.destination !== 'document';
      },
      handler: 'CacheFirst',
      options: {
        cacheName: 'app-cache',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
        }
      }
    }
  ]
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for true offline PWA support
  output: 'export',
  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },
}

module.exports = withPWA(nextConfig)
