/**
 * Les forêts de chaque commune : les forêts publiques que l'Office national
 * des forêts gère au titre du régime forestier, et le taux de boisement.
 *
 * **Les forêts publiques.** Une forêt qui appartient à l'État (domaniale), à
 * une commune, une section de commune, un département ou un établissement
 * public relève du régime forestier : sa gestion est confiée à l'ONF, et non
 * au propriétaire seul. Les périmètres sont ceux que l'ONF diffuse sous
 * Licence Ouverte, servis en WFS par la Géoplateforme de l'IGN. Une forêt est
 * rattachée aux communes **sur le territoire desquelles elle se trouve**, ce
 * qui n'est pas forcément sa propriétaire : la forêt communale d'une commune
 * peut s'étendre chez sa voisine, et le nom de la forêt dit à qui elle est.
 *
 * Le croisement suit celui des espaces naturels (`espaces-emettre.ts`) : une
 * grille de points sur la commune, et une forêt n'est retenue que si elle en
 * touche le cœur, à plus de 50 m de la limite — par un point, par trois de ses
 * sommets, ou par son centre si elle est petite. La part est approchée.
 *
 * **Le taux de boisement.** L'Observatoire des forêts de l'IGN publie, commune
 * par commune, la surface boisée d'après la BD Forêt, sa part de la commune,
 * et sa répartition entre feuillus, conifères et peuplements mixtes, avec
 * l'année des prises de vue aériennes dont elle est tirée.
 *
 * Lancé seul — `tsx scripts/forets-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-forets.json`. Il demande les contours des
 * communes (`contours-emettre.ts`).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anneauxDe, cadreDe, contoursDesCommunes, decouper, dedans, distanceAuBord, type Anneau } from './espaces-emettre.ts';
import { indisponible } from './echecs.ts';
import { ecrireParDepartement, telechargerSiAbsent } from './par-departement.ts';

const WFS = 'https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326';
const FORETS = 'ONF.FORETS_PUBLIQUES:ONF_FORETS_PUBLIQUES';
const BOISEMENT = 'ObsForets.Ressources.TxBoisement:taux_boisement_communal';

/** Une forêt publique dans une commune : nom, identifiant ONF, part de la commune (0 : moins de 1 %), 1 si domaniale. */
export type ForetCommune = [string, string, number, 0 | 1];
/** Le boisement : surface boisée (ha), taux (%), feuillus, conifères, mixtes (ha), année des prises de vue. */
export type Boisement = [number, number, number, number, number, number | null];

export interface Forets {
  maj: string;
  communes: Map<string, { f: ForetCommune[]; b: Boisement | null }>;
}

type Entite = { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null };

/** Toutes les entités d'une couche, par pages ; une page refusée est redemandée, plus petite. */
async function entites(couche: string, tri: string, champs: string | null, dire: (m: string) => void): Promise<Entite[]> {
  const toutes: Entite[] = [];
  let taille = champs ? 5000 : 200;
  let echecs = 0;
  for (let debut = 0; ; ) {
    const url = `${WFS}&typeNames=${couche}&sortBy=${tri}&count=${taille}&startIndex=${debut}${champs ? `&propertyName=${champs}` : ''}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!r.ok) throw new Error(`${r.status}`);
      const page = (await r.json()) as { features: Entite[]; numberMatched?: number };
      toutes.push(...page.features);
      debut += page.features.length;
      echecs = 0;
      if (page.features.length < taille || (page.numberMatched !== undefined && debut >= page.numberMatched)) break;
    } catch (e) {
      echecs++;
      if (echecs > 12) throw new Error(`${couche} : page ${debut} refusée douze fois (${String(e)})`);
      if (echecs % 3 === 0 && taille > 10) taille = Math.max(10, taille >> 1);
      await new Promise((ok) => setTimeout(ok, 1500 * echecs));
    }
  }
  dire(`  ${couche} : ${toutes.length} entités`);
  return toutes;
}

async function enCache(cache: string, nom: string, lire: () => Promise<Entite[]>): Promise<Entite[]> {
  const vers = join(cache, `${nom}-${new Date().toISOString().slice(0, 10)}.json`);
  if (existsSync(vers)) return JSON.parse(readFileSync(vers, 'utf8')) as Entite[];
  const e = await lire();
  writeFileSync(vers, JSON.stringify(e));
  return e;
}

export async function collecterForets(sortie: string, cache: string, dire: (m: string) => void): Promise<Forets | null> {
  if (!readdirSync(join(sortie, 'dep')).some((n) => n.endsWith('-contours.json'))) {
    throw new Error('Forêts : les contours des communes manquent — lancer contours-emettre.ts d’abord');
  }
  const communes = contoursDesCommunes(sortie);

  const forets = (await enCache(cache, 'onf-forets-publiques', () => entites(FORETS, 'iidtn_frt', null, dire)))
    .map((e) => {
      const anneaux = anneauxDe(e.geometry, 3);
      return {
        nom: String(e.properties.llib_frt ?? '').replace(/\s+/g, ' ').trim(),
        id: String(e.properties.iidtn_frt ?? ''),
        domaniale: e.properties.cdom_frt === 'OUI' ? 1 : 0,
        anneaux,
        cadre: cadreDe(anneaux),
      } as const;
    })
    .filter((z) => z.anneaux.length > 0 && z.nom);
  if (forets.length < 10000) return indisponible(dire, `Forêts : ${forets.length} forêts publiques seulement, on garde l’ingestion précédente.`);

  // Un index en grille de 0,2° : les forêts dont le cadre touche chaque case.
  const CASE = 2000;
  const grille = new Map<string, number[]>();
  forets.forEach((z, i) => {
    for (let cx = Math.floor(z.cadre[0] / CASE); cx <= Math.floor(z.cadre[2] / CASE); cx++) {
      for (let cy = Math.floor(z.cadre[1] / CASE); cy <= Math.floor(z.cadre[3] / CASE); cy++) {
        const k = `${cx},${cy}`;
        (grille.get(k) ?? grille.set(k, []).get(k)!).push(i);
      }
    }
  });

  const resultat = new Map<string, { f: ForetCommune[]; b: Boisement | null }>();
  const MARGE = 5;
  for (const [code, anneaux] of communes) {
    const cadre = cadreDe(anneaux);
    const candidates = new Set<number>();
    for (let cx = Math.floor(cadre[0] / CASE); cx <= Math.floor(cadre[2] / CASE); cx++) {
      for (let cy = Math.floor(cadre[1] / CASE); cy <= Math.floor(cadre[3] / CASE); cy++) {
        for (const i of grille.get(`${cx},${cy}`) ?? []) candidates.add(i);
      }
    }
    const touchees = [...candidates].filter((i) => {
      const z = forets[i].cadre;
      return z[0] <= cadre[2] && z[2] >= cadre[0] && z[1] <= cadre[3] && z[3] >= cadre[1];
    });
    if (touchees.length === 0) continue;
    let pas = Math.max(1, Math.max(cadre[2] - cadre[0], cadre[3] - cadre[1]) / 28);
    let points: [number, number][] = [];
    for (let essai = 0; essai < 3 && points.length < 200; essai++, pas /= 2) {
      points = [];
      for (let x = cadre[0] + pas / 2; x < cadre[2]; x += pas) {
        for (let y = cadre[1] + pas / 2; y < cadre[3]; y += pas) if (dedans(x, y, anneaux)) points.push([x, y]);
      }
    }
    if (points.length === 0) continue;
    const coeur = points.map(([x, y]) => distanceAuBord(x, y, anneaux) > MARGE);
    const liste: ForetCommune[] = [];
    for (const i of touchees) {
      const z = forets[i];
      const local: Anneau[] = z.anneaux.map((r) => decouper(r, cadre)).filter((r) => r.length >= 6);
      if (local.length === 0) continue;
      let n = 0;
      let nCoeur = 0;
      points.forEach(([x, y], k) => {
        if (!dedans(x, y, local)) return;
        n++;
        if (coeur[k]) nCoeur++;
      });
      let part = Math.round((100 * n) / points.length);
      if (nCoeur === 0) {
        // Rien au cœur de la commune : retenue seulement si trois de ses sommets, ou son centre, y sont bien.
        let sommets = 0;
        for (const r of local) {
          for (let k = 0; k < r.length && sommets < 3; k += 2) {
            if (dedans(r[k], r[k + 1], anneaux) && distanceAuBord(r[k], r[k + 1], anneaux) > MARGE) sommets++;
          }
        }
        const cx = (z.cadre[0] + z.cadre[2]) / 2;
        const cy = (z.cadre[1] + z.cadre[3]) / 2;
        if (sommets < 3 && !(dedans(cx, cy, anneaux) && distanceAuBord(cx, cy, anneaux) > MARGE)) continue;
        part = 0;
      }
      liste.push([z.nom, z.id, Math.min(part, 100), z.domaniale as 0 | 1]);
    }
    if (liste.length) resultat.set(code, { f: liste.sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0], 'fr')), b: null });
  }

  // Le taux de boisement, sans géométrie.
  const champs = 'insee_commune,surface_foret,taux_boisement,feuillus,coniferes,mixtes,annee_pva';
  const boisement = await enCache(cache, 'ign-taux-boisement', () => entites(BOISEMENT, 'insee_commune', champs, dire));
  let boisees = 0;
  for (const e of boisement) {
    const p = e.properties;
    // Les codes des départements 01 à 09 perdent leur zéro dans la couche (« 3165 ») : on le remet.
    const code = String(p.insee_commune ?? '').padStart(5, '0');
    if (!communes.has(code)) continue;
    const n = (k: string) => Math.round(Number(p[k]) || 0);
    const b: Boisement = [n('surface_foret'), n('taux_boisement'), n('feuillus'), n('coniferes'), n('mixtes'), Number(p.annee_pva) || null];
    (resultat.get(code) ?? resultat.set(code, { f: [], b: null }).get(code)!).b = b;
    boisees++;
  }
  const avecForet = [...resultat.values()].filter((v) => v.f.length > 0).length;
  dire(
    `Forêts : ${forets.length.toLocaleString('fr-FR')} forêts publiques, présentes dans ${avecForet.toLocaleString('fr-FR')} communes ; ` +
      `taux de boisement pour ${boisees.toLocaleString('fr-FR')} communes.`,
  );
  return { maj: new Date().toISOString().slice(0, 10), communes: resultat };
}

export function ecrireForets(sortie: string, f: Forets): number {
  return ecrireParDepartement(sortie, 'forets', f.communes, () => ({ maj: f.maj }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const f = await collecterForets(sortie, cache, console.log);
  if (f) console.log(`${ecrireForets(sortie, f)} départements écrits.`);
}
