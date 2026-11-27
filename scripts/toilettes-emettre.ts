/**
 * Les toilettes publiques, d'après OpenStreetMap.
 *
 * Aucune liste nationale officielle n'existe : data.gouv.fr ne publie que des
 * jeux de villes et de métropoles (Paris, Nantes, Lyon…), chacun à sa forme et
 * sous sa licence (recherche du 26 novembre 2026). OpenStreetMap, base
 * collaborative, est la seule source qui couvre toute la France, avec les
 * attributs qui servent : `fee` (payant ou gratuit), `access` (public, réservé
 * à la clientèle, privé), `wheelchair`, `changing_table`, `opening_hours`.
 * Sa couverture est inégale : l'absence d'un point ne dit pas qu'il n'y a pas
 * de toilettes, et la page le dit.
 *
 * **Licence : ODbL.** Une base dérivée se republie sous ODbL : les fichiers
 * `dep/XX-toilettes.json` sont à part, déclarés comme tels dans
 * `contenu/veille.yaml`, et la page cite « © les contributeurs
 * d'OpenStreetMap » avec le lien vers chaque objet.
 *
 * Une seule requête Overpass pour la France entière, sur le premier serveur
 * qui répond ; les toilettes à accès privé (`access=private` ou `no`) ne sont
 * pas reprises. Chaque point est rattaché à sa commune par ses contours (ceux
 * qu'écrit la collecte des espaces naturels). Si aucun serveur ne répond, la
 * collecte renonce et laisse les fichiers précédents.
 *
 * Lancé seul — `tsx scripts/toilettes-emettre.ts [sud,ouest,nord,est]` —, il
 * réécrit les fichiers ; avec un rectangle, il ne lit que lui (pour l'essai).
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contoursDesCommunes, ECHELLE } from './espaces-emettre.ts';
import { localisateur } from './localiser.ts';
import { ecrireParDepartement } from './par-departement.ts';
import { indisponible } from './echecs.ts';

/** Les serveurs Overpass, dans l'ordre ; `ROUAGES_OVERPASS` en impose un (l'essai local passe mieux par le second). */
export const SERVEURS = process.env.ROUAGES_OVERPASS
  ? [process.env.ROUAGES_OVERPASS]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/** Gratuit, payant, réservé à la clientèle, ou non précisé. */
export type Acces = 'gratuit' | 'payant' | 'clientele' | 'inconnu';

/**
 * Une toilette : x et y en dix-millièmes de degré, l'accès, l'accessibilité en fauteuil
 * (`yes`, `limited`, `no` ou vide), une table à langer (1, 0 ou null), les horaires tels que
 * publiés, et l'objet OpenStreetMap (« n123 », « w456 »).
 */
export type Toilette = [number, number, Acces, string, 0 | 1 | null, string, string];

export interface Toilettes {
  maj: string;
  communes: Map<string, Toilette[]>;
}

type Element = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

export function acces(tags: Record<string, string>): Acces | null {
  const a = (tags.access ?? '').toLowerCase();
  if (a === 'private' || a === 'no') return null;
  if (a === 'customers') return 'clientele';
  const f = (tags.fee ?? '').toLowerCase();
  if (f === 'no') return 'gratuit';
  if (f === 'yes' || /^\d/.test(f)) return 'payant';
  return 'inconnu';
}

async function requete(rectangle: string | null, dire: (m: string) => void): Promise<Element[]> {
  const zone = rectangle ? `(${rectangle})` : '(area.f)';
  const q = `[out:json][timeout:900][maxsize:536870912];${rectangle ? '' : 'area["ISO3166-1"="FR"]["admin_level"="2"]->.f;'}nwr["amenity"="toilets"]${zone};out center tags;`;
  let derniere: unknown;
  for (const serveur of SERVEURS) {
    for (let essai = 0; essai < 2; essai++) {
      try {
        const r = await fetch(serveur, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'rouages.fr (collecte de données ouvertes)' },
          body: `data=${encodeURIComponent(q)}`,
          signal: AbortSignal.timeout(1_000_000),
        });
        if (!r.ok) throw new Error(`${serveur} : ${r.status}`);
        const d = (await r.json()) as { elements?: Element[]; remark?: string };
        if (d.remark && /error|timed out/i.test(d.remark)) throw new Error(`${serveur} : ${d.remark}`);
        return d.elements ?? [];
      } catch (e) {
        derniere = e;
        dire(`  Overpass, ${serveur} : ${(e as Error).message}`);
        await new Promise((ok) => setTimeout(ok, 30_000 * (essai + 1)));
      }
    }
  }
  throw derniere;
}

export async function collecterToilettes(sortie: string, dire: (m: string) => void, rectangle: string | null = null): Promise<Toilettes | null> {
  const contours = contoursDesCommunes(sortie);
  if (!contours.size) return indisponible(dire, 'Toilettes : contours des communes absents, la collecte des espaces naturels doit passer avant.');
  const communeDu = localisateur(contours);
  let elements: Element[];
  try {
    elements = await requete(rectangle, dire);
  } catch (e) {
    return indisponible(dire, `Toilettes (OpenStreetMap) : aucun serveur Overpass n’a répondu (${(e as Error).message}).`);
  }
  if (!rectangle && elements.length < 10000) return indisponible(dire, `Toilettes : ${elements.length} objets seulement pour la France, on garde l’ingestion précédente.`);
  const communes = new Map<string, Toilette[]>();
  let prives = 0;
  let hors = 0;
  for (const e of elements) {
    const tags = e.tags ?? {};
    const a = acces(tags);
    if (!a) {
      prives++;
      continue;
    }
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const x = Math.round(lon * ECHELLE);
    const y = Math.round(lat * ECHELLE);
    const code = communeDu(x, y);
    if (!code) {
      hors++;
      continue;
    }
    const langer = tags.changing_table === 'yes' ? 1 : tags.changing_table === 'no' ? 0 : null;
    const fauteuil = ['yes', 'limited', 'no'].includes(tags.wheelchair ?? '') ? tags.wheelchair! : '';
    const t: Toilette = [x, y, a, fauteuil, langer, (tags.opening_hours ?? '').slice(0, 80), `${e.type[0]}${e.id}`];
    communes.set(code, [...(communes.get(code) ?? []), t]);
  }
  const n = [...communes.values()].reduce((s, l) => s + l.length, 0);
  dire(`Toilettes (OpenStreetMap) : ${n.toLocaleString('fr-FR')} dans ${communes.size.toLocaleString('fr-FR')} communes ; ${prives} privées écartées, ${hors} hors des communes.`);
  return { maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireToilettes(sortie: string, t: Toilettes): number {
  return ecrireParDepartement(sortie, 'toilettes', t.communes, () => ({
    maj: t.maj,
    licence: 'ODbL 1.0 — Open Database License, https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: '© les contributeurs d’OpenStreetMap',
  }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sortie = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'territoires');
  const t = await collecterToilettes(sortie, console.log, process.argv[2] ?? null);
  if (t) console.log(`${ecrireToilettes(sortie, t)} départements écrits.`);
}
