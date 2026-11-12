/**
 * Choisir, parmi les ressources d'un jeu data.gouv.fr, celles qui portent un
 * motif : `csv`, `resultats-communes`, `conseillers-municipaux`…
 *
 * Le motif se cherche d'abord dans le titre de la ressource, puis, si aucun
 * titre ne le porte, dans son adresse. Le titre seul ne suffit pas : en
 * novembre 2026, la veille a sonné l'alerte sur Sitadel et sur les résultats
 * des municipales, « le jeu a changé de forme », alors que les fichiers
 * étaient là. Leurs titres avaient changé (« Municipales 2026 - Résultats -
 * Communes_2026-03-20.csv »), pas leurs adresses (`…/municipales-2026-
 * resultats-communes-….csv`, `…/datafiles/…/csv`). Comme la recherche ne
 * regardait l'adresse qu'en l'absence de titre, la collecte des logements
 * autorisés échouait en silence depuis septembre et laissait les fichiers
 * précédents en place.
 *
 * Le titre garde la priorité pour ne rien changer aux jeux qu'il suffisait à
 * désigner : l'adresse ne sert que s'il ne désigne rien.
 */
export function ressourcesQuiPortent<R extends { title?: string; url?: string }>(
  ressources: readonly R[],
  motif: string,
): R[] {
  const cherche = motif.toLowerCase();
  const parTitre = ressources.filter((r) => (r.title ?? '').toLowerCase().includes(cherche));
  if (parTitre.length > 0) return parTitre;
  return ressources.filter((r) => (r.url ?? '').toLowerCase().includes(cherche));
}
