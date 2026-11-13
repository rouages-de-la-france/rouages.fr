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
import { lienUnesco, patrimoineMondial } from './patrimoine-mondial.ts';
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
  nature: 'programme' | 'zonage' | 'designation';
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
  /** Pour un dispositif signé par territoire : comment se nomment ces territoires (« contrats »…). */
  groupes_nom?: string;
  /** false quand les séries avant / après n'auraient pas de sens — un contrat qui couvre tout le pays. */
  series?: boolean;
}

/**
 * Les clés que `scripts/zonages-emettre.ts` sait rattacher aux communes.
 * `montagne` : la zone de montagne au sens de l'urbanisme, dans le huitième
 * champ, comparée à la zone agricole défavorisée de montagne, le quatrième.
 */
const CLES = new Set(['pvd', 'acv', 'va', 'ami', 'amm', 'cite', 'cde', 'fabp', 'habinclus', 'abc', 'montagne', 'frr', 'tlv', 'ti', 'crte', 'qpv', 'ramsar', 'biosphere', 'mondial']);

/**
 * Les désignations internationales ne sont pas dans les fichiers de zonage :
 * Ramsar et la biosphère viennent des périmètres de l'INPN
 * (`dep/XX-espaces.json`, natures 10 et 11), le patrimoine mondial de la
 * liste de l'UNESCO (`patrimoine-mondial.json`).
 */
const NATURE_INPN: Record<string, number> = { ramsar: 10, biosphere: 11 };
// L'INPN nomme chaque zone de certaines réserves : « Archipel De Guadeloupe (Zone Tampon) ».
const sansZone = (nom: string) => nom.replace(/\s*\((zone|aire)[^)]*\)\s*$/i, '');

/**
 * Les dispositifs qui ne sont pas une liste de programmes : où la ligne du
 * fichier de zonage dit qu'une commune en est. Territoire d'industrie et CRTE
 * portent le nom du territoire ou du contrat ; les quartiers prioritaires,
 * la liste des quartiers de la commune.
 */
const PAR_CHAMP: Record<string, (x: unknown[]) => boolean> = {
  ti: (x) => Boolean(x[1]),
  crte: (x) => Boolean(x[2]),
  qpv: (x) => Array.isArray(x[5]) && x[5].length > 0,
};
/** Le nom du groupe — territoire, contrat — auquel la commune appartient. */
const GROUPE: Record<string, (x: unknown[]) => string> = {
  ti: (x) => String(x[1] ?? ''),
  crte: (x) => String(x[2] ?? ''),
};

/**
 * Pour un zonage par classes, la classe d'une commune telle que la ligne du
 * fichier de zonage la porte — la zone ABC, le niveau de France ruralités
 * revitalisation —, ou null quand le fichier ne la porte pas.
 */
function classeDans(cle: string, x: unknown[]): string | null {
  if (cle === 'abc') return x[4] ? String(x[4]) : null;
  if (cle === 'frr') return x[8] === undefined ? null : String(x[8]);
  if (cle === 'tlv') return x[6] === undefined ? null : String(x[6]);
  return null;
}
/** Le fichier de zonage porte-t-il la classe ? Une date manquante dit que la collecte ne l'a pas encore lue. */
const DATE_DE_LA_CLASSE: Record<string, string> = { frr: 'frr', tlv: 'tlv' };

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
    if ((d.cle === 'abc' || d.cle === 'frr' || d.cle === 'tlv') && !d.classes?.length) erreurs.push(`${ou} : un zonage par classes déclare ses classes`);
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
type EspacesDep = { maj: string; z: Record<string, [string, string, number, unknown]>; c: Record<string, [number, string, number][]> };
const espacesDep = parDepartement<EspacesDep>('espaces');
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
  /** Pour un dispositif signé par territoire — Territoires d'industrie, CRTE — : chaque territoire et son nombre de communes. */
  groupes: { nom: string; n: number; lien?: string }[];
  /** Pour les quartiers prioritaires : les quartiers de chaque commune. */
  quartiersDe: Map<string, string[]>;
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
  const groupes = new Map<string, number>();
  const quartiersDe = new Map<string, string[]>();
  let deuxMontagnes: ChiffresDispositif['deuxMontagnes'] = null;
  const nature = NATURE_INPN[d.cle];
  const mondial = d.cle === 'mondial' ? patrimoineMondial() : null;
  const liens = new Map<string, string>();
  for (const c of communes()) {
    if (nature !== undefined || d.cle === 'mondial') {
      // Une désignation : la commune en est si un périmètre la touche, même de moins de 1 %.
      const noms = new Set<string>();
      if (d.cle === 'mondial') {
        if (!mondial) break;
        for (const [id] of mondial.c[c.code] ?? []) {
          const b = mondial.biens[String(id)];
          if (!b) continue;
          noms.add(b.nom);
          liens.set(b.nom, lienUnesco(id));
        }
        dateListe ??= mondial.version ?? mondial.maj;
      } else {
        const e = espacesDep.get(c.dep);
        for (const [n, cle] of e?.c[c.code] ?? []) if (n === nature && e!.z[cle]) noms.add(sansZone(e!.z[cle][0]));
        if (e) dateListe ??= e.maj;
      }
      if (noms.size === 0) continue;
      for (const nom of noms) groupes.set(nom, (groupes.get(nom) ?? 0) + 1);
      liste.push(c);
      const e = parDep.get(c.dep) ?? { depNom: c.depNom, n: 0 };
      e.n++;
      parDep.set(c.dep, e);
      continue;
    }
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
    } else if (PAR_CHAMP[d.cle]) {
      if (!PAR_CHAMP[d.cle](x)) continue;
      const g = GROUPE[d.cle]?.(x);
      if (g) groupes.set(g, (groupes.get(g) ?? 0) + 1);
      if (d.cle === 'qpv') quartiersDe.set(c.code, x[5] as string[]);
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
    groupes: [...groupes].map(([nom, n]) => ({ nom, n, lien: liens.get(nom) })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    quartiersDe,
    // Les recensements depuis 2010 : plus loin, la série dit l'histoire longue, pas l'avant / après.
    population_recensements: recensements
      ? (() => {
          const i = recensements.annees.findIndex((a) => a >= 2010);
          return { annees: recensements.annees.slice(i), valeurs: recensements.valeurs.slice(i), couvertes: recensements.couvertes };
        })()
      : null,
  };
}
