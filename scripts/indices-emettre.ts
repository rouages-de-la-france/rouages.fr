/**
 * Deux indices de l'INSEE pour le logement, lus dans sa banque de données
 * macro-économiques (BDM), en SDMX, sans clé :
 *
 * - **l'indice de référence des loyers (IRL)**, trimestriel, publié au Journal
 *   officiel : c'est sur sa variation que se révise un loyer d'habitation en
 *   cours de bail. Trois séries : l'hexagone, la Corse, et les départements et
 *   régions d'outre-mer (« collectivités régies par l'article 73 de la
 *   Constitution »), avec leur variation annuelle telle que l'INSEE la publie ;
 * - **les indices Notaires-INSEE des prix des logements anciens**, base 100 en
 *   2015, séries brutes, « ensemble » des logements : pour chacune des cinq
 *   zones du zonage ABC, chaque département de la grande couronne et de la
 *   petite couronne, Paris (appartements seulement, la seule série publiée), et
 *   la France métropolitaine. La page de commune montre celle de sa zone, ou de
 *   son département en Île-de-France : une tendance de communes semblables,
 *   jamais un indice de la commune.
 *
 * Le dernier trimestre des prix est provisoire (statut « P » de l'INSEE) : il
 * est marqué comme tel. Un seul fichier national, `public/territoires/indices.json`.
 * Lancé seul : `tsx scripts/indices-emettre.ts`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';

const BDM = 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/';

/** Les IRL : la série, puis sa variation annuelle publiée. */
export const IRL = {
  hexagone: ['001515333', '001515334'],
  corse: ['010760507', '010760508'],
  outremer: ['010760509', '010760510'],
} as const;

/** Les prix des logements anciens, séries brutes, base 100 en 2015 : clé du fichier, identifiant BDM, libellé. */
export const PRIX: [string, string, string][] = [
  ['A bis', '010760741', 'les communes de la zone A bis du zonage ABC'],
  ['A', '010760740', 'les communes de la zone A du zonage ABC'],
  ['B1', '010760742', 'les communes de la zone B1 du zonage ABC'],
  ['B2', '010760743', 'les communes de la zone B2 du zonage ABC'],
  ['C', '010760744', 'les communes de la zone C du zonage ABC'],
  ['75', '010567012', 'Paris, appartements'],
  ['77', '010567016', 'la Seine-et-Marne'],
  ['78', '010567022', 'les Yvelines'],
  ['91', '010567028', 'l’Essonne'],
  ['92', '010567034', 'les Hauts-de-Seine'],
  ['93', '010567040', 'la Seine-Saint-Denis'],
  ['94', '010567046', 'le Val-de-Marne'],
  ['95', '010567052', 'le Val-d’Oise'],
  ['FM', '010567058', 'la France métropolitaine'],
];

/** Vingt-quatre trimestres : de quoi dire un an et cinq ans, et réviser un loyer. */
const TRIMESTRES = 24;

/** Un trimestre : « 2026-Q2 », la valeur, et pour l'IRL la date de parution au Journal officiel. */
export type Point = [periode: string, valeur: number, provisoire: boolean, jo?: string];

export interface Indices {
  maj: string;
  irl: Record<keyof typeof IRL, { serie: Point[]; variation: Point[] }>;
  prix: Record<string, { nom: string; serie: Point[] }>;
}

/** Les séries d'une réponse SDMX de la BDM, par identifiant, du plus ancien au plus récent. */
export function lireSdmx(xml: string): Map<string, Point[]> {
  const series = new Map<string, Point[]>();
  const attrs = (s: string) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  for (const m of xml.matchAll(/<Series ([^>]*)>([\s\S]*?)<\/Series>/g)) {
    const id = attrs(m[1]).IDBANK;
    const points: Point[] = [];
    for (const o of m[2].matchAll(/<Obs ([^>]*)\/>/g)) {
      const a = attrs(o[1]);
      const v = Number(a.OBS_VALUE);
      if (!/^\d{4}-Q[1-4]$/.test(a.TIME_PERIOD ?? '') || !Number.isFinite(v)) continue;
      points.push(a.DATE_JO ? [a.TIME_PERIOD, v, a.OBS_STATUS === 'P', a.DATE_JO] : [a.TIME_PERIOD, v, a.OBS_STATUS === 'P']);
    }
    // La BDM sert le plus récent d'abord.
    points.sort((x, y) => x[0].localeCompare(y[0]));
    if (id) series.set(id, points.slice(-TRIMESTRES));
  }
  return series;
}

export async function collecterIndices(texte: (url: string) => Promise<string>, dire: (m: string) => void): Promise<Indices | null> {
  const ids = [...Object.values(IRL).flat(), ...PRIX.map((p) => p[1])];
  // Sept ans en arrière suffisent aux vingt-quatre trimestres.
  const debut = `${new Date().getFullYear() - 7}-Q1`;
  const series = lireSdmx(await texte(`${BDM}${ids.join('+')}?startPeriod=${debut}`));
  const manquent = ids.filter((id) => (series.get(id)?.length ?? 0) < 8);
  if (manquent.length > 0) return indisponible(dire, `Indices de l’INSEE : séries absentes ou trop courtes (${manquent.join(', ')}).`);

  const irl = Object.fromEntries(
    Object.entries(IRL).map(([cle, [serie, variation]]) => [cle, { serie: series.get(serie)!, variation: series.get(variation)! }]),
  ) as Indices['irl'];
  const prix = Object.fromEntries(PRIX.map(([cle, id, nom]) => [cle, { nom, serie: series.get(id)! }]));
  const dernier = irl.hexagone.serie.at(-1)!;
  dire(
    `Indices de l’INSEE : IRL ${dernier[0]} = ${dernier[1]} (${irl.hexagone.variation.at(-1)![1]} % sur un an) ; ` +
      `prix des logements anciens jusqu’à ${prix.FM.serie.at(-1)![0]}, ${PRIX.length} séries.`,
  );
  return { maj: new Date().toISOString().slice(0, 10), irl, prix };
}

export function ecrireIndices(sortie: string, i: Indices): void {
  writeFileSync(join(sortie, 'indices.json'), JSON.stringify(i));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sortie = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'territoires');
  const i = await collecterIndices(async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} : ${r.status}`);
    return r.text();
  }, console.log);
  if (i) ecrireIndices(sortie, i);
}
