/**
 * Les trajets de covoiturage au départ de chaque commune, d'après l'indicateur
 * « Nombre de trajets réalisés en covoiturage intermédié » du Tableau de bord
 * des mobilités durables (data.gouv.fr, jeu 69b9892671a02fb27d4bd716), calculé
 * sur le Registre de preuve de covoiturage : chaque année, les trajets
 * (un couple conducteur-passager) au départ de la commune.
 *
 * Ce ne sont que les trajets passés par une plateforme partenaire du
 * registre — le covoiturage « intermédié » de courte distance, 4 % du
 * covoiturage selon l'enquête Mobilité des personnes de 2022, d'après la fiche
 * du jeu. Le covoiturage entre voisins ou collègues n'y est pas.
 *
 * **Licence : ODbL**, telle que la fiche du jeu la déclare. Les fichiers
 * `dep/XX-covoiturage.json` sont à part, déclarés comme tels dans
 * `contenu/veille.yaml`, et la page cite la source.
 *
 * L'adresse du fichier change à chaque publication : la collecte le retrouve
 * par son titre (« … - commune »).
 *
 * Lancé seul — `tsx scripts/covoiturage-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-covoiturage.json`.
 */
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { communeDe, ecrireParDepartement, lignesCsv, telechargerSiAbsent } from './par-departement.ts';
import { indisponible } from './echecs.ts';

export const JEU = '69b9892671a02fb27d4bd716';

/** Les trajets au départ de la commune, année par année : [année, trajets]. */
export type Trajets = [number, number][];

export interface Covoiturage {
  maj: string;
  communes: Map<string, Trajets>;
}

export async function collecterCovoiturage(
  lireJson: (url: string) => Promise<unknown>,
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Covoiturage | null> {
  const r = (await lireJson(`https://www.data.gouv.fr/api/1/datasets/${JEU}/`)) as { resources?: { title?: string; url?: string }[] };
  const res = (r.resources ?? []).find((x) => /intermédié\s*-\s*commune\s*$/i.test(x.title ?? '') && /\.csv$/i.test(x.url ?? ''));
  if (!res?.url) return indisponible(dire, 'Covoiturage : le fichier par commune ne se retrouve plus par son titre.');
  const vers = join(cache, `covoiturage-${res.url.split('/').slice(-2).join('-')}`);
  await telecharger(res.url, vers);
  const par = new Map<string, Map<number, number>>();
  let col: Record<string, number> | null = null;
  let lues = 0;
  for await (const v of lignesCsv(createReadStream(vers) as unknown as AsyncIterable<Uint8Array>, ',')) {
    if (!col) {
      col = Object.fromEntries(v.map((n, i) => [n.replace(/^﻿/, '').trim(), i]));
      for (const n of ['annee', 'geocode_commune', 'valeur']) if (col[n] === undefined) return indisponible(dire, `Covoiturage : colonne « ${n} » absente, le fichier a changé de forme.`);
      continue;
    }
    const code = (v[col.geocode_commune] ?? '').trim().padStart(5, '0');
    const annee = Number(v[col.annee]);
    const n = Number(v[col.valeur]);
    if (!/^\d[\dAB]\d{3}$/.test(code) || !annee || !Number.isFinite(n)) continue;
    lues++;
    const c = communeDe(code);
    const m = par.get(c) ?? new Map<number, number>();
    m.set(annee, (m.get(annee) ?? 0) + Math.round(n));
    par.set(c, m);
  }
  if (lues < 100000) return indisponible(dire, `Covoiturage : ${lues} lignes seulement, on garde l’ingestion précédente.`);
  const communes = new Map<string, Trajets>();
  for (const [c, m] of par) communes.set(c, [...m].sort((a, b) => a[0] - b[0]));
  const derniere = [...par.values()].reduce((x, m) => Math.max(x, ...m.keys()), 0);
  const total = [...par.values()].reduce((t, m) => t + (m.get(derniere) ?? 0), 0);
  dire(`Covoiturage (registre de preuve) : ${total.toLocaleString('fr-FR')} trajets en ${derniere}, ${communes.size.toLocaleString('fr-FR')} communes.`);
  return { maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireCovoiturage(sortie: string, c: Covoiturage): number {
  return ecrireParDepartement(sortie, 'covoiturage', c.communes, () => ({
    maj: c.maj,
    licence: 'ODbL 1.0 — Open Database License, https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: 'Tableau de bord des mobilités durables, d’après le Registre de preuve de covoiturage',
  }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const c = await collecterCovoiturage(lireJson, telecharger, cache, console.log);
  if (c) console.log(`${ecrireCovoiturage(sortie, c)} départements écrits.`);
}
