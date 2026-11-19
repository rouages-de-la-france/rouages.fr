/**
 * Les déchèteries de chaque commune, et qui les exploite.
 *
 * La base permanente des équipements de l'INSEE les compte déjà. L'annuaire
 * SINOE de l'ADEME (Licence Ouverte) dit en plus le nom du site, son
 * exploitant, le mode de gestion choisi par la collectivité — régie, marché de
 * prestation de service, délégation de service public, gestion privée — et
 * si les professionnels y sont acceptés. Une ligne par site et par année
 * d'enquête ; l'année en cours donne « les informations à la date de mise à
 * jour du jeu ». On ne garde qu'elle : un site absent de l'année en cours
 * n'est plus ouvert.
 *
 * **L'exploitant n'est nommé que s'il est public** — syndicat, communauté,
 * commune. Un exploitant privé est dit « une entreprise » : l'annuaire ne
 * donne pas son SIREN, et parmi les « entreprises et artisans » il peut y
 * avoir un entrepreneur individuel, qu'on ne nomme pas sans pouvoir relire
 * son statut de diffusion (CLAUDE.md, « Les noms dans les données »).
 *
 * Le code commune suit le découpage de 2014 : il est reporté sur la commune
 * actuelle.
 *
 * Au Mayet-de-Montagne : la déchèterie de la zone de Mornier, exploitée en
 * régie par le SICTOM Sud-Allier, ouverte aux professionnels.
 *
 * Lancé seul — `tsx scripts/decheteries-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-decheteries.json`.
 */
import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';
import { communeDe, ecrireParDepartement, lignesCsv, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

const ADRESSE = 'https://data.ademe.fr/data-fair/api/v1/datasets/sinoe-(r)-annuaire-des-decheteries-dma/raw';

/** Les modes de gestion, tels que l'ADEME les documente (champ LOV_MO_GEST). */
export const MODES: Record<string, string> = {
  REGIE: 'en régie',
  ENTRE: 'dans le cadre d’un marché de prestation de service',
  GESDE: 'en délégation de service public',
  PRIVE: 'en gestion privée',
};

/** Les exploitants qu'on nomme : des personnes publiques (nomenclature SINOE des acteurs). */
const PUBLICS = /syndicat|sivom|sivu|communaut|m[ée]tropole|commune|d[ée]partement|r[ée]gion|[ée]tablissement public|p[ôo]le|eptb|ept\b/i;

/** Nom du site, exploitant public (vide s'il est privé), mode (clé de MODES), professionnels acceptés, année d'ouverture. */
export type Decheterie = [string, string, string, 0 | 1, number | null];

export interface Decheteries {
  annee: number;
  maj: string;
  communes: Map<string, Decheterie[]>;
}

export async function collecterDecheteries(
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Decheteries | null> {
  const fichier = join(cache, 'sinoe-decheteries.csv');
  await telecharger(ADRESSE, fichier);
  const { actuelles, reports } = reportsDuDecoupage();
  // Une commune fusionnée sans devenir déléguée n'est pas dans les reports
  // (Château-d'Olonne, Tatinghem…) : son code postal désigne alors la commune
  // actuelle, s'il n'en désigne qu'une dans le département.
  const parCodePostal = new Map<string, string[]>();
  const toutes = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('@etalab/decoupage-administratif/data/communes.json'), 'utf8')) as {
    code: string;
    type: string;
    departement?: string;
    codesPostaux?: string[];
  }[];
  for (const c of toutes) {
    if (c.type !== 'commune-actuelle') continue;
    for (const cp of c.codesPostaux ?? []) parCodePostal.set(cp, [...(parCodePostal.get(cp) ?? []), c.code]);
  }
  const parPoste = (cp: string, dep: string) => {
    const l = (parCodePostal.get(cp) ?? []).filter((c) => c.startsWith(dep));
    return l.length === 1 ? l[0] : '';
  };

  const lignes: Record<string, string>[] = [];
  let entete: string[] | null = null;
  for await (const l of lignesCsv(createReadStream(fichier), ';')) {
    if (!entete) entete = l.map((h) => h.replace(/^\uFEFF/, '').trim());
    else lignes.push(Object.fromEntries(entete.map((h, i) => [h, l[i] ?? ''])));
  }
  if (lignes.length === 0 || !('ANNEE' in lignes[0]) || !('C_COMM' in lignes[0]) || !('LOV_MO_GEST' in lignes[0])) {
    return indisponible(dire, 'Déchèteries : l’annuaire de SINOE a changé de forme.');
  }
  const annee = Math.max(...lignes.map((l) => Number(l.ANNEE) || 0));
  const courantes = lignes.filter((l) => Number(l.ANNEE) === annee);
  if (courantes.length < 3000) {
    return indisponible(dire, `Déchèteries : ${courantes.length} sites seulement pour ${annee}, on garde l’ingestion précédente.`);
  }

  const communes = new Map<string, Decheterie[]>();
  let nommes = 0;
  let perdus = 0;
  for (const l of courantes) {
    const brut = (l.C_COMM ?? '').trim().padStart(5, '0');
    const code = communeDe(
      actuelles.has(brut) ? brut : (reports.get(brut) ?? parPoste((l.CP_SITE ?? '').trim(), (l.C_DEPT ?? '').trim())),
    );
    if (!code) {
      perdus++;
      continue;
    }
    const publique = PUBLICS.test(l.L_TYP_ACTEUR ?? '') && !/entreprise|artisan|priv/i.test(l.L_TYP_ACTEUR ?? '');
    if (publique) nommes++;
    const ouverture = /^(\d{4})/.exec(l.D_OUV ?? '')?.[1];
    const d: Decheterie = [
      (l.N_SERVICE ?? '').trim(),
      publique ? (l.N_ACTEUR ?? '').trim() : '',
      (l.LOV_MO_GEST ?? '').trim(),
      /PRO/.test(l.ORIGINE_DECHET_ACC ?? '') ? 1 : 0,
      ouverture ? Number(ouverture) : null,
    ];
    if (!communes.has(code)) communes.set(code, []);
    communes.get(code)!.push(d);
  }
  const sites = [...communes.values()].reduce((s, l) => s + l.length, 0);
  dire(
    `Déchèteries ${annee} : ${sites.toLocaleString('fr-FR')} sites dans ${communes.size.toLocaleString('fr-FR')} communes, ` +
      `${nommes.toLocaleString('fr-FR')} à exploitant public nommé ; ${perdus} sans commune actuelle reconnue.`,
  );
  return { annee, maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireDecheteries(sortie: string, d: Decheteries): number {
  return ecrireParDepartement(sortie, 'decheteries', d.communes, () => ({ maj: d.maj, annee: d.annee }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const d = await collecterDecheteries(telecharger, cache, console.log);
  if (d) console.log(`${ecrireDecheteries(sortie, d)} départements écrits.`);
}
