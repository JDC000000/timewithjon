// src/app/robots.ts — AD-12: Disallow everything. No sitemap exists anywhere.
import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
