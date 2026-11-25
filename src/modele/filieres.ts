/**
 * Les filières de la carte des rouages de l'économie (`/economie`) : chaque
 * processus de la famille `economiques` appartient à une filière, et une
 * seule. La carte en fait ses colonnes et ses filtres ; le panneau, la liste
 * des sources de la filière, qui sont celles de ses processus.
 *
 * Un processus économique sans filière fait échouer le build
 * (`filiereDe`, appelé par `src/modele/reseau.ts`) : il n'aurait pas de place
 * sur la carte.
 */
export interface Filiere {
  id: string;
  libelle: string;
  /** Une phrase, sans chiffre : les chiffres sont dans les fiches, avec leur source. */
  resume: string;
  processus: string[];
  /**
   * Toutes les sources que citent ses processus, leurs étapes et leurs leviers,
   * sans doublon ; calculées avec la carte (`src/modele/reseau.ts`).
   */
  sources?: { type: string; titre: string; url: string }[];
}

export const FILIERES: Filiere[] = [
  {
    id: 'entreprise',
    libelle: 'La vie d’une entreprise',
    resume: 'De la création au numéro SIREN, la première embauche, la commande et la facture, et ce qui arrive quand l’entreprise ne peut plus payer.',
    processus: ['creer-une-entreprise', 'embaucher-un-premier-salarie', 'de-la-commande-a-la-facture', 'quand-une-entreprise-ne-peut-plus-payer'],
  },
  {
    id: 'commande-publique',
    libelle: 'La commande publique',
    resume: 'Le marché public vu de l’entreprise : quand la commune publie et met en concurrence, comment elle choisit, dans quel délai elle paie, et ce que peut faire le candidat écarté.',
    processus: ['comment-une-commune-achete'],
  },
  {
    id: 'pain',
    libelle: 'Du blé au pain',
    resume: 'Du champ au comptoir : qui intervient entre le blé et la baguette, et comment se décompose le prix d’un kilo de baguette.',
    processus: ['du-ble-a-la-baguette'],
  },
  {
    id: 'lait',
    libelle: 'Le lait',
    resume: 'De l’étable au rayon : la laiterie, la grande surface, et la décomposition du prix du lait, du yaourt et de l’emmental.',
    processus: ['du-lait-au-litre-de-lait'],
  },
  {
    id: 'viande',
    libelle: 'La viande',
    resume: 'De l’élevage au rayon : qui intervient entre l’animal et la barquette, et comment se décompose le prix du steak haché et du jambon cuit.',
    processus: ['de-l-elevage-a-la-viande-en-rayon'],
  },
  {
    id: 'pac',
    libelle: 'Les aides agricoles',
    resume: 'La déclaration PAC, les contrôles, l’avance et le solde versés par l’ASP, et la publication des bénéficiaires.',
    processus: ['recevoir-les-aides-de-la-pac'],
  },
];

/** La filière d'un processus économique ; une erreur s'il n'en a pas. */
export function filiereDe(processus: string): Filiere {
  const f = FILIERES.find((x) => x.processus.includes(processus));
  if (!f) throw new Error(`Le processus économique « ${processus} » n'a pas de filière : ajoutez-le à src/modele/filieres.ts.`);
  return f;
}
