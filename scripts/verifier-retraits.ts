/**
 * Vérifie ce qu'une annonce du BODACC montre d'une entreprise qui a demandé à
 * ne plus être nommée (`retraits.yaml`, section `entreprises`).
 *
 * Le premier cas réel (novembre 2026) l'a montré : pour l'une des deux
 * activités, le « nom commercial » déclaré était le nom de la personne. Garder
 * le nom commercial l'aurait nommée encore. Les noms ci-dessous sont inventés.
 */
import { nomAffiche, nommables, type PersonneAnnonce } from './entreprises-emettre.ts';
import { retraitsDe } from './retraits.ts';

const ROUGE = '\x1b[31m', VERT = '\x1b[32m', GRIS = '\x1b[90m', RAZ = '\x1b[0m';
let echecs = 0;
function attendre<T>(obtenu: T, attendu: T, pourquoi: string) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) echecs++;
  console.log(
    `${ok ? VERT + '  ok  ' : ROUGE + 'ÉCHEC '}${RAZ}${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}\n      ${GRIS}${pourquoi}${RAZ}`,
  );
}

const yaml = `
entreprises:
  - "111 111 111"
  - siren: "222222222"
    affichage: commercial
  - siren: "333333333"
    affichage: anonyme
  - siren: "444444444"
    affichage: commercial
  - siren: "555555555"
    affichage: commercial
  - siren: "666666666"
    affichage: autre
`;
const r = retraitsDe(yaml);
attendre([...r.entreprises].sort(), ['111111111', '222222222', '333333333', '444444444', '555555555', '666666666'], 'toutes les oppositions comptent, quel que soit l’affichage');
attendre(r.affichages.get('111111111') ?? null, null, 'un SIREN seul : retrait complet');
attendre(r.affichages.get('666666666') ?? null, null, 'un affichage inconnu vaut retrait complet');
attendre(retraitsDe('').entreprises.size, 0, 'sans fichier, aucune opposition');

const pp = (siren: string, prenom: string, nom: string, commercial = ''): PersonneAnnonce => ({
  siren,
  pp: true,
  nom: `${prenom} ${nom}${commercial ? ` (${commercial})` : ''}`,
  famille: nom,
  commercial,
});
const vu = (p: PersonneAnnonce[]) => nomAffiche(p, r.entreprises, r.affichages);

attendre(vu([pp('999999999', 'Jeanne', 'DURAND-FICTIF', 'Les Tilleuls')]), 'Jeanne DURAND-FICTIF (Les Tilleuls)', 'sans opposition, rien ne change');
attendre(vu([pp('111111111', 'Jeanne', 'DURAND-FICTIF', 'Les Tilleuls')]), null, 'retrait complet : l’annonce n’est plus montrée');
attendre(vu([pp('222222222', 'Jeanne', 'DURAND-FICTIF', 'Gîte Les Tilleuls')]), 'Gîte Les Tilleuls', 'commercial : le seul nom commercial');
attendre(vu([pp('333333333', 'Jeanne', 'DURAND-FICTIF', 'Gîte Les Tilleuls')]), 'Entreprise individuelle', 'anonyme : aucun nom');
attendre(vu([pp('444444444', 'Jeanne', 'Durand-Fictif', 'JEANNE DURAND FICTIF')]), 'Entreprise individuelle', 'commercial, mais le nom commercial est le nom de la personne : anonyme');
attendre(vu([pp('444444444', 'Jeanne', 'Bénard', 'Atelier Benard')]), 'Entreprise individuelle', 'le nom de famille dans le nom commercial, accents et casse mis à part : anonyme');
attendre(vu([pp('555555555', 'Jeanne', 'DURAND-FICTIF')]), 'Entreprise individuelle', 'commercial sans nom commercial : anonyme');
attendre(vu([pp('222222222', 'Jeanne', 'Bernard', 'Bernardin Traiteur')]), 'Bernardin Traiteur', 'un nom qui en contient un autre n’est pas le même mot');
attendre(
  vu([{ siren: '333333333', pp: false, nom: 'SCI DES TILLEULS', famille: '', commercial: '' }, pp('999999999', 'Paul', 'MARTIN-FICTIF')]),
  'Société, Paul MARTIN-FICTIF',
  'une société anonyme parmi d’autres personnes : seule elle perd son nom',
);
attendre(
  vu([{ siren: '222222222', pp: false, nom: 'SCI DES TILLEULS', famille: '', commercial: '' }]),
  'SCI DES TILLEULS',
  'une société en commercial garde sa dénomination',
);

// La liste des personnes telle que le BODACC la publie.
const annonce = JSON.stringify({
  personne: {
    typePersonne: 'pp',
    nom: 'DURAND-FICTIF',
    prenom: 'Jeanne, Marie',
    nomCommercial: 'Gîte Les Tilleuls',
    numeroImmatriculation: { numeroIdentification: '222 222 222' },
  },
});
const n = nommables(annonce)!;
attendre(n.noms, ['Jeanne DURAND-FICTIF (Gîte Les Tilleuls)'], 'le nom affiché sans opposition');
attendre(nomAffiche(n.personnes, r.entreprises, r.affichages), 'Gîte Les Tilleuls', 'de l’annonce publiée au nom affiché');

console.log(echecs ? `${ROUGE}${echecs} échec(s).${RAZ}` : `${VERT}Retraits des entreprises conformes.${RAZ}`);
process.exit(echecs ? 1 : 0);
