/**
 * La longueur de voirie retenue pour la dotation de solidarité rurale,
 * commune par commune : le critère que la DGCL publie avec le calcul des
 * dotations, tel que l'OFGL le republie (`dotations-communes`, variable
 * « Longueur de voirie en mètres »), comme les montants de
 * `dotations-emettre.ts`.
 *
 * Depuis la loi de finances pour 2025 (article 178, qui modifie l'article
 * L. 2334-22 du code général des collectivités territoriales), ce n'est plus
 * la voirie classée dans le domaine public communal que la commune déclarait :
 * la DGCL s'appuie sur les voies que l'IGN recense dans la BD TOPO. Le
 * changement se voit dans la série : au Mayet-de-Montagne, 38,3 km jusqu'en
 * 2024, 45,6 km en 2025.
 *
 * **Pourquoi pas la couche de l'IGN.** Un premier essai (22 novembre 2026)
 * mesurait les tronçons retenus que l'IGN publie, sur les contours des
 * communes : il s'écartait de 4,6 % du chiffre officiel au Mayet-de-Montagne.
 * Le chiffre de la DGCL est celui qui compte.
 *
 * **Les départements.** Le jeu jumeau `dotations-departements` donne la
 * voirie de chaque département, en deux longueurs : hors montagne et en
 * montagne. La DGCL s'en sert pour la dotation de fonctionnement minimale
 * (DFM), composante de la DGF des départements (jeu « VOIRIE DGF » de l'IGN).
 *
 * Lancé seul — `tsx scripts/voirie-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-voirie.json` et `voirie-departements.json`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';
import { ecrireParDepartement, lignesCsv, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

const BASE = 'https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/dotations-communes';
const VARIABLE = 'Longueur de voirie en mètres';

export interface Voirie {
  annee: number;
  maj: string;
  /** Longueur de voirie retenue, en mètres : la dernière année, et l'année d'avant quand elle est publiée. */
  communes: Map<string, [number, number | null]>;
}

/** Les longueurs d'une année, par code commune (une commune fusionnée reçoit la somme de celles qui l'ont formée). */
async function lireAnnee(annee: number, obstine: (url: string) => Promise<Response>): Promise<Map<string, number>> {
  const ou = `exercice>=${annee} and exercice<=${annee} and variable="${VARIABLE}"`;
  const url = `${BASE}/exports/csv?select=code_insee,categorie,valeur&delimiter=%3B&where=${encodeURIComponent(ou)}`;
  const texte = (await (await obstine(url)).text()).replace(/^﻿/, '');
  const { actuelles, reports } = reportsDuDecoupage();
  // La même longueur peut être donnée sous plusieurs fractions de la DSR : on la prend une fois par commune.
  const brut = new Map<string, number>();
  let col: Record<string, number> | null = null;
  for await (const v of lignesCsv([new TextEncoder().encode(texte)], ';')) {
    if (!col) {
      col = Object.fromEntries(v.map((n, i) => [n.trim(), i]));
      continue;
    }
    const m = Number(v[col.valeur]);
    if (!(m >= 0)) continue;
    brut.set(v[col.code_insee], Math.max(brut.get(v[col.code_insee]) ?? 0, m));
  }
  const parCode = new Map<string, number>();
  for (const [code, m] of brut) {
    const c = actuelles.has(code) ? code : reports.get(code);
    if (c) parCode.set(c, (parCode.get(c) ?? 0) + m);
  }
  return parCode;
}

export async function collecterVoirie(
  obstine: (url: string) => Promise<Response>,
  lireJson: (url: string) => Promise<unknown>,
  dire: (m: string) => void,
): Promise<Voirie | null> {
  const g = (await lireJson(
    `${BASE}/records?select=exercice&group_by=exercice&where=${encodeURIComponent(`variable="${VARIABLE}"`)}&limit=50`,
  )) as { results?: { exercice: string }[] };
  const annees = (g.results ?? []).map((r) => Number(r.exercice.slice(0, 4))).filter((a) => a > 2000).sort();
  if (!annees.length) return indisponible(dire, 'Voirie : l’OFGL ne publie plus la longueur de voirie des communes.');
  const annee = annees.at(-1)!;
  const derniere = await lireAnnee(annee, obstine);
  const precedente = annees.includes(annee - 1) ? await lireAnnee(annee - 1, obstine) : new Map<string, number>();
  if (derniere.size < 25_000) {
    return indisponible(dire, `Voirie : ${derniere.size} communes seulement pour ${annee}, on garde l’ingestion précédente.`);
  }
  const communes = new Map<string, [number, number | null]>();
  for (const [c, m] of derniere) communes.set(c, [Math.round(m), precedente.has(c) ? Math.round(precedente.get(c)!) : null]);
  dire(`Voirie ${annee} (DGCL, d’après l’OFGL) : ${communes.size.toLocaleString('fr-FR')} communes.`);
  return { annee, maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireVoirie(sortie: string, v: Voirie): number {
  return ecrireParDepartement(sortie, 'voirie', v.communes, () => ({ maj: v.maj, annee: v.annee }));
}

const BASE_DEP = 'https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/dotations-departements';
const VARIABLES_DEP = ['Longueur de voirie hors montagne en mètres', 'Longueur de voirie montagne en mètres'] as const;

export interface VoirieDepartements {
  annee: number;
  maj: string;
  /** Par département : hors montagne et en montagne, en mètres, la dernière année puis l'année d'avant (null si absente). */
  departements: Record<string, [number, number, number | null, number | null]>;
}

export async function collecterVoirieDepartements(
  obstine: (url: string) => Promise<Response>,
  lireJson: (url: string) => Promise<unknown>,
  dire: (m: string) => void,
): Promise<VoirieDepartements | null> {
  const filtre = `variable in (${VARIABLES_DEP.map((v) => `"${v}"`).join(',')})`;
  const g = (await lireJson(`${BASE_DEP}/records?select=exercice&group_by=exercice&where=${encodeURIComponent(filtre)}&limit=50`)) as {
    results?: { exercice: string }[];
  };
  const annees = (g.results ?? []).map((r) => Number(r.exercice.slice(0, 4))).filter((a) => a > 2000).sort();
  if (!annees.length) return indisponible(dire, 'Voirie des départements : l’OFGL ne la publie plus.');
  const annee = annees.at(-1)!;
  const ou = `exercice>=${annee - 1} and exercice<=${annee} and ${filtre}`;
  const url = `${BASE_DEP}/exports/csv?select=exercice,code_departement,variable,valeur&delimiter=%3B&where=${encodeURIComponent(ou)}`;
  const texte = (await (await obstine(url)).text()).replace(/^﻿/, '');
  const d: Record<string, [number, number, number | null, number | null]> = {};
  let col: Record<string, number> | null = null;
  for await (const v of lignesCsv([new TextEncoder().encode(texte)], ';')) {
    if (!col) {
      col = Object.fromEntries(v.map((n, i) => [n.trim(), i]));
      continue;
    }
    const k = VARIABLES_DEP.indexOf(v[col.variable] as (typeof VARIABLES_DEP)[number]);
    const m = Number(v[col.valeur]);
    if (k < 0 || !(m >= 0)) continue;
    // La Métropole de Lyon a son code chez l'OFGL ; le site la connaît sous 691.
    const dep = v[col.code_departement] === 'MET69' ? '691' : v[col.code_departement];
    const decalage = Number(String(v[col.exercice]).slice(0, 4)) === annee ? 0 : 2;
    d[dep] ??= [0, 0, null, null];
    d[dep][k + decalage] = Math.round(m);
  }
  if (Object.keys(d).length < 90) {
    return indisponible(dire, `Voirie des départements : ${Object.keys(d).length} départements seulement, on garde l’ingestion précédente.`);
  }
  dire(`Voirie des départements ${annee} (DGCL, d’après l’OFGL) : ${Object.keys(d).length} départements.`);
  return { annee, maj: new Date().toISOString().slice(0, 10), departements: d };
}

export function ecrireVoirieDepartements(sortie: string, v: VoirieDepartements): void {
  writeFileSync(join(sortie, 'voirie-departements.json'), JSON.stringify({ maj: v.maj, annee: v.annee, d: v.departements }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const obstine = async (url: string) => {
    for (let e = 0; ; e++) {
      try {
        const r = await fetch(url);
        if (r.ok) return r;
        throw new Error(String(r.status));
      } catch (err) {
        if (e >= 4) throw err;
        await new Promise((ok) => setTimeout(ok, 3000 * (e + 1)));
      }
    }
  };
  const v = await collecterVoirie(obstine, lireJson as (url: string) => Promise<unknown>, console.log);
  if (v) console.log(`${ecrireVoirie(sortie, v)} départements écrits.`);
  const vd = await collecterVoirieDepartements(obstine, lireJson as (url: string) => Promise<unknown>, console.log);
  if (vd) ecrireVoirieDepartements(sortie, vd);
}
