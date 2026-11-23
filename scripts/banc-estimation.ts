/**
 * Le banc d'essai du simulateur d'estimation : sa précision, mesurée sur des
 * ventes qu'il n'a pas vues, et publiée.
 *
 * **La méthode** (décision du 20 novembre 2026, note de méthode du dépôt
 * privé) :
 *
 * - les ventes de maisons sont réparties en **dix parts**, par un tirage
 *   pseudo-aléatoire dont la graine est publiée : le résultat se refait à
 *   l'identique ;
 * - pour chaque part, le simulateur est recalculé **sans elle** — tous les
 *   prix unitaires, voisinage compris —, puis chacune de ses ventes est
 *   estimée comme la page le ferait, sans étiquette énergétique ni état : la
 *   surface habitable, les locaux d'activité au quart, le terrain, les terres
 *   et les bois ;
 * - on compare au prix réel : écart médian |prix / estimation − 1|, quartiles
 *   du rapport, part des estimations à ± 10 % et à ± 20 %, et part des ventes
 *   que le simulateur n'a pas su estimer ;
 * - **une référence naïve** est mesurée sur les mêmes ventes : le prix médian
 *   au m² habitable des maisons de la commune, vendues sans terres ni bois
 *   (celui de la page de la commune), multiplié par la surface ; le
 *   département quand la commune en a moins de cinq. Un modèle qui ne fait
 *   pas mieux qu'elle doit le dire ;
 * - les résultats sont donnés pour la France, par département, et par taille
 *   de marché : moins de 20 ventes de maisons dans la commune, de 20 à 99,
 *   cent et plus — une commune à vingt ventes emprunte celles de ses
 *   voisines.
 *
 * Le fichier écrit, `public/territoires/simulateurs/estimation/banc.json`,
 * est lu par la page de méthode du simulateur.
 *
 * Lancé seul — `tsx scripts/banc-estimation.ts` —, il relit les ventes de
 * `.cache/dvf-AAAA.csv.gz` (voir `dvf-emettre.ts`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anneesDvf, lireVentes } from './dvf-emettre.ts';
import { daterBiens, estimer, lireVoisines, melangesPeriodes, mesurerPeriodes, PART_ACTIVITE, periodeDe, TAILLES, type Bien, type Estimation } from './estimation-emettre.ts';
import { departementDe, telechargerSiAbsent } from './par-departement.ts';

export const PLIS = 10;
export const GRAINE = 20261120;

/** Un générateur pseudo-aléatoire à graine (mulberry32) : le même tirage à chaque fois. */
export function tirage(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** L'estimation d'une maison telle que la page la calcule, sans étiquette ni état ; null s'il manque un prix. */
export function estimation(e: Estimation | undefined, b: Bien): number | null {
  if (!e) return null;
  const [h, c, cSeul, terres, bois] = e;
  if (!h) return null;
  let v = h * (b.habitable + PART_ACTIVITE * b.activite);
  if (b.constructible > 0) {
    const u = c ?? cSeul;
    if (u === null) return null;
    v += u * b.constructible;
  }
  if (b.agricole > 0) {
    if (!terres) return null;
    const t = b.agricole < TAILLES[0] ? 0 : b.agricole < TAILLES[1] ? 1 : 2;
    v += (b.agricole / 10_000) * terres[t];
  }
  if (b.bois > 0) {
    if (!bois) return null;
    v += (b.bois / 10_000) * bois;
  }
  return v > 0 ? v : null;
}

const mediane = (v: number[]) => {
  const t = [...v].sort((a, b) => a - b);
  const m = t.length >> 1;
  return t.length === 0 ? null : t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};
const quantile = (v: number[], p: number) => {
  const t = [...v].sort((a, b) => a - b);
  if (t.length === 0) return null;
  const i = (t.length - 1) * p;
  const b = Math.floor(i);
  return t[b] + (t[Math.min(b + 1, t.length - 1)] - t[b]) * (i - b);
};

/** Ce qu'on publie d'un ensemble de rapports prix / estimation. */
export type Mesure = {
  /** Ventes de maisons à estimer. */
  ventes: number;
  /** Part de celles que le modèle a pu estimer. */
  couverture: number;
  ecartMedian: number | null;
  q1: number | null;
  q3: number | null;
  a10: number | null;
  a20: number | null;
};

export function mesurer(rapports: (number | null)[]): Mesure {
  const r = rapports.filter((x): x is number => x !== null);
  const arr = (x: number | null, d = 3) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
  const ecarts = r.map((x) => Math.abs(x - 1));
  return {
    ventes: rapports.length,
    couverture: arr(rapports.length ? r.length / rapports.length : 0)!,
    ecartMedian: arr(mediane(ecarts)),
    q1: arr(quantile(r, 0.25)),
    q3: arr(quantile(r, 0.75)),
    a10: r.length ? arr(ecarts.filter((x) => x <= 0.1).length / r.length) : null,
    a20: r.length ? arr(ecarts.filter((x) => x <= 0.2).length / r.length) : null,
  };
}

export interface Banc {
  maj: string;
  annees: number[];
  plis: number;
  graine: number;
  modeles: { id: string; nom: string }[];
  /** Par modèle : la France, puis par département et par taille de marché. */
  france: Record<string, Mesure>;
  departements: Record<string, Record<string, Mesure>>;
  tailles: { id: string; nom: string; mesures: Record<string, Mesure> }[];
  intervalles: Intervalles;
  /** Les mêmes, pour qui donne la période de construction de sa maison. */
  intervallesPeriode: Intervalles;
}

/**
 * Les fourchettes du simulateur, par niveau de confiance : les bornes du rapport
 * prix / estimation qui laissent de côté autant de ventes de chaque côté, mesurées
 * sur les ventes que le modèle n'a pas vues ; séparément pour une commune mesurée
 * seule et pour une commune mesurée avec ses voisines.
 *
 * La tenue est vérifiée à part : bornes apprises sur les cinq premières parts,
 * comptées sur les cinq autres. Une fourchette « à 80 % » qui n'en contiendrait que
 * 70 % le dirait ici, et la page aussi.
 */
export type Intervalles = {
  niveaux: number[];
  classes: Record<'seule' | 'voisines', { ventes: number; bornes: [number, number][]; tenue: number[] }>;
};
export const NIVEAUX = [0.5, 0.8, 0.9];

export function intervalles(lignes: { voisines: boolean; pli: number; surface: number | null }[], plis: number): Intervalles {
  const arr = (x: number) => Math.round(x * 1000) / 1000;
  const classe = (voisines: boolean) => {
    const l = lignes.filter((x) => x.voisines === voisines && x.surface !== null) as { pli: number; surface: number }[];
    const bornes = (r: number[], n: number): [number, number] => [quantile(r, (1 - n) / 2) ?? 0, quantile(r, 1 - (1 - n) / 2) ?? 0];
    const apprises = l.filter((x) => x.pli < plis / 2).map((x) => x.surface);
    const comptees = l.filter((x) => x.pli >= plis / 2).map((x) => x.surface);
    return {
      ventes: l.length,
      bornes: NIVEAUX.map((n) => bornes(l.map((x) => x.surface), n).map(arr) as [number, number]),
      tenue: NIVEAUX.map((n) => {
        const [b, h] = bornes(apprises, n);
        return comptees.length ? arr(comptees.filter((r) => r >= b && r <= h).length / comptees.length) : 0;
      }),
    };
  };
  return { niveaux: NIVEAUX, classes: { seule: classe(false), voisines: classe(true) } };
}

const MODELES = [
  { id: 'surface', nom: 'Le simulateur : surface pondérée, voisinage compris' },
  { id: 'periode', nom: 'Le simulateur, avec la période de construction (BDNB)' },
  { id: 'naif', nom: 'Référence naïve : prix médian au m² de la commune × surface habitable' },
  // À l'essai (note du dépôt privé du 22 novembre 2026) : mesuré et écrit, ni utilisé par le simulateur ni montré sur la page.
  { id: 'melange', nom: 'Essai : moyenne des estimations du simulateur avec période et de la référence naïve', essai: true },
];
const TAILLES_MARCHE = [
  { id: 'petit', nom: 'Moins de 20 ventes de maisons dans la commune', max: 20 },
  { id: 'moyen', nom: 'De 20 à 99 ventes', max: 100 },
  { id: 'grand', nom: 'Cent ventes et plus', max: Infinity },
];

export function banc(
  biens: Bien[],
  voisines: (code: string) => string[],
  annees: number[],
  dire: (m: string) => void,
  plis = PLIS,
  graine = GRAINE,
  /** La région de chaque département : l'effet de la période se mesure par région, comme sur le site. */
  regionDe: (dep: string) => string = () => 'France',
): Banc {
  const maisons = biens.map((b, i) => ({ b, i })).filter(({ b }) => b.habitable > 0);
  // Le tirage : chaque maison reçoit une part, toujours la même pour la même liste de ventes.
  const alea = tirage(graine);
  const part = new Map<number, number>();
  for (const { i } of maisons) part.set(i, Math.floor(alea() * plis));
  // La taille du marché de chaque commune, sur toutes ses ventes de maisons.
  const parCommune = new Map<string, number>();
  for (const { b } of maisons) parCommune.set(b.commune, (parCommune.get(b.commune) ?? 0) + 1);

  const rapports: Record<string, (number | null)[]> = { surface: [], periode: [], naif: [], melange: [] };
  const lignes: { dep: string; taille: number; voisines: boolean; pli: number; datee: boolean; surface: number | null; periode: number | null; naif: number | null; melange: number | null }[] = [];
  for (let p = 0; p < plis; p++) {
    const appris = biens.filter((_, i) => part.get(i) !== p);
    const modele = estimer(appris, voisines);
    // L'effet de la période, appris sur ces ventes seules, région par région ; et le mélange de chaque commune.
    const parRegion = new Map<string, Bien[]>();
    for (const b of appris) (parRegion.get(regionDe(departementDe(b.commune))) ?? parRegion.set(regionDe(departementDe(b.commune)), []).get(regionDe(departementDe(b.commune)))!).push(b);
    const effetPeriode = new Map<string, { mult: number[]; melange: (code: string) => number }>();
    for (const [r, l] of parRegion) {
      const m = mesurerPeriodes(l, r);
      if (m) effetPeriode.set(r, { mult: m.multiplicateurs, melange: melangesPeriodes(l, m.multiplicateurs) });
    }
    // La référence naïve : la médiane au m² des maisons sans terres ni bois, de la commune puis du département.
    const m2 = new Map<string, number[]>();
    const m2Dep = new Map<string, number[]>();
    for (const b of appris) {
      if (!(b.habitable > 0) || b.agricole > 0 || b.bois > 0 || b.activite > 0) continue;
      const v = b.prix / b.habitable;
      (m2.get(b.commune) ?? m2.set(b.commune, []).get(b.commune)!).push(v);
      const d = departementDe(b.commune);
      (m2Dep.get(d) ?? m2Dep.set(d, []).get(d)!).push(v);
    }
    const medC = new Map([...m2].filter(([, l]) => l.length >= 5).map(([k, l]) => [k, mediane(l)!]));
    const medD = new Map([...m2Dep].map(([k, l]) => [k, mediane(l)!]));
    for (const { b, i } of maisons) {
      if (part.get(i) !== p) continue;
      const est = modele.get(b.commune);
      const e = estimation(est, b);
      const ep = effetPeriode.get(regionDe(departementDe(b.commune)));
      // Sans année connue, l'estimation reste celle d'une maison ordinaire de la commune, comme sur la page.
      const eP = e && ep && b.annee ? (e * ep.mult[periodeDe(b.annee)]) / ep.melange(b.commune) : e;
      const u = medC.get(b.commune) ?? medD.get(departementDe(b.commune)) ?? null;
      const n = u !== null ? u * b.habitable : null;
      const n2 = parCommune.get(b.commune) ?? 0;
      lignes.push({
        dep: departementDe(b.commune),
        // La commune mesurée seule, ou avec ses voisines : la page le sait, et choisit la fourchette en conséquence.
        voisines: (est?.[5][1] ?? 0) > 0,
        pli: p,
        datee: !!(ep && b.annee),
        taille: TAILLES_MARCHE.findIndex((t) => n2 < t.max),
        surface: e ? b.prix / e : null,
        periode: eP ? b.prix / eP : null,
        naif: n ? b.prix / n : null,
        // La moyenne des deux estimations, à parts égales (le poids appris sur cinq départements).
        melange: eP && n ? b.prix / ((eP + n) / 2) : null,
      });
    }
    dire(`  banc d’essai : part ${p + 1} sur ${plis}`);
  }
  for (const l of lignes) {
    rapports.surface.push(l.surface);
    rapports.periode.push(l.periode);
    rapports.naif.push(l.naif);
    rapports.melange.push(l.melange);
  }
  // Pour un contrôle indépendant des mesures : les rapports eux-mêmes, hors du site.
  if (process.env.ROUAGES_BANC_DETAIL) writeFileSync(process.env.ROUAGES_BANC_DETAIL, JSON.stringify(lignes));
  const parModele = (f: (l: (typeof lignes)[number]) => boolean) =>
    Object.fromEntries(MODELES.map((m) => [m.id, mesurer(lignes.filter(f).map((l) => l[m.id as 'surface' | 'periode' | 'naif' | 'melange']))]));
  const deps = [...new Set(lignes.map((l) => l.dep))].sort();
  const resultat: Banc = {
    maj: new Date().toISOString().slice(0, 10),
    annees,
    plis,
    graine,
    modeles: MODELES,
    france: parModele(() => true),
    departements: Object.fromEntries(deps.map((d) => [d, parModele((l) => l.dep === d)])),
    tailles: TAILLES_MARCHE.map((t, k) => ({ id: t.id, nom: t.nom, mesures: parModele((l) => l.taille === k) })),
    intervalles: intervalles(lignes, plis),
    // Pour qui donne la période : mesurées sur les seules maisons datées, estimées avec leur période.
    intervallesPeriode: intervalles(
      lignes.filter((l) => l.datee).map((l) => ({ ...l, surface: l.periode })),
      plis,
    ),
  };
  const f = resultat.france;
  dire(
    `Banc d’essai de l’estimation (${plis} parts, graine ${graine}) : ${f.surface.ventes.toLocaleString('fr-FR')} maisons ; ` +
      `écart médian ${f.surface.ecartMedian} pour le simulateur, ${f.periode.ecartMedian} avec la période, ${f.naif.ecartMedian} pour la référence naïve.`,
  );
  return resultat;
}

/** Le banc déjà calculé pour ces années, avec la même méthode : on ne le refait pas — c'est dix fois le simulateur (31 s pour l'Allier). */
export const VERSION = 4;
export function bancAJour(sortie: string, annees: number[]): boolean {
  const f = join(sortie, 'simulateurs', 'estimation', 'banc.json');
  if (process.env.ROUAGES_BANC_FORCER || !existsSync(f)) return false;
  try {
    const b = JSON.parse(readFileSync(f, 'utf8')) as Partial<Banc> & { version?: number };
    return b.version === VERSION && b.plis === PLIS && b.graine === GRAINE && JSON.stringify(b.annees) === JSON.stringify(annees);
  } catch {
    return false;
  }
}

export function ecrireBanc(sortie: string, b: Banc): void {
  const dossier = join(sortie, 'simulateurs', 'estimation');
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, 'banc.json'), JSON.stringify({ version: VERSION, ...b }));
  // Le petit fichier que lit la page du simulateur pour ses fourchettes.
  writeFileSync(join(dossier, 'intervalles.json'), JSON.stringify({ maj: b.maj, annees: b.annees, ...b.intervalles, periode: b.intervallesPeriode.classes }));
}

// Lancé seul : les ventes déjà en cache.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const annees = anneesDvf().filter((a) => existsSync(join(cache, `dvf-${a}.csv.gz`)));
  const biens: Bien[] = [];
  for (const a of annees) await lireVentes(join(cache, `dvf-${a}.csv.gz`), a, () => {}, () => {}, (b) => biens.push(b));
  console.log(`${daterBiens(biens, cache)} maisons datées d’après la BDNB.`);
  const debut = Date.now();
  const b = banc(biens, lireVoisines(sortie), annees, console.log, Number(process.env.ROUAGES_BANC_PLIS ?? PLIS));
  console.log(`(${Math.round((Date.now() - debut) / 1000)} s)`);
  ecrireBanc(sortie, b);
}
