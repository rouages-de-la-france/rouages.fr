/**
 * Ce qui touche une parcelle dans le document d'urbanisme : la lecture
 * assistée du PLU, niveau 1 (`docs/07-risques.md`, section 10).
 *
 * Tout est lu au moment de la demande, rien n'est gardé : la parcelle au
 * cadastre de l'IGN (Parcellaire Express), puis les couches du Géoportail de
 * l'urbanisme que sert la Géoplateforme — zones et secteurs, prescriptions,
 * informations, assiettes des servitudes d'utilité publique —, puis l'état de
 * chaque document à l'API du Géoportail. Le même code tourne dans le
 * navigateur (`src/client/ma-parcelle.ts`) et sous Node pour la fiche de
 * relecture (`scripts/relecture-parcelle.ts`).
 *
 * **Le filtre du service est lâche** : une requête par rectangle rend les
 * entités dont l'enveloppe touche le rectangle, pas celles qui touchent la
 * parcelle — au Mayet-de-Montagne, l'emprise ferroviaire de tout le
 * Puy-de-Dôme revient pour une parcelle du bourg. Chaque entité rendue est
 * donc testée ici contre la géométrie de la parcelle, et seule celle qui la
 * touche est gardée.
 *
 * Le module ne cite aucun texte du règlement : il dit le libellé publié, le
 * type CNIG en clair et le lien vers la pièce. Il ne conclut rien.
 */
import { typeInformation, typePrescription, typeZone, TYPES_SECTEUR, type TypeCnig } from './cnig.ts';

/**
 * La page n'entre au menu et dans les moteurs qu'après relecture par un
 * praticien, sur la fiche `docs/11-relecture-parcelle.md` : la décision revient
 * au mainteneur, qui passe ce drapeau à `true`.
 */
export const PUBLIE = false;

export const WFS = 'https://data.geopf.fr/wfs/ows';
export const ANNEXES = 'https://data.geopf.fr/annexes/gpu/documents';
export const API_GPU = 'https://www.geoportail-urbanisme.gouv.fr/api/document';
export const GEOCODAGE = 'https://data.geopf.fr/geocodage/search';
export const COUCHE_PARCELLE = 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle';

type Proprietes = Record<string, unknown>;
export type Geometrie = { type: string; coordinates: unknown } | null;
export interface Entite {
  id?: string;
  properties: Proprietes;
  geometry: Geometrie;
}

/** Une parcelle du cadastre, telle que Parcellaire Express la publie. */
export interface Parcelle {
  /** L'identifiant national : code INSEE, préfixe, section, numéro — « 03165000AC0062 ». */
  idu: string;
  commune: string;
  insee: string;
  section: string;
  numero: string;
  /** La contenance cadastrale en mètres carrés, telle que publiée. */
  contenance: number | null;
  geometrie: Geometrie;
}

// ---------------------------------------------------------------------------
// Géométrie, dans un plan local en mètres centré sur la parcelle.

type P = [number, number];
type Anneau = P[];
/** Les polygones d'une géométrie, chacun avec ses anneaux (contour, puis trous). */
type Polygones = Anneau[][];

/** Une projection équirectangulaire autour d'un point : à l'échelle d'une parcelle, l'écart est négligeable. */
export function planLocal(lon0: number, lat0: number): (lonlat: number[]) => P {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky];
}

export function polygones(g: Geometrie, f: (c: number[]) => P): Polygones {
  if (!g) return [];
  const c = g.coordinates as number[][][] | number[][][][];
  if (g.type === 'Polygon') return [(c as number[][][]).map((r) => r.map(f))];
  if (g.type === 'MultiPolygon') return (c as number[][][][]).map((p) => p.map((r) => r.map(f)));
  return [];
}

export function lignes(g: Geometrie, f: (c: number[]) => P): P[][] {
  if (!g) return [];
  const c = g.coordinates as number[][] | number[][][];
  if (g.type === 'LineString') return [(c as number[][]).map(f)];
  if (g.type === 'MultiLineString') return (c as number[][][]).map((l) => l.map(f));
  return [];
}

export function points(g: Geometrie, f: (c: number[]) => P): P[] {
  if (!g) return [];
  if (g.type === 'Point') return [f(g.coordinates as number[])];
  if (g.type === 'MultiPoint') return (g.coordinates as number[][]).map(f);
  return [];
}

/** Pair-impair sur les anneaux de chaque polygone, un trou comptant comme dehors ; dedans si un polygone le contient. */
export function dedans([x, y]: P, polys: Polygones): boolean {
  for (const p of polys) {
    let c = false;
    for (const r of p)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i];
        const [xj, yj] = r[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
    if (c) return true;
  }
  return false;
}

function distanceSegment([x, y]: P, [ax, ay]: P, [bx, by]: P): number {
  const l = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = l ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l)) : 0;
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}

/** La distance d'un point au bord le plus proche d'une suite de segments (anneaux fermés ou lignes). */
export function distanceBord(p: P, chemins: P[][], fermes: boolean): number {
  let d = Infinity;
  for (const r of chemins)
    for (let i = fermes ? 0 : 1, j = fermes ? r.length - 1 : 0; i < r.length; j = i++) d = Math.min(d, distanceSegment(p, r[j], r[i]));
  return d;
}

function orientation(a: P, b: P, c: P): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Deux segments qui se coupent ou se touchent. */
export function seCoupent(a: P, b: P, c: P, d: P): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  const sur = (p: P, q: P, r: P) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (o1 === 0 && sur(a, b, c)) || (o2 === 0 && sur(a, b, d)) || (o3 === 0 && sur(c, d, a)) || (o4 === 0 && sur(c, d, b));
}

type Cadre = [number, number, number, number];
function cadreDe(pts: P[]): Cadre {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Un chemin (anneau ou ligne) coupe-t-il un bord de la parcelle ? Les segments loin du cadre de la parcelle sont écartés d'abord. */
function cheminCoupe(chemin: P[], ferme: boolean, bords: P[][], cadre: Cadre, marge: number): boolean {
  const [x0, y0, x1, y1] = [cadre[0] - marge, cadre[1] - marge, cadre[2] + marge, cadre[3] + marge];
  for (let i = ferme ? 0 : 1, j = ferme ? chemin.length - 1 : 0; i < chemin.length; j = i++) {
    const a = chemin[j];
    const b = chemin[i];
    if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1 || Math.max(a[1], b[1]) < y0 || Math.min(a[1], b[1]) > y1) continue;
    for (const r of bords) for (let k = 0, l = r.length - 1; k < r.length; l = k++) if (seCoupent(a, b, r[l], r[k])) return true;
  }
  return false;
}

/**
 * Comment une entité touche la parcelle :
 * - `toute` : elle couvre toute la parcelle ;
 * - `partie` : elle en couvre une partie ;
 * - `bord` : elle n'en touche qu'une bande étroite le long de sa limite, moins
 *   du dixième de sa surface et rien à plus de trois mètres du bord —
 *   souvent l'écart entre deux dessins, le zonage et le cadastre, faits
 *   séparément ; on le dit plutôt que de le taire ;
 * - `traverse` : une ligne ou un point sur la parcelle ;
 * - `limite` : une ligne ou un point à moins d'un mètre de sa limite, dehors.
 */
export type Contact = 'toute' | 'partie' | 'bord' | 'traverse' | 'limite';

/** Une bande de trois mètres ou moins le long de la limite : en deçà, on ne parle que du bord. */
export const BANDE = 3;
/** La tolérance d'une ligne ou d'un point dessiné sur la limite. */
export const TOLERANCE = 1;

/** La parcelle préparée une fois pour toutes les entités : son plan local, ses anneaux, et une grille de points dedans. */
export interface Gabarit {
  plan: (c: number[]) => P;
  polys: Polygones;
  bords: P[][];
  cadre: Cadre;
  /** Les points de la grille qui tombent dans la parcelle, avec leur distance à sa limite. */
  grille: { p: P; profondeur: number }[];
}

export function gabarit(g: Geometrie): Gabarit {
  // Le centre du cadre en degrés, pour le plan local.
  const brut = polygones(g, (c) => [c[0], c[1]]).flat(2);
  const [lx0, ly0, lx1, ly1] = cadreDe(brut);
  const plan = planLocal((lx0 + lx1) / 2, (ly0 + ly1) / 2);
  const polys = polygones(g, plan);
  const bords = polys.flat();
  const cadre = cadreDe(bords.flat());
  // Une grille d'environ trois mille points sur le cadre, au pas d'un demi-mètre au moins.
  const [x0, y0, x1, y1] = cadre;
  const pas = Math.max(0.5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 3000));
  const grille: Gabarit['grille'] = [];
  for (let x = x0 + pas / 2; x < x1; x += pas)
    for (let y = y0 + pas / 2; y < y1; y += pas) {
      const p: P = [x, y];
      if (dedans(p, polys)) grille.push({ p, profondeur: distanceBord(p, bords, true) });
    }
  return { plan, polys, bords, cadre, grille };
}

/** Le contact d'une entité avec la parcelle, ou `null` si elle ne la touche pas. */
export function contact(gab: Gabarit, g: Geometrie): Contact | null {
  if (!g) return null;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    const polys = polygones(g, gab.plan);
    const coupe = polys.some((p) => p.some((r) => cheminCoupe(r, true, gab.bords, gab.cadre, 0)));
    const sommetDedans = polys.some((p) => p.some((r) => r.some((s) => dedans(s, gab.polys))));
    const couverts = gab.grille.filter(({ p }) => dedans(p, polys));
    if (!coupe && !sommetDedans && !couverts.length) return null;
    if (couverts.length === gab.grille.length) return 'toute';
    // Une bande : peu de la parcelle, et rien à plus de trois mètres de sa limite. Les deux à la fois, sans quoi
    // une parcelle de quelques mètres de large serait toute entière « au bord ».
    if (!couverts.length || (couverts.length < 0.1 * gab.grille.length && Math.max(...couverts.map((c) => c.profondeur)) <= BANDE)) return 'bord';
    return 'partie';
  }
  const ls = lignes(g, gab.plan);
  if (ls.length) {
    if (ls.some((l) => cheminCoupe(l, false, gab.bords, gab.cadre, 0) || l.some((s) => dedans(s, gab.polys)))) return 'traverse';
    if (ls.some((l) => gab.bords.some((r) => r.some((s) => distanceBord(s, [l], false) <= TOLERANCE)) || l.some((s) => distanceBord(s, gab.bords, true) <= TOLERANCE)))
      return 'limite';
    return null;
  }
  const ps = points(g, gab.plan);
  if (ps.some((p) => dedans(p, gab.polys))) return 'traverse';
  if (ps.some((p) => distanceBord(p, gab.bords, true) <= TOLERANCE)) return 'limite';
  return null;
}

// ---------------------------------------------------------------------------
// Les services.

/** Un appel qui réessaie deux fois : la Géoplateforme coupe parfois une connexion sans raison. */
async function lire(url: string, essais = 3): Promise<unknown> {
  let derniere: unknown;
  for (let i = 0; i < essais; i++) {
    if (i) await new Promise((r) => setTimeout(r, 800 * i));
    try {
      // Vingt secondes au plus : une connexion qui pend ne doit pas laisser la page attendre sans fin.
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
      derniere = new Error(`${r.status} ${url}`);
      if (r.status < 500) break;
    } catch (e) {
      derniere = e;
    }
  }
  throw derniere;
}

async function parPaquets<T, R>(liste: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const sortie: R[] = new Array(liste.length);
  let suivant = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, liste.length) }, async () => {
      while (suivant < liste.length) {
        const i = suivant++;
        sortie[i] = await f(liste[i]);
      }
    }),
  );
  return sortie;
}

function urlWfs(couche: string, filtre: Record<string, string>): string {
  const p = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: couche,
    OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:4326',
    COUNT: '500',
    ...filtre,
  });
  return `${WFS}?${p}`;
}

/** Le cadre d'une requête, latitude d'abord comme le veut EPSG:4326 en WFS 2.0. */
const bbox = (lon0: number, lat0: number, lon1: number, lat1: number) => `${lat0},${lon0},${lat1},${lon1},urn:ogc:def:crs:EPSG::4326`;

function enParcelle(e: Entite): Parcelle {
  const p = e.properties;
  return {
    idu: String(p.idu ?? ''),
    commune: String(p.nom_com ?? ''),
    insee: String(p.code_insee ?? ''),
    section: String(p.section ?? ''),
    numero: String(p.numero ?? ''),
    contenance: p.contenance == null || p.contenance === '' ? null : Number(p.contenance),
    geometrie: e.geometry,
  };
}

/** Une parcelle par son identifiant : « 03165000AC0062 », ou le code INSEE, la section et le numéro. */
export function idu(insee: string, section: string, numero: string, prefixe = '000'): string {
  return `${insee}${prefixe.padStart(3, '0')}${section.toUpperCase().padStart(2, '0')}${numero.padStart(4, '0')}`;
}

export async function parcelleParIdu(id: string): Promise<Parcelle | null> {
  if (!/^\d[\dAB]\d{3}\d{3}[0-9A-Z]{2}\d{4}$/.test(id)) return null;
  const d = (await lire(urlWfs(COUCHE_PARCELLE, { CQL_FILTER: `idu='${id}'` }))) as { features?: Entite[] };
  const e = d.features?.[0];
  return e ? enParcelle(e) : null;
}

/** Les parcelles autour d'un point, pour choisir sur la carte : celle qui contient le point d'abord. */
export async function parcellesAutour(lon: number, lat: number, metres = 40): Promise<{ parcelles: Parcelle[]; sous: string | null }> {
  const dx = metres / (111320 * Math.cos((lat * Math.PI) / 180));
  const dy = metres / 110574;
  const d = (await lire(urlWfs(COUCHE_PARCELLE, { BBOX: bbox(lon - dx, lat - dy, lon + dx, lat + dy) }))) as { features?: Entite[] };
  const parcelles = (d.features ?? []).map(enParcelle);
  const plan = planLocal(lon, lat);
  const sous = parcelles.find((p) => dedans(plan([lon, lat]), polygones(p.geometrie, plan)))?.idu ?? null;
  return { parcelles, sous };
}

/** Une adresse trouvée par le géocodeur de la Géoplateforme, avec la précision qu'il donne. */
export interface Adresse {
  libelle: string;
  lon: number;
  lat: number;
  insee: string;
  /** `housenumber` (le numéro), `street` (la rue), `locality` (le lieu-dit) ou `municipality` (la commune). */
  type: string;
  score: number;
}

export async function chercherAdresse(q: string): Promise<Adresse[]> {
  const p = new URLSearchParams({ q, index: 'address', limit: '6' });
  const d = (await lire(`${GEOCODAGE}?${p}`)) as { features?: Entite[] };
  return (d.features ?? []).map((f) => {
    const [lon, lat] = (f.geometry?.coordinates as number[]) ?? [0, 0];
    const pr = f.properties;
    return { libelle: String(pr.label ?? ''), lon, lat, insee: String(pr.citycode ?? ''), type: String(pr.type ?? ''), score: Number(pr.score ?? 0) };
  });
}

/** La précision du géocodage, en clair. */
export const PRECISION: Record<string, string> = {
  housenumber: 'au numéro',
  street: 'à la rue seulement',
  locality: 'au lieu-dit seulement',
  municipality: 'à la commune seulement',
};

// ---------------------------------------------------------------------------
// Ce qui touche la parcelle.

export type Famille = 'zone' | 'prescription' | 'information' | 'servitude';

const COUCHES: { couche: string; famille: Famille }[] = [
  { couche: 'wfs_du:zone_urba', famille: 'zone' },
  { couche: 'wfs_du:secteur_cc', famille: 'zone' },
  { couche: 'wfs_du:prescription_surf', famille: 'prescription' },
  { couche: 'wfs_du:prescription_lin', famille: 'prescription' },
  { couche: 'wfs_du:prescription_pct', famille: 'prescription' },
  { couche: 'wfs_du:info_surf', famille: 'information' },
  { couche: 'wfs_du:info_lin', famille: 'information' },
  { couche: 'wfs_du:info_pct', famille: 'information' },
  { couche: 'wfs_sup:assiette_sup_s', famille: 'servitude' },
  { couche: 'wfs_sup:assiette_sup_l', famille: 'servitude' },
  { couche: 'wfs_sup:assiette_sup_p', famille: 'servitude' },
];

/** Un document tel que l'API du Géoportail de l'urbanisme le décrit. */
export interface Document {
  id: string;
  titre: string | null;
  type: string | null;
  /** L'état juridique et l'état d'application, tels que publiés (`APPROVED`, `EN_VIGUEUR`…). */
  etat: string | null;
  application: string | null;
  publication: string | null;
  producteur: string | null;
  /** La catégorie d'une servitude : son code, son libellé et la fiche du Géoportail. */
  categorie: { code: string; libelle: string; court: string | null; fiche: string | null } | null;
  /** Le nom du document dans la Géoplateforme, et la date de sa dernière procédure qu'il porte. */
  nom: string | null;
  procedure: string | null;
}

export interface Element {
  famille: Famille;
  /** Le libellé publié, tel quel. */
  libelle: string;
  /** Le libellé long d'une zone, quand il dit autre chose que le libellé court. */
  libelleLong: string | null;
  /** Le type CNIG en clair (zone, prescription, information), ou la catégorie de servitude. */
  type: TypeCnig | { code: string; libelle: string; references: string } | null;
  contact: Contact;
  /** La pièce qui le décrit, et la page quand le document la donne. */
  piece: string | null;
  page: number | null;
  document: string;
}

export interface Lecture {
  parcelle: Parcelle;
  elements: Element[];
  documents: Map<string, Document>;
  /** Les couches que le service n'a pas rendues : la liste est alors incomplète, et la page le dit. */
  manquantes: string[];
  lueLe: string;
}

const texte = (v: unknown) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

function piece(p: Proprietes, champ: 'nomfic' | 'fichier'): string | null {
  const nom = texte(p[champ]);
  if (nom) return `${ANNEXES}/${texte(p.partition)}/${texte(p.gpu_doc_id)}/${nom}`;
  const url = texte(p.urlfic ?? p.urlreg);
  return /^https?:\/\//.test(url) ? url : null;
}

/** La date AAAAMMJJ que porte un identifiant de document, en AAAA-MM-JJ. */
export function dateProcedure(nom: string | null | undefined): string | null {
  const m = /_(\d{4})(\d{2})(\d{2})(?:_|$)/.exec(nom ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function element(famille: Famille, couche: string, p: Proprietes, c: Contact): Element {
  const libelle = texte(p.libelle) || texte(p.nomass) || '?';
  let type: Element['type'] = null;
  let libelleLong: string | null = null;
  if (famille === 'zone' && couche.endsWith('secteur_cc')) {
    const t = texte(p.typesect).padStart(2, '0');
    type = TYPES_SECTEUR[t] ? { code: t, libelle: TYPES_SECTEUR[t], references: '' } : null;
  } else if (famille === 'zone') {
    const z = typeZone(p.typezone);
    type = z ? { code: z.code, libelle: `zone ${z.libelle.toLowerCase()}`, references: z.definition } : null;
    // Le libellé long, sans le libellé court qu'il répète souvent (« UA : Zone urbaine dense »).
    const long = texte(p.libelong).replace(new RegExp(`^${libelle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '');
    libelleLong = long && long !== libelle ? long : null;
  } else if (famille === 'prescription') type = typePrescription(p);
  else if (famille === 'information') type = typeInformation(p);
  const url = piece(p, famille === 'servitude' ? 'fichier' : 'nomfic');
  const page = url && /#page=(\d+)/.exec(url);
  return { famille, libelle, libelleLong, type, contact: c, piece: url, page: page ? Number(page[1]) : null, document: texte(p.gpu_doc_id) };
}

async function documentGpu(id: string): Promise<Document> {
  const d = (await lire(`${API_GPU}/${id}/details`)) as Record<string, unknown>;
  const cat = d.supCategory as Record<string, unknown> | null;
  const nom = texte(d.originalName) || null;
  return {
    id,
    titre: texte(d.title) || null,
    type: texte(d.type) || null,
    etat: texte(d.legalStatus) || null,
    application: texte(d.effectiveStatus) || null,
    publication: texte(d.publicationDate) || null,
    producteur: texte(d.producer) || null,
    categorie: cat ? { code: texte(cat.name), libelle: texte(cat.libelle), court: texte(cat.libelleCourt) || null, fiche: texte(cat.urlFiche) || null } : null,
    nom,
    procedure: dateProcedure(nom),
  };
}

/** Des géométries du même genre en une seule : polygones, lignes ou points. */
export function reunir(geos: Geometrie[]): Geometrie {
  const ok = geos.filter((g): g is NonNullable<Geometrie> => !!g);
  if (!ok.length) return null;
  const genre = ok[0].type.replace('Multi', '');
  const parts = ok.flatMap((g) => (g.type.startsWith('Multi') ? (g.coordinates as unknown[]) : [g.coordinates]));
  return { type: `Multi${genre}`, coordinates: parts };
}

/** L'ordre d'affichage : la parcelle d'abord couverte, puis en partie, puis au bord. */
const POIDS: Record<Contact, number> = { toute: 0, partie: 1, traverse: 2, limite: 3, bord: 4 };

export async function lireParcelle(parcelle: Parcelle): Promise<Lecture> {
  const gab = gabarit(parcelle.geometrie);
  const brut = polygones(parcelle.geometrie, (c) => [c[0], c[1]]).flat(2);
  const [lon0, lat0, lon1, lat1] = cadreDe(brut);
  // Un mètre de marge, pour les lignes et les points dessinés sur la limite.
  const m = 1.5e-5;
  const cadre = bbox(lon0 - m, lat0 - m, lon1 + m, lat1 + m);
  const manquantes: string[] = [];
  // Quatre requêtes à la fois au plus : le service coupe plus volontiers quand on lui en envoie onze.
  const reponses = await parPaquets(COUCHES, 4, async ({ couche, famille }) => {
    try {
      const d = (await lire(urlWfs(couche, { BBOX: cadre }))) as { features?: Entite[] };
      return { couche, famille, entites: d.features ?? [] };
    } catch {
      manquantes.push(couche);
      return { couche, famille, entites: [] as Entite[] };
    }
  });
  // Une même zone découpée en plusieurs morceaux, ou rendue par deux couches : une seule ligne, et le contact
  // calculé sur la réunion des morceaux — deux morceaux qui se partagent la parcelle la couvrent ensemble.
  const groupes = new Map<string, { famille: Famille; couche: string; p: Proprietes; geos: Geometrie[] }>();
  for (const { couche, famille, entites } of reponses)
    for (const e of entites) {
      const p = e.properties;
      const cle = [famille, couche.replace(/_(surf|lin|pct|s|l|p)$/, ''), texte(p.gpu_doc_id), texte(p.libelle) || texte(p.idgen) || texte(p.idass), texte(p.typezone ?? p.typepsc ?? p.typeinf ?? p.suptype), texte(p.stypepsc ?? p.stypeinf), texte(p.nomfic ?? p.fichier), e.geometry?.type.replace('Multi', '') ?? ''].join('|');
      const g = groupes.get(cle) ?? groupes.set(cle, { famille, couche, p, geos: [] }).get(cle)!;
      g.geos.push(e.geometry);
    }
  const elements: Element[] = [];
  for (const { famille, couche, p, geos } of groupes.values()) {
    const c = contact(gab, reunir(geos));
    if (c) elements.push(element(famille, couche, p, c));
  }
  elements.sort((a, b) => POIDS[a.contact] - POIDS[b.contact] || a.libelle.localeCompare(b.libelle, 'fr', { numeric: true }));
  const documents = new Map<string, Document>();
  await Promise.all(
    [...new Set(elements.map((e) => e.document).filter(Boolean))].map(async (id) => {
      try {
        documents.set(id, await documentGpu(id));
      } catch {
        // Le document reste sans état : la page dit qu'il n'a pas pu être lu.
      }
    }),
  );
  // Une servitude prend le libellé de sa catégorie, tel que le Géoportail le donne.
  for (const e of elements) {
    const cat = e.famille === 'servitude' ? documents.get(e.document)?.categorie : null;
    if (cat) e.type = { code: cat.code, libelle: cat.libelle, references: cat.fiche ?? '' };
  }
  return { parcelle, elements, documents, manquantes, lueLe: new Date().toISOString() };
}

/** Les états que publie l'API du Géoportail, en clair ; un état inconnu est montré tel quel. */
export const ETATS: Record<string, string> = {
  APPROVED: 'approuvé',
  EN_VIGUEUR: 'en vigueur',
};

export const FAMILLES: Record<Famille, { titre: string; aide: string }> = {
  zone: {
    titre: 'Zones',
    aide: 'La zone dit quel chapitre du règlement s’applique. Il se lit avec les dispositions générales et le lexique du même règlement.',
  },
  prescription: {
    titre: 'Prescriptions',
    aide: 'Une prescription ajoute une règle sur une partie du territoire, par-dessus celle de la zone : un emplacement réservé, un élément de patrimoine, une limite de constructibilité.',
  },
  information: {
    titre: 'Informations',
    aide: 'Une information signale un périmètre défini par un autre texte, que le document annexe : un droit de préemption, un secteur exposé au bruit ou au plomb.',
  },
  servitude: {
    titre: 'Servitudes d’utilité publique',
    aide: 'Une servitude d’utilité publique est instituée par l’État ou un gestionnaire de réseau, hors du PLU, et s’impose à lui. Toutes ne sont pas numérisées.',
  },
};

export const CONTACTS: Record<Contact, string> = {
  toute: 'couvre toute la parcelle',
  partie: 'couvre une partie de la parcelle',
  bord: `ne touche qu’une bande de ${BANDE} mètres au plus le long de la limite — souvent un écart entre le dessin du document et celui du cadastre`,
  traverse: 'passe sur la parcelle',
  limite: 'longe la limite de la parcelle, à moins d’un mètre',
};
