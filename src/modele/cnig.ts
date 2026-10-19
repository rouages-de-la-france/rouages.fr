/**
 * Les types du standard CNIG des documents d'urbanisme, en clair.
 *
 * Le Géoportail de l'urbanisme publie chaque zone, prescription et
 * information avec un code : `typezone` (U, AUc, AUs, A, N), `typepsc` et
 * `stypepsc` pour une prescription, `typeinf` et `stypeinf` pour une
 * information. Le libellé que la collectivité a saisi dit ce qu'elle a voulu
 * dessiner ; le code dit dans quelle catégorie du code de l'urbanisme elle
 * l'a rangé. On montre les deux, le libellé d'abord, et on ne reformule ni
 * l'un ni l'autre.
 *
 * Source : Conseil national de l'information géolocalisée, « Standard CNIG
 * PLU v2024-01 » du 20 décembre 2023, tables ZoneUrbaType,
 * PrescriptionUrbaType (millésime 2023-12) et InformationUrbaType (millésime
 * 2022-06), libellés repris mot pour mot. Un document versé sous un standard
 * plus ancien peut porter un code depuis transféré : le standard le dit dans
 * sa table, et on reprend ce qu'il en dit.
 *
 * Les catégories de servitudes d'utilité publique ne sont pas ici : leur
 * libellé vient du Géoportail lui-même, avec la fiche de la catégorie, au
 * moment de la demande.
 */

export const STANDARD = {
  titre: 'Standard CNIG PLU v2024-01',
  date: '2023-12-20',
  url: 'https://cnig.gouv.fr/IMG/pdf/231220_standard_cnig_plu_v2024-01.pdf',
};

/** ZoneUrbaType : le libellé du standard, et la définition qu'il en donne. */
export const TYPES_ZONE: Record<string, { libelle: string; definition: string }> = {
  U: {
    libelle: 'urbaine',
    definition:
      'Secteurs déjà urbanisés et secteurs où les équipements publics existants ou en cours de réalisation ont une capacité suffisante pour desservir les constructions à implanter',
  },
  AUC: {
    libelle: 'à urbaniser',
    definition:
      'Zone d’urbanisation future qui pourra être urbanisée ponctuellement ou à l’occasion de la réalisation d’opérations d’aménagement ou de constructions compatibles avec les orientations d’aménagement et de programmation et, le cas échéant, le règlement.',
  },
  AUS: {
    libelle: 'à urbaniser bloquée',
    definition: 'Zone à urbaniser, mais dont l’ouverture est subordonnée à une modification ou une révision du Plan Local d’Urbanisme',
  },
  A: {
    libelle: 'agricole',
    definition: 'Secteurs de la commune, équipés ou non, à protéger en raison du potentiel agronomique, biologique ou économique des terres agricoles.',
  },
  N: {
    libelle: 'Naturelle et forestière',
    definition:
      'Secteurs de la commune, équipés ou non, à protéger en raison soit de la qualité des sites, des milieux naturels, des paysages et de leur intérêt esthétique, historique ou écologique, soit de l’existence d’une exploitation forestière, soit de leur caractère d’espaces naturels.',
  },
};

/**
 * Les secteurs d'une carte communale (`typesect`) : les libellés de la carte
 * du zonage de la page de commune (`src/client/zonage-plu.ts`), qui ne sont
 * pas tirés du standard PLU ci-dessus.
 */
export const TYPES_SECTEUR: Record<string, string> = {
  '01': 'Secteur ouvert à la construction',
  '02': 'Secteur réservé aux activités',
  '03': 'Secteur où la construction n’est pas autorisée, sauf exceptions prévues par la loi',
};

/**
 * PrescriptionUrbaType : par code, puis par sous-code. Le sous-code 00 est le
 * libellé générique du code ; un sous-code absent de la table retombe sur
 * lui. Les références sont celles que le standard donne, législatives puis
 * réglementaires, au code de l'urbanisme.
 */
export const PRESCRIPTIONS: Record<string, Record<string, [string, string]>> = {
  '01': {
    '00': ['Espace boisé classé', 'L113-1, R151-31 1°'],
    '01': ['Espace boisé classé à protéger ou conserver', 'L113-1, R151-31 1°'],
    '02': ['Espace boisé classé à créer', 'L113-1, R151-31 1°'],
    '03': ['Espace boisé classé significatif au titre de la loi littoral', 'L121-27'],
  },
  '02': {
    '00': ['Limitations de la constructibilité pour des raisons environnementales, de risques, d’intérêt général', 'R151-31 2° et R151-34 1°'],
    '01': ['Secteur avec interdiction de constructibilité pour des raisons environnementales, de risques, d’intérêt général', 'R151-31 2°'],
    '02': ['Secteur avec conditions spéciales de constructibilité pour des raisons environnementales, de risques, d’intérêt général', 'R151-34 1°'],
  },
  '03': {
    '00': ['Secteur avec disposition de reconstruction / démolition', 'L151-10, R151-34 3°'],
    '02': ['Interdiction de restauration de bâtiment dont il reste l’essentiel des murs porteurs', 'L111-23'],
    '03': ['Interdiction de reconstruction à l’identique', 'L111-15'],
  },
  '04': { '00': ['Périmètre issu des PDU sur obligation de stationnement', 'L151-47 dernier alinéa'] },
  '05': {
    '00': ['Emplacement réservé', 'L151-41 1° à 3°'],
    '01': ['Emplacement réservé aux voies publiques', 'L151-41 1°, R151-48 2°'],
    '02': ['Emplacement réservé aux ouvrages publics', 'L151-41 1°, R151-50 1°'],
    '03': ['Emplacement réservé aux installations d’intérêt général', 'L151-41 2°, R151-34 4°'],
    '04': ['Emplacement réservé aux espaces verts/continuités écologiques', 'L151-41 3°, R151-43 3°'],
    '05': ['Emplacement réservé logement social/mixité sociale', 'L151-41 4°, R151-38 1°'],
    '06': ['Servitude de localisation des voies, ouvrages publics, installations d’intérêt général et espaces verts en zone U ou AU', 'L151-41 dernier alinéa'],
    '07': ['Secteur de projet en attente d’un projet d’aménagement global', 'L151-41 5°, R151-32'],
    '08': ['Emplacements réservés à la relocalisation d’équipements, de constructions et d’installations exposés au recul du trait de côte', 'L151-41 6°'],
  },
  '07': {
    '00': ['Patrimoine bâti, paysager ou éléments de paysages à protéger pour des motifs d’ordre culturel, historique, architectural ou écologique', 'L151-19 et L151-23, R151-41 3° et R151-43 5°'],
    '01': ['Patrimoine bâti à protéger pour des motifs d’ordre culturel, historique, architectural', 'L151-19, R151-41 3°'],
    '02': ['Patrimoine paysager à protéger pour des motifs d’ordre culturel, historique, architectural', 'L151-19, R151-41 3°'],
    '03': ['Patrimoine paysager correspondant à un espace boisé à protéger pour des motifs d’ordre culturel, historique, architectural', 'L151-19, R151-41 3°'],
    '04': ['Éléments de paysage, (sites et secteurs) à préserver pour des motifs d’ordre écologique', 'L151-23, R151-43 5°'],
    '05': ['Éléments de paysage correspondant à un espace boisé, (sites et secteurs) à préserver pour des motifs d’ordre écologique', 'L151-23 al.1, R151-43 5°'],
  },
  '08': { '00': ['Terrain cultivé ou non bâti à protéger en zone urbaine', 'L151-23 al. 2, R151-43 6°'] },
  '09': { '00': ['Anciennement code 9 : Emplacement réservé logement social/mixité sociale est transféré en 05 05', ''] },
  '10': { '00': ['Anciennement code 10 : Servitude de localisation des voies (,,) et espaces verts en zone U ou AU est transféré en 05 06', ''] },
  '11': { '00': ['Anciennement code 11, est transféré en code 15 Règles d’implantation des constructions', ''] },
  '12': { '00': ['Anciennement code 12 : Secteur de projet en attente d’un projet d’aménagement global est transféré en 05 07', ''] },
  '13': { '00': ['Zone à aménager en vue de la pratique du ski', 'L151-38 al. 2, R151-48 3°'] },
  '14': { '00': ['Secteur de plan de masse', 'R151-40'] },
  '15': {
    '00': ['Règles d’implantation des constructions', 'L151-17 et L151-18, R151-39 dernier al.'],
    '01': ['Implantation des constructions par rapport aux voies et aux emprises publiques', 'L151-17 et L151-18, R151-39'],
    '02': ['Implantation des constructions par rapport aux limites séparatives latérales', 'L151-17 et L151-18, R151-39'],
    '03': ['Implantation des constructions par rapport aux limites des fonds de parcelles', 'L151-17, R151-39'],
    '98': ['Implantation alternative des constructions', 'L151-17, R151-39'],
  },
  '16': {
    '00': ['Constructions et installations nécessaires à des équipements collectifs en zone A ou N', 'L151-11 I 1°, R151-23 2° et R151-25 2°'],
    '01': ['Bâtiment susceptible de changer de destination en zone A ou N', 'L151-11 I 2°, R151-23 2°, R151-25 2° et R151-35'],
    '02': ['Bâtiments d’habitation existants pouvant faire l’objet d’extensions ou d’annexes en zone A ou N', 'L151-12, R151-23 2° et R151-25 2°'],
    '03': ['Secteur de taille et de capacité d’accueil limitées (STECAL) en zone A ou N', 'L151-13, R151-23 2° et R151-25 2°'],
    '04': ['Constructions et installations nécessaires à l’activité agricole en zone A ou N', 'R151-23 1° et R151-25 1°'],
    '05': ['Diversification de l’activité agricole : transformation, conditionnement et ventes de produits agricoles (activités liées au tourisme exclues)', 'L151-11 II'],
  },
  '17': { '00': ['Secteur à programme de logements mixité sociale en zone U et AU', 'L151-15, R151-38 3°'] },
  '18': {
    '00': ['Périmètre comportant des orientations d’aménagement et de programmation (OAP)', 'L151-6 et L151-7, R151-6 à R151-8-1'],
    '01': ['OAP de projet (sans règlement)', 'L151-6 et L151-7, R151-8'],
  },
  '19': { '00': ['Secteur protégé en raison de la richesse du sol et du sous-sol', 'R151-34 2°'] },
  '20': { '00': ['Secteur à transfert de constructibilité en zone N', 'L151-25, R151-36'] },
  '22': { '00': ['Diversité commerciale à protéger ou à développer', 'L151-16-1, R151-37 4°'] },
  '23': { '00': ['Secteur avec taille minimale des logements en zone U et AU', 'L151-14, R151-38 2°'] },
  '24': { '00': ['Voies, chemins, transport public à conserver et à créer', 'L151-38, R151-48 1°'] },
  '25': { '00': ['Eléments de continuité écologique et trame verte et bleue', 'L151-23 al. 2, R151-43 4° et R151-43 8°'] },
  '26': { '00': ['Secteur de performance énergétique', 'L151-21, R151-42 1°'] },
  '27': { '00': ['Secteur d’aménagement numérique', 'L151-40, R151-50 2°'] },
  '28': { '00': ['Conditions de desserte', 'R151-47 1° et 2°'] },
  '29': { '00': ['Secteur avec densité minimale de construction', 'R151-39 2e al.'] },
  '30': { '00': ['Majoration des volumes constructibles', 'R151-37 2°'] },
  '31': { '00': ['Espaces remarquables du littoral', 'L121-23, R121-4 1° à 8°'] },
  '32': { '00': ['Exclusion protection de plans d’eau de faible importance', 'L122-12, R122-2'] },
  '33': { '00': ['Secteur de dérogation aux protections des rives des plans d’eau en zone de montagne', 'L122-14 1°'] },
  '34': { '00': ['Espaces, paysage et milieux caractéristiques du patrimoine naturel et culturel montagnard à préserver', 'L122-9'] },
  '35': { '00': ['Terres nécessaires au maintien et au développement des activités agricoles, pastorales et forestières à préserver', 'L122-10'] },
  '36': { '00': ['Mixité des destinations ou sous-destinations', 'R151-37 1°'] },
  '37': { '00': ['Règles différenciées entre le rez-de-chaussée et les étages supérieurs des constructions', 'R151-37 3°'] },
  '38': { '00': ['Emprise au sol', 'R151-39'] },
  '39': { '00': ['Hauteur', 'R151-39'] },
  '40': { '00': ['Volumétrie', 'R151-39'] },
  '41': { '00': ['Aspect extérieur', 'L151-18, R151-41 2°'] },
  '42': { '00': ['Coefficient de biotope par surface', 'L151-22, R151-43 1°'] },
  '43': { '00': ['Réalisation d’espaces libres, plantations, aires de jeux et de loisir', 'R151-43 2°'] },
  '44': { '00': ['Stationnement', 'R151-44'] },
  '45': { '00': ['Secteur de ZAC avec surfaces de plancher déterminées', 'L151-27 1°'] },
  '46': { '00': ['Constructibilité espace boisé antérieur au 20ème siècle', 'L151-20'] },
  '47': { '00': ['Desserte par les réseaux', 'L151-39, R151-49'] },
  '48': { '00': ['Mesures pour limiter l’imperméabilisation des sols', 'R151-49 2°'] },
  '49': { '00': ['Opération d’ensemble imposée en zone AU', 'R151-20'] },
  '50': { '00': ['Interdiction types d’activités, destinations, sous-destinations', 'L151-9, R151-30'] },
  '51': { '00': ['Autorisation sous conditions types d’activités, destinations, sous-destinations', 'L151-9, R151-33'] },
  '52': { '00': ['Infrastructures et équipements logistiques à préserver ou à développer en zones U et AU', 'L151-16-2'] },
  '53': { '00': ['dérogation à l’article L.111-6 pour l’implantation des constructions le long des grands axes routiers', 'L.111-8'] },
  '97': {
    '00': ['Périmètre d’application d’une pièce écrite territorialisée (rapport de présentation, PADD, règlement, règlement graphique, POA)', ''],
    '01': ['Périmètre couvert par un Plan de secteurs', 'L151-3'],
  },
  '99': { '00': ['Autre', ''] },
};

/**
 * InformationUrbaType : par code, puis par sous-code. Les références sont la
 * définition de l'information, puis son annexion au document, telles que le
 * standard les donne.
 */
export const INFORMATIONS: Record<string, Record<string, [string, string]>> = {
  '01': { '00': ['Anciennement 01 : « Secteur sauvegardé » puis « Site patrimonial remarquable » depuis la Loi CAP de juillet 2016 : ce périmètre d’information est désormais supprimé car il correspond à une SUP', 'L631-1 code du patrimoine'] },
  '02': { '00': ['Zone d’aménagement concerté', 'L311-1 code de l’urbanisme, R151-52 8°'] },
  '03': { '00': ['Zone de préemption dans un espace naturel et sensible', 'L215-1 code de l’urbanisme'] },
  '04': {
    '00': ['Périmètre de droit de préemption urbain', 'L211-1 code de l’urbanisme, R151-52 7°'],
    '01': ['Périmètre de droit de préemption urbain renforcé', 'R151-52 7°'],
  },
  '05': { '00': ['Zone d’aménagement différé', 'L212-1 et L212-2-1 code de l’urbanisme, R151-52 7°'] },
  '06': { '00': ['Anciennement code 06 : zone d’obligation du permis de démolir, est transféré en Prescription 03', ''] },
  '07': { '00': ['Périmètre de développement prioritaire économie d’énergie', 'L712-2 code de l’énergie, R151-53 1°'] },
  '08': { '00': ['Périmètre forestier : interdiction ou réglementation des plantations (code rural et de la pêche maritime), plantations à réaliser et semis d’essence forestière', 'L126-1 code rural et de la pêche maritime, R151-53 2°'] },
  '09': { '00': ['Périmètre minier de concession pour l’exploitation ou le stockage', 'Livres I et II du code minier, R151-53 3°'] },
  '10': { '00': ['Zone de recherche et d’exploitation de carrière', 'L321-1, L333-1 et L334-1 du code minier, R151-53 4°'] },
  '11': { '00': ['Périmètre des zones délimitées - divisions foncières soumises à déclaration préalable', 'L115-3 code de l’urbanisme, R151-52 4°'] },
  '12': { '00': ['Périmètre de sursis à statuer', 'L424-1 code de l’urbanisme, R151-52 13°'] },
  '13': { '00': ['Secteur de programme d’aménagement d’ensemble', 'L332-9 code de l’urbanisme dans sa version antérieure au 1er mars 2012, R151-52 9°'] },
  '14': { '00': ['Périmètre de voisinage d’infrastructure de transport terrestre (secteur affecté par le bruit)', 'L571-10 code de l’environnement, R151-53 5°'] },
  '15': { '00': ['Anciennement code 15 est abrogé : les Zones Agricoles Protégées sont à traiter en SUP A9', ''] },
  '16': { '00': ['Site archéologique', 'L522-5 2ème alinéa du code du patrimoine'] },
  '17': { '00': ['Zone à risque d’exposition au plomb', 'L1334-5 code de la santé publique dans sa version antérieure au 11 août 2004, R151-53 6°'] },
  '18': { '00': ['Anciennement code 18 (Espaces et milieux à préserver, en fonction de l’intérêt écologique) est transféré en Prescription 31', ''] },
  '19': {
    '01': ['Zone d’assainissement collectif/non collectif, eaux usées/eaux pluviales, schéma de réseaux eau et assainissement, systèmes d’élimination des déchets', 'L2224-10 code général des collectivités territoriales, R151-53 8°'],
    '02': ['Emplacements traitement eaux et déchets', 'R151-53 8°'],
  },
  '20': { '00': ['Règlement local de publicité', 'L581-14 code de l’environnement, R151-53 11°'] },
  '21': { '00': ['Projet de plan de prévention des risques', 'L562-2 code de l’environnement, R151-53 9°'] },
  '22': { '00': ['Protection des rives des plans d’eau en zone de montagne', 'L122-12 code de l’urbanisme'] },
  '23': { '00': ['Arrêté du préfet coordonnateur de massif', 'L122-12 code de l’urbanisme, R151-52 6°'] },
  '24': { '00': ['24 (Document d’aménagement artisanal et Commercial) est transféré en Prescription 18-08', ''] },
  '25': { '00': ['Périmètre de protection des espaces agricoles et naturels périurbain', 'L113-16 code de l’urbanisme, R151-52 3°'] },
  '26': { '00': ['Anciennement code 26 (lotissement) est Abrogé', ''] },
  '27': { '00': ['Plan d’exposition au bruit des aérodromes', 'L112-6 code de l’urbanisme, R151-52 2°'] },
  '28': { '00': ['Anciennement codes 28 et 29, sont transférés en Prescription 30', ''] },
  '29': { '00': ['Anciennement codes 28 et 29, sont transférés en Prescription 30', ''] },
  '30': { '00': ['Périmètre projet urbain partenarial', 'L332-11-3 code de l’urbanisme, R151-52 12°'] },
  '31': { '00': ['Périmètres patrimoniaux d’exclusion des matériaux et énergies renouvelables pris par délibération', 'L111-17 code de l’urbanisme'] },
  '32': { '00': ['Secteur de taxe d’aménagement', 'L331-14 et L331-15 code urba., R151-52 10°'] },
  '33': { '00': ['Droit de préemption commercial', 'L 214-1, R214-1 et 2 code de l’urbanisme'] },
  '34': { '00': ['Périmètre d’opération d’intérêt national', 'L102-12 et R102-3 code de l’urbanisme'] },
  '35': { '00': ['Périmètre de secteur affecté par un seuil minimal de densité', 'L331-36 code de l’urbanisme, R151-52 11°'] },
  '36': { '00': ['Schémas d’aménagement de plage', 'L121-28 code de l’urbanisme, R151-52 5°'] },
  '37': { '00': ['Bois ou forêts relevant du régime forestier', 'L211-1 et L211-2 code forestier, R151-53 7°'] },
  '38': { '00': ['Secteurs d’information sur les sols', 'L125-6 code de l’environnement, R151-53 10°'] },
  '39': { '00': ['Périmètres de projets AFUP (dans lesquels les propriétaires fonciers sont incités à se regrouper en AFU de projet et les AFU de projet à mener leurs opérations de façon concertée)', 'L322-13 code de l’urbanisme, R151-52 14°'] },
  '40': {
    '01': ['Périmètre d’un bien inscrit au patrimoine mondial', 'L612-1 et R612-1 à R612-2 code du patrimoine, R151-53'],
    '02': ['Zone tampon d’un bien inscrit au patrimoine mondial', 'R151-53'],
  },
  '41': { '00': ['Bande de recul le long des axes à grande circulation', 'L111-6 code de l’urbanisme'] },
  '42': {
    '00': ['Secteurs délimités par délibération de l’autorité compétente en matière d’urbanisme, dans lesquels certaines opérations sont soumises à autorisation d’urbanisme.', 'R151-52'],
    '01': ['secteur dans lequel les travaux de démolition sont soumis à permis de démolir', 'R421-27, R151-52'],
    '02': ['Secteur dans lequel l’édification d’une clôture doit être précédée d’une déclaration préalable', 'R421-12 d, R151-52'],
    '03': ['secteur dans lequel les travaux de ravalement sont soumis à déclaration préalable', 'R421-17-1 e, R151-52'],
  },
  '97': { '00': ['Périmètre d’application d’une pièce écrite territorialisée relative aux annexes (liste des annexes, liste et plan des SUP)', ''] },
  '98': { '00': ['Périmètre d’annulation partielle du document d’urbanisme (lorsqu’elle impacte le règlement graphique)', ''] },
  '99': {
    '00': ['Autre périmètre, secteur, plan, document, site, projet, espace.', ''],
    '01': ['autre relevant de la loi littoral', ''],
    '02': ['autre relevant de la loi montagne', ''],
  },
};

export interface TypeCnig {
  /** « 05-01 », tel que le standard l'écrit. */
  code: string;
  libelle: string;
  references: string;
}

function chercher(table: Record<string, Record<string, [string, string]>>, type: unknown, sous: unknown): TypeCnig | null {
  const t = String(type ?? '').trim().padStart(2, '0');
  const s = String(sous ?? '').trim().padStart(2, '0') || '00';
  const codes = table[t];
  if (!codes) return null;
  // Le sous-code précis s'il est dans la table ; sinon le générique ; à défaut le premier (le code 40 n'a pas de 00).
  const [cle, [libelle, references]] = codes[s] ? [s, codes[s]] : codes['00'] ? ['00', codes['00']] : Object.entries(codes)[0];
  return { code: `${t}-${cle}`, libelle, references };
}

export const typePrescription = (p: { typepsc?: unknown; stypepsc?: unknown }) => chercher(PRESCRIPTIONS, p.typepsc, p.stypepsc);
export const typeInformation = (p: { typeinf?: unknown; stypeinf?: unknown }) => chercher(INFORMATIONS, p.typeinf, p.stypeinf);

/** Le type d'une zone de PLU : AUc et AUs à part, et un « AU » nu, que d'anciens documents portent, à urbaniser. */
export function typeZone(typezone: unknown): { code: string; libelle: string; definition: string } | null {
  const t = String(typezone ?? '').trim().toUpperCase();
  const x = TYPES_ZONE[t] ?? (t === 'AU' ? TYPES_ZONE.AUC : null);
  return x ? { code: t === 'AUC' ? 'AUc' : t === 'AUS' ? 'AUs' : t, ...x } : null;
}
