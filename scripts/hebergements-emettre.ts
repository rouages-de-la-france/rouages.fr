/**
 * Les hébergements touristiques classés, d'après la liste qu'Atout France
 * publie chaque jour (data.gouv.fr, jeu 59c36c6a88ee3826d5998a35, Licence
 * Ouverte) : hôtels de tourisme, campings, résidences de tourisme, villages de
 * vacances, parcs résidentiels de loisirs, auberges collectives.
 *
 * Le classement est volontaire : un hébergement non classé n'y figure pas, et
 * la liste ne dit pas tout ce qui accueille des touristes dans la commune. Elle
 * publie, pour chacun, les « données publiques » de l'arrêté du 29 décembre
 * 2021 : le nom commercial, le type, le classement, la date de classement et
 * la capacité. La page les reprend tels quels, sans l'adresse ni le site.
 *
 * Le fichier ne donne pas le code INSEE : la commune se retrouve par son code
 * postal et son nom, comme pour les lieux à voir (`lieux-emettre.ts`), sinon
 * par un code postal qui ne désigne qu'une commune ; un arrondissement de
 * Paris, Lyon ou Marseille va à sa commune.
 *
 * Lancé seul — `tsx scripts/hebergements-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-hebergements.json`.
 */
import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { correspondances } from './lieux-emettre.ts';
import { ecrireParDepartement, lignesCsv, telechargerSiAbsent } from './par-departement.ts';
import { indisponible } from './echecs.ts';

export const JEU = '59c36c6a88ee3826d5998a35';
export const FICHIER = 'https://data.classement.atout-france.fr/static/exportHebergementsClasses/hebergements_classes.csv';

/** Un hébergement : nom, type, classement (« 3 étoiles »), date de classement (ISO), capacité en personnes. */
export type Hebergement = [string, string, string, string, number | null];

export interface Hebergements {
  maj: string;
  communes: Map<string, Hebergement[]>;
}

/** « HÔTEL DE TOURISME » → « Hôtel de tourisme ». */
const type = (t: string) => {
  const s = t.trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Un code postal qui ne désigne qu'une commune actuelle : le repli pour une
 * station ou un hameau que le fichier nomme à la place de sa commune (« 73400
 * VAL THORENS » est ambigu, « 06160 JUAN LES PINS » non). Un code partagé
 * entre plusieurs communes ne tranche rien : la ligne reste sans commune.
 */
export function communeUniqueParCodePostal(): (cp: string) => string | null {
  const chemin = createRequire(import.meta.url).resolve('@etalab/decoupage-administratif/data/communes.json');
  const toutes = JSON.parse(readFileSync(chemin, 'utf8')) as { code: string; type: string; codesPostaux?: string[] }[];
  const par = new Map<string, Set<string>>();
  for (const c of toutes) {
    if (c.type !== 'commune-actuelle') continue;
    for (const cp of c.codesPostaux ?? []) par.set(cp, (par.get(cp) ?? new Set()).add(c.code));
  }
  return (cp) => {
    const s = par.get(cp);
    return s && s.size === 1 ? [...s][0] : null;
  };
}

/** Paris, Lyon et Marseille : un arrondissement va à sa commune. */
function arrondissement(nom: string): string | null {
  const n = nom.toUpperCase();
  if (/^PARIS\b/.test(n)) return '75056';
  if (/^LYON\b/.test(n)) return '69123';
  if (/^MARSEILLE\b/.test(n)) return '13055';
  return null;
}

export async function collecterHebergements(
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Hebergements | null> {
  const vers = join(cache, `hebergements-classes-${new Date().toISOString().slice(0, 10)}.csv`);
  await telecharger(FICHIER, vers);
  const commune = correspondances();
  const parCodePostal = communeUniqueParCodePostal();
  const communes = new Map<string, Hebergement[]>();
  let col: Record<string, number> | null = null;
  let lus = 0;
  let orphelins = 0;
  for await (const v of lignesCsv(createReadStream(vers) as unknown as AsyncIterable<Uint8Array>, ';')) {
    if (!col) {
      col = Object.fromEntries(v.map((n, i) => [n.trim(), i]));
      for (const n of ['DATE DE CLASSEMENT', 'TYPOLOGIE ÉTABLISSEMENT', 'CLASSEMENT', 'NOM COMMERCIAL', 'CODE POSTAL', 'COMMUNE', "CAPACITÉ D'ACCUEIL (PERSONNES)"]) {
        if (col[n] === undefined) return indisponible(dire, `Hébergements classés : colonne « ${n} » absente, le fichier a changé de forme.`);
      }
      continue;
    }
    const nom = (v[col['NOM COMMERCIAL']] ?? '').replace(/\s+/g, ' ').trim();
    const cp = (v[col['CODE POSTAL']] ?? '').trim().padStart(5, '0');
    const nomCommune = (v[col.COMMUNE] ?? '').trim();
    if (!nom || !/^\d{5}$/.test(cp) || !nomCommune) continue;
    lus++;
    const code = arrondissement(nomCommune) ?? commune(cp, nomCommune) ?? parCodePostal(cp);
    if (!code) {
      orphelins++;
      continue;
    }
    const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v[col['DATE DE CLASSEMENT']] ?? '').trim());
    const capacite = Number((v[col["CAPACITÉ D'ACCUEIL (PERSONNES)"]] ?? '').trim());
    const h: Hebergement = [
      nom,
      type(v[col['TYPOLOGIE ÉTABLISSEMENT']] ?? ''),
      (v[col.CLASSEMENT] ?? '').trim(),
      date ? `${date[3]}-${date[2]}-${date[1]}` : '',
      Number.isFinite(capacite) && capacite > 0 ? capacite : null,
    ];
    communes.set(code, [...(communes.get(code) ?? []), h]);
  }
  if (lus < 15000) return indisponible(dire, `Hébergements classés : ${lus} lignes seulement, on garde l’ingestion précédente.`);
  // Les plus grands d'abord, puis par nom.
  for (const l of communes.values()) l.sort((a, b) => (b[4] ?? 0) - (a[4] ?? 0) || a[0].localeCompare(b[0], 'fr'));
  dire(
    `Hébergements classés (Atout France) : ${lus.toLocaleString('fr-FR')} hébergements, ${communes.size.toLocaleString('fr-FR')} communes` +
      (orphelins ? ` ; ${orphelins} sans commune retrouvée par le code postal et le nom.` : '.'),
  );
  return { maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireHebergements(sortie: string, h: Hebergements): number {
  return ecrireParDepartement(sortie, 'hebergements', h.communes, () => ({ maj: h.maj }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const h = await collecterHebergements(telecharger, cache, console.log);
  if (h) console.log(`${ecrireHebergements(sortie, h)} départements écrits.`);
}
