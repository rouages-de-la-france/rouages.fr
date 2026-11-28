/**
 * Les équipements sportifs de chaque commune, d'après Data ES, le recensement
 * des équipements sportifs et lieux de pratique du ministère chargé des sports
 * (data.gouv.fr, jeu 6a5036faf53d94a0ff7fa58f, Licence Ouverte 2.0, mis à jour
 * chaque jour ; servi par data.education.gouv.fr). La fiche du jeu rappelle que
 * tout propriétaire d'un équipement sportif est tenu de le déclarer
 * (article L312-2 du code du sport).
 *
 * Pour chaque équipement : l'installation qui le porte (le stade, le complexe,
 * le collège), son nom, son type, le type de propriétaire — jamais son nom —,
 * l'année de mise en service, s'il est en accès libre, ouvert au public, si
 * l'installation est accessible en fauteuil, les activités qui s'y pratiquent,
 * et sa position.
 *
 * Les noms sont gardés tels que le recensement les publie — un équipement
 * nommé d'après quelqu'un lui rend le plus souvent hommage (« Complexe
 * Fernand Fayet »), et une civilité y est souvent un sigle de club ou une
 * enseigne (« Chez … ») —, sauf celui qui dit le domicile d'un particulier.
 *
 * Lancé seul — `tsx scripts/sport-emettre.ts` —, il réécrit les fichiers
 * `public/territoires/dep/XX-sport.json`.
 */
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { communeDe, ecrireParDepartement, lignesCsv, telechargerSiAbsent } from './par-departement.ts';
import { ECHELLE } from './espaces-emettre.ts';
import { indisponible } from './echecs.ts';

export const JEU = '6a5036faf53d94a0ff7fa58f';
const ODS = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/data-es-recensement-des-equipements-sportifs-et-lieux-de-pratique-complet/exports/csv';
const CHAMPS = [
  'equip_numero', 'inst_numero', 'inst_nom', 'equip_nom', 'equip_type_name', 'equip_type_famille', 'equip_prop_type',
  'equip_service_date', 'equip_ouv_public_bool', 'equip_acc_libre', 'inst_acc_handi_bool', 'aps_name', 'new_code',
  'equip_x', 'equip_y', 'inst_hs_bool', 'equip_maj_date',
];
export const EXPORT = `${ODS}?select=${encodeURIComponent(CHAMPS.join(','))}&delimiter=%3B`;

export const nomGarde = (n: string) => {
  const s = n.replace(/\s+/g, ' ').trim();
  return /\bdomicile\b/i.test(s) ? '' : s;
};

/**
 * Un équipement : son numéro (« E001I031650009 »), le numéro de son installation, le nom de
 * l'installation et celui de l'équipement (vides quand ils ne sont pas gardés), son type, sa
 * famille, le type de propriétaire, l'année de mise en service (0 si inconnue), des drapeaux
 * (1 accès libre, 2 ouvert au public, 4 installation accessible en fauteuil, 8 hors service),
 * les activités (trois au plus), x et y en dix-millièmes de degré.
 */
export type Equipement = [string, string, string, string, string, string, string, number, number, string[], number, number];

export interface Sport {
  maj: string;
  communes: Map<string, Equipement[]>;
}

export async function collecterSport(telecharger: (url: string, vers: string) => Promise<void>, cache: string, dire: (m: string) => void): Promise<Sport | null> {
  const vers = join(cache, `sport-data-es-${new Date().toISOString().slice(0, 10)}.csv`);
  await telecharger(EXPORT, vers);
  const communes = new Map<string, Equipement[]>();
  let col: Record<string, number> | null = null;
  let lus = 0;
  let sansNom = 0;
  let dernier = '';
  for await (const v of lignesCsv(createReadStream(vers) as unknown as AsyncIterable<Uint8Array>, ';')) {
    if (!col) {
      col = Object.fromEntries(v.map((n, i) => [n.replace(/^﻿/, '').trim(), i]));
      for (const n of CHAMPS) if (col[n] === undefined) return indisponible(dire, `Équipements sportifs : colonne « ${n} » absente, le fichier a changé de forme.`);
      continue;
    }
    const g = (n: string) => (v[col![n]] ?? '').trim();
    const code = g('new_code').padStart(5, '0');
    if (!/^\d[\dAB]\d{3}$/.test(code) || !g('equip_numero')) continue;
    lus++;
    const inst = nomGarde(g('inst_nom'));
    const equip = nomGarde(g('equip_nom'));
    if (g('inst_nom') && !inst) sansNom++;
    const annee = Number(g('equip_service_date').slice(0, 4));
    const drapeaux = (g('equip_acc_libre') === 'true' ? 1 : 0) | (g('equip_ouv_public_bool') === 'true' ? 2 : 0) | (g('inst_acc_handi_bool') === 'true' ? 4 : 0) | (g('inst_hs_bool') === 'Oui' ? 8 : 0);
    const activites = g('aps_name').split(/\s*,\s*(?=[A-ZÉÈÀÂÎÔÛ])/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
    const x = Math.round(Number(g('equip_x')) * ECHELLE);
    const y = Math.round(Number(g('equip_y')) * ECHELLE);
    if (g('equip_maj_date') > dernier) dernier = g('equip_maj_date');
    const e: Equipement = [g('equip_numero'), g('inst_numero'), inst, equip, g('equip_type_name'), g('equip_type_famille'), g('equip_prop_type'), annee >= 1800 ? annee : 0, drapeaux, activites, Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
    const c = communeDe(code);
    communes.set(c, [...(communes.get(c) ?? []), e]);
  }
  if (lus < 250000) return indisponible(dire, `Équipements sportifs : ${lus} lignes seulement, on garde l’ingestion précédente.`);
  for (const l of communes.values()) l.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  dire(`Équipements sportifs (Data ES) : ${lus.toLocaleString('fr-FR')} équipements dans ${communes.size.toLocaleString('fr-FR')} communes ; ${sansNom} installations sans nom gardé ; dernière mise à jour ${dernier}.`);
  return { maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireSport(sortie: string, s: Sport): number {
  return ecrireParDepartement(sortie, 'sport', s.communes, () => ({ maj: s.maj }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const s = await collecterSport(telecharger, cache, console.log);
  if (s) console.log(`${ecrireSport(sortie, s)} départements écrits.`);
}
