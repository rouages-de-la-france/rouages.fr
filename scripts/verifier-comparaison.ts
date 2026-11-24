/**
 * Vérifie les règles de `comparer-reingestion.ts`, sans git ni réseau.
 *
 * Le contrôle sert une seule fois par réingestion, sur des milliers de
 * fichiers : une règle qui se tairait à tort ne se verrait pas. Le cas qui l'a
 * motivé est fixé ici — le patrimoine mondial passé de 1 247 à 685 communes à
 * la réingestion du 21 novembre 2026, sans alerte.
 */
import { alertes, jeu, mesurer, type Ligne } from './comparer-reingestion.ts';

const ROUGE = '\x1b[31m', VERT = '\x1b[32m', GRIS = '\x1b[90m', RAZ = '\x1b[0m';
let echecs = 0;

function attendre(quoi: string, obtenu: unknown, attendu: unknown, pourquoi: string) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) echecs++;
  console.log(
    `${ok ? VERT + '  ok  ' : ROUGE + 'ÉCHEC '}${RAZ}${quoi} → ${JSON.stringify(obtenu)}` +
      (ok ? '' : ` (attendu ${JSON.stringify(attendu)})`) +
      `\n      ${GRIS}${pourquoi}${RAZ}`,
  );
}

/** Un fichier de `n` communes, chacune avec deux valeurs. */
const fichier = (n: number) => JSON.stringify({ maj: '2026-11-24', c: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(3000 + i), [1, 2]])) });
const ligne = (chemin: string, avant: string | null, apres: string | null): Ligne => ({
  chemin,
  avant: avant === null ? null : mesurer(avant),
  apres: apres === null ? null : mesurer(apres),
});
const messages = (l: Ligne[]) => alertes(l).map((a) => `${a.jeu}${a.chemin ? ' (fichier)' : ''}`);

attendre('le jeu d’un fichier', ['public/territoires/dep/03-dvf.json', 'public/territoires/marches/03/x.json', 'public/territoires/patrimoine-mondial.json'].map(jeu), ['dvf', 'marches/', 'patrimoine-mondial'], 'le même regroupement que la table du workflow');
attendre('la mesure', mesurer(fichier(3)), { communes: 3, valeurs: 7, octets: Buffer.byteLength(fichier(3)) }, 'trois communes, six valeurs et la date');
attendre('le patrimoine mondial du 21 novembre', messages([ligne('public/territoires/patrimoine-mondial.json', fichier(1247), fichier(685))]), ['patrimoine-mondial (fichier)', 'patrimoine-mondial'], '−45 % des communes : alerte sur le fichier et sur le jeu');
attendre('une baisse sous le seuil', messages([ligne('public/territoires/dep/03-dvf.json', fichier(100), fichier(96))]), [], '−4 % des communes : rien');
attendre('une baisse répartie', messages(Array.from({ length: 10 }, (_, i) => ligne(`public/territoires/dep/${10 + i}-eau.json`, fichier(100), fichier(i < 5 ? 88 : 100)))), ['eau (fichier)', 'eau (fichier)', 'eau (fichier)', 'eau (fichier)', 'eau (fichier)', 'eau'], 'cinq fichiers à −12 %, et le jeu à −6 %');
attendre('un fichier vidé', messages([ligne('public/territoires/dep/03-eau.json', fichier(10), JSON.stringify({ maj: 'x', c: {} }))]), ['eau (fichier)', 'eau'], 'il ne reste que la date');
attendre('un fichier déjà presque vide', messages([ligne('public/territoires/recherche-deliberations/83/i-k.json', '[1]', '[2]')]), [], 'une valeur avant, une après : pas une alerte');
attendre('un fichier supprimé, un ajouté', messages([ligne('public/territoires/dep/03-eau.json', fichier(5), null), ligne('public/territoires/dep/03-air.json', null, fichier(5))]), ['eau (fichier)', 'eau'], 'la suppression alerte, l’ajout non');

console.log(echecs === 0 ? `\n${VERT}Comparaison conforme.${RAZ}` : `\n${ROUGE}${echecs} règle(s) de la comparaison ne tiennent plus.${RAZ}`);
process.exit(echecs === 0 ? 0 : 1);
