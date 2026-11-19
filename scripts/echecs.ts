/**
 * Les collectes en échec d'une réingestion, qu'elles aient levé une erreur ou
 * qu'elles aient renoncé d'elles-mêmes.
 *
 * `tenter` (`ingerer-territoires.ts`) note une collecte qui lève une erreur.
 * Une vingtaine d'autres renoncent sans lever : elles disent que les fichiers
 * précédents restent en place, puis rendent `null`. La réingestion du
 * 18 novembre 2026 a perdu Sitadel ainsi sans que la PR le dise — « une
 * collecte en échec », quand il y en avait deux. Elles passent désormais par
 * `indisponible`, qui écrit la même ligne que `tenter` (le workflow relève
 * les échecs d'après elle) et les compte dans `ingestion.json`.
 */
export const ECHECS: string[] = [];

export function noterEchec(quoi: string): void {
  ECHECS.push(quoi);
}

/** Dit pourquoi la collecte renonce, la compte parmi les échecs, et rend `null`. */
export function indisponible(dire: (m: string) => void, message: string): null {
  dire(message);
  dire('  → les fichiers de cette source ne seront pas réécrits.');
  noterEchec(message);
  return null;
}
