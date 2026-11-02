/**
 * Vérifie que la collecte des marchés publics ne dépend pas de l'ordre de
 * lecture des données essentielles.
 *
 * L'export ne garantit pas l'ordre de ses lignes. Avant le départage complet,
 * deux téléchargements des mêmes données réécrivaient 147 fichiers de
 * `marches/` qui ne différaient que par l'ordre des marchés de même date ou
 * des autres lots d'une consultation : de faux changements à chaque collecte,
 * et des conflits entre deux collectes non fusionnées. Les mêmes lignes, lues
 * dans plusieurs ordres, doivent donc écrire les mêmes octets.
 *
 * Sans réseau : l'export est simulé, et les collectes annexes (annuaire,
 * BOAMP, BODACC, acheteurs hors collectivités), qui échouent, sont isolées par
 * le script lui-même.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collecterMarches, ecrireSuitesMarches, ordreDesLots, ordreDesMarches, type Marche } from './marches-emettre.ts';

const ROUGE = '\x1b[31m', VERT = '\x1b[32m', GRIS = '\x1b[90m', RAZ = '\x1b[0m';
let echecs = 0;

function attendre(quoi: string, ok: boolean, pourquoi: string, detail = '') {
  if (!ok) echecs++;
  console.log(`${ok ? VERT + '  ok  ' : ROUGE + 'ÉCHEC '}${RAZ}${quoi}${ok ? '' : ` ${detail}`}\n      ${GRIS}${pourquoi}${RAZ}`);
}

// Un acheteur : la CA Vichy Communauté, qui achète pour Le Mayet-de-Montagne.
const ACHETEUR = '200071140';
const annee = new Date().getUTCFullYear();
const jour = (mois: number, j: number) => `${annee}-${String(mois).padStart(2, '0')}-${String(j).padStart(2, '0')}`;

function ligne(id: string, objet: string, montant: number | null, date: string, titulaire = '12345678900011') {
  return {
    acheteur_id: `${ACHETEUR}00011`,
    objet,
    montant,
    datenotification: date,
    procedure: 'Procédure adaptée',
    dureemois: 24,
    offresrecues: '3',
    codecpv: '90911200-8',
    techniques: 'Accord-cadre',
    titulaire_id_1: titulaire,
    titulaire_typeidentifiant_1: 'SIRET',
    id,
    lieuexecution_code: '03165',
    lieuexecution_typecode: 'Code commune',
    formeprix: 'Forfaitaire',
    modalitesexecution: 'Bons de commande',
    soustraitancedeclaree: 'non',
    considerationssociales: 'Pas de considération sociale',
    considerationsenvironnementales: 'Pas de considération environnementale',
    marcheinnovant: 'non',
  };
}

// Une consultation en lots, notifiée le même jour, dont deux lots de même
// montant ; des marchés distincts de même date et de même montant ; un
// accord-cadre publié deux fois, avec deux titulaires ; et assez de marchés
// pour qu'une suite s'écrive dans `marches/`.
const LIGNES = [
  ligne('2026-07-GO-L01', 'GROS OEUVRE FONDATIONS', 300_000, jour(1, 15)),
  ligne('2026-07-GO-L02', 'VRD PAYSAGE', 80_000, jour(1, 15)),
  ligne('2026-07-GO-L03', 'MENUISERIES INTERIEURES', 80_000, jour(1, 15)),
  ligne('2026-07-GO-L04', 'PEINTURE', null, jour(1, 15)),
  ligne('2026-11', 'Nettoyage des locaux', 50_000, jour(1, 10)),
  ligne('2026-12', 'Entretien des espaces verts', 50_000, jour(1, 10)),
  ligne('2026-13', 'Fournitures de bureau', 50_000, jour(1, 10)),
  ligne('2026-14', 'Restauration scolaire', 120_000, jour(1, 5), '12345678900011'),
  ligne('2026-14', 'Restauration scolaire', 120_000, jour(1, 5), '98765432100022'),
  ligne('2026-15', 'Transport scolaire', 70_000, jour(1, 2)),
];

/** Les lignes dans l'ordre donné, une année de notification par appel, comme l'export. */
function exportSimule(lignes: typeof LIGNES) {
  return async <T>(url: string): Promise<T> => {
    const m = /datenotification%3E%3Ddate'(\d{4})/.exec(url) ?? /datenotification>=date'(\d{4})/.exec(url);
    if (!url.includes('/exports/json?select=acheteur_id') || !m) throw new Error('hors simulation');
    return lignes.filter((l) => l.datenotification.startsWith(m[1])) as T;
  };
}

/** Les fichiers de `marches/` d'une collecte, lus octet pour octet. */
async function collecter(lignes: typeof LIGNES): Promise<Map<string, string>> {
  const m = await collecterMarches(exportSimule(lignes), new Set([ACHETEUR]), () => {});
  if (!m) throw new Error('collecte vide');
  const sortie = mkdtempSync(join(tmpdir(), 'rouages-marches-'));
  try {
    ecrireSuitesMarches(sortie, m);
    const fichiers = new Map<string, string>();
    for (const f of readdirSync(join(sortie, 'marches'))) fichiers.set(f, readFileSync(join(sortie, 'marches', f), 'utf8'));
    // Ce qui part dans le fichier du département et les fichiers nationaux.
    fichiers.set('(parAcheteur)', JSON.stringify([...m.parAcheteur]));
    fichiers.set('(echeances)', JSON.stringify([...m.echeances]));
    fichiers.set('(recents)', JSON.stringify([...m.recents]));
    return fichiers;
  } finally {
    rmSync(sortie, { recursive: true, force: true });
  }
}

/** Un mélange reproductible. */
function melanger<T>(liste: T[], graine: number): T[] {
  const l = [...liste];
  let s = graine;
  for (let i = l.length - 1; i > 0; i--) {
    s = (s * 1_103_515_245 + 12_345) % 2 ** 31;
    const j = s % (i + 1);
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}

const reference = await collecter(LIGNES);
attendre(
  'une suite est écrite pour l’acheteur',
  reference.has(`${ACHETEUR}.json`),
  'sans elle, le cas ne vérifierait rien des fichiers de marches/',
);
const ordres: [string, typeof LIGNES][] = [
  ['ordre inverse', [...LIGNES].reverse()],
  ...[1, 2, 3, 4, 5].map((g): [string, typeof LIGNES] => [`mélange n° ${g}`, melanger(LIGNES, g)]),
];
for (const [nom, lignes] of ordres) {
  const autre = await collecter(lignes);
  const differents = [...reference.keys()].filter((k) => autre.get(k) !== reference.get(k));
  attendre(
    `mêmes octets, lignes lues en ${nom}`,
    differents.length === 0 && autre.size === reference.size,
    'deux collectes des mêmes données écrivent les mêmes fichiers',
    `(diffèrent : ${differents.join(', ')})`,
  );
}

// Le sens du tri ne change pas : du plus récent au plus ancien, puis le plus gros.
const tout: Marche[] = [
  ...((JSON.parse(reference.get('(parAcheteur)')!) as [string, Marche[]][])[0]?.[1] ?? []),
  ...(JSON.parse(reference.get(`${ACHETEUR}.json`) ?? '{"m":[]}') as { m: Marche[] }).m,
];
attendre(
  'les marchés restent du plus récent au plus ancien, le plus gros d’abord',
  tout.every((x, i) => i === 0 || tout[i - 1].date > x.date || (tout[i - 1].date === x.date && (tout[i - 1].montant ?? 0) >= (x.montant ?? 0))),
  'le départage ne joue qu’à date et montant égaux',
);
const memeJour = tout.filter((x) => x.date === jour(1, 10)).map((x) => x.x?.[0]);
attendre(
  'à date et montant égaux, l’identifiant du marché départage',
  JSON.stringify(memeJour) === JSON.stringify(['2026-11', '2026-12', '2026-13']),
  'trois marchés du même jour au même montant',
  JSON.stringify(memeJour),
);
const go = tout.find((x) => x.objet === 'GROS OEUVRE FONDATIONS');
attendre(
  'les autres lots, par libellé puis montant',
  JSON.stringify(go?.x?.[9]) === JSON.stringify([['MENUISERIES INTERIEURES', 80000], ['PEINTURE', null], ['VRD PAYSAGE', 80000]]),
  '« VRD PAYSAGE » et « MENUISERIES INTERIEURES » ne permutent plus',
  JSON.stringify(go?.x?.[9]),
);

// Les comparateurs eux-mêmes.
attendre(
  'à libellé égal, un montant inconnu passe avant',
  ordreDesLots(['LOT', null], ['LOT', 1]) < 0 && ordreDesLots(['LOT', 2], ['LOT', 1]) > 0,
  'un ordre total, sans égalité entre deux lots différents',
);
const a = { objet: 'A', montant: 1, date: '2026-01-01', procedure: 0, lots: 1 } as Marche;
attendre(
  'deux marchés différents ne sont jamais égaux pour le tri',
  ordreDesMarches(a, { ...a, offres: 2 }) !== 0 && ordreDesMarches(a, { ...a }) === 0,
  'le dernier recours compare le marché entier',
);

console.log(echecs === 0 ? `${VERT}Collecte des marchés indépendante de l'ordre de lecture.${RAZ}` : `${ROUGE}${echecs} échec(s).${RAZ}`);
process.exit(echecs === 0 ? 0 : 1);
