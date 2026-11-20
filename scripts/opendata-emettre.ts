/**
 * Les collectivités qui publient leurs données en open data, d'après
 * l'Observatoire open data des territoires d'OpenDataFrance, sous Licence
 * Ouverte.
 *
 * **Une photographie datée.** La dernière édition publiée arrête ses comptes
 * au 31 décembre 2022. La page le dit à chaque fois : une commune qui publie
 * depuis n'y figure pas, et un compte de jeux de données de 2022 ne dit rien
 * d'aujourd'hui. Une nouvelle édition remplacera celle-ci d'elle-même : le jeu
 * est cherché par son titre, et l'édition la plus récente retenue.
 *
 * Pour chaque organisation, par SIREN : son nom, son type, la plateforme où
 * elle publie et le nombre de jeux qu'on y trouvait, et le nombre de jeux
 * qu'elle avait sur data.gouv.fr, avec les liens.
 *
 * Un seul fichier national, `public/territoires/opendata.json`.
 * Lancé seul : `tsx scripts/opendata-emettre.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';
import { lignesCsv, telechargerSiAbsent } from './par-departement.ts';

/** [nom, type, plateforme, adresse sur la plateforme, jeux sur la plateforme, adresse sur data.gouv.fr, jeux sur data.gouv.fr] */
export type OrganisationOuverte = [string, string, string, string, number | null, string, number | null];

export interface Ouverture {
  maj: string;
  /** La date d'arrêt de l'édition, AAAA-MM-JJ. */
  edition: string;
  organisations: Record<string, OrganisationOuverte>;
  /** Le SIREN de chaque commune qui figure à l'observatoire, par code INSEE : la page part du code. */
  communes: Record<string, string>;
}

const nombre = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};
const lien = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return /^https?:\/\//.test(t) ? t : '';
};

export async function collecterOuverture(
  telecharger: (url: string, vers: string) => Promise<void>,
  json: <T>(url: string) => Promise<T>,
  cache: string,
  dire: (m: string) => void,
): Promise<Ouverture | null> {
  type Jeu = { slug?: string; title?: string; organization?: { name?: string } };
  type Ressource = { title?: string; url?: string };
  let jeux: Jeu[] = [];
  try {
    jeux = (await json<{ data?: Jeu[] }>('https://www.data.gouv.fr/api/2/datasets/search/?q=observatoire%20open%20data%20des%20territoires&page_size=20')).data ?? [];
  } catch {
    return indisponible(dire, 'Open data des territoires : la recherche n’a pas répondu.');
  }
  // L'édition la plus récente d'OpenDataFrance : l'année est dans le titre.
  const edition = jeux
    .filter((j) => /opendatafrance/i.test(j.organization?.name ?? '') && /observatoire open data des territoires/i.test(j.title ?? ''))
    .map((j) => ({ slug: j.slug!, annee: Number(/(20\d\d)/.exec(j.title ?? '')?.[1] ?? 0) }))
    .sort((a, b) => b.annee - a.annee)[0];
  if (!edition) return indisponible(dire, 'Open data des territoires : aucune édition de l’observatoire trouvée.');
  let ressources: Ressource[] = [];
  try {
    ressources = (await json<{ data?: Ressource[] }>(`https://www.data.gouv.fr/api/2/datasets/${edition.slug}/resources/?page_size=20`)).data ?? [];
  } catch {
    return indisponible(dire, 'Open data des territoires : les fichiers de l’édition n’ont pas répondu.');
  }
  const organisations = ressources.find((r) => /organisations/i.test(r.title ?? '') && r.url);
  if (!organisations) return indisponible(dire, 'Open data des territoires : le fichier des organisations est introuvable.');
  const arret = /(20\d\d-\d\d-\d\d)/.exec(`${organisations.title} ${organisations.url}`)?.[1] ?? `${edition.annee}-12-31`;
  const fichier = join(cache, `opendata-organisations-${arret}.csv`);
  await telecharger(organisations.url!, fichier);

  const sortie: Record<string, OrganisationOuverte> = {};
  let entete: string[] | null = null;
  for await (const l of lignesCsv([readFileSync(fichier, 'utf8')], ',')) {
    if (!entete) {
      entete = l.map((h) => h.trim());
      if (!['siren', 'nom', 'type', 'nb-ptf', 'nb-datagouv'].every((c) => entete!.includes(c))) {
        return indisponible(dire, 'Open data des territoires : le fichier a changé de forme.');
      }
      continue;
    }
    const v = (c: string) => (l[entete!.indexOf(c)] ?? '').trim();
    const siren = v('siren').replace(/\D/g, '');
    if (siren.length !== 9) continue;
    sortie[siren] = [v('nom'), v('type'), v('ptf'), lien(v('url-ptf')), nombre(v('nb-ptf')), lien(v('url-datagouv')), nombre(v('nb-datagouv'))];
  }
  const n = Object.keys(sortie).length;
  if (n < 500) return indisponible(dire, `Open data des territoires : ${n} organisations seulement, on garde l’ingestion précédente.`);
  // Les communes, par leur SIREN au découpage administratif.
  const decoupage = JSON.parse(
    readFileSync(createRequire(import.meta.url).resolve('@etalab/decoupage-administratif/data/communes.json'), 'utf8'),
  ) as { code: string; type: string; siren?: string }[];
  const communes: Record<string, string> = {};
  for (const c of decoupage) if (c.type === 'commune-actuelle' && c.siren && sortie[c.siren]) communes[c.code] = c.siren;
  dire(`Open data des territoires (édition arrêtée au ${arret}) : ${n} organisations, dont ${Object.keys(communes).length} communes.`);
  return { maj: new Date().toISOString().slice(0, 10), edition: arret, organisations: sortie, communes };
}

export function ecrireOuverture(sortie: string, o: Ouverture): void {
  writeFileSync(join(sortie, 'opendata.json'), JSON.stringify(o));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const o = await collecterOuverture(telecharger, lireJson as <T>(url: string) => Promise<T>, cache, console.log);
  if (o) ecrireOuverture(sortie, o);
}
