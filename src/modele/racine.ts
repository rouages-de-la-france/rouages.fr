/**
 * La racine du dépôt, d'où se lisent `contenu/`, `public/territoires/` et
 * `retraits.yaml`.
 *
 * On la calculait depuis l'emplacement du module (`../../`). Astro 7 regroupe
 * le code du prérendu dans `dist/.prerender/chunks/` : ce chemin tombait alors
 * sur `dist/`, le graphe se chargeait vide sans erreur, et seul un contrôle en
 * aval (« démarche inconnue ») l'a révélé. On remonte donc les dossiers jusqu'à
 * celui qui porte à la fois `package.json` et `contenu/`, où que soit le code
 * compilé ; à défaut, le dossier où la commande a été lancée.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function trouverRacine(): string {
  for (const depart of [dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    let d = depart;
    for (;;) {
      if (existsSync(join(d, 'package.json')) && existsSync(join(d, 'contenu'))) return d.endsWith('/') ? d : `${d}/`;
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
  }
  return `${process.cwd()}/`;
}

/** Avec la barre finale, comme l'ancienne valeur tirée de `new URL('../../', …)`. */
export const RACINE = trouverRacine();
