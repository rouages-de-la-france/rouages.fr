/**
 * Le marché du logement, côte à côte (`src/composants/commune/Marche.astro`) :
 * la rotation du parc, l'évolution du prix des maisons, la vacance de longue
 * durée et les logements autorisés, chacun avec sa source — sans indice
 * composé, qui serait un choix du site.
 */
import type { Batiments, Immobilier, Parc, Vacance } from './fiche-vie.ts';
import type { Fiche } from './territoires.ts';

export interface LigneMarche {
  nom: string;
  valeur: string;
  detail: string;
}

export function lignesMarche(
  immobilier: Immobilier | null,
  batiments: Batiments | null,
  parc: Parc | null,
  vacance: Vacance | null,
  logements: NonNullable<Fiche['logements']> | null,
  depNom: string | null,
): LigneMarche[] {
  const pc = (x: number, d = 0) => `${(Math.round(x * 100 * 10 ** d) / 10 ** d).toLocaleString('fr-FR')} %`;
  const signe = (x: number) => (x < 0 ? '−' : '+') + pc(Math.abs(x));
  const dixieme = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // La rotation : les ventes d'un seul logement par an, rapportées au parc des fichiers fonciers, ou du recensement.
  const ventesParAn = immobilier ? immobilier.commune.parAnnee.reduce((a, b) => a + b, 0) / immobilier.annees.length : null;
  const parcLogements = batiments?.logements || parc?.commune[0]?.[0] || null;
  const rotation = ventesParAn !== null && parcLogements ? ventesParAn / parcLogements : null;

  // Le prix des maisons, de la première à la dernière année qui ont assez de ventes.
  const evolution = (l: { m2: number | null; ventes: number }[] | null | undefined, annees: number[]) => {
    if (!l) return null;
    const i = l.findIndex((x) => x.m2 !== null);
    const j = l.findLastIndex((x) => x.m2 !== null);
    return i >= 0 && j > i ? { de: annees[i], a: annees[j], variation: l[j].m2! / l[i].m2! - 1 } : null;
  };
  const prix = immobilier ? evolution(immobilier.detail?.parAnnee, immobilier.annees) : null;
  const prixDep = immobilier ? evolution(immobilier.detailDepartement?.parAnnee, immobilier.annees) : null;

  // La vacance de plus de deux ans, au dernier millésime où elle et le parc privé sont publiés.
  const complet = vacance ? [...vacance.serie].reverse().find((s) => s.longue !== null && s.parc) : null;

  const lignes = [
    rotation !== null && {
      nom: 'Logements vendus chaque année',
      valeur: `${pc(rotation, 1)} du parc`,
      detail: `${dixieme(ventesParAn!)} ventes d’un seul logement par an, de ${immobilier!.annees[0]} à ${immobilier!.annees.at(-1)}, pour ${Math.round(parcLogements!).toLocaleString('fr-FR')} logements${batiments?.logements ? ' aux fichiers fonciers' : ' au recensement'}. Les ventes de plusieurs logements à la fois ne sont pas comptées.`,
    },
    prix && {
      nom: `Prix des maisons, de ${prix.de} à ${prix.a}`,
      valeur: signe(prix.variation),
      detail: `Le prix médian au mètre carré des maisons vendues sans terres ni bois, d’une année sur l’autre — vingt ventes au moins chaque année.${prixDep && depNom ? ` ${depNom} : ${signe(prixDep.variation)}.` : ''} La médiane varie aussi au hasard des maisons vendues.`,
    },
    // Trop peu de ventes ici : l'évolution du département, dite comme telle.
    !prix && prixDep && depNom && {
      nom: `Prix des maisons, de ${prixDep.de} à ${prixDep.a}`,
      valeur: `${signe(prixDep.variation)} dans le département`,
      detail: `Trop peu de ventes chaque année dans la commune — moins de vingt — pour en dire l’évolution : c’est celle du prix médian au mètre carré des maisons du département (${depNom}), vendues sans terres ni bois.`,
    },
    complet && {
      nom: 'Logements vacants depuis plus de deux ans',
      valeur: `${pc(complet.longue! / complet.parc!, 1)} du parc privé`,
      detail: `${complet.longue!.toLocaleString('fr-FR')} sur ${complet.parc!.toLocaleString('fr-FR')}, au millésime ${complet.millesime} de LOVAC.`,
    },
    logements && {
      nom: `Logements autorisés en ${logements.annees.length} ans`,
      valeur: `${dixieme(logements.taux)} pour 1 000 habitants`,
      detail: `${logements.autorises.toLocaleString('fr-FR')} logements ; la médiane des communes est de ${dixieme(logements.medianeTaux)} pour 1 000 habitants.`,
    },
  ].filter((x): x is LigneMarche => !!x);
    return lignes;
}
