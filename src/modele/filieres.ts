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
  /**
   * La décomposition du prix au détail que publie l'Observatoire de la formation des prix et des
   * marges, pour la page de la filière : les montants tels que les fiches des processus les citent
   * (déjà recoupés contre le rapport), l'année, et la source.
   */
  prix?: PrixDecompose[];
}

export interface PrixDecompose {
  produit: string;
  /** « le kilo », « le litre ». */
  unite: string;
  /** Où ce prix est relevé : « en grande surface », « tous circuits de vente confondus ». */
  ou: string;
  annee: number;
  /** Le prix moyen publié, toutes taxes comprises, en euros. */
  total: number;
  /** Les parts, dans l'ordre de la chaîne : [libellé, euros]. */
  parts: [string, number][];
  /** L'identifiant de la source dans `contenu/sources.yaml`. */
  source: string;
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
    prix: [
      { produit: 'La baguette', unite: 'le kilo', ou: 'tous circuits de vente confondus', annee: 2025, total: 4.05, parts: [['Blé', 0.24], ['Marge brute de la meunerie', 0.27], ['Marge brute en aval (boulangerie, distribution)', 3.33], ['TVA', 0.21]], source: 'ofpm-rapport-2026-pain' },
    ],
  },
  {
    id: 'lait',
    libelle: 'Le lait',
    resume: 'De l’étable au rayon : la laiterie, la grande surface, et la décomposition du prix du lait, du yaourt et de l’emmental.',
    processus: ['du-lait-au-litre-de-lait'],
    prix: [
      { produit: 'Le lait demi-écrémé UHT', unite: 'le litre', ou: 'en grande surface', annee: 2025, total: 1.11, parts: [['Matière première', 0.31], ['Marge brute de l’industrie', 0.43], ['Marge brute de la grande surface', 0.31], ['TVA', 0.06]], source: 'ofpm-rapport-2026-lait' },
      { produit: 'Le yaourt nature', unite: 'le kilo', ou: 'en grande surface', annee: 2025, total: 2.36, parts: [['Matière première', 0.3], ['Marge brute de l’industrie', 1.15], ['Marge brute de la grande surface', 0.78], ['TVA', 0.12]], source: 'ofpm-rapport-2026-lait' },
      { produit: 'L’emmental', unite: 'le kilo', ou: 'en grande surface', annee: 2025, total: 9.12, parts: [['Matière première', 4.43], ['Marge brute de l’industrie', 1.59], ['Marge brute de la grande surface', 2.63], ['TVA', 0.48]], source: 'ofpm-rapport-2026-lait' },
    ],
  },
  {
    id: 'viande',
    libelle: 'La viande',
    resume: 'De l’élevage au rayon : qui intervient entre l’animal et la barquette, et comment se décompose le prix du steak haché et du jambon cuit.',
    processus: ['de-l-elevage-a-la-viande-en-rayon'],
    prix: [
      { produit: 'La viande de bœuf hachée (15 % de matière grasse)', unite: 'le kilo', ou: 'en grande surface', annee: 2025, total: 14.38, parts: [['Matière première', 8.2], ['Marge brute de l’abattage-découpe', 2.48], ['Marge brute de la grande surface', 2.94], ['TVA', 0.75]], source: 'ofpm-rapport-2026-viande' },
      { produit: 'Le jambon cuit', unite: 'le kilo', ou: 'en grande surface', annee: 2025, total: 13.6, parts: [['Matière première', 4.4], ['Marge brute de l’abattage-découpe', 1.42], ['Marge brute de la charcuterie', 4.89], ['Marge brute de la grande surface', 2.18], ['TVA', 0.71]], source: 'ofpm-rapport-2026-viande' },
    ],
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
