/**
 * Les dispositifs — programmes de l'État, zonages —, une page chacun sous
 * `/dispositif/<id>` (docs/13-programmes-et-zonages.md).
 *
 * Le texte vient de `contenu/dispositifs.yaml`, écrit à la main d'après des
 * sources lues. Les communes viennent des fichiers de zonage, par la clé du
 * dispositif. Le reste est calculé ici, et la page le dit :
 *
 *   — des chiffres descriptifs : combien de communes, combien d'habitants,
 *     leur taille médiane, leur répartition par département ;
 *   — des séries avant / après, sur les seules communes du dispositif : les
 *     logements autorisés chaque année, la population à chaque recensement.
 *     Elles décrivent ; elles ne mesurent pas l'effet du programme — les
 *     communes ont été choisies justement parce qu'elles différaient des
 *     autres, et bien d'autres choses ont changé en même temps. La page les
 *     sépare des évaluations publiées, qui seules jugent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { nommeUnePersonne } from './civilites.ts';
import { parDepartement } from './fiche-commune.ts';
import { communes, type CommuneIndex } from './territoires.ts';

export interface PhraseSourcee {
  texte: string;
  source: string;
}

export interface Dispositif {
  id: string;
  /** La clé du dispositif dans les fichiers de zonage (`pvd`, `acv`, `va`…). */
  cle: string;
  nom: string;
  nature: 'programme' | 'zonage';
  lancement: number;
  pilote: string;
  resume: string;
  ce_que_cest: PhraseSourcee[];
  qui_decide: PhraseSourcee[];
  apporte: PhraseSourcee[];
  cout: PhraseSourcee[];
  evaluations?: { source: string; conclusion: string }[];
  sans_evaluation?: string;
  sources: { id: string; titre: string; url: string; consulte_le: string }[];
  verifie_le: string;
  /**
   * Un zonage qui classe toutes les communes plutôt qu'il n'en retient
   * certaines — le zonage ABC : les classes, dans l'ordre, telles que les
   * fichiers de zonage les écrivent, et leur libellé.
   */
  classes?: { cle: string; libelle: string }[];
  /** Le nom d'une classe, au singulier : « zone » par défaut, « niveau » pour FRR. */
  classes_nom?: string;
  /** D'où vient la liste des communes, dit sur la page : « la liste des communes de … ». */
  liste?: string;
}

/**
 * Les clés que `scripts/zonages-emettre.ts` sait rattacher aux communes.
 * `montagne` : la zone de montagne au sens de l'urbanisme, dans le huitième
 * champ, comparée à la zone agricole défavorisée de montagne, le quatrième.
 */
const CLES = new Set(['pvd', 'acv', 'va', 'ami', 'amm', 'cite', 'cde', 'fabp', 'habinclus', 'abc', 'montagne', 'frr']);

/**
 * Pour un zonage par classes, la classe d'une commune telle que la ligne du
 * fichier de zonage la porte — la zone ABC, le niveau de France ruralités
 * revitalisation —, ou null quand le fichier ne la porte pas.
 */
function classeDans(cle: string, x: unknown[]): string | null {
  if (cle === 'abc') return x[4] ? String(x[4]) : null;
  if (cle === 'frr') return x[8] === undefined ? null : String(x[8]);
  return null;
}
/** Le fichier de zonage porte-t-il la classe ? Une date manquante dit que la collecte ne l'a pas encore lue. */
const DATE_DE_LA_CLASSE: Record<string, string> = { frr: 'frr' };

let cache: Dispositif[] | undefined;

export function dispositifs(racine = process.cwd()): Dispositif[] {
  if (cache && racine === process.cwd()) return cache;
  const brut = parse(readFileSync(join(racine, 'contenu', 'dispositifs.yaml'), 'utf8')) as { dispositifs?: Dispositif[] } | null;
  const liste = (brut?.dispositifs ?? []).map((d) => ({
    ...d,
    verifie_le: String(d.verifie_le),
    sources: (d.sources ?? []).map((s) => ({ ...s, consulte_le: String(s.consulte_le) })),
  }));
  if (racine === process.cwd()) cache = liste;
  return liste;
}

/** La page d'un dispositif, quand il en a une. */
export function lienDispositif(cle: string): string | null {
  const d = dispositifs().find((x) => x.cle === cle);
  return d ? `/dispositif/${d.id}` : null;
}

/** Les erreurs qui empêchent de publier : la validation les refuse. */
export function controlerDispositifs(liste = dispositifs()): string[] {
  const erreurs: string[] = [];
  const ids = new Set<string>();
  for (const d of liste) {
    const ou = `contenu/dispositifs.yaml → ${d.id ?? '(sans id)'}`;
    if (!d.id || !/^[a-z0-9-]+$/.test(d.id)) erreurs.push(`${ou} : id absent ou mal formé`);
    if (ids.has(d.id)) erreurs.push(`${ou} : id en double`);
    ids.add(d.id);
    if (!CLES.has(d.cle)) erreurs.push(`${ou} : clé « ${d.cle} » inconnue des fichiers de zonage`);
    if (!d.resume || d.resume.length > 280) erreurs.push(`${ou} : résumé absent ou de plus de 280 caractères`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.verifie_le)) erreurs.push(`${ou} : verifie_le doit être une date`);
    const sources = new Set(d.sources.map((s) => s.id));
    for (const s of d.sources) {
      if (!/^https:\/\//.test(s.url)) erreurs.push(`${ou} : la source ${s.id} n'est pas en https`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.consulte_le)) erreurs.push(`${ou} : consulte_le de ${s.id} doit être une date`);
    }
    const phrases = [...d.ce_que_cest, ...d.qui_decide, ...d.apporte, ...d.cout];
    for (const p of phrases) if (!sources.has(p.source)) erreurs.push(`${ou} : source « ${p.source} » citée, non déclarée`);
    for (const e of d.evaluations ?? []) if (!sources.has(e.source)) erreurs.push(`${ou} : évaluation de source « ${e.source} » non déclarée`);
    if (!(d.evaluations?.length) && !d.sans_evaluation) erreurs.push(`${ou} : ni évaluation, ni phrase qui dit qu'il n'y en a pas`);
    if ((d.cle === 'abc' || d.cle === 'frr') && !d.classes?.length) erreurs.push(`${ou} : un zonage par classes déclare ses classes`);
    for (const t of [d.resume, ...phrases.map((p) => p.texte), ...(d.evaluations ?? []).map((e) => e.conclusion)]) {
      if (nommeUnePersonne(t)) erreurs.push(`${ou} : un texte semble nommer une personne physique : « ${t.slice(0, 60)}… »`);
    }
  }
  return erreurs;
}

type ZonagesDep = {
  maj: string;
  dates: Record<string, string>;
  c: Record<string, [string[], string, string, number, string, string[]?, number?, number?, number?]>;
};
type LogementsDep = { annees: number[]; arrete: string; c: Record<string, [number[], number, number]> };
type PopulationDep = { annees: number[]; c: Record<string, [number[], ...unknown[]]> };
const zonagesDep = parDepartement<ZonagesDep>('zonages');
const logementsDep = parDepartement<LogementsDep>('logements');
const populationDep = parDepartement<PopulationDep>('population');

export interface SerieAnnuelle {
  annees: number[];
  valeurs: number[];
  /** Combien de communes du dispositif la série couvre. */
  couvertes: number;
}

export interface ChiffresDispositif {
  communes: CommuneIndex[];
  /** Pour un zonage par classes : la classe de chaque commune, par son code. */
  classeDe: Map<string, string>;
  parClasse: { cle: string; libelle: string; n: number; population: number }[];
  population: number;
  medianePopulation: number | null;
  parDepartement: { dep: string; depNom: string; n: number }[];
  /** La date de la liste de communes, telle que le fichier de zonage la porte. */
  dateListe: string | null;
  logements: (SerieAnnuelle & { arrete: string }) | null;
  population_recensements: SerieAnnuelle | null;
  /**
   * Pour la zone de montagne : ses communes croisées avec la zone agricole
   * défavorisée de montagne (entière ou en partie). Null tant que la collecte
   * n'a pas lu la délimitation de l'urbanisme.
   */
  deuxMontagnes: { lesDeux: number; urbanismeSeul: number; agricultureSeule: number; agricultureEnPartie: number } | null;
}

const mediane = (v: number[]): number | null => {
  if (v.length === 0) return null;
  const t = [...v].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : Math.round((t[m - 1] + t[m]) / 2);
};

/** Une série additionnée sur les communes, pour les années communes à tous leurs fichiers. */
function additionner(series: { annees: number[]; v: number[] }[]): SerieAnnuelle | null {
  if (series.length === 0) return null;
  const annees = series[0].annees.filter((a) => series.every((s) => s.annees.includes(a)));
  const valeurs = annees.map((a) => series.reduce((t, s) => t + (s.v[s.annees.indexOf(a)] ?? 0), 0));
  return { annees, valeurs, couvertes: series.length };
}

export function chiffresDispositif(d: Dispositif): ChiffresDispositif {
  const liste: CommuneIndex[] = [];
  let dateListe: string | null = null;
  const parDep = new Map<string, { depNom: string; n: number }>();
  const logs: { annees: number[]; v: number[] }[] = [];
  const pops: { annees: number[]; v: number[] }[] = [];
  let arrete = '';
  const classeDe = new Map<string, string>();
  const montagne = d.cle === 'montagne';
  let deuxMontagnes: ChiffresDispositif['deuxMontagnes'] = null;
  for (const c of communes()) {
    const z = zonagesDep.get(c.dep);
    const x = z?.c[c.code];
    if (!z || !x) continue;
    if (montagne) {
      if (!z.dates?.montagneUrbanisme) continue;
      deuxMontagnes ??= { lesDeux: 0, urbanismeSeul: 0, agricultureSeule: 0, agricultureEnPartie: 0 };
      const u = x[7] === 1;
      const a = x[3];
      if (u && a === 1) deuxMontagnes.lesDeux++;
      else if (u && a === 0) deuxMontagnes.urbanismeSeul++;
      else if (!u && a === 1) deuxMontagnes.agricultureSeule++;
      if (a === 2) deuxMontagnes.agricultureEnPartie++;
      if (!u) continue;
      dateListe ??= z.dates.montagneUrbanisme;
    } else if (d.classes) {
      const date = DATE_DE_LA_CLASSE[d.cle];
      if (date && !z.dates?.[date]) continue;
      const k = classeDans(d.cle, x);
      if (k === null || !d.classes.some((y) => y.cle === k)) continue;
      classeDe.set(c.code, k);
    } else if (!x[0]?.includes(d.cle)) continue;
    if (!montagne) dateListe ??= z.dates?.[d.cle] ?? null;
    liste.push(c);
    const e = parDep.get(c.dep) ?? { depNom: c.depNom, n: 0 };
    e.n++;
    parDep.set(c.dep, e);
    const l = logementsDep.get(c.dep);
    const lc = l?.c[c.code];
    if (l && lc) {
      logs.push({ annees: l.annees, v: lc[0] });
      arrete = l.arrete;
    }
    const p = populationDep.get(c.dep);
    const pc = p?.c[c.code];
    if (p && pc) pops.push({ annees: p.annees, v: pc[0] });
  }
  liste.sort((a, b) => a.dep.localeCompare(b.dep, 'fr', { numeric: true }) || a.nom.localeCompare(b.nom, 'fr'));
  const logements = additionner(logs);
  const recensements = additionner(pops);
  const parClasse = (d.classes ?? []).map((k) => {
    const ici = liste.filter((c) => classeDe.get(c.code) === k.cle);
    return { ...k, n: ici.length, population: ici.reduce((t, c) => t + c.population, 0) };
  });
  return {
    communes: liste,
    classeDe,
    parClasse,
    population: liste.reduce((t, c) => t + c.population, 0),
    medianePopulation: mediane(liste.map((c) => c.population)),
    parDepartement: [...parDep].map(([dep, x]) => ({ dep, ...x })).sort((a, b) => b.n - a.n || a.dep.localeCompare(b.dep, 'fr', { numeric: true })),
    dateListe,
    logements: logements ? { ...logements, arrete } : null,
    deuxMontagnes,
    // Les recensements depuis 2010 : plus loin, la série dit l'histoire longue, pas l'avant / après.
    population_recensements: recensements
      ? (() => {
          const i = recensements.annees.findIndex((a) => a >= 2010);
          return { annees: recensements.annees.slice(i), valeurs: recensements.valeurs.slice(i), couvertes: recensements.couvertes };
        })()
      : null,
  };
}
