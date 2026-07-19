import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ESW Operaciones',
    short_name: 'ESW',
    description: 'Operaciones, facturación y cobranzas de ESW.',
    start_url: '/',
    display: 'standalone',
    background_color: '#020617',
    theme_color: '#020617',
    lang: 'es',
    icons: [
      {
        src: '/logo_factura.jpg',
        sizes: '500x500',
        type: 'image/jpeg',
        purpose: 'maskable',
      },
    ],
  };
}
