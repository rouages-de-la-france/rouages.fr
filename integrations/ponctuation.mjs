/**
 * Pas d'espace entre un élément en ligne et la ponctuation qui le suit.
 *
 * Astro 7 garde, en compression sans perte (`compressHTML: true`), le blanc
 * qu'un retour à la ligne laisse entre `</a>` et la virgule qui le suit dans
 * un composant : « EGIS EAU SA , BUREAU », « l'agence régionale de santé ,
 * que ». Astro 5 le retirait. Plutôt que de retoucher la mise en page de
 * dizaines de composants, on retire ce blanc dans les pages produites, et
 * seulement là : derrière une balise en ligne fermante, devant une virgule, un
 * point ou une parenthèse fermante. Le texte, lui, n'est jamais touché.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOTIF = /(<\/(?:a|abbr|span|strong|em|b|i|code|time|small|sup|sub|bdi)>)[ \t\r\n]+(?=[,.)](?!\.))/g;

export function corrigerPonctuation(html) {
  return html.replace(MOTIF, '$1');
}

export function ponctuation() {
  return {
    name: 'rouages-ponctuation',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        let pages = 0;
        let corriges = 0;
        const parcourir = (d) => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) parcourir(p);
            else if (e.name.endsWith('.html')) {
              const avant = readFileSync(p, 'utf8');
              let n = 0;
              const apres = avant.replace(MOTIF, (_, balise) => (n++, balise));
              if (n) {
                writeFileSync(p, apres);
                pages++;
                corriges += n;
              }
            }
          }
        };
        parcourir(fileURLToPath(dir));
        logger.info(`${corriges} espaces retirées devant une ponctuation, dans ${pages} pages.`);
      },
    },
  };
}
