import { defineConfig } from 'astro/config';
import { elaguer } from './integrations/elaguer.mjs';
import { nomsFixes } from './integrations/noms-fixes.mjs';
import { ponctuation } from './integrations/ponctuation.mjs';

export default defineConfig({
  site: 'https://rouages.fr',
  // Site statique : les schémas sont générés au build, lisibles sans JavaScript,
  // indexables et imprimables. Voir docs/06-stack-technique.md.
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  // Astro 7 applique par défaut les règles de blancs de JSX ('jsx'), qui retirent les espaces entre éléments en
  // ligne : comparé page à page au rendu d'Astro 5, le site perdait 107 620 espaces (« titulaire : → », les liens
  // du menu collés). `true` est la compression sans perte d'Astro 5.
  compressHTML: true,
  markdown: { shikiConfig: { theme: 'github-light' } },
  integrations: [nomsFixes(), elaguer(), ponctuation()],
});
