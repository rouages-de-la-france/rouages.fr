/**
 * L'agriculture biologique, commune par commune, d'après l'Agence Bio
 * (data.gouv.fr, jeu 61a6250d8660681353681fa8, « Historique détaillé des
 * surfaces, cheptels et nombre d'opérateurs par commune », Licence Ouverte) :
 * des comptes issus des contrôles annuels des organismes certificateurs.
 *
 * Deux fichiers :
 *
 * - **les opérateurs**, de 2008 à la dernière année : par commune, par
 *   activité principale (P production, T transformation, D distribution,
 *   I importation) et, pour les producteurs, par production principale ;
 * - **les surfaces** certifiées bio ou en conversion en fin d'année, en
 *   hectares, et le nombre d'exploitations engagées. L'Agence Bio les
 *   déclare dans la commune du site d'activité, à défaut du siège : les
 *   parcelles d'une exploitation peuvent être ailleurs. Les surfaces
 *   sont publiées « NC » (les fichiers sont intitulés « secretstat ») pour
 *   toute commune de moins de trois exploitations engagées — constaté sur
 *   l'année 2025 : 11 511 communes à une ou deux exploitations, toutes « NC »,
 *   aucune au-delà. La page dit alors qu'elles ne sont pas publiées, sans
 *   rien estimer.
 *
 * Aucun nom ici : ce sont des comptes. Une commune absente d'une année n'y
 * avait aucun opérateur recensé.
 *
 * Les adresses des fichiers changent à chaque publication : la collecte les
 * retrouve par leur titre dans la fiche du jeu.
 *
 * Lancé seul — `tsx scripts/bio-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-bio.json`.
 */
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { communeDe, ecrireParDepartement, lignesCsv, telechargerSiAbsent } from './par-departement.ts';
import { indisponible } from './echecs.ts';

export const JEU = '61a6250d8660681353681fa8';

/**
 * Une commune : les opérateurs année par année ([année, nombre]), la dernière année en détail —
 * par activité principale [P, T, D, I] et les producteurs par production principale —, et les
 * surfaces de la dernière année [exploitations, surface bio, dont certifiée, dont en
 * conversion], en hectares (null sous le secret statistique), avec leur historique
 * ([année, surface bio ou null]).
 */
export interface Bio {
  o: [number, number][];
  a: [number, number, number, number];
  p: [string, number][];
  s: [number, number | null, number | null, number | null] | null;
  h: [number, number | null][];
}

export interface Bios {
  maj: string;
  annee: number;
  anneeSurfaces: number;
  communes: Map<string, Bio>;
}

const ha = (v: string) => (v === 'NC' || v === '' ? null : Math.round(Number(v) * 100) / 100);

async function* lignes(chemin: string): AsyncGenerator<Record<string, string>> {
  let entete: string[] | null = null;
  for await (const v of lignesCsv(createReadStream(chemin) as unknown as AsyncIterable<Uint8Array>, ',')) {
    if (!entete) {
      entete = v.map((x) => x.replace(/^﻿/, '').trim());
      continue;
    }
    yield Object.fromEntries(entete.map((n, i) => [n, (v[i] ?? '').trim()]));
  }
}

export async function collecterBio(
  lireJson: (url: string) => Promise<unknown>,
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Bios | null> {
  const r = (await lireJson(`https://www.data.gouv.fr/api/1/datasets/${JEU}/`)) as { resources?: { title?: string; url?: string; last_modified?: string }[] };
  const trouver = (motif: RegExp) => (r.resources ?? []).find((x) => motif.test(x.title ?? '') && /\.csv$/i.test(x.url ?? ''));
  const operateurs = trouver(/certifiées des opérateurs/i);
  const surfaces = trouver(/certifiées des surfaces de \d{4}/i);
  if (!operateurs?.url || !surfaces?.url) return indisponible(dire, 'Agence Bio : les fichiers des opérateurs et des surfaces par commune ne se retrouvent plus par leur titre.');
  const cheminO = join(cache, `bio-operateurs-${operateurs.url.split('/').slice(-2).join('-')}`);
  const cheminS = join(cache, `bio-surfaces-${surfaces.url.split('/').slice(-2).join('-')}`);
  await telecharger(operateurs.url, cheminO);
  await telecharger(surfaces.url, cheminS);

  const par = new Map<string, Map<number, { n: number; a: [number, number, number, number]; p: Map<string, number> }>>();
  let lues = 0;
  for await (const l of lignes(cheminO)) {
    if (l.nboperateur === undefined || l.codeinseecommune === undefined) return indisponible(dire, 'Agence Bio : le fichier des opérateurs a changé de forme.');
    const code = l.codeinseecommune.padStart(5, '0');
    const annee = Number(l.annee);
    const n = Number(l.nboperateur);
    if (!/^\d[\dAB]\d{3}$/.test(code) || !annee || !(n > 0)) continue;
    lues++;
    const c = communeDe(code);
    const ans = par.get(c) ?? new Map();
    const x = ans.get(annee) ?? { n: 0, a: [0, 0, 0, 0] as [number, number, number, number], p: new Map<string, number>() };
    x.n += n;
    const i = 'PTDI'.indexOf(l.codesimple_ptdi);
    if (i >= 0) x.a[i] += n;
    if (l.codesimple_ptdi === 'P') x.p.set(l.productionprincipale || 'Non renseignée', (x.p.get(l.productionprincipale || 'Non renseignée') ?? 0) + n);
    ans.set(annee, x);
    par.set(c, ans);
  }
  const annee = [...par.values()].reduce((x, m) => Math.max(x, ...m.keys()), 0);
  const surf = new Map<string, Map<number, [number, number | null, number | null, number | null]>>();
  for await (const l of lignes(cheminS)) {
    if (l.surfbio === undefined) return indisponible(dire, 'Agence Bio : le fichier des surfaces a changé de forme.');
    const code = (l.codeinseecommune ?? '').padStart(5, '0');
    const a = Number(l.annee);
    if (!/^\d[\dAB]\d{3}$/.test(code) || !a) continue;
    const c = communeDe(code);
    const m = surf.get(c) ?? new Map();
    m.set(a, [Number(l.nb_exp) || 0, ha(l.surfbio), ha(l.surfab), ha(l.surfc123)]);
    surf.set(c, m);
  }
  const anneeSurfaces = [...surf.values()].reduce((x, m) => Math.max(x, ...m.keys()), 0);
  if (lues < 300000 || annee < 2024) return indisponible(dire, `Agence Bio : ${lues} lignes d’opérateurs, dernière année ${annee} ; on garde l’ingestion précédente.`);

  const communes = new Map<string, Bio>();
  for (const c of new Set([...par.keys(), ...surf.keys()])) {
    const ans = par.get(c) ?? new Map();
    const d = ans.get(annee);
    const s = surf.get(c);
    communes.set(c, {
      o: [...ans].map(([a, x]) => [a, x.n] as [number, number]).sort((x, y) => x[0] - y[0]),
      a: d ? d.a : [0, 0, 0, 0],
      p: d ? [...d.p].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'fr')) : [],
      s: s?.get(anneeSurfaces) ?? null,
      h: s ? [...s].map(([a, v]) => [a, v[1]] as [number, number | null]).sort((x, y) => x[0] - y[0]) : [],
    });
  }
  const total = [...communes.values()].reduce((t, b) => t + (b.o.find(([a]) => a === annee)?.[1] ?? 0), 0);
  dire(`Agence Bio : ${total.toLocaleString('fr-FR')} opérateurs en ${annee}, ${communes.size.toLocaleString('fr-FR')} communes avec au moins un opérateur une année ; surfaces ${anneeSurfaces}.`);
  return { maj: new Date().toISOString().slice(0, 10), annee, anneeSurfaces, communes };
}

export function ecrireBio(sortie: string, b: Bios): number {
  return ecrireParDepartement(sortie, 'bio', b.communes, () => ({ maj: b.maj, annee: b.annee, anneeSurfaces: b.anneeSurfaces }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const b = await collecterBio(lireJson, telecharger, cache, console.log);
  if (b) console.log(`${ecrireBio(sortie, b)} départements écrits.`);
}
