/**
 * Les lieux culturels de chaque commune — bibliothèques, cinémas, musées,
 * scènes, conservatoires, archives, sites patrimoniaux remarquables… —, d'après
 * la base des lieux et équipements culturels (Basilic) que tient le
 * département des études, de la prospective, des statistiques et de la
 * documentation du ministère de la Culture.
 *
 * Ce qui est écarté, et pourquoi :
 *   — les monuments historiques, que la page tient déjà de la base Mérimée ;
 *   — les librairies, papeteries et maisons de la presse : ce sont des
 *     commerces, souvent au nom de leur exploitant (« FAYE JEAN »), donc des
 *     entrepreneurs individuels, que le site ne nomme que d'après SIRENE, une
 *     fois sa diffusion vérifiée (CLAUDE.md, « Les noms dans les données »).
 *
 * Un lieu peut porter le nom de quelqu'un qu'on honore — le cinéma Jean Gabin,
 * la médiathèque Louis Aragon — comme l'école primaire Yves Duteil. Mais la
 * base recense aussi des dépôts de livres chez l'habitant (« Domicile de
 * Mme … »). Le nom n'est donc gardé que s'il ne porte ni civilité ni
 * « domicile », et, s'il ressemble à un nom de personne, que s'il dit aussi ce
 * qu'est le lieu (« médiathèque », « salle », « musée »…). Sinon la page dit le
 * type de lieu sans son nom : un cinéma de moins nommé, plutôt qu'un
 * particulier nommé.
 *
 * La base n'a pas de date de mise à jour régulière : la date de la ressource
 * sur data.gouv.fr est gardée, et la page la donne.
 *
 * Lancé seul — `tsx scripts/culture-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-culture.json`.
 */
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nommeUnePersonne, nommeUnParticulier, estUnPrenomCourant } from '../src/modele/civilites.ts';
import { ressourcesDuJeu } from './donnees-ouvertes.ts';
import { codeCommune, communeDe, ecrireParDepartement, lignesCsv, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

/** Le jeu, par son identifiant : l'adresse du fichier porte l'horodatage de chaque publication. */
export const JEU = '61777ddaa9101d073e5506cd';

/**
 * Les types gardés, dans l'ordre où la page les montre. L'indice est ce que
 * le fichier écrit ; le libellé, ce que la page affiche.
 */
export const TYPES: [string, string][] = [
  ['Bibliothèque', 'Bibliothèque ou médiathèque'],
  ['Cinéma', 'Cinéma'],
  ['Théâtre', 'Théâtre'],
  ['Scène', 'Scène'],
  ['Opéra', 'Opéra'],
  ['Centre de création artistique', 'Centre de création artistique'],
  ['Centre de création musicale', 'Centre de création musicale'],
  ['Musée', 'Musée'],
  ["Centre d'art", 'Centre d’art'],
  ['Centre culturel', 'Centre culturel'],
  ['Conservatoire', 'Conservatoire ou école de musique'],
  ["Établissement d'enseignement supérieur", 'Enseignement supérieur de la culture'],
  ["Service d'archives", 'Service d’archives'],
  ['Espace protégé', 'Site patrimonial remarquable ou espace protégé'],
  ['Parc et jardin', 'Parc ou jardin'],
  ['Lieu de mémoire', 'Lieu de mémoire'],
  ['Lieu archéologique', 'Lieu archéologique'],
];
const INDICE = new Map(TYPES.map(([t], i) => [t, i]));

/** Indice du type, nom (vide quand il n'est pas montré), label ou appellation, nombre d'écrans d'un cinéma (0 sinon). */
export type LieuCulturel = [number, string, string, number];

export interface Culture {
  maj: string;
  /** La date de la ressource sur data.gouv.fr : celle de la version lue. */
  base: string;
  communes: Map<string, LieuCulturel[]>;
}

const MOT_DE_LIEU =
  /biblioth|m[ée]diath|mus[ée]e|cin[ée]|th[ée][aâ]tre|salle|sc[èe]ne|conservatoire|[ée]cole|centre|espace|maison|archives|site|jardin|parc|op[ée]ra|auditorium|lieu|foyer|point lecture|ludo/i;

/** Le nom se montre-t-il ? Voir l'en-tête : jamais un particulier. */
export function nomMontrable(nom: string): boolean {
  if (!nom.trim()) return false;
  if (/\bdomicile\b|\bchez\b/i.test(nom)) return false;
  if (nommeUnePersonne(nom)) return false;
  const ressemble = nommeUnParticulier(nom) || nom.trim().split(/\s+/).every((m) => estUnPrenomCourant(m));
  return !ressemble || MOT_DE_LIEU.test(nom);
}

export async function collecterCulture(
  json: <T>(url: string) => Promise<T>,
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Culture | null> {
  const d = await json<{ data?: { title?: string; url?: string; last_modified?: string }[] }>(
    `https://www.data.gouv.fr/api/2/datasets/${JEU}/resources/?page_size=50`,
  );
  const [adresse] = (await ressourcesDuJeu(JEU, 'base-des-lieux', json, dire)).filter((u) => /\.csv$/i.test(u));
  if (!adresse) {
    dire('Lieux culturels : la base Basilic est introuvable, on garde l’ingestion précédente.');
    return null;
  }
  const base = ((d.data ?? []).find((r) => r.url === adresse)?.last_modified ?? '').slice(0, 10);
  const vers = join(cache, 'basilic.csv');
  await telecharger(adresse, vers);

  const { actuelles, reports } = reportsDuDecoupage();
  const communes = new Map<string, LieuCulturel[]>();
  let col: Record<string, number> | null = null;
  let gardes = 0;
  let sansNom = 0;
  for await (const v of lignesCsv(createReadStream(vers) as unknown as AsyncIterable<Uint8Array>, ';')) {
    if (!col) {
      col = Object.fromEntries(v.map((n, i) => [n.trim(), i]));
      for (const n of ['Nom', 'code_insee', 'Type équipement ou lieu', 'Label et appellation', 'Nombre_ecrans', 'Demographie_AP']) {
        if (col[n] === undefined) throw new Error(`Basilic : colonne « ${n} » absente — le fichier a changé de forme`);
      }
      continue;
    }
    const type = INDICE.get((v[col['Type équipement ou lieu']] ?? '').trim());
    if (type === undefined) continue;
    // La base ne recense que des lieux actifs ; on le vérifie plutôt que de le supposer.
    if ((v[col.Demographie_AP] ?? '').trim() !== 'Actif') continue;
    const brut = communeDe(codeCommune(v[col.code_insee] ?? ''));
    const code = actuelles.has(brut) ? brut : reports.get(brut);
    if (!code) continue;
    const nomBrut = (v[col.Nom] ?? '').replace(/\s+/g, ' ').replace(/^"+|"+$/g, '').trim();
    const nom = nomMontrable(nomBrut) ? nomBrut : '';
    if (!nom) sansNom++;
    const label = (v[col['Label et appellation']] ?? '').trim();
    const ecrans = type === INDICE.get('Cinéma') ? Number.parseInt(v[col.Nombre_ecrans] ?? '', 10) || 0 : 0;
    const l = communes.get(code) ?? [];
    l.push([type, nom, label, ecrans]);
    communes.set(code, l);
    gardes++;
  }
  if (gardes < 20000) {
    dire(`Lieux culturels : ${gardes} lieux seulement, on garde l’ingestion précédente.`);
    return null;
  }
  for (const l of communes.values()) l.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], 'fr'));
  dire(
    `Lieux culturels : ${gardes.toLocaleString('fr-FR')} lieux dans ${communes.size.toLocaleString('fr-FR')} communes, ` +
      `dont ${sansNom.toLocaleString('fr-FR')} montrés sans leur nom.`,
  );
  return { maj: new Date().toISOString().slice(0, 10), base, communes };
}

export function ecrireCulture(sortie: string, c: Culture): number {
  return ecrireParDepartement(sortie, 'culture', c.communes, () => ({ maj: c.maj, base: c.base, types: TYPES.map(([, l]) => l) }));
}

// Lancé seul : télécharge dans `.cache/` s'il n'y est pas, et réécrit les fichiers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { cache, telecharger, lireJson, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const c = await collecterCulture(lireJson as <T>(url: string) => Promise<T>, telecharger, cache, console.log);
  if (c) console.log(`${ecrireCulture(sortie, c)} départements écrits.`);
}
