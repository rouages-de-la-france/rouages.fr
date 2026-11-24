/**
 * Les indices de l'INSEE pour le logement (`scripts/indices-emettre.ts`) :
 * l'indice de référence des loyers, et les indices Notaires-INSEE des prix des
 * logements anciens. Un indice dit une tendance de communes semblables — la
 * même zone du zonage ABC, ou le même département en Île-de-France —, jamais
 * celle d'une commune.
 */
import { national } from './fiche-commune.ts';

export type Point = [periode: string, valeur: number, provisoire: boolean, jo?: string];

export interface IndicesFichier {
  maj: string;
  irl: Record<'hexagone' | 'corse' | 'outremer', { serie: Point[]; variation: Point[] }>;
  prix: Record<string, { nom: string; serie: Point[] }>;
  /** Absent des fichiers écrits avant le 24 novembre 2026. */
  loyers?: Record<string, { nom: string; serie: Point[] }>;
}

export const indicesFichier = national<IndicesFichier>('indices.json');

/** « 2026-Q2 » → « 2ᵉ trimestre 2026 ». */
export function trimestre(p: string): string {
  const [a, q] = p.split('-Q');
  return `${q === '1' ? '1er' : `${q}ᵉ`} trimestre ${a}`;
}

const IDF = new Set(['75', '77', '78', '91', '92', '93', '94', '95']);
const OUTREMER = /^97/;

export interface TendancePrix {
  /** « les communes de la zone C du zonage ABC », « la Seine-et-Marne ». */
  nom: string;
  /** La zone ou le département : ce qui est dit dans le titre. */
  cle: string;
  de: string;
  a: string;
  provisoire: boolean;
  unAn: number;
  /** Null quand la série ne remonte pas cinq ans. */
  cinqAns: number | null;
}

/** La série d'une commune : celle de son département en Île-de-France, de sa zone ABC ailleurs en métropole. */
export function tendancePrix(dep: string, abc: string | null, f: IndicesFichier | null = indicesFichier()): TendancePrix | null {
  if (!f || OUTREMER.test(dep)) return null;
  // Le zonage écrit « A BIS », l'INSEE « A bis ».
  const cle = IDF.has(dep) ? dep : abc?.replace(/^A BIS$/i, 'A bis') ?? null;
  const s = cle ? f.prix[cle] : undefined;
  if (!s || s.serie.length < 5) return null;
  const n = s.serie.length;
  const [a, va, provisoire] = s.serie[n - 1];
  const [de, vde] = s.serie[n - 5];
  return { nom: s.nom, cle: cle!, de, a, provisoire, unAn: va / vde - 1, cinqAns: n >= 21 ? va / s.serie[n - 21][1] - 1 : null };
}

/** L'IRL qui s'applique dans un département : la Corse et l'outre-mer ont le leur. */
export function serieIrl(dep: string): 'hexagone' | 'corse' | 'outremer' {
  return dep === '2A' || dep === '2B' ? 'corse' : OUTREMER.test(dep) ? 'outremer' : 'hexagone';
}

export interface LoyersEnPlace {
  /** « en France métropolitaine », « à La Réunion ». */
  ou: string;
  de: string;
  a: string;
  /** La variation sur un an, par secteur ; `tous` en Guyane, seule série publiée. */
  secteurs: { secteur: 'libre' | 'social' | 'tous'; unAn: number }[];
}

/** L'évolution des loyers en place sur un an, là où l'INSEE la publie : la métropole et quatre départements d'outre-mer. */
export function loyersEnPlace(dep: string, f: IndicesFichier | null = indicesFichier()): LoyersEnPlace | null {
  if (!f?.loyers) return null;
  const zone = OUTREMER.test(dep) ? dep : 'FM';
  const secteurs = (['libre', 'social', 'tous'] as const)
    .map((secteur) => ({ secteur, s: f.loyers![`${zone}-${secteur}`] }))
    .filter((x) => x.s && x.s.serie.length >= 5);
  if (secteurs.length === 0) return null;
  const ref = secteurs[0].s.serie;
  return {
    ou: secteurs[0].s.nom,
    de: ref.at(-5)![0],
    a: ref.at(-1)![0],
    secteurs: secteurs.map(({ secteur, s }) => ({ secteur, unAn: s.serie.at(-1)![1] / s.serie.at(-5)![1] - 1 })),
  };
}
