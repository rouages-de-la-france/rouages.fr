/**
 * Les familles du graphe qui ne sont pas encore publiées.
 *
 * Décision du 7 novembre 2026 (`docs/12-rouages-influence.md`) : la famille
 * « influence » s'écrit maintenant et sort quand le site aura une notoriété
 * vérifiable. D'ici là, ses processus — et les acteurs qui ne servent qu'à
 * eux — restent hors du réseau public : ni carte, ni recherche, ni plan du
 * site, ni jeux, ni voisinage des autres pages. Leurs pages sont construites,
 * hors des moteurs et marquées « en relecture », pour qu'on puisse les relire
 * en ligne. Publier la famille, c'est passer `INFLUENCE_PUBLIEE` à `true`.
 */
export const INFLUENCE_PUBLIEE = false;

export function familleCachee(famille: string): boolean {
  return famille === 'influence' && !INFLUENCE_PUBLIEE;
}
