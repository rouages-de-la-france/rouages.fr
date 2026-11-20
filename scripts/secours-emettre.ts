/**
 * Les interventions des services d'incendie et de secours, service par
 * service : la statistique annuelle de la direction générale de la sécurité
 * civile et de la gestion des crises (ministère de l'Intérieur), sous Licence
 * Ouverte.
 *
 * Un service par département — le SDIS, établissement public financé par le
 * département et les communes —, sauf deux unités militaires de l'État : la
 * brigade de sapeurs-pompiers de Paris, qui couvre Paris et la petite
 * couronne (Hauts-de-Seine, Seine-Saint-Denis, Val-de-Marne), et le
 * bataillon de marins-pompiers de Marseille, à côté du SDIS des
 * Bouches-du-Rhône. La statistique les donne à part ; la page du département
 * aussi.
 *
 * Gardés, pour les cinq dernières années publiées : les grandes familles
 * d'interventions telles que la statistique les totalise — incendies,
 * secours à personne, accidents de circulation, risques technologiques,
 * opérations diverses — et le total. Les sous-catégories restent dans la
 * source.
 *
 * Un seul fichier national, `public/territoires/secours.json`.
 * Lancé seul : `tsx scripts/secours-emettre.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decoder } from './donnees-ouvertes.ts';
import { indisponible } from './echecs.ts';
import { telechargerSiAbsent } from './par-departement.ts';
import { ressourcesQuiPortent } from './ressource-motif.ts';

const JEU = 'interventions-realisees-par-les-services-d-incendie-et-de-secours';
const ANNEES = 5;

/** Les familles retenues, dans l'ordre du fichier écrit, avec le libellé de la colonne. */
export const FAMILLES = [
  ['Incendies', 'incendies'],
  ['Secours à personne', 'secours à personne'],
  ['Accidents de circulation', 'accidents de circulation'],
  ['Risques technologiques', 'risques technologiques'],
  ['Opérations diverses', 'opérations diverses'],
  ['Total interventions', 'total'],
] as const;

export interface Secours {
  maj: string;
  annees: number[];
  familles: string[];
  /** Par service — code du département, « BSPP » ou « BMPM » : son nom, sa catégorie, et par année les familles (null si l'année manque). */
  services: Record<string, { nom: string; categorie: string; serie: ((number | null)[] | null)[] }>;
}

const plie = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** « 1 786 », « 1 786 » (espace insécable) : le nombre, ou null pour une case vide. */
const entier = (v: string | undefined): number | null => {
  const t = (v ?? '').replace(/[^\d]/g, '');
  return t ? Number(t) : null;
};

/** Le code d'un service tel que le fichier l'écrit : « 3 », « 2a », « BSPP ». */
export const codeService = (v: string) => {
  const t = v.trim().toUpperCase();
  return /^\d$/.test(t) ? `0${t}` : t;
};

/** Un fichier annuel, découpé : en-tête, puis lignes. */
export function lireAnnee(texte: string): { entete: string[]; lignes: string[][] } {
  const lignes = texte
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(';'));
  return { entete: lignes[0] ?? [], lignes: lignes.slice(1) };
}

export async function collecterSecours(
  telecharger: (url: string, vers: string) => Promise<void>,
  json: <T>(url: string) => Promise<T>,
  cache: string,
  dire: (m: string) => void,
): Promise<Secours | null> {
  type Ressource = { title?: string; url?: string };
  let ressources: Ressource[] = [];
  try {
    ressources = (await json<{ data?: Ressource[] }>(`https://www.data.gouv.fr/api/2/datasets/${JEU}/resources/?page_size=100`)).data ?? [];
  } catch {
    return indisponible(dire, 'Secours : le jeu n’a pas répondu.');
  }
  const parAnnee = new Map<number, string>();
  for (const r of ressourcesQuiPortent(ressources.filter((r) => r.url), 'sis')) {
    const a = Number(/(20\d\d)/.exec(r.title ?? '')?.[1] ?? 0);
    if (a && !parAnnee.has(a)) parAnnee.set(a, r.url!);
  }
  const annees = [...parAnnee.keys()].sort((a, b) => a - b).slice(-ANNEES);
  if (annees.length === 0) return indisponible(dire, 'Secours : aucun fichier annuel trouvé.');

  const services: Secours['services'] = {};
  for (const [i, annee] of annees.entries()) {
    const fichier = join(cache, `secours-${annee}.csv`);
    await telecharger(parAnnee.get(annee)!, fichier);
    const { entete, lignes } = lireAnnee(decoder(readFileSync(fichier)));
    const col = (nom: string) => entete.findIndex((h) => plie(h) === plie(nom));
    const iNumero = col('Numéro');
    const iNom = col('Département');
    const iCategorie = col('Catégorie A');
    const colonnes = FAMILLES.map(([nom]) => col(nom));
    if (iNumero < 0 || iNom < 0 || colonnes.some((c) => c < 0)) {
      dire(`  Secours ${annee} : le fichier a changé de forme, année laissée de côté.`);
      continue;
    }
    for (const l of lignes) {
      const code = codeService(l[iNumero] ?? '');
      if (!/^(\d{2,3}|2[AB]|BSPP|BMPM)$/.test(code)) continue;
      const s = (services[code] ??= { nom: (l[iNom] ?? '').trim(), categorie: '', serie: annees.map(() => null) });
      s.categorie = (iCategorie >= 0 ? l[iCategorie] : '')?.trim() || s.categorie;
      s.serie[i] = colonnes.map((c) => entier(l[c]));
    }
  }
  const derniere = annees.length - 1;
  const couverts = Object.values(services).filter((s) => s.serie[derniere]).length;
  if (couverts < 95) return indisponible(dire, `Secours : ${couverts} services seulement en ${annees[derniere]}, on garde l’ingestion précédente.`);
  dire(`Secours (${annees[0]}-${annees[derniere]}) : ${couverts} services d’incendie et de secours.`);
  return { maj: new Date().toISOString().slice(0, 10), annees, familles: FAMILLES.map(([, f]) => f), services };
}

export function ecrireSecours(sortie: string, s: Secours): void {
  writeFileSync(join(sortie, 'secours.json'), JSON.stringify(s));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const s = await collecterSecours(telecharger, lireJson as <T>(url: string) => Promise<T>, cache, console.log);
  if (s) ecrireSecours(sortie, s);
}
