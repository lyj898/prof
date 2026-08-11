// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Local dev only for this pass. Default dev port 4321 (matches the Supabase
// redirect URL you'll allow-list). No adapter / no deploy target wired up yet.
export default defineConfig({
  // Deployed as a static site to GitHub Pages at the custom domain.
  site: 'https://prof.yvjobs.online',
  integrations: [react()],
  server: {
    port: 4321,
  },
});
