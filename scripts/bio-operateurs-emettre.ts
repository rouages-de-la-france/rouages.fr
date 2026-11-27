/**
 * Les opérateurs certifiés en agriculture biologique, nommés, d'après la liste
 * que l'Agence Bio publie en application de l'article 34, paragraphe 6, du
 * règlement (UE) 2018/848 (data.gouv.fr, « Professionnels engagés en BIO »,
 * jeu 622f52bb6b1fe2b127f0ce64, Licence Ouverte 2.0, mise à jour chaque jour).
 *
 * Décision du 27 novembre 2026, justifiée dans `docs/07-risques.md` et
 * reprise dans `CLAUDE.md` (« Les noms dans les données ») :
 *
 * - une personne morale est nommée par la dénomination que la liste publie
 *   (celle de SIRENE si la liste n'en donne pas) ;
 * - un entrepreneur individuel est nommé par le nom que publie SIRENE,
 *   seulement s'il y est diffusible, le statut relu à l'INSEE ;
 * - un entrepreneur en diffusion partielle, un SIRET que SIRENE ne connaît
 *   pas et une opposition de `retraits.yaml` (par SIREN) : le SIREN seul,
 *   que l'INSEE diffuse — on sait que l'opérateur existe, sans son nom ;
 * - ni gérant, ni téléphone, ni courriel, ni adresse.
 *
 * La liste ne donne que le code postal du siège : la commune est celle de
 * l'établissement à SIRENE, à défaut celle que désigne seul le code postal.
 *
 * Lancé seul — `tsx scripts/bio-operateurs-emettre.ts [département]` —, il
 * réécrit les fichiers `public/territoires/dep/XX-bio-operateurs.json` ; avec
 * un département, il ne lit que les sièges dont le code postal y commence
 * (pour l'essai).
 */
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { communeDe, ecrireParDepartement, lignesCsv, telechargerSiAbsent } from './par-departement.ts';
import { communeUniqueParCodePostal } from './hebergements-emettre.ts';
import { etablissementsSirene } from './sirene-noms.ts';
import { retraits } from './retraits.ts';
import { indisponible } from './echecs.ts';

export const JEU = '622f52bb6b1fe2b127f0ce64';

/**
 * Un opérateur : son nom (null quand il n'est montré que par son SIREN), son SIREN, ses
 * activités certifiées (« Production, Préparation »), l'organisme certificateur, la date
 * d'engagement (ISO, vide si la liste ne la donne pas).
 */
export type Operateur = [string | null, string, string, string, string];

export interface OperateursBio {
  maj: string;
  communes: Map<string, Operateur[]>;
}

/** « Production,Préparation » → « Production, Préparation ». */
const activites = (a: string) => a.split(',').map((x) => x.trim()).filter(Boolean).join(', ');
/** Une dénomination que la liste laisse en attente n'en est pas une. */
const vraiNom = (n: string) => (n && !/^(en cours|none|null|-)$/i.test(n.trim()) ? n.replace(/\s+/g, ' ').trim() : '');

export async function collecterOperateursBio(
  lireJson: (url: string) => Promise<unknown>,
  telecharger: (url: string, vers: string) => Promise<void>,
  texte: (url: string) => Promise<string>,
  cache: string,
  dire: (m: string) => void,
  /** Pour l'essai : ne garder que les sièges de ce département (par le code postal). */
  essai: string | null = null,
): Promise<OperateursBio | null> {
  const r = (await lireJson(`https://www.data.gouv.fr/api/1/datasets/${JEU}/`)) as { resources?: { title?: string; url?: string }[] };
  const res = (r.resources ?? []).find((x) => /\.csv$/i.test(x.url ?? '') && /operateurs?bio/i.test(x.title ?? ''));
  if (!res?.url) return indisponible(dire, 'Opérateurs bio : la liste CSV ne se retrouve plus dans la fiche du jeu.');
  const vers = join(cache, `bio-operateurs-liste-${new Date().toISOString().slice(0, 10)}.csv`);
  await telecharger(res.url, vers);

  type Ligne = { siret: string; nom: string; cp: string; activites: string; organisme: string; date: string };
  const liste: Ligne[] = [];
  let col: Record<string, number> | null = null;
  for await (const v of lignesCsv(createReadStream(vers) as unknown as AsyncIterable<Uint8Array>, ';')) {
    if (!col) {
      col = Object.fromEntries(v.map((n, i) => [n.replace(/^﻿/, '').trim(), i]));
      for (const n of ['SIRET', 'DENOMINATION', 'CODE POSTAL SIEGE SOCIAL', 'DATEENGAGEMENT', 'ACTIVITES', 'ORGANISME CERTIFICATEUR']) {
        if (col[n] === undefined) return indisponible(dire, `Opérateurs bio : colonne « ${n} » absente, la liste a changé de forme.`);
      }
      continue;
    }
    const siret = (v[col.SIRET] ?? '').trim();
    if (!/^\d{14}$/.test(siret)) continue;
    const date = (v[col.DATEENGAGEMENT] ?? '').trim();
    if (essai && !(v[col['CODE POSTAL SIEGE SOCIAL']] ?? '').trim().padStart(5, '0').startsWith(essai)) continue;
    liste.push({
      siret,
      nom: vraiNom(v[col.DENOMINATION] ?? ''),
      cp: (v[col['CODE POSTAL SIEGE SOCIAL']] ?? '').trim().padStart(5, '0'),
      activites: activites(v[col.ACTIVITES] ?? ''),
      organisme: (v[col['ORGANISME CERTIFICATEUR']] ?? '').trim(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    });
  }
  if (!essai && liste.length < 50000) return indisponible(dire, `Opérateurs bio : ${liste.length} lignes seulement, on garde l’ingestion précédente.`);

  dire(`Opérateurs bio : ${liste.length.toLocaleString('fr-FR')} lignes, établissements relus à SIRENE…`);
  const sirene = await etablissementsSirene(texte, liste.map((l) => l.siret), dire);
  const parCp = communeUniqueParCodePostal();
  const opposes = retraits().entreprises;
  const communes = new Map<string, Operateur[]>();
  const vus = new Set<string>();
  let parCodePostal = 0;
  let sansCommune = 0;
  let parSiren = 0;
  for (const l of liste) {
    if (vus.has(l.siret)) continue;
    vus.add(l.siret);
    const e = sirene.get(l.siret);
    const siren = e?.siren || l.siret.slice(0, 9);
    let code = e?.commune && /^\d[\dAB]\d{3}$/.test(e.commune) ? e.commune : null;
    if (!code) {
      code = parCp(l.cp);
      if (code) parCodePostal++;
    }
    if (!code) {
      sansCommune++;
      continue;
    }
    // Le refus est le cas par défaut : inconnu de SIRENE, non diffusible, ou opposé.
    let nom: string | null = null;
    if (e && !opposes.has(siren)) nom = e.ei ? e.nom : l.nom || e.nom;
    if (!nom) parSiren++;
    const c = communeDe(code);
    communes.set(c, [...(communes.get(c) ?? []), [nom, siren, l.activites, l.organisme, l.date]]);
  }
  // Les nommés par ordre alphabétique, puis les SIREN seuls.
  for (const o of communes.values()) o.sort((a, b) => (a[0] === null ? 1 : 0) - (b[0] === null ? 1 : 0) || (a[0] ?? a[1]).localeCompare(b[0] ?? b[1], 'fr'));
  const n = [...communes.values()].reduce((t, o) => t + o.length, 0);
  dire(
    `Opérateurs bio : ${n.toLocaleString('fr-FR')} dans ${communes.size.toLocaleString('fr-FR')} communes, ${parSiren.toLocaleString('fr-FR')} sous leur SIREN seul` +
      (parCodePostal ? `, ${parCodePostal} placés par le code postal` : '') +
      (sansCommune ? ` ; ${sansCommune} sans commune retrouvée.` : '.'),
  );
  return { maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireOperateursBio(sortie: string, o: OperateursBio): number {
  return ecrireParDepartement(sortie, 'bio-operateurs', o.communes, () => ({ maj: o.maj }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson, obstine } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const o = await collecterOperateursBio(lireJson, telecharger, async (url) => (await obstine(url)).text(), cache, console.log, process.argv[2] ?? null);
  if (o) console.log(`${ecrireOperateursBio(sortie, o)} départements écrits.`);
}
