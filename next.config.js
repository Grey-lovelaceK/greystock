/** @type {import('next').NextConfig} */
const nextConfig = {
  // Aumentar límite de subida de archivos para los Excel
  api: {
    bodyParser: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
}

module.exports = nextConfig
