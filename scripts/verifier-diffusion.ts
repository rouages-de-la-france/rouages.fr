/**
 * Vérifie, sans réseau, la relecture du statut de diffusion des entrepreneurs
 * à l'INSEE (`diffusion-insee.ts`) : un SIREN diffusible est gardé, un SIREN en
 * diffusion partielle ou inconnu est refusé, et une API muette ou une clé
 * absente ne retire rien sans le dire. Les SIREN sont inventés.
 */
import { ECHECS } from './echecs.ts';
import { LOT, refusesAJour, requete, statutsDe } from './diffusion-insee.ts';

const ROUGE = '\x1b[31m', VERT = '\x1b[32m', GRIS = '\x1b[90m', RAZ = '\x1b[0m';
let echecs = 0;
function attendre<T>(obtenu: T, attendu: T, pourquoi: string) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) echecs++;
  console.log(`${ok ? VERT + '  ok  ' : ROUGE + 'ÉCHEC '}${RAZ}${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}\n      ${GRIS}${pourquoi}${RAZ}`);
}
const muet = () => {};
const sansPause = async () => {};
const reponse = (status: number, corps: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => corps });

attendre(
  decodeURIComponent(requete(['111111111', '222222222'])).includes('q=siren:(111111111 OR 222222222)'),
  true,
  'une requête multicritère pour le lot',
);
attendre(
  [...statutsDe({ unitesLegales: [{ siren: '111111111', statutDiffusionUniteLegale: 'O' }, { siren: '222222222', statutDiffusionUniteLegale: 'P' }] })],
  [['111111111', 'O'], ['222222222', 'P']],
  'le statut de chaque unité rendue',
);

const vus: { url: string; cle: string }[] = [];
const insee = async (url: string, init: { headers: Record<string, string> }) => {
  vus.push({ url, cle: init.headers['X-INSEE-Api-Key-Integration'] });
  return reponse(200, { unitesLegales: [{ siren: '111111111', statutDiffusionUniteLegale: 'O' }, { siren: '222222222', statutDiffusionUniteLegale: 'P' }] });
};
const r = await refusesAJour(['222222222', '111111111', '333333333', '111111111', 'pas-un-siren'], muet, 'cle-de-test', insee, sansPause);
attendre(r && [...r].sort(), ['222222222', '333333333'], 'diffusion partielle et SIREN inconnu refusés ; le diffusible gardé');
attendre(vus.length, 1, 'trois SIREN distincts, une seule requête');
attendre(vus[0]?.cle, 'cle-de-test', 'la clé dans l’en-tête de l’INSEE');

const beaucoup = Array.from({ length: LOT + 1 }, (_, i) => String(100000000 + i));
let appels = 0;
await refusesAJour(beaucoup, muet, 'cle', async () => (appels++, reponse(404)), sansPause);
attendre(appels, 2, `au-delà de ${LOT} SIREN, un second lot`);
const tous = await refusesAJour(beaucoup.slice(0, 3), muet, 'cle', async () => reponse(404), sansPause);
attendre(tous?.size, 3, 'un 404 : aucun SIREN connu, tous refusés');

let n = 0;
const apres429 = await refusesAJour(['111111111'], muet, 'cle', async () => (n++ === 0 ? reponse(429) : reponse(200, { unitesLegales: [{ siren: '111111111', statutDiffusionUniteLegale: 'O' }] })), sansPause);
attendre(apres429 && [...apres429], [], 'un 429 : on attend et on réessaie');

const avant = ECHECS.length;
attendre(await refusesAJour(['111111111'], muet, '', insee, sansPause), null, 'sans clé : rien de retiré, la copie mensuelle reste seule juge');
attendre(ECHECS.length, avant + 1, 'et la dégradation est comptée parmi les échecs');
attendre(await refusesAJour(['111111111'], muet, 'cle', async () => reponse(403), sansPause), null, 'une clé refusée : même chose');
attendre(ECHECS.length, avant + 1, 'comptée une fois par ingestion, pas à chaque collecte');
attendre(await refusesAJour(['111111111'], muet, 'cle', async () => reponse(503), sansPause), null, 'une API qui ne répond pas : même chose');
attendre([...((await refusesAJour([], muet, '', insee, sansPause)) ?? ['?'])], [], 'rien à vérifier : rien à demander, même sans clé');

console.log(echecs ? `\n${ROUGE}${echecs} échec(s).${RAZ}` : `\n${VERT}Relecture de la diffusion conforme.${RAZ}`);
process.exit(echecs ? 1 : 0);
