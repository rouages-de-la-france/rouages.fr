/**
 * Les bâtiments de chaque commune, d'après la Base de données nationale des
 * bâtiments (BDNB, CSTB), dans sa version ouverte (Licence Ouverte 2.0).
 *
 * La BDNB croise une cinquantaine de sources publiques au bâtiment. On n'en
 * garde ici que des comptes par commune, tirés des tables ouvertes :
 *
 * - les groupes de bâtiments, et leur usage principal ;
 * - ceux que décrivent les fichiers fonciers : l'année de construction, rangée
 *   par période, et le nombre de logements ;
 * - les copropriétés immatriculées (registre national), et leurs logements ;
 * - le logement social (RPLS) : les logements, et chaque ensemble — leur
 *   nombre, les années de construction, individuel ou collectif, l'étiquette
 *   énergétique principale ;
 * - le raccordement à un réseau de chaleur, ou la distance au plus proche ;
 * - l'aléa de retrait-gonflement des argiles.
 *
 * Rien n'est nommé : ni propriétaire (réservé aux ayants droit, et absent de
 * la version ouverte), ni copropriété, ni bailleur.
 *
 * **Le coût.** Un fichier par département — 333 Mo pour l'Allier, 40 Go pour
 * la France —, lu en flux dans l'archive, puis effacé. La BDNB paraît trois
 * fois par an : tant que le millésime ne change pas, rien n'est refait, comme
 * pour la couverture mobile de l'Arcep. `ROUAGES_BDNB_FORCER=1` force le
 * calcul.
 *
 * Au Mayet-de-Montagne (millésime 2026-02.b) : 1 569 groupes de bâtiments,
 * 939 décrits par les fichiers fonciers, dont 376 d'avant 1919 sur 884
 * d'année connue ; 100 logements sociaux en 8 ensembles ; 32 bâtiments
 * raccordés au réseau de chaleur. Chiffres relus par le mainteneur le
 * 19 novembre 2026.
 *
 * Lancé seul — `tsx scripts/batiments-emettre.ts [03 15 …]` —, il réécrit
 * `public/territoires/dep/XX-batiments.json`, pour les départements donnés
 * ou pour tous.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';
import { communeDe, lignesCsv, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

const JEU = 'https://www.data.gouv.fr/api/1/datasets/base-de-donnees-nationale-des-batiments/';
const ARCHIVE = (m: string, dep: string) =>
  `https://open-data.s3.fr-par.scw.cloud/bdnb_millesime_${m}/millesime_${m}_dep${dep.toLowerCase()}/open_data_millesime_${m}_dep${dep.toLowerCase()}_csv.zip`;

export const PERIODES = ['avant 1919', '1919-1945', '1946-1970', '1971-1990', '1991-2005', 'depuis 2006'] as const;
const BORNES = [1919, 1946, 1971, 1991, 2006];
export const USAGES = ['Résidentiel individuel', 'Résidentiel collectif', 'Tertiaire', 'Dépendance', 'Secondaire', 'Primaire', 'Autre'] as const;
export const ARGILE = ['Faible', 'Moyen', 'Fort'] as const;
/** Au plus tant d'ensembles de logement social par commune : les plus grands. */
const ENSEMBLES = 12;

/** Un ensemble de logement social : logements, années de construction, types de construction, étiquette principale. */
export type Ensemble = [number, string, string, string];

/**
 * Par commune : groupes de bâtiments, groupes décrits par les fichiers
 * fonciers, logements des fichiers fonciers, bâtiments par période (dans
 * l'ordre de PERIODES), par usage (USAGES), copropriétés [immatriculées,
 * logements], logement social [ensembles, logements, ensembles détaillés],
 * réseau de chaleur [raccordés, à moins de 100 m, de 100 à 200 m, de 200 à
 * 400 m], aléa argile (ARGILE).
 */
export type BatimentsCommune = [
  number,
  number,
  number,
  number[],
  number[],
  [number, number],
  [number, number, Ensemble[]],
  [number, number, number, number],
  number[],
];

const nouvelle = (): BatimentsCommune => [0, 0, 0, PERIODES.map(() => 0), USAGES.map(() => 0), [0, 0], [0, 0, []], [0, 0, 0, 0], ARGILE.map(() => 0)];

/** Une liste écrite `[ "1970", "1982" ]` dans la BDNB. */
const liste = (v: string): string[] => {
  try {
    const l = JSON.parse(v || '[]');
    return Array.isArray(l) ? [...new Set(l.map(String))] : [];
  } catch {
    return v ? [v] : [];
  }
};
const entier = (v: string) => Math.round(Number(v) || 0);

/** Les lignes d'une table de l'archive, lue en flux, comme des objets. */
async function* table(archive: string, nom: string): AsyncGenerator<Record<string, string>> {
  const p = spawn('unzip', ['-p', archive, `csv/${nom}.csv`]);
  let erreur: Error | null = null;
  p.on('error', () => (erreur = new Error('« unzip » est requis pour lire l’archive de la BDNB')));
  let entete: string[] | null = null;
  for await (const l of lignesCsv(p.stdout, ';')) {
    if (!entete) entete = l.map((h) => h.replace(/^﻿/, '').trim());
    else yield Object.fromEntries(entete.map((h, i) => [h, l[i] ?? '']));
  }
  if (erreur) throw erreur;
}

/** Le millésime le plus récent, d'après les ressources du jeu sur data.gouv.fr. */
export async function dernierMillesime(json: <T>(url: string) => Promise<T>): Promise<string> {
  const j = await json<{ resources: { url: string }[] }>(JEU);
  const m = j.resources
    .map((r) => /bdnb_millesime_(\d{4}-\d{2}-[a-z])\//.exec(r.url)?.[1])
    .filter((x): x is string => !!x)
    .sort();
  if (!m.length) throw new Error('aucun millésime dans les ressources du jeu');
  return m[m.length - 1];
}

function dejaCalcule(sortie: string, millesime: string): boolean {
  const dossier = join(sortie, 'dep');
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith('-batiments.json'));
  if (fichiers.length < 90) return false;
  return fichiers.every((f) => {
    try {
      return (JSON.parse(readFileSync(join(dossier, f), 'utf8')) as { millesime?: string }).millesime === millesime;
    } catch {
      return false;
    }
  });
}

/** Lit un département et rend ses communes. */
export async function lireDepartement(
  archive: string,
  reports: { actuelles: Set<string>; reports: Map<string, string> },
): Promise<Map<string, BatimentsCommune>> {
  const communeDuGroupe = new Map<string, string>();
  const communes = new Map<string, BatimentsCommune>();
  const de = (id: string) => {
    const c = communeDuGroupe.get(id);
    return c ? communes.get(c) : undefined;
  };

  for await (const r of table(archive, 'batiment_groupe')) {
    const brut = r.code_commune_insee;
    const code = communeDe(reports.actuelles.has(brut) ? brut : (reports.reports.get(brut) ?? ''));
    if (!code) continue;
    communeDuGroupe.set(r.batiment_groupe_id, code);
    if (!communes.has(code)) communes.set(code, nouvelle());
    communes.get(code)![0]++;
  }
  for await (const r of table(archive, 'batiment_groupe_synthese_propriete_usage')) {
    const c = de(r.batiment_groupe_id);
    if (!c) continue;
    const i = USAGES.indexOf(r.usage_principal_bdnb_open as (typeof USAGES)[number]);
    c[4][i >= 0 ? i : USAGES.length - 1]++;
  }
  for await (const r of table(archive, 'batiment_groupe_ffo_bat')) {
    const c = de(r.batiment_groupe_id);
    if (!c) continue;
    c[1]++;
    c[2] += entier(r.nb_log);
    const a = Number(r.annee_construction);
    if (a > 1000 && a <= new Date().getUTCFullYear()) c[3][BORNES.filter((b) => a >= b).length]++;
  }
  for await (const r of table(archive, 'batiment_groupe_rnc')) {
    const c = de(r.batiment_groupe_id);
    if (!c) continue;
    c[5][0]++;
    c[5][1] += entier(r.nb_log);
  }
  for await (const r of table(archive, 'batiment_groupe_rpls')) {
    const c = de(r.batiment_groupe_id);
    if (!c) continue;
    const n = entier(r.nb_log);
    c[6][0]++;
    c[6][1] += n;
    c[6][2].push([n, liste(r.l_annee_construction).sort().join(', '), liste(r.type_construction).join(', '), r.classe_ener_principale ?? '']);
  }
  for await (const r of table(archive, 'batiment_groupe_indicateur_reseau_chaud_froid')) {
    const c = de(r.batiment_groupe_id);
    if (!c) continue;
    const d = r.indicateur_distance_au_reseau;
    if (/raccord/i.test(d)) c[7][0]++;
    else if (/inf[ée]rieure? .{0,3}100/i.test(d)) c[7][1]++;
    else if (/100 et 200/.test(d)) c[7][2]++;
    else if (/200 et 400/.test(d)) c[7][3]++;
  }
  for await (const r of table(archive, 'batiment_groupe_risques')) {
    const c = de(r.batiment_groupe_id);
    if (!c) continue;
    const i = ARGILE.indexOf(r.alea_argile as (typeof ARGILE)[number]);
    if (i >= 0) c[8][i]++;
  }
  for (const c of communes.values()) c[6][2] = c[6][2].sort((x, y) => y[0] - x[0]).slice(0, ENSEMBLES);
  return communes;
}

export async function collecterBatiments(
  sortie: string,
  json: <T>(url: string) => Promise<T>,
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
  /** Pour un essai : ces départements seulement. */
  seuls?: string[],
): Promise<{ millesime: string; departements: number } | null> {
  const millesime = await dernierMillesime(json);
  if (!process.env.ROUAGES_BDNB_FORCER && !seuls && dejaCalcule(sortie, millesime)) {
    dire(`  Bâtiments : déjà calculés pour le millésime ${millesime} de la BDNB ; rien à refaire.`);
    return null;
  }
  const reports = reportsDuDecoupage();
  const deps =
    seuls ??
    readdirSync(join(sortie, 'dep'))
      .map((f) => /^([0-9]{2,3}|2[AB])\.json$/.exec(f)?.[1])
      .filter((d): d is string => !!d)
      .sort();
  let ecrits = 0;
  const manques: string[] = [];
  for (const dep of deps) {
    const archive = join(cache, `bdnb-${millesime}-${dep}.zip`);
    try {
      await telecharger(ARCHIVE(millesime, dep), archive);
      const communes = await lireDepartement(archive, reports);
      const c = Object.fromEntries([...communes].filter(([code]) => code.startsWith(dep)).sort());
      writeFileSync(
        join(sortie, 'dep', `${dep}-batiments.json`),
        JSON.stringify({ maj: new Date().toISOString().slice(0, 10), millesime, periodes: PERIODES, usages: USAGES, argile: ARGILE, c }),
      );
      ecrits++;
    } catch (e) {
      manques.push(`${dep} (${(e as Error).message.slice(0, 80)})`);
    } finally {
      // 40 Go pour la France : l'archive part dès qu'elle est lue.
      if (existsSync(archive)) rmSync(archive, { force: true });
    }
  }
  if (ecrits === 0) return indisponible(dire, `Bâtiments : aucun département lu dans la BDNB ${millesime}.`);
  dire(
    `Bâtiments (BDNB ${millesime}) : ${ecrits} départements écrits` +
      (manques.length ? ` ; non lus : ${manques.join(', ')}` : '') +
      '.',
  );
  return { millesime, departements: ecrits };
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const seuls = process.argv.slice(2);
  await collecterBatiments(sortie, lireJson as <T>(url: string) => Promise<T>, telecharger, cache, console.log, seuls.length ? seuls : undefined);
}
