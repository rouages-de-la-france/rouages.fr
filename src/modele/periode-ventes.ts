/**
 * La période des ventes immobilières, dite juste quand la dernière année n'est
 * qu'un semestre (`scripts/dvf-emettre.ts`, champ `fin` : « 2026-06 »).
 * Sans `fin`, la période est celle des années pleines.
 */
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Le nombre de mois couverts de la dernière année : 12 sans `fin`. */
export function moisDerniere(annees: number[], fin?: string | null): number {
  const m = /^(\d{4})-(\d{2})$/.exec(fin ?? '');
  return m && Number(m[1]) === annees.at(-1) ? Number(m[2]) : 12;
}

/** « 2025 », ou « juin 2026 » quand la dernière année s'arrête au premier semestre. */
export function finVentes(annees: number[], fin?: string | null): string {
  const mois = moisDerniere(annees, fin);
  return mois < 12 ? `${MOIS[mois - 1]} ${annees.at(-1)}` : String(annees.at(-1));
}

/** « de 2023 à 2025 », ou « de 2023 à juin 2026 ». */
export function periodeVentes(annees: number[], fin?: string | null): string {
  return `de ${annees[0]} à ${finVentes(annees, fin)}`;
}

/**
 * Une année de la série : « 2026 (janvier à juin, provisoire) » pour la dernière quand elle n'est
 * qu'un semestre. Provisoire : le fichier d'octobre manque encore des actes enregistrés tard (il
 * manquait 13 % des ventes de décembre 2025 à la version de mai 2026).
 */
export function anneeVentes(a: number, annees: number[], fin?: string | null): string {
  const mois = moisDerniere(annees, fin);
  return a === annees.at(-1) && mois < 12 ? `${a} (janvier à ${MOIS[mois - 1]}, provisoire)` : String(a);
}

/** Les années pleines seules : pour compter des ventes par an, un semestre encore incomplet tirerait le compte vers le bas. */
export function anneesPleines(annees: number[], fin?: string | null): number[] {
  return moisDerniere(annees, fin) < 12 ? annees.slice(0, -1) : annees;
}

