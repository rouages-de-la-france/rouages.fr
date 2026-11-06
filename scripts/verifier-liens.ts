/**
 * Vérifie qu'une adresse venue d'un registre tiers ne devient un lien que si
 * elle est en http ou https (`src/modele/lien-web.ts`).
 *
 * Audit du 6 novembre 2026 : l'adresse d'une délibération, saisie par la
 * collectivité ou son agrégateur, était reprise telle quelle dans un `href`.
 * Une adresse `javascript:` s'y serait exécutée au clic. Les adresses déjà
 * publiées sont relues aussi : aucune ne doit sortir de http(s).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lienWeb } from '../src/modele/lien-web.ts';

const ROUGE = '\x1b[31m', VERT = '\x1b[32m', RAZ = '\x1b[0m';
let echecs = 0;

const cas: [string | null | undefined, string | null][] = [
  ['https://www.mairie.fr/delib.pdf', 'https://www.mairie.fr/delib.pdf'],
  ['  http://x.fr/a b.pdf ', 'http://x.fr/a b.pdf'],
  ['javascript:alert(1)', null],
  [' JavaScript:alert(1)', null],
  ['data:text/html,<script>1</script>', null],
  ['vbscript:x', null],
  ['//ailleurs.fr/x', null],
  ['/relatif', null],
  ['ftp://x.fr/f', null],
  ['', null],
  [null, null],
  [undefined, null],
];
for (const [entree, attendu] of cas) {
  const r = lienWeb(entree);
  if (r !== attendu) {
    echecs++;
    console.log(`${ROUGE}échec${RAZ} ${JSON.stringify(entree)} → ${JSON.stringify(r)}, attendu ${JSON.stringify(attendu)}`);
  }
}

// Les délibérations déjà publiées : chaque adresse est en http(s), ou absente.
const DEP = 'public/territoires/dep';
let lues = 0;
for (const f of readdirSync(DEP).filter((n) => n.endsWith('-deliberations.json'))) {
  for (const m of readFileSync(join(DEP, f), 'utf8').matchAll(/"url":"((?:[^"\\]|\\.)*)"/g)) {
    const url = JSON.parse(`"${m[1]}"`) as string;
    if (!url) continue; // une délibération sans adresse
    lues++;
    if (lienWeb(url) === null) {
      echecs++;
      console.log(`${ROUGE}échec${RAZ} ${f} : adresse refusée ${JSON.stringify(url.slice(0, 80))}`);
    }
  }
}

if (echecs) {
  console.log(`${ROUGE}${echecs} échec(s).${RAZ}`);
  process.exit(1);
}
console.log(`${VERT}Liens conformes : ${cas.length} cas, ${lues} adresses de délibérations publiées.${RAZ}`);
