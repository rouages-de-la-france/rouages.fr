/**
 * Les zones à faibles émissions (ZFE) en vigueur, et les communes qu'elles
 * couvrent : la base nationale consolidée du point d'accès national aux
 * données de transport (transport.data.gouv.fr).
 *
 * **La licence.** La base est publiée sous ODbL. Ce qu'on en tire — la liste
 * des communes couvertes par chaque zone — est une base dérivée : elle est
 * écrite dans un fichier à part, `public/territoires/zfe.json`, qui porte la
 * licence, et la page la nomme. Le reste des données de rouages.fr n'est pas
 * concerné. *À valider par un avocat* (`docs/juridique` du dépôt privé).
 *
 * **Le statut légal.** La suppression des ZFE votée au printemps 2026 a été
 * censurée par le Conseil constitutionnel (21 mai 2026) : elles restent en
 * vigueur. Si une loi les suspend, on cesse de les afficher, et seule une note
 * le dit dans les sources.
 *
 * **Ce qui est montré, et ce qui ne l'est pas.** Une zone est en vigueur si sa
 * date de début est passée et sa date de fin, quand elle en a une, ne l'est
 * pas. La page dit que la commune est couverte, en tout ou en partie, depuis
 * quand, et renvoie au site de la collectivité. Elle ne reprend **pas** les
 * vignettes Crit'Air interdites : la base n'est mise à jour qu'au fil des
 * déclarations, et un calendrier dépassé dirait une règle qui n'est plus la
 * bonne. Seul le cas d'une zone sans aucune restriction déclarée (« NC » pour
 * tous les véhicules) est dit, tel quel.
 *
 * La part de la commune couverte est approchée, par une grille de points,
 * comme pour les espaces naturels.
 *
 * Lancé seul : `tsx scripts/zfe-emettre.ts`. Il demande les contours des
 * communes (`contours-emettre.ts`).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anneauxDe, cadreDe, contoursDesCommunes, dedans, distanceAuBord, type Anneau } from './espaces-emettre.ts';
import { indisponible } from './echecs.ts';
import { lignesCsv, telechargerSiAbsent } from './par-departement.ts';
import { ressourcesQuiPortent } from './ressource-motif.ts';

const JEU = 'base-nationale-consolidee-des-zones-a-faibles-emissions';
const IDENTIFIANTS = 'https://raw.githubusercontent.com/etalab/transport-site/master/apps/transport/priv/zfe_ids.csv';

/** Une zone couvrant la commune : collectivité, part de la commune (0 : moins de 1 %), date de début, 1 si aucune restriction n'est déclarée, site d'information. */
export type ZoneCommune = [string, number, string, 0 | 1, string];

export interface Zfe {
  maj: string;
  communes: Record<string, ZoneCommune[]>;
}

type Proprietes = Record<string, unknown>;
const texte = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const lien = (v: unknown) => (/^https?:\/\//.test(texte(v)) ? texte(v) : '');

export async function collecterZfe(
  sortie: string,
  telecharger: (url: string, vers: string) => Promise<void>,
  json: <T>(url: string) => Promise<T>,
  cache: string,
  dire: (m: string) => void,
  aujourdhui = new Date().toISOString().slice(0, 10),
): Promise<Zfe | null> {
  if (!readdirSync(join(sortie, 'dep')).some((n) => n.endsWith('-contours.json'))) {
    throw new Error('ZFE : les contours des communes manquent — lancer contours-emettre.ts d’abord');
  }
  type Ressource = { title?: string; url?: string };
  let ressources: Ressource[] = [];
  try {
    ressources = (await json<{ data?: Ressource[] }>(`https://www.data.gouv.fr/api/2/datasets/${JEU}/resources/?page_size=20`)).data ?? [];
  } catch {
    return indisponible(dire, 'ZFE : la base nationale n’a pas répondu.');
  }
  const aires = ressourcesQuiPortent(ressources.filter((r) => r.url), 'aires')[0]?.url;
  if (!aires) return indisponible(dire, 'ZFE : le fichier des aires est introuvable.');
  const fichier = join(cache, `zfe-aires-${aujourdhui}.geojson`);
  await telecharger(aires, fichier);
  const fichierIds = join(cache, `zfe-ids-${aujourdhui}.csv`);
  await telecharger(IDENTIFIANTS, fichierIds);

  // Le nom de la collectivité qui porte chaque zone, par le SIREN en tête de l'identifiant.
  const porteurs = new Map<string, string>();
  let entete: string[] | null = null;
  for await (const l of lignesCsv([readFileSync(fichierIds, 'utf8')], ';')) {
    if (!entete) {
      entete = l;
      continue;
    }
    const v = (c: string) => (l[entete!.indexOf(c)] ?? '').trim();
    if (v('siren')) porteurs.set(v('siren'), v('epci_principal'));
  }
  // À défaut, le nom de l'intercommunalité au découpage administratif.
  const epci = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('@etalab/decoupage-administratif/data/epci.json'), 'utf8')) as { code: string; nom: string }[];
  for (const e of epci) if (!porteurs.has(e.code)) porteurs.set(e.code, e.nom);

  const { features } = JSON.parse(readFileSync(fichier, 'utf8')) as { features: { properties: Proprietes; geometry: { type: string; coordinates: unknown } | null }[] };
  const VEHICULES = ['vp_critair', 'vul_critair', 'pl_critair', 'deux_rm_critair'];
  const zones = features
    .map((f) => {
      const p = f.properties;
      const debut = texte(p.date_debut);
      const fin = texte(p.date_fin) || texte(p.date_fin_init);
      const anneaux = anneauxDe(f.geometry, 3);
      const siren = /^(\d{9})/.exec(texte(p.id))?.[1] ?? '';
      return {
        enVigueur: !!debut && debut <= aujourdhui && (!fin || fin >= aujourdhui),
        porteur: porteurs.get(siren) ?? (texte(p.Name) || texte(p.nom) || ''),
        debut,
        sansRestriction: VEHICULES.every((k) => texte(p[k]) === 'NC') ? 1 : 0,
        site: lien(p.url_site_information) || lien(p.url_site) || lien(p.url_site_informations) || lien(p.url_arrete),
        anneaux,
        cadre: cadreDe(anneaux),
      } as const;
    })
    .filter((z) => z.anneaux.length > 0);
  const actives = zones.filter((z) => z.enVigueur);
  if (zones.length < 15) return indisponible(dire, `ZFE : ${zones.length} zones seulement dans la base, on garde l’ingestion précédente.`);

  const communes: Record<string, ZoneCommune[]> = {};
  const MARGE = 5;
  for (const [code, anneaux] of contoursDesCommunes(sortie)) {
    const cadre = cadreDe(anneaux);
    const touchees = actives.filter((z) => z.cadre[0] <= cadre[2] && z.cadre[2] >= cadre[0] && z.cadre[1] <= cadre[3] && z.cadre[3] >= cadre[1]);
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
    // Seuls les points au cœur de la commune comptent : une zone qui suit la limite voisine n'y mord pas.
    const coeur = points.filter(([x, y]) => distanceAuBord(x, y, anneaux) > MARGE);
    const l: ZoneCommune[] = [];
    // Une collectivité peut déclarer plusieurs zones successives ou emboîtées : on garde la plus étendue ici.
    const parPorteur = new Map<string, ZoneCommune>();
    for (const z of touchees) {
      const dans = (a: Anneau[]) => (pt: [number, number]) => dedans(pt[0], pt[1], a);
      if (!coeur.some(dans(z.anneaux))) continue;
      const part = Math.round((100 * points.filter(dans(z.anneaux)).length) / points.length);
      const deja = parPorteur.get(z.porteur);
      if (!deja || part > deja[1]) parPorteur.set(z.porteur, [z.porteur, Math.min(part, 100), z.debut, z.sansRestriction as 0 | 1, z.site]);
    }
    l.push(...parPorteur.values());
    if (l.length) communes[code] = l;
  }
  dire(`ZFE : ${zones.length} zones dans la base, ${actives.length} en vigueur, ${Object.keys(communes).length} communes couvertes.`);
  return { maj: aujourdhui, communes };
}

/** Un fichier à part, sous la licence de la base dont il dérive. */
export function ecrireZfe(sortie: string, z: Zfe): void {
  writeFileSync(
    join(sortie, 'zfe.json'),
    JSON.stringify({
      licence: 'ODbL 1.0 — Open Database License, https://opendatacommons.org/licenses/odbl/1-0/',
      source: 'Base nationale consolidée des zones à faibles émissions, transport.data.gouv.fr',
      maj: z.maj,
      c: z.communes,
    }),
  );
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const z = await collecterZfe(sortie, telecharger, lireJson as <T>(url: string) => Promise<T>, cache, console.log);
  if (z) ecrireZfe(sortie, z);
}
