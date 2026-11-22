/**
 * La longueur de voirie retenue pour la dotation globale de fonctionnement,
 * commune par commune.
 *
 * Depuis la loi de finances pour 2025 (article 178, qui modifie l'article
 * L. 2334-22 du code général des collectivités territoriales), ce n'est plus
 * la voirie classée dans le domaine public communal que la commune déclarait :
 * la DGCL s'appuie sur les voies que l'IGN recense dans la BD TOPO, selon les
 * catégories de l'article R. 2334-8-1 — routes à une ou deux chaussées,
 * bretelles, ronds-points ; ni chemins, ni sentiers, ni routes empierrées. La
 * longueur entre dans le calcul de la dotation de solidarité rurale.
 *
 * **La source.** Le site des dotations de la DGCL refuse les connexions
 * automatiques (constaté depuis l'environnement de développement et depuis le
 * runner, 21 novembre 2026). L'IGN publie, sous Licence Ouverte 2.0, la couche
 * des tronçons retenus pour l'année (`DGF_AAAA_:_voirie-retenue-communes` sur
 * la Géoplateforme, jeu « VOIRIE DGF » sur data.gouv.fr) : 8,4 millions de
 * tronçons, sans code commune.
 *
 * **Le calcul.** Département par département, les tronçons du cadre sont lus
 * par pages ; chaque morceau entre deux sommets est mesuré à la surface de la
 * Terre et va à la commune où tombe son milieu, d'après les contours que
 * `contours-emettre.ts` a écrits. Ces contours sont simplifiés : contre une
 * découpe exacte sur le contour officiel, l'écart va de −1,9 % à +0,4 % sur
 * quatre communes de l'Allier (21 novembre 2026). La page le dit approché, en
 * kilomètres arrondis.
 *
 * La couche change une fois par an : la longueur n'est recalculée qu'à la
 * parution d'une nouvelle année.
 *
 * Lancé seul — `tsx scripts/voirie-emettre.ts [départements…]` —, il réécrit
 * `public/territoires/dep/XX-voirie.json`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cadreDe, contoursDesCommunes, dedans, type Anneau } from './espaces-emettre.ts';
import { indisponible } from './echecs.ts';
import { ecrireParDepartement } from './par-departement.ts';

const WFS = 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0';
const PAGE = 5000;
/** Les contours sont en dix-millièmes de degré (`espaces-emettre.ts`). */
const ECHELLE = 10_000;

export interface Voirie {
  annee: number;
  maj: string;
  /** Longueur de voirie retenue, en mètres. */
  communes: Map<string, number>;
}

/** La distance entre deux points [longitude, latitude], en mètres. */
export function haversine(a: number[], b: number[]): number {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r;
  const dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

/** La dernière année publiée, d'après les couches que la Géoplateforme annonce. */
export function derniereAnnee(capacites: string): number | null {
  const annees = [...capacites.matchAll(/<Name>DGF_(20\d\d)_:_voirie-retenue-communes<\/Name>/g)].map((m) => Number(m[1]));
  return annees.length ? Math.max(...annees) : null;
}

/** L'année déjà calculée, si tous les départements l'ont. */
function dejaCalculee(sortie: string, annee: number): boolean {
  const dossier = join(sortie, 'dep');
  const deps = readdirSync(dossier).filter((f) => /^([0-9]{2,3}|2[AB])\.json$/.test(f));
  return deps.length > 0 && deps.every((f) => {
    const v = join(dossier, f.replace('.json', '-voirie.json'));
    try {
      return existsSync(v) && (JSON.parse(readFileSync(v, 'utf8')) as { annee?: number }).annee === annee;
    } catch {
      return false;
    }
  });
}

type Zone = { code: string; anneaux: Anneau[]; cadre: [number, number, number, number] };

/** Ajoute à chaque commune la longueur des morceaux de ces lignes dont le milieu tombe chez elle. */
export function repartir(lignes: number[][][], zones: Zone[], parCommune: Map<string, number>): void {
  for (const l of lignes) {
    let derniere: Zone | null = null;
    for (let i = 1; i < l.length; i++) {
      const x = ((l[i - 1][0] + l[i][0]) / 2) * ECHELLE;
      const y = ((l[i - 1][1] + l[i][1]) / 2) * ECHELLE;
      const dans = (z: Zone) => x >= z.cadre[0] && x <= z.cadre[2] && y >= z.cadre[1] && y <= z.cadre[3] && dedans(x, y, z.anneaux);
      // Les morceaux d'un tronçon tombent presque toujours dans la même commune : on la teste d'abord.
      const z: Zone | undefined = derniere && dans(derniere) ? derniere : zones.find(dans);
      if (!z) continue;
      parCommune.set(z.code, (parCommune.get(z.code) ?? 0) + haversine(l[i - 1], l[i]));
      derniere = z;
    }
  }
}

export async function collecterVoirie(
  sortie: string,
  dire: (m: string) => void,
  seuls?: string[],
  aujourdhui = new Date().toISOString().slice(0, 10),
): Promise<Voirie | null> {
  let annee: number | null = null;
  try {
    annee = derniereAnnee(await (await fetch(`${WFS}&REQUEST=GetCapabilities`, { signal: AbortSignal.timeout(120_000) })).text());
  } catch (e) {
    return indisponible(dire, `Voirie : la Géoplateforme n’a pas répondu (${String(e).slice(0, 80)}).`);
  }
  if (!annee) return indisponible(dire, 'Voirie : aucune couche DGF_AAAA_:_voirie-retenue-communes sur la Géoplateforme.');
  if (!seuls && dejaCalculee(sortie, annee)) {
    dire(`  Voirie : déjà calculée pour la DGF ${annee} ; rien à refaire.`);
    return null;
  }
  const contours = contoursDesCommunes(sortie);
  if (contours.size === 0) throw new Error('Voirie : les contours des communes manquent — lancer contours-emettre.ts d’abord');
  const parDep = new Map<string, Zone[]>();
  for (const [code, anneaux] of contours) {
    const dep = code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2);
    if (seuls && !seuls.includes(dep)) continue;
    (parDep.get(dep) ?? parDep.set(dep, []).get(dep)!).push({ code, anneaux, cadre: cadreDe(anneaux) });
  }
  const couche = `DGF_${annee}_:_voirie-retenue-communes`;
  const communes = new Map<string, number>();
  let troncons = 0;
  for (const [dep, zones] of [...parDep].sort()) {
    const k = zones.reduce((t, z) => [Math.min(t[0], z.cadre[0]), Math.min(t[1], z.cadre[1]), Math.max(t[2], z.cadre[2]), Math.max(t[3], z.cadre[3])], [Infinity, Infinity, -Infinity, -Infinity]).map((v) => v / ECHELLE);
    const avant = communes.size;
    for (let debut = 0; ; debut += PAGE) {
      // En EPSG:4326, le cadre se donne latitude d'abord.
      const url =
        `${WFS}&REQUEST=GetFeature&TYPENAMES=${couche}&OUTPUTFORMAT=application/json&PROPERTYNAME=geom&SORTBY=cleabs` +
        `&COUNT=${PAGE}&STARTINDEX=${debut}&BBOX=${k[1]},${k[0]},${k[3]},${k[2]},urn:ogc:def:crs:EPSG::4326`;
      let page: { features?: { geometry: { type: string; coordinates: unknown } | null }[] } | null = null;
      for (let essai = 0; essai < 6 && !page; essai++) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
          if (r.ok) page = await r.json();
        } catch {
          /* on réessaie */
        }
        if (!page) await new Promise((ok) => setTimeout(ok, 3000 * (essai + 1)));
      }
      if (!page?.features) throw new Error(`Voirie : page ${debut} du département ${dep} refusée six fois`);
      for (const f of page.features) {
        const g = f.geometry;
        if (!g) continue;
        repartir((g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]) as number[][][], zones, communes);
        troncons++;
      }
      if (page.features.length < PAGE) break;
    }
    dire(`  Voirie : ${dep}, ${communes.size - avant} communes`);
  }
  if (!seuls && communes.size < 30_000) {
    return indisponible(dire, `Voirie : ${communes.size} communes seulement, on garde l’ingestion précédente.`);
  }
  dire(`Voirie (DGF ${annee}, IGN) : ${troncons.toLocaleString('fr-FR')} tronçons lus, ${communes.size} communes.`);
  return { annee, maj: aujourdhui, communes: new Map([...communes].map(([c, m]) => [c, Math.round(m)])) };
}

export function ecrireVoirie(sortie: string, v: Voirie): number {
  return ecrireParDepartement(sortie, 'voirie', v.communes, () => ({ maj: v.maj, annee: v.annee }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sortie = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'territoires');
  const seuls = process.argv.slice(2);
  const v = await collecterVoirie(sortie, console.log, seuls.length ? seuls : undefined);
  if (v) console.log(`${ecrireVoirie(sortie, v)} départements écrits.`);
}
