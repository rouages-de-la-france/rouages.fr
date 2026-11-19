/**
 * Les logements vacants du parc privé, commune par commune : LOVAC.
 *
 * LOVAC croise le fichier 1767 bis Com de la DGFiP avec les fichiers
 * fonciers ; le Cerema en publie pour la DGALN une version agrégée à la
 * commune, sous Licence Ouverte, sur data.gouv.fr. Chaque millésime donne le
 * nombre de logements vacants du parc privé, ceux qui le sont depuis plus de
 * deux ans — la vacance « structurelle », celle qui ne se résorbe pas d'elle-
 * même — et le nombre de logements du parc privé.
 *
 * **Le secret.** Une case masquée vaut « s » ; on garde `null`, et la page
 * dit « masqué », sans deviner. Ce n'est pas toujours « moins de onze » : au
 * millésime 2026, aucune valeur publiée n'est entre 1 et 10 (les petites sont
 * des zéros), mais des communes masquées en 2026 ont, d'autres années, des
 * valeurs publiées jusqu'à 487 — d'après la documentation, il suffit que les
 * vacants de moins ou de plus de deux ans soient moins de onze —, et le parc privé est masqué dans
 * 18 321 communes, dont 10 699 où la vacance est publiée : un masquage
 * secondaire, pour qu'on ne retrouve rien par différence (vérifié le
 * 19 novembre 2026).
 *
 * **Les dates.** La documentation date chaque millésime du 1er janvier de
 * l'année précédente, mais pas de façon tout à fait cohérente (le millésime
 * 2023 est daté du 1er janvier 2023, comme le 2024). La page parle donc de
 * millésimes, et ne calcule une part qu'entre deux chiffres du même.
 *
 * Le parc social n'y est pas : la vacance du recensement, que la page montre
 * déjà, compte tous les logements.
 *
 * Au Mayet-de-Montagne : 159 logements vacants au millésime 2026, dont 101
 * depuis plus de deux ans ; au millésime 2025, 139 sur 901 logements du parc
 * privé.
 *
 * Lancé seul — `tsx scripts/vacance-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-vacance.json`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ressourcesDuJeu } from './donnees-ouvertes.ts';
import { indisponible } from './echecs.ts';
import { communeDe, ecrireParDepartement, lignesCsv, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

/** Le jeu, par son identifiant : son titre change chaque année (« de 2020 à 2026 »). */
const JEU = '61816c6e23197bb34835228e';

/** Par millésime croissant : [millésime, vacants, vacants depuis plus de deux ans, logements du parc privé], null sous le secret. */
export type MillesimeVacance = [number, number | null, number | null, number | null];

export interface Vacance {
  millesimes: number[];
  maj: string;
  communes: Map<string, (number | null)[][]>;
}

const valeur = (v: string | undefined): number | null => {
  const t = (v ?? '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};

export async function collecterVacance(
  telecharger: (url: string, vers: string) => Promise<void>,
  json: <T>(url: string) => Promise<T>,
  cache: string,
  dire: (m: string) => void,
): Promise<Vacance | null> {
  const [adresse] = await ressourcesDuJeu(JEU, 'communes', json, dire);
  if (!adresse) return indisponible(dire, 'Vacance : le fichier LOVAC des communes est introuvable.');
  const fichier = join(cache, 'lovac-communes.csv');
  await telecharger(adresse, fichier);
  // Le fichier est en Latin-1.
  const texte = new TextDecoder('latin1').decode(readFileSync(fichier));
  const { actuelles, reports } = reportsDuDecoupage();

  let entete: string[] | null = null;
  let millesimes: number[] = [];
  let colonnes: { m: number; vacants: number; longue: number; parc: number }[] = [];
  const communes = new Map<string, (number | null)[][]>();
  let secret = 0;
  for await (const l of lignesCsv([texte], ';')) {
    if (!entete) {
      entete = l.map((h) => h.trim());
      millesimes = [...new Set(entete.map((h) => /^pp_vacant_(\d{2})$/.exec(h)?.[1]).filter((x): x is string => !!x))]
        .map(Number)
        .sort((a, b) => a - b);
      colonnes = millesimes.map((m) => ({
        m: 2000 + m,
        vacants: entete!.indexOf(`pp_vacant_${m}`),
        longue: entete!.indexOf(`pp_vacant_plus_2ans_${m}`),
        parc: entete!.indexOf(`ff_pp_total_${m}`),
      }));
      if (!entete.includes('CODGEO_26') && !entete.some((h) => /^CODGEO_\d{2}$/.test(h))) {
        return indisponible(dire, 'Vacance : le fichier LOVAC n’a plus de colonne de code commune.');
      }
      continue;
    }
    const iCode = entete.findIndex((h) => /^CODGEO_\d{2}$/.test(h));
    const brut = (l[iCode] ?? '').trim().padStart(5, '0');
    const code = communeDe(actuelles.has(brut) ? brut : (reports.get(brut) ?? ''));
    if (!code) continue;
    const serie = colonnes.map((c) => [c.m, valeur(l[c.vacants]), c.longue >= 0 ? valeur(l[c.longue]) : null, c.parc >= 0 ? valeur(l[c.parc]) : null]);
    const deja = communes.get(code);
    if (!deja) {
      communes.set(code, serie);
      continue;
    }
    // Paris, Lyon, Marseille : le fichier donne les arrondissements, on les somme. Un arrondissement
    // sous le secret rend la somme inconnue plutôt que fausse.
    for (const [i, x] of deja.entries()) for (let j = 1; j < 4; j++) x[j] = x[j] === null || serie[i][j] === null ? null : x[j]! + serie[i][j]!;
  }
  for (const serie of communes.values()) if (serie[serie.length - 1][1] === null) secret++;
  if (communes.size < 30000 || millesimes.length === 0) {
    return indisponible(dire, `Vacance : ${communes.size} communes seulement dans LOVAC, on garde l’ingestion précédente.`);
  }
  const dernier = 2000 + millesimes[millesimes.length - 1];
  dire(
    `Vacance (LOVAC ${2000 + millesimes[0]}-${dernier}) : ${communes.size.toLocaleString('fr-FR')} communes, ` +
      `${secret.toLocaleString('fr-FR')} sous le secret au millésime ${dernier}.`,
  );
  return { millesimes: millesimes.map((m) => 2000 + m), maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireVacance(sortie: string, v: Vacance): number {
  return ecrireParDepartement(sortie, 'vacance', v.communes, () => ({ maj: v.maj, millesimes: v.millesimes }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const v = await collecterVacance(telecharger, lireJson as <T>(url: string) => Promise<T>, cache, console.log);
  if (v) console.log(`${ecrireVacance(sortie, v)} départements écrits.`);
}
