/**
 * Vérifie le test d'appartenance de la lecture assistée du PLU
 * (`src/modele/parcelle-plu.ts`) sur des géométries construites ici, sans
 * réseau : le service rend des entités dont l'enveloppe touche la parcelle
 * sans qu'elles la touchent, et c'est ce test qui les écarte.
 *
 * Les cas sont ceux qu'on a mesurés au Mayet-de-Montagne le 18 octobre 2026,
 * réduits à leur forme : une zone qui contient la parcelle, la voisine qui
 * n'en touche que le bord, une servitude dont l'enveloppe couvre tout un
 * département et qui passe à côté, une zone percée d'un trou où tombe la
 * parcelle, une ligne qui longe la limite. Aucune donnée du Géoportail n'est
 * gardée dans le dépôt.
 */
import { typeInformation, typePrescription, typeZone } from '../src/modele/cnig.ts';
import { contact, gabarit, reunir, type Contact, type Gabarit, type Geometrie } from '../src/modele/parcelle-plu.ts';

// Un mètre, en degrés, au Mayet-de-Montagne (46,07° N).
const LAT0 = 46.0725;
const LON0 = 3.6682;
const MX = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const MY = 1 / 110574;
const pt = (x: number, y: number) => [LON0 + x * MX, LAT0 + y * MY];
/** Un rectangle en mètres autour du point de référence, avec ses trous éventuels. */
const rect = (x0: number, y0: number, x1: number, y1: number) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1), pt(x0, y0)];
const poly = (...anneaux: number[][][]): Geometrie => ({ type: 'Polygon', coordinates: anneaux });
const multi = (...polys: number[][][][]): Geometrie => ({ type: 'MultiPolygon', coordinates: polys });
const ligne = (...p: [number, number][]): Geometrie => ({ type: 'LineString', coordinates: p.map(([x, y]) => pt(x, y)) });
const point = (x: number, y: number): Geometrie => ({ type: 'Point', coordinates: pt(x, y) });

// La parcelle : 30 m sur 25 m.
const parcelle = gabarit(poly(rect(0, 0, 30, 25)));

const CAS: [string, Geometrie, Contact | null, Gabarit?][] = [
  ['une zone qui contient la parcelle', poly(rect(-100, -100, 100, 100)), 'toute'],
  ['une zone qui en couvre la moitié', poly(rect(15, -50, 100, 50)), 'partie'],
  ['la zone voisine, qui s’arrête à un mètre dedans', poly(rect(29, -50, 100, 50)), 'bord'],
  ['la zone voisine, qui s’arrête pile sur la limite', poly(rect(30, -50, 100, 50)), 'bord'],
  ['la zone voisine, à vingt centimètres dehors', poly(rect(30.2, -50, 100, 50)), null],
  ['une servitude dont l’enveloppe couvre le département, en L autour de la parcelle', poly([pt(-5000, -5000), pt(5000, -5000), pt(5000, 5000), pt(40, 5000), pt(40, -5), pt(-5000, -5), pt(-5000, -5000)]), null],
  ['une zone percée d’un trou où tombe la parcelle', poly(rect(-100, -100, 100, 100), rect(-10, -10, 40, 35)), null],
  ['une zone percée d’un trou qui mange la moitié de la parcelle', poly(rect(-100, -100, 100, 100), rect(15, -10, 40, 35)), 'partie'],
  ['un petit secteur au milieu de la parcelle', poly(rect(10, 8, 20, 16)), 'partie'],
  ['une zone en deux morceaux qui se partagent la parcelle', multi([rect(-50, -50, 15, 50)], [rect(15, -50, 80, 50)]), 'toute'],
  ['une ligne qui traverse la parcelle', ligne([-10, 12], [40, 12]), 'traverse'],
  ['une ligne qui longe la limite à cinquante centimètres dehors', ligne([-10, -0.5], [40, -0.5]), 'limite'],
  ['une ligne à trois mètres de la parcelle', ligne([-10, -3], [40, -3]), null],
  ['un point dans la parcelle', point(5, 5), 'traverse'],
  ['un point à quatre-vingts centimètres de la limite', point(30.8, 10), 'limite'],
  ['un point à cinq mètres', point(35, 10), null],
];

// Une parcelle de deux mètres sur quatre, partagée entre deux zones : chacune en couvre une partie, pas le bord.
CAS.push(['une zone qui couvre la moitié d’une parcelle de huit mètres carrés', poly(rect(-10, 2, 10, 10)), 'partie', gabarit(poly(rect(0, 0, 2, 4)))]);

let erreurs = 0;
for (const [quoi, g, attendu, gab = parcelle] of CAS) {
  const obtenu = contact(gab, g);
  if (obtenu !== attendu) {
    console.error(`« ${quoi} » : attendu ${attendu ?? 'rien'}, obtenu ${obtenu ?? 'rien'}`);
    erreurs++;
  }
}

// Deux morceaux de la même zone, rendus séparément : réunis, ils couvrent la parcelle ; seuls, chacun en partie.
const gauche = poly(rect(-50, -50, 15, 50));
const droite = poly(rect(15, -50, 80, 50));
if (contact(parcelle, gauche) !== 'partie' || contact(parcelle, reunir([gauche, droite])) !== 'toute') {
  console.error('deux morceaux d’une même zone devraient couvrir ensemble toute la parcelle');
  erreurs++;
}

// Les types CNIG : le sous-code précis, le générique à défaut, et l'ancien code transféré.
const types: [string, string | undefined, string][] = [
  ['zone UA', typeZone('U')?.libelle, 'urbaine'],
  ['zone AUs', typeZone('AUs')?.code, 'AUs'],
  ['zone « AU » d’un ancien document, gardée telle quelle', `${typeZone('AU')?.code} ${typeZone('AU')?.libelle}`, 'AU à urbaniser'],
  ['emplacement réservé aux voies', typePrescription({ typepsc: '05', stypepsc: '01' })?.libelle, 'Emplacement réservé aux voies publiques'],
  ['sous-code inconnu', typePrescription({ typepsc: '05', stypepsc: '42' })?.code, '05-00'],
  ['code numérique sans zéro', typePrescription({ typepsc: 2, stypepsc: 0 })?.code, '02-00'],
  ['ancien code 11', typePrescription({ typepsc: '11', stypepsc: '00' })?.libelle, 'Anciennement code 11, est transféré en code 15 Règles d’implantation des constructions'],
  ['droit de préemption urbain', typeInformation({ typeinf: '04', stypeinf: '00' })?.libelle, 'Périmètre de droit de préemption urbain'],
  ['assainissement, sous-code 01 seul', typeInformation({ typeinf: '19', stypeinf: '00' })?.code, '19-01'],
  ['patrimoine mondial, sans sous-code 00', typeInformation({ typeinf: '40', stypeinf: '00' })?.code, '40-01'],
];
for (const [quoi, obtenu, attendu] of types)
  if (obtenu !== attendu) {
    console.error(`type CNIG, ${quoi} : attendu « ${attendu} », obtenu « ${obtenu} »`);
    erreurs++;
  }
if (typePrescription({ typepsc: '77' }) !== null) {
  console.error('un code absent du standard doit rester sans type');
  erreurs++;
}

if (erreurs) {
  console.error(`${erreurs} erreur(s) dans la lecture de la parcelle.`);
  process.exit(1);
}
console.log(`Lecture de la parcelle : ${CAS.length + 1} cas de géométrie et ${types.length + 1} types CNIG conformes.`);
