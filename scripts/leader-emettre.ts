/**
 * Les groupes d'action locale (GAL) LEADER 2023-2027 de chaque commune.
 *
 * LEADER est une intervention du FEADER que gèrent les conseils régionaux.
 * Aucune liste nationale des communes des GAL n'est publiée (décision du
 * 13 novembre 2026 : collecter région par région, et demander un fichier
 * national). La collecte lit donc ce que chaque Région publie, sous la forme
 * qu'elle a choisie, et le fichier écrit dit quelles régions sont couvertes :
 * une commune d'une région absente n'est pas « hors LEADER », elle est
 * inconnue.
 *
 *   — Hauts-de-France : la liste des communes de chaque GAL, par code INSEE,
 *     y compris celles du Val-d'Oise que compte le GAL du PNR Oise-Pays de
 *     France ;
 *   — Pays de la Loire : les contours des GAL (ODbL). Un GAL réunit des
 *     communes entières : une commune en est quand un point intérieur de son
 *     contour tombe dans celui du GAL. Le fichier régional porte aussi le nom
 *     d'un contact : il n'est pas lu.
 *
 * Chaque région est facultative : celle qui échoue n'emporte pas les autres.
 *
 * Lancé seul — `tsx scripts/leader-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-leader.json`, et a besoin des contours des
 * communes (`scripts/contours-emettre.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { contoursDesCommunes, dedans, ECHELLE, type Anneau } from './espaces-emettre.ts';
import { communeDe, departementDe, ecrireParDepartement, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

export const REGIONS = {
  '32': {
    nom: 'Hauts-de-France',
    jeu: '6712f7222432948efa2feb19',
    url: 'https://sig.hautsdefrance.fr/ext/opendata/Amenagement/gal/gal_com_2023.xlsx',
    licence: 'non précisée',
    deps: ['02', '59', '60', '62', '80'],
  },
  '52': {
    nom: 'Pays de la Loire',
    jeu: '5e322382dee7e71547f5c8fc',
    url: 'https://data.paysdelaloire.fr/api/explore/v2.1/catalog/datasets/groupements-dactions-locales-en-pays-de-la-loire/exports/geojson',
    licence: 'ODbL',
    deps: ['44', '49', '53', '72', '85'],
  },
} as const;

export interface Leader {
  maj: string;
  /** Les régions lues, avec la date de lecture : la couverture que la page affiche. */
  regions: Record<string, string>;
  /** Par commune : le nom de son GAL. */
  communes: Map<string, string>;
}

/** Un point à l'intérieur des anneaux : le milieu du plus large segment intérieur, à mi-hauteur du plus grand anneau. */
export function pointInterieur(anneaux: Anneau[]): [number, number] | null {
  let grand: Anneau | null = null;
  let etendue = -1;
  for (const r of anneaux) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 1; i < r.length; i += 2) {
      y0 = Math.min(y0, r[i]);
      y1 = Math.max(y1, r[i]);
    }
    if (y1 - y0 > etendue) {
      etendue = y1 - y0;
      grand = r;
    }
  }
  if (!grand) return null;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 1; i < grand.length; i += 2) {
    y0 = Math.min(y0, grand[i]);
    y1 = Math.max(y1, grand[i]);
  }
  // Un peu à côté du milieu, pour ne pas tomber pile sur un sommet.
  const y = (y0 + y1) / 2 + 0.37;
  const xs: number[] = [];
  for (const r of anneaux) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1];
      const yj = r[j + 1];
      if (yi > y !== yj > y) xs.push(r[i] + ((r[j] - r[i]) * (y - yi)) / (yj - yi));
    }
  }
  xs.sort((a, b) => a - b);
  let meilleur: [number, number] | null = null;
  let largeur = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > largeur) {
      largeur = xs[k + 1] - xs[k];
      meilleur = [(xs[k] + xs[k + 1]) / 2, y];
    }
  }
  return meilleur;
}

type Geometrie = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };

/** Les anneaux d'une géométrie GeoJSON en degrés, à l'échelle des contours. */
export function anneauxDe(g: Geometrie): Anneau[] {
  const polygones = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][];
  return polygones.flatMap((p) => p.map((r) => r.flatMap(([x, y]) => [Math.round(x * ECHELLE), Math.round(y * ECHELLE)])));
}

export async function collecterLeader(
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  sortie: string,
  dire: (m: string) => void,
): Promise<Leader | null> {
  const { actuelles, reports } = reportsDuDecoupage();
  const actuelle = (brut: string) => {
    const c = communeDe(brut);
    return actuelles.has(c) ? c : (reports.get(c) ?? null);
  };
  const jour = new Date().toISOString().slice(0, 10);
  const communes = new Map<string, string>();
  const regions: Record<string, string> = {};

  // Hauts-de-France : une ligne par commune, le code INSEE lu comme un nombre par le tableur.
  try {
    const r = REGIONS['32'];
    const vers = join(cache, `leader-hauts-de-france-${jour}.xlsx`);
    await telecharger(r.url, vers);
    const wb = XLSX.read(readFileSync(vers));
    const lignes = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const entete = (lignes[0] as string[]).map((x) => String(x ?? '').trim().toLowerCase());
    const iCode = entete.indexOf('insee_com');
    const iGal = entete.indexOf('gal');
    if (iCode < 0 || iGal < 0) throw new Error('colonnes « insee_com » et « gal » introuvables');
    let n = 0;
    for (const l of lignes.slice(1)) {
      const brut = String(l[iCode] ?? '').trim();
      const gal = String(l[iGal] ?? '').trim().replace(/\s+/g, ' ');
      if (!brut || !gal) continue;
      const code = actuelle(brut.padStart(5, '0'));
      // Un GAL peut déborder de la région : celui du PNR Oise-Pays de France compte des communes du Val-d'Oise.
      if (!code) continue;
      communes.set(code, gal);
      n++;
    }
    if (n < 1000) throw new Error(`${n} communes seulement`);
    regions['32'] = jour;
    dire(`LEADER : Hauts-de-France, ${n.toLocaleString('fr-FR')} communes.`);
  } catch (e) {
    dire(`LEADER : Hauts-de-France non lus (${(e as Error).message}).`);
  }

  // Pays de la Loire : les contours des GAL, croisés avec ceux des communes.
  try {
    const r = REGIONS['52'];
    const vers = join(cache, `leader-pays-de-la-loire-${jour}.geojson`);
    await telecharger(r.url, vers);
    const fc = JSON.parse(readFileSync(vers, 'utf8')) as {
      features: { properties: Record<string, unknown>; geometry: Geometrie | null }[];
    };
    const gals = fc.features
      .filter((f) => f.geometry)
      .map((f) => {
        const anneaux = anneauxDe(f.geometry!);
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const a of anneaux)
          for (let i = 0; i < a.length; i += 2) {
            x0 = Math.min(x0, a[i]);
            x1 = Math.max(x1, a[i]);
            y0 = Math.min(y0, a[i + 1]);
            y1 = Math.max(y1, a[i + 1]);
          }
        // Le nom seul : le contact nominatif du fichier n'est pas lu.
        const nom = String(f.properties.gal ?? f.properties['Libellé GAL'] ?? '').trim();
        return { nom, anneaux, cadre: [x0, y0, x1, y1] as const };
      })
      .filter((g) => g.nom);
    if (gals.length < 15) throw new Error(`${gals.length} GAL seulement`);
    const contours = contoursDesCommunes(sortie);
    let n = 0;
    for (const [code, anneaux] of contours) {
      if (!(r.deps as readonly string[]).includes(departementDe(code))) continue;
      const p = pointInterieur(anneaux);
      if (!p) continue;
      const g = gals.find((x) => p[0] >= x.cadre[0] && p[0] <= x.cadre[2] && p[1] >= x.cadre[1] && p[1] <= x.cadre[3] && dedans(p[0], p[1], x.anneaux));
      if (!g) continue;
      communes.set(code, `GAL ${g.nom}`);
      n++;
    }
    if (n < 500) throw new Error(`${n} communes seulement`);
    regions['52'] = jour;
    dire(`LEADER : Pays de la Loire, ${gals.length} GAL, ${n.toLocaleString('fr-FR')} communes.`);
  } catch (e) {
    dire(`LEADER : Pays de la Loire non lus (${(e as Error).message}).`);
  }

  if (Object.keys(regions).length === 0) {
    dire('LEADER : aucune région lue, on garde l’ingestion précédente.');
    return null;
  }
  return { maj: jour, regions, communes };
}

/**
 * Un fichier par département qui a au moins une commune dans un GAL ; chacun
 * porte la liste des régions lues, que la page donne comme couverture.
 */
export function ecrireLeader(sortie: string, l: Leader): number {
  const parCommune = new Map<string, [string]>();
  for (const [code, gal] of l.communes) parCommune.set(code, [gal]);
  return ecrireParDepartement(sortie, 'leader', parCommune, () => ({ maj: l.maj, regions: l.regions }));
}

// Lancé seul : télécharge dans `.cache/` s'il n'y est pas, et réécrit les fichiers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { cache, telecharger, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const l = await collecterLeader(telecharger, cache, sortie, console.log);
  if (l) console.log(`${ecrireLeader(sortie, l)} départements écrits.`);
}
