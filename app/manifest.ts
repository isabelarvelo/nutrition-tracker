import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mise — Personal nutrition journal',
    short_name: 'Mise',
    description: 'Capture meals quickly and understand your nutrition over time.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f1ea',
    theme_color: '#234c39',
  };
}
