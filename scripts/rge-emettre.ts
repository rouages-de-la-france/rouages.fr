/**
 * Les entreprises reconnues garantes de l'environnement (RGE), d'après la
 * liste que l'ADEME publie chaque jour (data.gouv.fr, jeu
 * 62bd63b70ff1edf452b83a6b ; données sur data.ademe.fr, Licence Ouverte) : la
 * mention qui ouvre droit aux aides de l'État pour les travaux de rénovation
 * énergétique et d'énergies renouvelables.
 *
 * Décision du 28 novembre 2026, justifiée dans `docs/07-risques.md` et reprise
 * dans `CLAUDE.md` : les entreprises sont nommées et comptées, avec la règle
 * des opérateurs bio — une personne morale par sa dénomination, un
 * entrepreneur individuel par son nom SIRENE s'il est diffusible, sinon (ou
 * pour une opposition de `retraits.yaml`, ou un SIRET inconnu de SIRENE) par
 * son seul SIREN. Ni adresse, ni téléphone, ni courriel.
 *
 * La liste a une ligne par qualification : la collecte regroupe par SIRET.
 * La commune est celle de l'adresse que donne la liste, placée par ses
 * coordonnées dans les contours des communes, sinon par le code postal et le
 * nom de la commune.
 *
 * Lancé seul — `tsx scripts/rge-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-rge.json`.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contoursDesCommunes, ECHELLE } from './espaces-emettre.ts';
import { localisateur } from './localiser.ts';
import { correspondances } from './lieux-emettre.ts';
import { etablissementsSirene } from './sirene-noms.ts';
import { retraits } from './retraits.ts';
import { communeDe, ecrireParDepartement, telechargerSiAbsent } from './par-departement.ts';
import { indisponible } from './echecs.ts';

export const JEU = '62bd63b70ff1edf452b83a6b';
const CHAMPS = ['siret', 'nom_entreprise', 'code_postal', 'commune', 'latitude', 'longitude', 'domaine', 'meta_domaine', 'nom_qualification', 'organisme', 'particulier', 'lien_date_fin', 'url_qualification'];
export const PREMIERE_PAGE = `https://data.ademe.fr/data-fair/api/v1/datasets/liste-des-entreprises-rge-2/lines?size=10000&select=${encodeURIComponent(CHAMPS.join(','))}`;

/** Une qualification : son nom, son organisme, sa date de fin (ISO), le lien vers son attestation. */
export type Qualification = [string, string, string, string];

/**
 * Une entreprise : son nom (null quand elle n'est montrée que par son SIREN), son SIREN, ses
 * domaines de travaux, si elle travaille pour les particuliers (1/0), ses qualifications.
 */
export type EntrepriseRge = [string | null, string, string[], 0 | 1, Qualification[]];

export interface Rge {
  maj: string;
  communes: Map<string, EntrepriseRge[]>;
}

type Ligne = Record<(typeof CHAMPS)[number], unknown>;

const lien = (u: unknown) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : '');

export async function collecterRge(
  sortie: string,
  lireJson: (url: string) => Promise<unknown>,
  texte: (url: string) => Promise<string>,
  dire: (m: string) => void,
): Promise<Rge | null> {
  const contours = contoursDesCommunes(sortie);
  if (!contours.size) return indisponible(dire, 'RGE : contours des communes absents, la collecte des espaces naturels doit passer avant.');
  const communeDu = localisateur(contours);
  const parNom = correspondances();

  const lignes: Ligne[] = [];
  let total = 0;
  for (let url: string | undefined = PREMIERE_PAGE; url; ) {
    const r = (await lireJson(url)) as { total?: number; next?: string; results?: Ligne[] };
    total = r.total ?? total;
    lignes.push(...(r.results ?? []));
    url = r.results?.length ? r.next : undefined;
  }
  if (lignes.length < 100000 || lignes.length < total * 0.99) return indisponible(dire, `RGE : ${lignes.length} lignes lues sur ${total}, on garde l’ingestion précédente.`);

  // Par SIRET : le nom publié, la commune, les domaines et les qualifications.
  type Groupe = { nom: string; code: string | null; domaines: Set<string>; particulier: boolean; qualifs: Map<string, Qualification> };
  const groupes = new Map<string, Groupe>();
  let sansCommune = 0;
  for (const l of lignes) {
    const siret = String(l.siret ?? '').trim();
    if (!/^\d{14}$/.test(siret)) continue;
    let g = groupes.get(siret);
    if (!g) {
      const lat = Number(l.latitude);
      const lon = Number(l.longitude);
      let code = Number.isFinite(lat) && Number.isFinite(lon) && lat && lon ? communeDu(Math.round(lon * ECHELLE), Math.round(lat * ECHELLE)) : null;
      if (!code && l.code_postal && l.commune) code = parNom(String(l.code_postal).padStart(5, '0'), String(l.commune));
      g = { nom: String(l.nom_entreprise ?? '').replace(/\s+/g, ' ').trim(), code, domaines: new Set(), particulier: false, qualifs: new Map() };
      groupes.set(siret, g);
    }
    if (l.domaine) g.domaines.add(String(l.domaine).replace(/\s+/g, ' ').trim());
    if (l.particulier === true || l.particulier === 'true') g.particulier = true;
    const nomQ = String(l.nom_qualification ?? '').trim();
    if (nomQ && !g.qualifs.has(nomQ)) g.qualifs.set(nomQ, [nomQ, String(l.organisme ?? '').trim(), String(l.lien_date_fin ?? '').slice(0, 10), lien(l.url_qualification)]);
  }

  dire(`RGE : ${lignes.length.toLocaleString('fr-FR')} qualifications, ${groupes.size.toLocaleString('fr-FR')} entreprises ; établissements relus à SIRENE…`);
  const sirene = await etablissementsSirene(texte, groupes.keys(), dire);
  const opposes = retraits().entreprises;
  const communes = new Map<string, EntrepriseRge[]>();
  let parSiren = 0;
  for (const [siret, g] of groupes) {
    if (!g.code) {
      sansCommune++;
      continue;
    }
    const e = sirene.get(siret);
    const siren = e?.siren || siret.slice(0, 9);
    // Le refus est le cas par défaut : inconnu de SIRENE, non diffusible, ou opposé.
    let nom: string | null = null;
    if (e && !opposes.has(siren)) nom = e.ei ? e.nom : g.nom || e.nom;
    if (!nom) parSiren++;
    const c = communeDe(g.code);
    const q = [...g.qualifs.values()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
    communes.set(c, [...(communes.get(c) ?? []), [nom, siren, [...g.domaines].sort((a, b) => a.localeCompare(b, 'fr')), g.particulier ? 1 : 0, q]]);
  }
  for (const l of communes.values()) l.sort((a, b) => (a[0] === null ? 1 : 0) - (b[0] === null ? 1 : 0) || (a[0] ?? a[1]).localeCompare(b[0] ?? b[1], 'fr'));
  const n = [...communes.values()].reduce((t, l) => t + l.length, 0);
  dire(
    `RGE (ADEME) : ${n.toLocaleString('fr-FR')} entreprises dans ${communes.size.toLocaleString('fr-FR')} communes, ${parSiren.toLocaleString('fr-FR')} sous leur SIREN seul` +
      (sansCommune ? ` ; ${sansCommune} sans commune retrouvée.` : '.'),
  );
  return { maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireRge(sortie: string, r: Rge): number {
  return ecrireParDepartement(sortie, 'rge', r.communes, () => ({ maj: r.maj }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { sortie, lireJson, obstine } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const r = await collecterRge(sortie, lireJson, async (url) => (await obstine(url)).text(), console.log);
  if (r) console.log(`${ecrireRge(sortie, r)} départements écrits.`);
}
