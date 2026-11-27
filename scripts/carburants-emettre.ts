/**
 * Les stations-service, leurs prix et leurs services, d'après le flux
 * instantané « Prix des carburants en France » que publie la DGCCRF
 * (data.economie.gouv.fr, jeu `prix-des-carburants-en-france-flux-instantane-v2`,
 * Licence Ouverte 2.0). Ce sont les points de vente déclarés sur
 * prix-carburants.gouv.fr, au titre de l'arrêté du 12 décembre 2006 : le
 * gérant y déclare ses prix, ses ruptures et ses services.
 *
 * Pour chaque station : la position, l'adresse, la route ou l'autoroute,
 * l'automate 24 h sur 24, chaque carburant avec son dernier prix et la date
 * de ce prix, ou sa rupture (temporaire ou définitive, et depuis quand), et
 * la liste des services déclarés. Un prix est montré avec sa date : le flux
 * garde le dernier prix déclaré, même ancien, et c'est la date qui dit ce
 * qu'il vaut.
 *
 * Le flux ne donne pas le code INSEE : la station est placée dans sa commune
 * par ses coordonnées (les contours qu'écrit la collecte des espaces
 * naturels), sinon par son code postal et le nom de sa ville.
 *
 * Lancé seul — `tsx scripts/carburants-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-carburants.json`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contoursDesCommunes, ECHELLE } from './espaces-emettre.ts';
import { localisateur } from './localiser.ts';
import { correspondances } from './lieux-emettre.ts';
import { ecrireParDepartement, telechargerSiAbsent } from './par-departement.ts';
import { indisponible } from './echecs.ts';

export const JEU = 'prix-des-carburants-en-france-flux-instantane-v2';
export const EXPORT = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/${JEU}/exports/json`;

/** Les carburants du flux, dans l'ordre de ses colonnes, avec leur libellé. */
export const CARBURANTS: [string, string][] = [
  ['gazole', 'Gazole'],
  ['sp95', 'SP95'],
  ['e10', 'SP95-E10'],
  ['sp98', 'SP98'],
  ['e85', 'E85'],
  ['gplc', 'GPLc'],
];

/**
 * Un carburant : sa clé (`gazole`…), le dernier prix déclaré (euros le litre, null s'il n'y en a
 * pas), la date de ce prix (ISO), la rupture (`t` temporaire, `d` définitive, vide sinon) et sa
 * date de début (ISO, vide sinon).
 */
export type Carburant = [string, number | null, string, '' | 't' | 'd', string];

/**
 * Une station : x et y en dix-millièmes de degré, l'adresse, 1 sur autoroute, 1 si l'automate
 * sert 24 h sur 24, ses carburants, ses services (rangs dans la liste de l'en-tête), et son
 * identifiant dans le système « Prix des carburants ».
 */
export type Station = [number, number, string, 0 | 1, 0 | 1, Carburant[], number[], number];

export interface Carburants {
  maj: string;
  services: string[];
  communes: Map<string, Station[]>;
}

type Ligne = {
  id: number;
  cp?: string;
  ville?: string;
  adresse?: string;
  pop?: string;
  geom?: { lon: number; lat: number } | null;
  horaires_automate_24_24?: string | null;
  services_service?: string[] | null;
  [cle: string]: unknown;
};

const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

export function lireCarburants(l: Ligne): Carburant[] {
  const carburants: Carburant[] = [];
  for (const [cle] of CARBURANTS) {
    const prix = typeof l[`${cle}_prix`] === 'number' ? (l[`${cle}_prix`] as number) : null;
    const type = l[`${cle}_rupture_type`];
    const rupture = type === 'temporaire' ? 't' : type === 'definitive' ? 'd' : '';
    // Un carburant que la station n'a jamais déclaré n'apparaît pas.
    if (prix === null && !rupture) continue;
    carburants.push([cle, prix, date(l[`${cle}_maj`]), rupture, rupture ? date(l[`${cle}_rupture_debut`]) : '']);
  }
  return carburants;
}

export async function collecterCarburants(
  sortie: string,
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Carburants | null> {
  const contours = contoursDesCommunes(sortie);
  if (!contours.size) return indisponible(dire, 'Carburants : contours des communes absents, la collecte des espaces naturels doit passer avant.');
  const communeDu = localisateur(contours);
  const parNom = correspondances();
  const maj = new Date().toISOString().slice(0, 10);
  const vers = join(cache, `carburants-${maj}.json`);
  await telecharger(EXPORT, vers);
  let lignes: Ligne[];
  try {
    lignes = JSON.parse(readFileSync(vers, 'utf8')) as Ligne[];
  } catch (e) {
    return indisponible(dire, `Carburants : le flux ne se lit pas (${(e as Error).message}) ; il a peut-être été coupé.`);
  }
  if (!Array.isArray(lignes) || lignes.length < 8000) return indisponible(dire, `Carburants : ${lignes?.length ?? 0} stations seulement, on garde l’ingestion précédente.`);
  // Les services, rangés par ordre alphabétique : l'en-tête ne change pas avec l'ordre du flux.
  const services = [...new Set(lignes.flatMap((l) => l.services_service ?? []))].sort((a, b) => a.localeCompare(b, 'fr'));
  const rang = new Map(services.map((x, i) => [x, i]));
  const communes = new Map<string, Station[]>();
  let parCp = 0;
  let perdues = 0;
  for (const l of lignes) {
    const g = l.geom;
    const x = g ? Math.round(g.lon * ECHELLE) : 0;
    const y = g ? Math.round(g.lat * ECHELLE) : 0;
    let code = g ? communeDu(x, y) : null;
    if (!code && l.cp && l.ville) {
      code = parNom(String(l.cp).padStart(5, '0'), l.ville);
      if (code) parCp++;
    }
    if (!code) {
      perdues++;
      continue;
    }
    const s = [...new Set(l.services_service ?? [])].map((x) => rang.get(x)!).sort((a, b) => a - b);
    const station: Station = [x, y, (l.adresse ?? '').replace(/\s+/g, ' ').trim(), l.pop === 'A' ? 1 : 0, l.horaires_automate_24_24 === 'Oui' ? 1 : 0, lireCarburants(l), s, Number(l.id)];
    communes.set(code, [...(communes.get(code) ?? []), station]);
  }
  for (const l of communes.values()) l.sort((a, b) => a[2].localeCompare(b[2], 'fr'));
  const n = [...communes.values()].reduce((t, l) => t + l.length, 0);
  dire(
    `Carburants (DGCCRF) : ${n.toLocaleString('fr-FR')} stations dans ${communes.size.toLocaleString('fr-FR')} communes` +
      (parCp ? `, dont ${parCp} placées par le code postal` : '') +
      (perdues ? ` ; ${perdues} sans commune retrouvée.` : '.'),
  );
  return { maj, services, communes };
}

export function ecrireCarburants(sortie: string, c: Carburants): number {
  return ecrireParDepartement(sortie, 'carburants', c.communes, () => ({ maj: c.maj, services: c.services }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const c = await collecterCarburants(sortie, telecharger, cache, console.log);
  if (c) console.log(`${ecrireCarburants(sortie, c)} départements écrits.`);
}
