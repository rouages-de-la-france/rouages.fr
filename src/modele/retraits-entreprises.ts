/**
 * Les oppositions des entreprises (`retraits.yaml`, section `entreprises`), et
 * ce qu'elles laissent voir d'une annonce du BODACC.
 *
 * Une entrée est un SIREN seul — l'annonce n'est plus montrée, elle reste
 * comptée — ou `{ siren, affichage }` : `commercial` garde l'annonce sous le
 * seul nom commercial, `anonyme` sans aucun nom. Un nom commercial qui
 * contient un mot du prénom ou du nom de la personne la nommerait encore :
 * l'annonce est alors anonyme.
 *
 * La collecte (`scripts/entreprises-emettre.ts`) l'applique à l'ingestion ; la
 * page de la commune et son journal l'appliquent aussi au build, avec les
 * SIREN que chaque annonce garde : une opposition inscrite se voit dès la
 * publication suivante, sans attendre la réingestion.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { RACINE } from './racine.ts';

export type Affichage = 'commercial' | 'anonyme';

export interface RetraitsEntreprises {
  /** Toutes les oppositions, quel que soit l'affichage. */
  entreprises: Set<string>;
  /** Les SIREN dont l'annonce reste montrée, et comment. */
  affichages: Map<string, Affichage>;
}

/** Les oppositions d'un texte au format de `retraits.yaml`. */
export function retraitsEntreprisesDe(texte: string): RetraitsEntreprises {
  const brut = ((texte ? parse(texte) : null) ?? {}) as { entreprises?: unknown[] };
  const entrees = (brut.entreprises ?? [])
    .map((x) => {
      const o = typeof x === 'object' && x !== null ? (x as { siren?: unknown; affichage?: unknown }) : { siren: x };
      const affichage = o.affichage === 'commercial' || o.affichage === 'anonyme' ? (o.affichage as Affichage) : null;
      return { siren: String(o.siren ?? '').replace(/\D/g, ''), affichage };
    })
    .filter((e) => e.siren.length === 9);
  return {
    entreprises: new Set(entrees.map((e) => e.siren)),
    affichages: new Map(entrees.filter((e) => e.affichage).map((e) => [e.siren, e.affichage!])),
  };
}

let lus: RetraitsEntreprises | null = null;
export function retraitsEntreprises(): RetraitsEntreprises {
  if (!lus) {
    const chemin = join(RACINE, 'retraits.yaml');
    lus = retraitsEntreprisesDe(existsSync(chemin) ? readFileSync(chemin, 'utf8') : '');
  }
  return lus;
}

/** Sans accents ni casse ni ponctuation : « Bénard-Lefèvre » et « BENARD LEFEVRE » se valent. */
export const plie = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Le nom commercial contient-il un mot (de plus d'une lettre) du nom de la personne ? */
export function commercialNomme(commercial: string, nom: string): boolean {
  const c = ` ${plie(commercial)} `;
  return plie(nom)
    .split(' ')
    .some((m) => m.length > 1 && c.includes(` ${m} `));
}

/** Ce qu'une annonce affiche à la place du nom, selon la nature de la personne. */
export const anonymat = (pp: boolean) => (pp ? 'Entreprise individuelle' : 'Société');

/**
 * Une annonce du fichier d'une commune : date, rang de la famille, nom,
 * identifiant au BODACC, activité, 1 pour un entrepreneur individuel, puis les
 * SIREN des personnes que l'ingestion a nommées, et leur nombre quand il
 * dépasse un.
 */
export type AnnonceFichier = [string, number, string, string, string?, (0 | 1)?, string[]?, number?];

/**
 * L'annonce telle qu'elle peut être montrée au build ; `null` si elle ne doit
 * plus l'être. Une annonce à plusieurs personnes dont l'une s'oppose est
 * retirée jusqu'à l'ingestion suivante, qui la recompose personne par
 * personne : le fichier ne garde pas leurs noms séparés.
 */
export function annonceRetenue<A extends AnnonceFichier>(a: A, r: RetraitsEntreprises = retraitsEntreprises()): A | null {
  const sirens = a[6] ?? [];
  const opposes = sirens.filter((s) => r.entreprises.has(s));
  if (opposes.length === 0) return a;
  if ((a[7] ?? 1) > 1) return null;
  const mode = r.affichages.get(opposes[0]);
  if (!mode) return null;
  const pp = a[5] === 1;
  let nom = anonymat(pp);
  if (mode === 'commercial') {
    if (!pp) nom = a[2];
    else {
      // « Prénom Nom (nom commercial) », tel que la collecte l'écrit.
      const m = /^(.*?) \((.+)\)$/.exec(a[2]);
      if (m && !commercialNomme(m[2], m[1])) nom = m[2];
    }
  }
  const b = [...a] as unknown as A;
  b[2] = nom;
  b[6] = [];
  return b;
}
