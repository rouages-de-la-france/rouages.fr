/**
 * Le prix des maisons et des appartements, commune par commune, d'après les
 * demandes de valeurs foncières (DVF) de la direction générale des finances
 * publiques, dans la version géolocalisée qu'en publie data.gouv.
 *
 * DVF recense chaque vente passée devant notaire, mais une vente peut porter
 * sur plusieurs biens : une maison et deux garages, trois appartements d'un
 * immeuble, une maison et un champ. Le prix au mètre carré n'a de sens que pour
 * une vente d'un seul logement. D'où la règle, écrite une fois ici :
 * - une vente (nature « Vente », pas un échange ni une adjudication) ;
 * - un seul logement, maison ou appartement, et rien d'autre que des
 *   dépendances — pas de local commercial ;
 * - dans une seule commune ;
 * - une surface bâtie d'au moins 9 m², sous laquelle le prix au mètre carré ne
 *   veut plus rien dire.
 * Le prix rapporté est la médiane, qui ne bouge pas pour une vente
 * extravagante, sur les trois dernières années publiées réunies — un village
 * vend quelques maisons par an. Sous cinq ventes, pas de médiane. La
 * fourchette est celle des quartiles : la moitié des ventes tombe entre les
 * deux. S'y ajoutent la surface habitable, le nombre de pièces et, pour une
 * maison, la surface de terrain vendue avec elle.
 *
 * **Les terrains nus**, sans aucun local, d'une seule nature cadastrale :
 * - les terrains à bâtir (code AB), au mètre carré, à partir de 100 m² ;
 * - les terres et les prés (T, P, PA, PC), à l'hectare, à partir de 1 000 m² ;
 * - les bois (B, BF, BM, BP, BR, BS, BT), à l'hectare, à partir de 1 000 m².
 * « Terrain à bâtir » est une nature cadastrale déclarée à la vente : elle ne
 * dit pas ce que le plan local d'urbanisme permet. Les vignes et les vergers,
 * dont le prix tient à l'appellation, ne sont pas mêlés aux terres.
 *
 * **Le complément du fichier brut.** La version géolocalisée suit avec retard
 * les publications de la DGFiP : celle de mai 2026 manquait 13 % des ventes de
 * décembre 2025, que le fichier brut d'octobre donnait (actes enregistrés
 * tard). Chaque année est donc lue dans la version géolocalisée, puis
 * complétée des seules mutations que le fichier brut de la DGFiP ajoute —
 * même date, même valeur, même commune, même nature : rien n'est compté deux
 * fois. Ces ventes-là n'ont pas de coordonnées ; le rapprochement avec les
 * diagnostics énergétiques, qui en a besoin, les laisse de côté.
 *
 * **Le semestre publié de l'année en cours.** La DGFiP publie en octobre le
 * premier semestre de l'année en cours, dans son seul fichier brut (« Valeurs
 * foncières 2026 - Premier semestre ») : il s'ajoute aux trois années pleines,
 * et le fichier dit jusqu'où il va (`fin`, « 2026-06 »). L'année pleine le
 * remplace quand elle paraît (`anneesDvf`).
 *
 * DVF ne couvre ni l'Alsace ni la Moselle, où le livre foncier tient ce rôle,
 * ni Mayotte. Paris, Lyon et Marseille y sont par arrondissement : ils sont
 * réunis sous leur commune.
 *
 * Lancé seul — `tsx scripts/dvf-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-dvf.json`, et ceux du jeu des prix,
 * `public/territoires/jeux/dvf/XX.json`, et ceux du simulateur d'estimation,
 * `public/territoires/simulateurs/estimation/XX.json`.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { communeDe, departementDe, ecrireParDepartement, lignesCsv, mediane, telechargerSiAbsent } from './par-departement.ts';
import { bienDe, ecrireEstimation, type Bien } from './estimation-emettre.ts';
import { indisponible } from './echecs.ts';

export const ADRESSE = (annee: number) => `https://files.data.gouv.fr/geo-dvf/latest/csv/${annee}/full.csv.gz`;
/** Le jeu de la DGFiP sur data.gouv.fr : un fichier par année, « Valeurs foncières AAAA ». */
const JEU_BRUT = '5c4ae55a634f4117716d5656';

/** Les fichiers bruts de la DGFiP : par année pleine, et le semestre publié d'une année en cours. */
async function adressesBrut(): Promise<{ pleines: Map<number, string>; semestres: Map<number, string> }> {
  const r = await fetch(`https://www.data.gouv.fr/api/2/datasets/${JEU_BRUT}/resources/?page_size=50`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`data.gouv.fr : ${r.status}`);
  const d = (await r.json()) as { data?: { title?: string; url?: string }[] };
  const pleines = new Map<number, string>();
  const semestres = new Map<number, string>();
  for (const x of d.data ?? []) {
    const titre = (x.title ?? '').trim();
    const a = /^Valeurs foncières (20\d\d)$/.exec(titre);
    if (a && x.url) pleines.set(Number(a[1]), x.url);
    const s = /^Valeurs foncières (20\d\d) - Premier semestre$/.exec(titre);
    if (s && x.url) semestres.set(Number(s[1]), x.url);
  }
  return { pleines, semestres };
}
/** Sous ce nombre de ventes, la médiane serait celle de trois maisons. */
export const MINIMUM = 5;

/**
 * Par commune : ventes de maisons, prix médian au m² d'une maison, prix médian
 * d'une maison ; ventes d'appartements, prix médian au m² d'un appartement ;
 * puis le nombre de ventes de logements, année par année.
 */
export type Prix = [number, number | null, number | null, number, number | null, ...number[]];

export interface Dvf {
  maj: string;
  annees: number[];
  /** Le dernier mois couvert quand la dernière année n'est qu'un semestre : « 2026-06 ». */
  fin?: string;
  communes: Map<string, Prix>;
  departements: Map<string, Prix>;
  details: Map<string, Detail>;
  detailsDep: Map<string, Detail>;
  /** Les ventes d'un seul logement, par commune, pour le jeu des prix. */
  ventes: Map<string, Vente[]>;
  /** Les maisons et les terrains nus, surfaces par nature, pour le simulateur d'estimation. */
  biens: Bien[];
}

type Vente = {
  commune: string;
  annee: number;
  type: 'Maison' | 'Appartement';
  prix: number;
  surface: number;
  pieces: number;
  /** La surface des parcelles vendues avec le logement, en m² ; 0 pour un appartement en copropriété. */
  terrain: number;
  /** Vendu avec des terres, des prés, des landes, des vignes, des vergers ou des bois : hors de la médiane. */
  terres: boolean;
};

/** Une vente de terrain nu, d'une seule nature. */
type Terrain = { commune: string; annee: number; genre: Genre; prix: number; surface: number };
export const GENRES = ['batir', 'terres', 'bois'] as const;
type Genre = (typeof GENRES)[number];
const NATURES: Record<string, Genre> = {
  AB: 'batir',
  T: 'terres',
  P: 'terres',
  PA: 'terres',
  PC: 'terres',
  B: 'bois',
  BF: 'bois',
  BM: 'bois',
  BP: 'bois',
  BR: 'bois',
  BS: 'bois',
  BT: 'bois',
};
/**
 * Les natures cadastrales qui font d'une maison une « maison avec des terres ou des bois » :
 * terres, prés, pâtures, landes, vignes, vergers, bois. Décision du 20 novembre 2026 : la
 * médiane publiée ne compte que les maisons vendues sans elles, les autres sont comptées à part —
 * leur prix comprend celui des terres, qui relevait de 10 % et plus le prix au m² d'une commune
 * rurale sur trois dans l'Allier.
 */
const TERRES_ET_BOIS = new Set(['T', 'P', 'PA', 'PC', 'PP', 'L', 'LB', 'VI', 'VE', 'B', 'BF', 'BM', 'BP', 'BR', 'BS', 'BT']);

/** Sous ces surfaces, le prix tient aux frais plus qu'au terrain. */
const SURFACE_MIN: Record<Genre, number> = { batir: 100, terres: 1000, bois: 1000 };

/** La surface de terrain d'une mutation : chaque parcelle et chaque nature une fois. */
function surfaceTerrain(lignes: string[][], col: Record<string, number>): number {
  const vues = new Map<string, number>();
  for (const l of lignes) {
    const s = Number(l[col.surface_terrain]);
    if (s > 0) vues.set(`${l[col.id_parcelle]}|${l[col.code_nature_culture]}|${l[col.code_nature_culture_speciale] ?? ''}`, s);
  }
  return [...vues.values()].reduce((a, b) => a + b, 0);
}

/** Une mutation sans aucun local : la vente d'un terrain nu d'une seule nature, ou rien. */
function terrainDe(lignes: string[][], col: Record<string, number>, annee: number): Terrain | null {
  if (lignes[0][col.nature_mutation] !== 'Vente') return null;
  const communes = new Set(lignes.map((l) => l[col.code_commune]));
  if (communes.size !== 1) return null;
  if (lignes.some((l) => l[col.type_local])) return null;
  const genres = new Set<string>(lignes.map((l) => NATURES[l[col.code_nature_culture]] ?? 'autre'));
  if (genres.size !== 1) return null;
  const [genre] = genres;
  if (genre === 'autre') return null;
  const surface = surfaceTerrain(lignes, col);
  const prix = Number(lignes[0][col.valeur_fonciere]);
  if (!(prix > 0) || !(surface >= SURFACE_MIN[genre as Genre])) return null;
  return { commune: communeDe([...communes][0]), annee, genre: genre as Genre, prix, surface };
}

/** Une mutation, toutes ses lignes réunies : en rend la vente d'un logement, ou rien. */
function venteDe(lignes: string[][], col: Record<string, number>, annee: number): Vente | null {
  if (lignes[0][col.nature_mutation] !== 'Vente') return null;
  const communes = new Set(lignes.map((l) => l[col.code_commune]));
  if (communes.size !== 1) return null;
  const logements = new Map<string, [string, number, number]>();
  for (const l of lignes) {
    const type = l[col.type_local];
    if (type === 'Maison' || type === 'Appartement') {
      // Un même logement revient sur plusieurs lignes quand la vente porte
      // aussi sur plusieurs parcelles ou lots : on le compte une fois.
      const s = Number(l[col.surface_reelle_bati]);
      logements.set(`${type}|${l[col.id_parcelle]}|${s}|${l[col.nombre_pieces_principales]}|${l[col.lot1_numero]}`, [type, s, Number(l[col.nombre_pieces_principales])]);
    } else if (type && type !== 'Dépendance') return null;
  }
  if (logements.size !== 1) return null;
  const [[type, surface, pieces]] = logements.values();
  const prix = Number(lignes[0][col.valeur_fonciere]);
  if (!(surface >= 9) || !(prix > 0)) return null;
  return {
    commune: communeDe([...communes][0]),
    annee,
    type: type as Vente['type'],
    prix,
    surface,
    pieces: pieces > 0 ? pieces : 0,
    terrain: type === 'Maison' ? surfaceTerrain(lignes, col) : 0,
    terres: type === 'Maison' && lignes.some((l) => TERRES_ET_BOIS.has(l[col.code_nature_culture])),
  };
}

export async function lireVentes(
  chemin: string,
  annee: number,
  ajouter: (v: Vente) => void,
  ajouterTerrain: (t: Terrain) => void = () => {},
  ajouterBien: (b: Bien) => void = () => {},
  /** Pour le complément du fichier brut : la clé de chaque ligne lue (`cleLigne`). */
  cles?: Set<string>,
): Promise<void> {
  let col: Record<string, number> | null = null;
  let id = '';
  let lignes: string[][] = [];
  const flux = createReadStream(chemin).pipe(createGunzip()) as unknown as AsyncIterable<Uint8Array>;
  const clore = () => {
    if (lignes.length > 0) {
      // Pour le simulateur d'estimation, une lecture de plus des mêmes lignes.
      const b = bienDe(lignes, col!);
      if (b) ajouterBien(b);
      const v = venteDe(lignes, col!, annee);
      if (v) ajouter(v);
      else {
        const t = terrainDe(lignes, col!, annee);
        if (t) ajouterTerrain(t);
      }
    }
  };
  for await (const v of lignesCsv(flux)) {
    if (!col) {
      col = Object.fromEntries(v.map((n, i) => [n.trim(), i]));
      for (const n of ['id_mutation', 'nature_mutation', 'valeur_fonciere', 'code_commune', 'type_local', 'surface_reelle_bati', 'id_parcelle', 'nombre_pieces_principales', 'lot1_numero', 'surface_terrain', 'code_nature_culture']) {
        if (col[n] === undefined) throw new Error(`DVF ${annee} : colonne « ${n} » absente`);
      }
      continue;
    }
    if (v.length < 10) continue;
    // Les lignes d'une mutation se suivent dans le fichier.
    if (v[col.id_mutation] !== id) {
      clore();
      id = v[col.id_mutation];
      lignes = [];
    }
    lignes.push(v);
    cles?.add(cleLigne(v[col.date_mutation], v[col.valeur_fonciere], v[col.code_commune], v[col.nature_mutation]));
  }
  clore();
}

/** Une ligne, pour reconnaître la même mutation dans les deux fichiers : date ISO, valeur, commune, nature. */
export const cleLigne = (date: string, valeur: string, commune: string, nature: string) =>
  `${date}|${Number(String(valeur).replace(',', '.'))}|${commune}|${nature}`;

/** Les colonnes du fichier géolocalisé que la lecture utilise, dans l'ordre où le complément les écrit. */
const COLONNES = [
  'id_mutation', 'date_mutation', 'nature_mutation', 'valeur_fonciere', 'code_commune', 'id_parcelle', 'lot1_numero',
  'type_local', 'surface_reelle_bati', 'nombre_pieces_principales', 'code_nature_culture', 'code_nature_culture_speciale',
  'surface_terrain', 'longitude', 'latitude',
] as const;

/** Une ligne du fichier brut de la DGFiP, mise au format du fichier géolocalisé ; null si elle est illisible. */
export function ligneDuBrut(l: string[], i: Record<string, number>, id: string): string[] | null {
  const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(l[i['Date mutation']] ?? '');
  const dep = (l[i['Code departement']] ?? '').trim();
  const com = (l[i['Code commune']] ?? '').trim();
  if (!date || !dep || !com) return null;
  // La commune sur cinq caractères : 03 + 165, ou 971 + 01 outre-mer.
  const commune = dep.length === 3 ? dep + com.padStart(2, '0') : dep.padStart(2, '0') + com.padStart(3, '0');
  const section = (l[i['Section']] ?? '').trim();
  const plan = (l[i['No plan']] ?? '').trim();
  const parcelle = section && plan ? commune + (l[i['Prefixe de section']] ?? '').trim().padStart(3, '0') + section.padStart(2, '0') + plan.padStart(4, '0') : '';
  const nombre = (x: string | undefined) => (x ?? '').trim().replace(',', '.');
  const v: Record<(typeof COLONNES)[number], string> = {
    id_mutation: id,
    date_mutation: `${date[3]}-${date[2]}-${date[1]}`,
    nature_mutation: (l[i['Nature mutation']] ?? '').trim(),
    valeur_fonciere: nombre(l[i['Valeur fonciere']]),
    code_commune: commune,
    id_parcelle: parcelle,
    lot1_numero: (l[i['1er lot']] ?? '').trim(),
    type_local: (l[i['Type local']] ?? '').trim(),
    surface_reelle_bati: nombre(l[i['Surface reelle bati']]),
    nombre_pieces_principales: nombre(l[i['Nombre pieces principales']]),
    code_nature_culture: (l[i['Nature culture']] ?? '').trim(),
    code_nature_culture_speciale: (l[i['Nature culture speciale']] ?? '').trim(),
    surface_terrain: nombre(l[i['Surface terrain']]),
    longitude: '',
    latitude: '',
  };
  return COLONNES.map((c) => v[c]);
}

/**
 * Les mutations du fichier brut de la DGFiP qui manquent au fichier
 * géolocalisé déjà lu (`cles`), passées aux mêmes lectures. Une mutation du
 * fichier brut réunit les lignes de même date, valeur, nature et département ;
 * elle est gardée si aucune de ses lignes n'est dans le fichier géolocalisé.
 * Rend le nombre de mutations ajoutées.
 */
export async function lireComplement(
  zip: string,
  annee: number,
  cles: Set<string>,
  ajouter: (v: Vente) => void,
  ajouterTerrain: (t: Terrain) => void,
  ajouterBien: (b: Bien) => void,
): Promise<number> {
  const membre = await new Promise<string>((ok, ko) => {
    const p = spawn('unzip', ['-Z1', zip]);
    let s = '';
    p.stdout.on('data', (b) => (s += b));
    p.on('close', (c) => (c ? ko(new Error(`${zip} illisible`)) : ok(s.split('\n').find((n) => /\.txt$/i.test(n.trim()))?.trim() ?? '')));
  });
  if (!membre) throw new Error(`${zip} : aucun fichier texte dans l’archive`);
  const col = Object.fromEntries(COLONNES.map((c, k) => [c, k])) as Record<string, number>;
  // On ne garde que les lignes absentes du fichier géolocalisé ; pour les autres, la clé de leur mutation suffit.
  const candidates = new Map<string, string[][]>();
  const presentes = new Set<string>();
  let i: Record<string, number> | null = null;
  let n = 0;
  const p = spawn('unzip', ['-p', zip, membre]);
  for await (const brute of createInterface({ input: p.stdout, crlfDelay: Infinity })) {
    const champs = brute.replace(/^\uFEFF/, '').split('|');
    if (!i) {
      i = Object.fromEntries(champs.map((c, k) => [c.trim(), k]));
      for (const c of ['Date mutation', 'Nature mutation', 'Valeur fonciere', 'Code departement', 'Code commune', 'Section', 'No plan', 'Type local', 'Surface terrain', 'Nature culture']) {
        if (i[c] === undefined) throw new Error(`DVF brut ${annee} : colonne « ${c} » absente`);
      }
      continue;
    }
    const cle = `${champs[i['Date mutation']]}|${champs[i['Valeur fonciere']]}|${champs[i['Nature mutation']]}|${champs[i['Code departement']]}`;
    if (presentes.has(cle)) continue;
    const ligne = ligneDuBrut(champs, i, `brut-${annee}-${n}`);
    if (!ligne) continue;
    if (cles.has(cleLigne(ligne[col.date_mutation], ligne[col.valeur_fonciere], ligne[col.code_commune], ligne[col.nature_mutation]))) {
      presentes.add(cle);
      candidates.delete(cle);
      continue;
    }
    let m = candidates.get(cle);
    if (!m) {
      candidates.set(cle, (m = []));
      n++;
    } else ligne[col.id_mutation] = m[0][col.id_mutation];
    m.push(ligne);
  }
  let ajoutees = 0;
  for (const [cle, lignes] of candidates) {
    if (presentes.has(cle) || !lignes.every((l) => l[col.date_mutation].startsWith(String(annee)))) continue;
    ajoutees++;
    const b = bienDe(lignes, col);
    if (b) ajouterBien(b);
    const v = venteDe(lignes, col, annee);
    if (v) ajouter(v);
    else {
      const t = terrainDe(lignes, col, annee);
      if (t) ajouterTerrain(t);
    }
  }
  return ajoutees;
}

function resumer(ventes: Vente[], annees: number[]): Prix {
  // Les maisons sans terres ni bois : leur prix est celui de la maison et de son jardin.
  const maisons = ventes.filter((v) => v.type === 'Maison' && !v.terres);
  const apparts = ventes.filter((v) => v.type === 'Appartement');
  const med = (v: number[]) => (v.length >= MINIMUM ? Math.round(mediane(v)!) : null);
  return [
    maisons.length,
    med(maisons.map((v) => v.prix / v.surface)),
    med(maisons.map((v) => v.prix)),
    apparts.length,
    med(apparts.map((v) => v.prix / v.surface)),
    ...annees.map((a) => ventes.filter((v) => v.annee === a).length),
  ];
}

/** Le quantile p (0 à 1), par interpolation entre les deux valeurs qui l'encadrent — la médiane est le quantile 0,5. */
export function quantile(v: number[], p: number): number | null {
  if (v.length === 0) return null;
  const t = [...v].sort((a, b) => a - b);
  const i = (t.length - 1) * p;
  const bas = Math.floor(i);
  return t[bas] + (t[Math.min(bas + 1, t.length - 1)] - t[bas]) * (i - bas);
}

/**
 * Le détail d'une commune ou d'un département, à côté du résumé que la page
 * lit déjà :
 * - maisons : [1er quartile du prix, 3e quartile, surface habitable médiane,
 *   pièces médianes, terrain médian en m²], ou null sous cinq ventes ;
 * - appartements : [1er quartile, 3e quartile, surface médiane, pièces médianes], ou null ;
 * - terrains à bâtir : [ventes, prix médian au m², 1er quartile, 3e quartile, surface médiane en m²] ;
 * - terres et prés, bois : [ventes, prix médian à l'hectare, surface médiane en hectares] ;
 * - maisons vendues avec des terres ou des bois, hors de la médiane : [ventes, prix médian] ;
 * - année par année, les maisons sans terres ni bois : [prix médian au m², ventes], le prix à partir
 *   de vingt ventes dans l'année — en deçà, une médiane annuelle dirait le hasard des maisons vendues
 *   (au Mayet-de-Montagne, 16 ventes en 2023 et 19 en 2025 donnaient « +20 % »).
 * Un nombre de ventes est toujours donné ; les prix, à partir de cinq.
 */
export type Detail = [
  [number, number, number, number, number] | null,
  [number, number, number, number] | null,
  [number, number | null, number | null, number | null, number | null],
  [number, number | null, number | null],
  [number, number | null, number | null],
  [number, number | null],
  [number | null, number][],
];

/** Sous ce nombre de ventes de maisons dans l'année, pas de prix annuel. */
export const MINIMUM_ANNUEL = 20;

function detailler(ventes: Vente[], terrains: Terrain[], annees: number[]): Detail {
  const r = (x: number | null, d = 0) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
  const assez = <T,>(l: T[]) => l.length >= MINIMUM;
  const logement = (type: Vente['type']) => {
    const l = ventes.filter((v) => v.type === type && !v.terres);
    if (!assez(l)) return null;
    const prix = l.map((v) => v.prix);
    return [r(quantile(prix, 0.25))!, r(quantile(prix, 0.75))!, r(quantile(l.map((v) => v.surface), 0.5))!, r(quantile(l.filter((v) => v.pieces > 0).map((v) => v.pieces), 0.5), 1) ?? 0];
  };
  const maison = logement('Maison');
  const maisons = ventes.filter((v) => v.type === 'Maison' && !v.terres && v.terrain > 0);
  const avecTerres = ventes.filter((v) => v.type === 'Maison' && v.terres);
  const batir = terrains.filter((t) => t.genre === 'batir');
  const m2 = batir.map((t) => t.prix / t.surface);
  const hectare = (g: Genre): [number, number | null, number | null] => {
    const l = terrains.filter((t) => t.genre === g);
    return assez(l)
      ? [l.length, r(quantile(l.map((t) => t.prix / (t.surface / 10_000)), 0.5)), r(quantile(l.map((t) => t.surface / 10_000), 0.5), 2)]
      : [l.length, null, null];
  };
  return [
    maison ? [maison[0], maison[1], maison[2], maison[3], assez(maisons) ? r(quantile(maisons.map((v) => v.terrain), 0.5))! : 0] : null,
    logement('Appartement') as [number, number, number, number] | null,
    assez(batir)
      ? [batir.length, r(quantile(m2, 0.5)), r(quantile(m2, 0.25)), r(quantile(m2, 0.75)), r(quantile(batir.map((t) => t.surface), 0.5))]
      : [batir.length, null, null, null, null],
    hectare('terres'),
    hectare('bois'),
    [avecTerres.length, assez(avecTerres) ? r(quantile(avecTerres.map((v) => v.prix), 0.5)) : null],
    annees.map((a) => {
      const l = ventes.filter((v) => v.type === 'Maison' && !v.terres && v.annee === a);
      return [l.length >= MINIMUM_ANNUEL ? r(quantile(l.map((v) => v.prix / v.surface), 0.5)) : null, l.length];
    }),
  ];
}

export async function collecterDvf(
  anneesPleines: number[],
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Dvf | null> {
  let annees = anneesPleines;
  const parCommune = new Map<string, Vente[]>();
  const terrainsParCommune = new Map<string, Terrain[]>();
  const biens: Bien[] = [];
  const lues: number[] = [];
  let bruts = new Map<number, string>();
  let semestres = new Map<number, string>();
  try {
    ({ pleines: bruts, semestres } = await adressesBrut());
  } catch (e) {
    dire(`Ventes immobilières : fichiers bruts de la DGFiP introuvables (${String(e).slice(0, 80)}) ; la version géolocalisée seule.`);
  }
  for (const annee of annees) {
    const vers = join(cache, `dvf-${annee}.csv.gz`);
    try {
      await telecharger(ADRESSE(annee), vers);
    } catch {
      dire(`Ventes immobilières ${annee} indisponibles.`);
      continue;
    }
    let n = 0;
    let nt = 0;
    const cles = new Set<string>();
    await lireVentes(
      vers,
      annee,
      (v) => {
        if (!parCommune.has(v.commune)) parCommune.set(v.commune, []);
        parCommune.get(v.commune)!.push(v);
        n++;
      },
      (t) => {
        if (!terrainsParCommune.has(t.commune)) terrainsParCommune.set(t.commune, []);
        terrainsParCommune.get(t.commune)!.push(t);
        nt++;
      },
      (b) => biens.push(b),
      cles,
    );
    // Le complément du fichier brut, quand la version géolocalisée a du retard ; sans lui, on garde la lecture.
    let ajoutees = 0;
    const brut = bruts.get(annee);
    if (brut) {
      try {
        const zip = join(cache, `dvf-brut-${annee}.zip`);
        await telecharger(brut, zip);
        ajoutees = await lireComplement(
          zip,
          annee,
          cles,
          (v) => {
            if (!parCommune.has(v.commune)) parCommune.set(v.commune, []);
            parCommune.get(v.commune)!.push(v);
            n++;
          },
          (t) => {
            if (!terrainsParCommune.has(t.commune)) terrainsParCommune.set(t.commune, []);
            terrainsParCommune.get(t.commune)!.push(t);
            nt++;
          },
          (b) => biens.push(b),
        );
      } catch (e) {
        dire(`Ventes immobilières ${annee} : le fichier brut de la DGFiP n’a pas pu être lu (${String(e).slice(0, 80)}) ; la version géolocalisée seule.`);
      }
    }
    dire(
      `Ventes immobilières ${annee} : ${n.toLocaleString('fr-FR')} ventes d’un seul logement, ${nt.toLocaleString('fr-FR')} de terrain nu` +
        (ajoutees ? ` ; ${ajoutees.toLocaleString('fr-FR')} mutations ajoutées du fichier brut de la DGFiP.` : '.'),
    );
    lues.push(annee);
  }
  // Trois années ou rien : une médiane sur deux ans ne se comparerait pas à
  // celle de l'ingestion précédente.
  if (lues.length !== annees.length) {
    return indisponible(dire, 'Ventes immobilières : une année manque, l’ingestion précédente reste en place.');
  }
  // Le premier semestre de l'année qui suit, quand la DGFiP l'a publié : il s'ajoute, l'année pleine le remplacera.
  let fin: string | undefined;
  const suivante = annees[annees.length - 1] + 1;
  const semestre = semestres.get(suivante);
  if (semestre) {
    try {
      const zip = join(cache, `dvf-brut-${suivante}-s1.zip`);
      await telecharger(semestre, zip);
      let n = 0;
      const ajoutees = await lireComplement(
        zip,
        suivante,
        new Set(),
        (v) => {
          if (!parCommune.has(v.commune)) parCommune.set(v.commune, []);
          parCommune.get(v.commune)!.push(v);
          n++;
        },
        (t) => {
          if (!terrainsParCommune.has(t.commune)) terrainsParCommune.set(t.commune, []);
          terrainsParCommune.get(t.commune)!.push(t);
        },
        (b) => biens.push(b),
      );
      if (ajoutees > 0) {
        annees = [...annees, suivante];
        fin = `${suivante}-06`;
        dire(`Ventes immobilières, premier semestre ${suivante} (fichier brut de la DGFiP) : ${n.toLocaleString('fr-FR')} ventes d’un seul logement.`);
      }
    } catch (e) {
      dire(`Ventes immobilières : le premier semestre ${suivante} n’a pas pu être lu (${String(e).slice(0, 80)}) ; les années pleines seules.`);
    }
  }
  const communes = new Map<string, Prix>();
  const parDep = new Map<string, Vente[]>();
  for (const [code, ventes] of parCommune) {
    communes.set(code, resumer(ventes, annees));
    const dep = departementDe(code);
    if (!parDep.has(dep)) parDep.set(dep, []);
    parDep.get(dep)!.push(...ventes);
  }
  const departements = new Map([...parDep].map(([dep, v]) => [dep, resumer(v, annees)]));
  const details = new Map<string, Detail>();
  const terrainsParDep = new Map<string, Terrain[]>();
  for (const [code, t] of terrainsParCommune) {
    const dep = departementDe(code);
    if (!terrainsParDep.has(dep)) terrainsParDep.set(dep, []);
    terrainsParDep.get(dep)!.push(...t);
  }
  for (const code of new Set([...parCommune.keys(), ...terrainsParCommune.keys()])) {
    details.set(code, detailler(parCommune.get(code) ?? [], terrainsParCommune.get(code) ?? [], annees));
  }
  const detailsDep = new Map<string, Detail>();
  for (const dep of new Set([...parDep.keys(), ...terrainsParDep.keys()])) {
    detailsDep.set(dep, detailler(parDep.get(dep) ?? [], terrainsParDep.get(dep) ?? [], annees));
  }
  return { maj: new Date().toISOString().slice(0, 10), annees, ...(fin ? { fin } : {}), communes, departements, details, detailsDep, ventes: parCommune, biens };
}

/** Les trois dernières années complètes : la base est publiée au printemps et en automne. */
export function anneesDvf(aujourdhui = new Date()): number[] {
  const derniere = aujourdhui.getUTCFullYear() - (aujourdhui.getUTCMonth() >= 5 ? 1 : 2);
  return [derniere - 2, derniere - 1, derniere];
}

export function ecrireDvf(sortie: string, d: Dvf): number {
  // Une commune qui n'a vendu que des terrains a quand même sa ligne : un
  // résumé de logements à zéro, et son détail.
  const communes = new Map(d.communes);
  for (const code of d.details.keys()) if (!communes.has(code)) communes.set(code, [0, null, null, 0, null, ...d.annees.map(() => 0)]);
  const parDep = new Map<string, Record<string, Detail>>();
  for (const [code, x] of d.details) {
    const dep = departementDe(code);
    if (!parDep.has(dep)) parDep.set(dep, {});
    parDep.get(dep)![code] = x;
  }
  return ecrireParDepartement(sortie, 'dvf', communes, (dep) => ({
    maj: d.maj,
    annees: d.annees,
    ...(d.fin ? { fin: d.fin } : {}),
    minimum: MINIMUM,
    dep: d.departements.get(dep) ?? null,
    xdep: d.detailsDep.get(dep) ?? null,
    x: parDep.get(dep) ?? {},
  }));
}

/**
 * Le jeu des prix : de vraies ventes, à deviner, dans les limites que les
 * conditions d'utilisation de DVF imposent (détail dans `docs/07-risques.md`).
 *
 * - **Ni adresse, ni parcelle, ni date** : la commune et l'année seulement.
 * - **Des communes d'au moins dix ventes** de logement sur les trois ans, pour
 *   qu'aucune vente ne soit la seule de son année et de son genre.
 * - **Des valeurs arrondies** : le prix au millier d'euros, la surface
 *   habitable à 5 m², le terrain à 100 m² (au millier au-delà d'un hectare).
 * - **Pas de vente extrême** : une vente entre le 1er et le 9e décile du prix
 *   au m² de sa commune pour son type — une maison cédée 5 000 € entre parents
 *   n'apprend rien sur le marché, et c'est la transparence du marché que la
 *   loi donne pour objet à la réutilisation.
 * - **Au plus quarante par commune**, tirées d'un ordre fixe : le fichier d'une
 *   grande ville resterait sinon trop lourd pour une partie de cinq ventes.
 *
 * Les fichiers vont dans `jeux/dvf/`, que `robots.txt` ferme et que le serveur
 * marque `noindex` : les informations de DVF ne s'indexent pas.
 */
export const JEU_MINIMUM = 10;
export const JEU_PAR_COMMUNE = 40;

/** Une vente du jeu : [année, 0 maison ou 1 appartement, prix, surface, pièces, terrain]. */
export type VenteJeu = [number, 0 | 1, number, number, number, number];

/** Un ordre fixe d'une ingestion à l'autre, qui ne suit ni le prix ni la date. */
function empreinte(v: Vente): number {
  let h = 2166136261;
  for (const c of `${v.commune}|${v.annee}|${v.type}|${v.prix}|${v.surface}|${v.pieces}|${v.terrain}`) {
    h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  }
  return h;
}

export function ventesDuJeu(ventes: Vente[]): VenteJeu[] {
  if (ventes.length < JEU_MINIMUM) return [];
  const gardees: Vente[] = [];
  for (const type of ['Maison', 'Appartement'] as const) {
    const l = ventes.filter((v) => v.type === type);
    if (l.length < MINIMUM) continue;
    const m2 = l.map((v) => v.prix / v.surface);
    const bas = quantile(m2, 0.1)!;
    const haut = quantile(m2, 0.9)!;
    gardees.push(...l.filter((v) => v.prix / v.surface >= bas && v.prix / v.surface <= haut));
  }
  const arrondi = (x: number, pas: number) => Math.round(x / pas) * pas;
  return gardees
    .sort((a, b) => empreinte(a) - empreinte(b))
    .slice(0, JEU_PAR_COMMUNE)
    .map((v): VenteJeu => [
      v.annee,
      v.type === 'Maison' ? 0 : 1,
      Math.max(1000, arrondi(v.prix, 1000)),
      Math.max(10, arrondi(v.surface, 5)),
      v.pieces,
      v.terrain >= 10_000 ? arrondi(v.terrain, 1000) : arrondi(v.terrain, 100),
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

/** Les noms des communes actuelles, pour que le jeu n'ait qu'un fichier à lire. */
function nomsDesCommunes(): Map<string, string> {
  const chemin = createRequire(import.meta.url).resolve('@etalab/decoupage-administratif/data/communes.json');
  const toutes = JSON.parse(readFileSync(chemin, 'utf8')) as { code: string; nom: string; type: string }[];
  return new Map(toutes.filter((c) => c.type === 'commune-actuelle').map((c) => [c.code, c.nom]));
}

/**
 * Par commune : son nom, ses ventes, et les médianes que sa page publie déjà —
 * le prix d'une maison, le prix au m² d'un appartement —, que le jeu donne en
 * repère après chaque réponse. Elles sont ici parce que `dep/XX-dvf.json` ne
 * part pas sur le site : seul le build le lit.
 */
export function ecrireVentesJeu(sortie: string, d: Dvf): number {
  const noms = nomsDesCommunes();
  const parDep = new Map<string, Record<string, { n: string; m: [number | null, number | null]; v: VenteJeu[] }>>();
  for (const code of [...d.ventes.keys()].sort()) {
    const nom = noms.get(code);
    const v = ventesDuJeu(d.ventes.get(code)!);
    if (!nom || v.length === 0) continue;
    const dep = departementDe(code);
    if (!parDep.has(dep)) parDep.set(dep, {});
    const p = d.communes.get(code);
    parDep.get(dep)![code] = { n: nom, m: [p?.[2] ?? null, p?.[4] ?? null], v };
  }
  const dossier = join(sortie, 'jeux', 'dvf');
  mkdirSync(dossier, { recursive: true });
  let ecrits = 0;
  for (const [dep, c] of parDep) {
    if (!existsSync(join(sortie, 'dep', `${dep}.json`))) continue;
    writeFileSync(join(dossier, `${dep}.json`), JSON.stringify({ maj: d.maj, annees: d.annees, ...(d.fin ? { fin: d.fin } : {}), c }));
    ecrits++;
  }
  return ecrits;
}

// Lancé seul : télécharge dans `.cache/` s'il n'y est pas, et réécrit les fichiers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { cache, telecharger, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const d = await collecterDvf(anneesDvf(), telecharger, cache, console.log);
  if (d) {
    console.log(`${ecrireDvf(sortie, d)} départements écrits.`);
    console.log(`${ecrireVentesJeu(sortie, d)} départements écrits pour le jeu des prix.`);
    console.log(`${ecrireEstimation(sortie, d.biens, d.annees, d.maj, cache, d.fin)} départements écrits pour le simulateur d’estimation.`);
  }
}
