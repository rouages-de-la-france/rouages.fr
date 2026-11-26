/**
 * Les sites de baignade et leur classement, d'après le rapportage de la saison
 * balnéaire que le ministère chargé de la santé publie sur data.gouv.fr (jeu
 * 57fce28ac751df0e4079df72, Licence Ouverte) : le contrôle sanitaire des
 * agences régionales de santé, au titre de la directive 2006/7/CE.
 *
 * Deux fichiers par saison : la liste des sites (code du site, nom, commune,
 * type d'eau) et leurs caractéristiques (le classement, le lien vers le profil
 * de baignade). La collecte prend la dernière saison qui publie les deux.
 *
 * Le classement est un code. Sa légende n'est pas dans ces fichiers : elle
 * vient du classeur national de la saison 2019, sur le même jeu de données —
 * 1 excellent, 2 bon, 3 suffisant, 4 insuffisant, 5 insuffisance de
 * prélèvements, 6 nouvelle baignade, 7 changement qui affecte la qualité de
 * l'eau. Le code « 0 », que porte un site sur trente en 2025, n'y figure
 * pas et n'est documenté nulle part : ces sites sont repris sans classement.
 * Tout autre code hors de la liste fait renoncer la collecte plutôt que
 * d'afficher un classement inventé.
 *
 * Un site que la liste dit « supprimé » n'est pas repris.
 *
 * Lancé seul — `tsx scripts/baignade-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-baignade.json`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { communeDe, ecrireParDepartement, lignesCsv, telechargerSiAbsent } from './par-departement.ts';
import { indisponible } from './echecs.ts';

export const JEU = '57fce28ac751df0e4079df72';
export const CLASSEMENTS: Record<string, string> = {
  '1': 'excellent',
  '2': 'bon',
  '3': 'suffisant',
  '4': 'insuffisant',
  '5': 'insuffisance de prélèvements',
  '6': 'nouvelle baignade',
  '7': 'changement qui affecte la qualité de l’eau',
};

/** Un site : nom, type d'eau, code de classement (« » s'il n'en a pas), lien vers son profil. */
export type Site = [string, string, string, string];

export interface Baignade {
  maj: string;
  saison: number;
  communes: Map<string, Site[]>;
}

/** UTF-8 si le fichier l'est, sinon Latin-1 : la liste des sites est publiée dans l'un, les caractéristiques dans l'autre. */
function texte(chemin: string): string {
  const octets = readFileSync(chemin);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder('latin1').decode(octets);
  }
}

async function lignes(chemin: string): Promise<Record<string, string>[]> {
  const sortie: Record<string, string>[] = [];
  let entete: string[] | null = null;
  for await (const v of lignesCsv([texte(chemin)], ';')) {
    if (!entete) {
      entete = v.map((x) => x.trim());
      continue;
    }
    sortie.push(Object.fromEntries(entete.map((n, i) => [n, (v[i] ?? '').trim()])));
  }
  return sortie;
}

export async function collecterBaignade(
  lireJson: (url: string) => Promise<unknown>,
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Baignade | null> {
  const r = (await lireJson(`https://www.data.gouv.fr/api/1/datasets/${JEU}/`)) as { resources?: { title?: string; url?: string }[] };
  // « saison-balneaire-2025-liste-des-sites-de-baignade.csv », « Saison balnéaire 2025_caractéristiques des sites… »
  const parSaison = new Map<number, { liste?: string; carac?: string }>();
  for (const x of r.resources ?? []) {
    const m = /saison[\s_-]*baln[ée]aire[\s_-]*(\d{4})[\s_-]*(liste|caract)/i.exec(x.title ?? '');
    if (!m || !x.url) continue;
    const s = parSaison.get(Number(m[1])) ?? {};
    if (m[2].toLowerCase() === 'liste') s.liste ??= x.url;
    else s.carac ??= x.url;
    parSaison.set(Number(m[1]), s);
  }
  const saison = [...parSaison].filter(([, s]) => s.liste && s.carac).map(([a]) => a).sort((a, b) => b - a)[0];
  if (!saison) return indisponible(dire, 'Baignade : aucune saison ne publie à la fois la liste des sites et leurs caractéristiques.');
  const { liste, carac } = parSaison.get(saison)!;
  const cheminListe = join(cache, `baignade-${saison}-liste.csv`);
  const cheminCarac = join(cache, `baignade-${saison}-caracteristiques.csv`);
  await telecharger(liste!, cheminListe);
  await telecharger(carac!, cheminCarac);

  const CODE = "Code unique d'identification du site de baignade";
  const classement = new Map<string, [string, string]>();
  for (const l of await lignes(cheminCarac)) {
    // « 0 » : 121 sites en 2025, sans remarque, et un code que la légende de 2019 ne connaît pas.
    // On ne l'interprète pas : le site est montré sans classement publié pour la saison.
    const brut = (l.Classement ?? '').replace(/\.0$/, '');
    const c = brut === '0' ? '' : brut;
    if (c && !CLASSEMENTS[c]) return indisponible(dire, `Baignade : classement « ${c} » inconnu, la légende a peut-être changé.`);
    if (l[CODE]) classement.set(l[CODE], [c, l['Lien URL vers le profil de baignade'] ?? '']);
  }
  const communes = new Map<string, Site[]>();
  let n = 0;
  for (const l of await lignes(cheminListe)) {
    // La colonne porte les saisons dans son nom : « Evolution 2025 vs. 2024 ».
    if (/supprim/i.test(Object.entries(l).find(([k]) => /^[ÉE]volution/i.test(k))?.[1] ?? '')) continue;
    const code = (l['Code INSEE de la commune'] ?? '').padStart(5, '0');
    const nom = (l['Nom du site de baignade'] ?? '').replace(/\s+/g, ' ');
    if (!/^\d[\dAB]\d{3}$/.test(code) || !nom) continue;
    const [c, lien] = classement.get(l[CODE]) ?? ['', ''];
    const commune = communeDe(code);
    communes.set(commune, [...(communes.get(commune) ?? []), [nom, l["Type d'eau"] ?? '', c, /^https?:\/\//.test(lien) ? lien : '']]);
    n++;
  }
  if (n < 3000) return indisponible(dire, `Baignade : ${n} sites seulement, on garde l’ingestion précédente.`);
  dire(`Baignade, saison ${saison} : ${n.toLocaleString('fr-FR')} sites dans ${communes.size.toLocaleString('fr-FR')} communes, ${classement.size.toLocaleString('fr-FR')} classements.`);
  return { maj: new Date().toISOString().slice(0, 10), saison, communes };
}

export function ecrireBaignade(sortie: string, b: Baignade): number {
  return ecrireParDepartement(sortie, 'baignade', b.communes, () => ({ maj: b.maj, saison: b.saison }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const b = await collecterBaignade(lireJson, telecharger, cache, console.log);
  if (b) console.log(`${ecrireBaignade(sortie, b)} départements écrits.`);
}
