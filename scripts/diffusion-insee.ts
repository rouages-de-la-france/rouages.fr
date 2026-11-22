/**
 * Le statut de diffusion des entrepreneurs individuels, relu dans l'API Sirene
 * de l'INSEE au moment de l'ingestion.
 *
 * **Pourquoi.** Les collectes lisent les noms dans la copie de SIRENE
 * qu'Opendatasoft met à jour le 1er du mois. Un entrepreneur qui s'oppose à
 * la diffusion de son identité après le 1er y reste « diffusible » jusqu'à la
 * mise à jour suivante : le 21 novembre 2026, la page d'Izaux en nommait un
 * (dépôt privé, ticket #101). L'API de l'INSEE dit le statut du jour.
 *
 * **Ce qui est vérifié.** Seuls les entrepreneurs individuels : une personne
 * morale est toujours diffusible. Un SIREN que l'INSEE ne rend pas, ou dont
 * le statut n'est pas `O`, est refusé : le refus reste le cas par défaut.
 *
 * **L'API.** `https://api.insee.fr/api-sirene/3.11/siren`, la clé dans
 * l'en-tête `X-INSEE-Api-Key-Integration` (portail-api.insee.fr), 30
 * requêtes par minute ; une requête multicritère `q=siren:(… OR …)` prend
 * plusieurs SIREN à la fois. Le compte est gratuit : `INSEE_SIRENE_CLE`.
 *
 * **Sans la clé**, ou si l'API ne répond pas, rien n'est retiré de plus : la
 * copie mensuelle reste seule juge, et la ligne qui le dit est comptée parmi
 * les échecs de l'ingestion, pour que la PR de données le montre.
 */
import { noterEchec } from './echecs.ts';

export const INSEE_SIRENE = 'https://api.insee.fr/api-sirene/3.11/siren';
/** SIREN par requête : l'adresse reste sous 4 Ko. */
export const LOT = 200;
/** 30 requêtes par minute : une toutes les deux secondes et demie, avec de la marge. */
const PAS_MS = 2500;
/** Trois collectes passent par ici : la dégradation n'est comptée qu'une fois par ingestion. */
let dejaDit = false;
function degrade(dire: (m: string) => void, m: string): null {
  dire(m);
  if (!dejaDit) noterEchec(m);
  dejaDit = true;
  return null;
}

type Lecteur = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

/** La requête multicritère d'un lot de SIREN. */
export function requete(lot: string[]): string {
  const q = `siren:(${lot.join(' OR ')})`;
  return `${INSEE_SIRENE}?q=${encodeURIComponent(q)}&champs=${encodeURIComponent('siren,statutDiffusionUniteLegale')}&nombre=${lot.length}`;
}

/** Les SIREN d'une réponse, avec leur statut. */
export function statutsDe(reponse: unknown): Map<string, string> {
  const m = new Map<string, string>();
  const unites = (reponse as { unitesLegales?: { siren?: string; statutDiffusionUniteLegale?: string }[] })?.unitesLegales ?? [];
  for (const u of unites) if (u.siren) m.set(u.siren, u.statutDiffusionUniteLegale ?? '');
  return m;
}

/**
 * Parmi ces SIREN d'entrepreneurs individuels, ceux que l'INSEE ne dit pas
 * diffusibles aujourd'hui ; `null` si la vérification n'a pas pu se faire.
 */
export async function refusesAJour(
  sirens: Iterable<string>,
  dire: (m: string) => void,
  cle = process.env.INSEE_SIRENE_CLE,
  lire: Lecteur = fetch as unknown as Lecteur,
  pause = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)),
): Promise<Set<string> | null> {
  const uniques = [...new Set(sirens)].filter((s) => /^\d{9}$/.test(s)).sort();
  if (uniques.length === 0) return new Set();
  if (!cle) {
    return degrade(dire, 'SIRENE : sans INSEE_SIRENE_CLE, le statut de diffusion des entrepreneurs est celui de la copie mensuelle d’Opendatasoft.');
  }
  const refuses = new Set<string>();
  for (let i = 0; i < uniques.length; i += LOT) {
    const lot = uniques.slice(i, i + LOT);
    let statuts: Map<string, string> | null = null;
    for (let essai = 0; essai < 5 && !statuts; essai++) {
      const r = await lire(requete(lot), { headers: { 'X-INSEE-Api-Key-Integration': cle, Accept: 'application/json' } }).catch(() => null);
      // 404 : aucun SIREN du lot n'est connu de l'INSEE.
      if (r && r.status === 404) statuts = new Map();
      else if (r && r.ok) statuts = statutsDe(await r.json());
      else if (r && (r.status === 401 || r.status === 403)) {
        return degrade(dire, `SIRENE : l’API de l’INSEE refuse la clé (${r.status}) ; le statut de diffusion est celui de la copie mensuelle.`);
      } else await pause(r?.status === 429 ? 61_000 : PAS_MS * (essai + 1));
    }
    if (!statuts) {
      return degrade(dire, `SIRENE : l’API de l’INSEE n’a pas répondu (lot ${i / LOT + 1}) ; le statut de diffusion est celui de la copie mensuelle.`);
    }
    for (const s of lot) if (statuts.get(s) !== 'O') refuses.add(s);
    await pause(PAS_MS);
  }
  dire(`  SIRENE : ${uniques.length} entrepreneurs relus à l’INSEE, ${refuses.size} non diffusibles aujourd’hui.`);
  return refuses;
}
