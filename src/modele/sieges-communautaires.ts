/**
 * Qui, parmi les élus d'une commune, siège au conseil communautaire : le
 * rapprochement par le nom (`recoupements.ts`) ne compare la déclaration d'un
 * élu qu'aux marchés des collectivités où il siège. La page de la commune s'en
 * sert pour l'élu ; celle de l'intercommunalité, pour ses marchés.
 */
import type { Fiche } from './territoires.ts';

/** Le nom plié pour comparer une déclaration au répertoire des élus. */
export const personne = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();

export function siegesCommunautaires(fiche: Fiche | null): Set<string> {
  if (!fiche) return new Set();
  return new Set(
    [
      ...(fiche.maire && fiche.maireCc ? [`${fiche.maire.prenom} ${fiche.maire.nom}`] : []),
      ...fiche.adjoints.filter((x) => x.cc).map((x) => `${x.prenom} ${x.nom}`),
      ...fiche.conseillers.filter((x) => x.cc).map((x) => `${x.prenom} ${x.nom}`),
    ].map(personne),
  );
}
