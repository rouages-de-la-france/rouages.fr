/**
 * Vérifie le choix d'une ressource data.gouv.fr par son motif
 * (`scripts/ressource-motif.ts`), sans réseau.
 *
 * Novembre 2026 : la veille déclarait Sitadel et les résultats des
 * municipales « changés de forme » parce que le motif n'était cherché que dans
 * le titre, et la collecte des logements autorisés échouait en silence pour la
 * même raison. Les cas ci-dessous reprennent les titres et les adresses que
 * data.gouv.fr publiait le 12 novembre 2026.
 */
import { ressourcesQuiPortent } from './ressource-motif.ts';

const ROUGE = '\x1b[31m', VERT = '\x1b[32m', RAZ = '\x1b[0m';
let echecs = 0;

type R = { title?: string; url?: string };
const titres = (rs: R[]) => rs.map((r) => r.title ?? r.url);

function attendre(nom: string, obtenu: R[], attendu: R[]) {
  const a = JSON.stringify(titres(obtenu)), b = JSON.stringify(titres(attendu));
  if (a !== b) {
    echecs++;
    console.log(`${ROUGE}échec${RAZ} ${nom} : ${a}, attendu ${b}`);
  }
}

// Sitadel : le titre ne dit plus « csv », l'adresse du fichier le dit.
const sitadelPage: R = {
  title: 'Logements autorisés et commencés, nombre et surfaces, séries mensuelles communales en date de prise en compte',
  url: 'https://www.statistiques.developpement-durable.gouv.fr/catalogue?page=datafile&datafileRid=577a8a66-4157-4787-b00a-031b61afea61',
};
const sitadelFichier: R = {
  title: sitadelPage.title,
  url: 'https://data.statistiques.developpement-durable.gouv.fr/dido/api/v1/datafiles/577a8a66-4157-4787-b00a-031b61afea61/csv',
};
attendre('Sitadel', ressourcesQuiPortent([sitadelPage, sitadelFichier], 'csv'), [sitadelFichier]);

// Municipales : le titre écrit « Résultats - Communes », l'adresse « resultats-communes ».
const communes: R = {
  title: 'Municipales 2026 - Résultats - Communes_2026-03-20.csv',
  url: 'https://static.data.gouv.fr/resources/elections-municipales-2026-resultats-du-premier-tour/20260320-164339/municipales-2026-resultats-communes-2026-03-20.csv',
};
const bureaux: R = {
  title: 'Municipales 2026 - Résultats - BV par communes_2026-03-20.csv',
  url: 'https://static.data.gouv.fr/resources/elections-municipales-2026-resultats-du-premier-tour/20260320-164249/municipales-2026-resultats-bv-par-communes-2026-03-20.csv',
};
attendre('Municipales', ressourcesQuiPortent([bureaux, communes], 'resultats-communes'), [communes]);

// Quand le titre désigne déjà la ressource, l'adresse n'en ajoute pas d'autre.
const parTitre: R = { title: 'Conseillers municipaux', url: 'https://x.fr/rne/cm.csv' };
const parAdresse: R = { title: 'Archive', url: 'https://x.fr/rne/conseillers-municipaux-2020.csv' };
attendre('Priorité au titre', ressourcesQuiPortent([parAdresse, parTitre], 'conseillers municipaux'), [parTitre]);

// La casse ne compte pas ; un motif absent partout ne rend rien.
attendre('Casse', ressourcesQuiPortent([communes], 'RESULTATS-COMMUNES'), [communes]);
attendre('Motif absent', ressourcesQuiPortent([communes, bureaux], 'candidatures'), []);
// Sans titre, l'adresse suffit, comme avant.
const sansTitre: R = { url: 'https://x.fr/geodae.csv' };
attendre('Sans titre', ressourcesQuiPortent([sansTitre], 'geodae.csv'), [sansTitre]);

if (echecs) {
  console.log(`${ROUGE}${echecs} échec(s).${RAZ}`);
  process.exit(1);
}
console.log(`${VERT}Choix des ressources par motif : 6 cas conformes.${RAZ}`);
