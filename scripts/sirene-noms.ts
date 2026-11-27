/**
 * Le nom qu'une unité légale porte au répertoire SIRENE, quand il peut être
 * publié.
 *
 * Une société se nomme par sa dénomination. Un entrepreneur individuel se
 * nomme par son prénom et son nom — d'usage s'il en déclare un —, **et
 * seulement s'il est diffusible** : celui qui a exercé son droit d'opposition
 * (article R123-232-1 du code de commerce) est en diffusion partielle, et
 * son nom n'est pas repris (`CLAUDE.md`, « Les noms dans les données »). Un
 * SIREN que la copie du répertoire ne connaît pas n'est pas nommé non plus :
 * c'est le refus qui est le cas par défaut.
 *
 * La copie lue est celle d'Opendatasoft, qui sert le répertoire par
 * établissement ; on y regroupe par SIREN. Elle n'est mise à jour qu'au 1er
 * du mois : le statut des entrepreneurs est relu à l'INSEE
 * (`diffusion-insee.ts`).
 */
import { refusesAJour } from './diffusion-insee.ts';

const SIRENE = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/economicref-france-sirene-v3/exports/csv';

const CHAMPS = [
  'siren',
  'statutdiffusionunitelegale',
  'categoriejuridiqueunitelegale',
  'denominationunitelegale',
  'nomunitelegale',
  'nomusageunitelegale',
  'prenomusuelunitelegale',
  'prenom1unitelegale',
  'etatadministratifunitelegale',
] as const;

/** Un CSV à point-virgule et guillemets, en lignes de champs. */
function lignes(texte: string): string[][] {
  const out: string[][] = [];
  let champ = '';
  let ligne: string[] = [];
  let dans = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dans) {
      if (c === '"' && texte[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') dans = false;
      else champ += c;
    } else if (c === '"') dans = true;
    else if (c === ';') {
      ligne.push(champ);
      champ = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ);
      out.push(ligne);
      ligne = [];
      champ = '';
    } else champ += c;
  }
  if (champ || ligne.length) {
    ligne.push(champ);
    out.push(ligne);
  }
  return out;
}

/** « DUPONT » et « Marie » → « Marie DUPONT » ; le nom d'usage l'emporte quand il est déclaré. */
const nomPersonne = (nom: string, usage: string, prenomUsuel: string, prenom: string) =>
  `${(prenomUsuel || prenom).trim()} ${(usage || nom).trim()}`.trim();

export interface NomSirene {
  nom: string;
  /** Vrai pour un entrepreneur individuel (catégorie juridique 1000). */
  ei: boolean;
  /** Vrai quand le répertoire dit l'unité légale cessée. */
  cessee: boolean;
}

/**
 * Les noms publiables, par SIREN, pour ceux qu'on soumet. Un SIREN absent du
 * résultat ne doit pas être nommé.
 */
export async function nomsSirene(
  texte: (url: string) => Promise<string>,
  sirens: Iterable<string>,
  dire: (m: string) => void = console.log,
): Promise<Map<string, NomSirene>> {
  return (await diffusionSirene(texte, sirens, dire)).noms;
}

/**
 * Les noms publiables, et à part les SIREN que le répertoire refuse de
 * diffuser. Un registre qui publie lui-même le nom — une ancienne entreprise
 * à la CASIAS — peut le garder pour un SIREN inconnu, jamais pour un refus.
 */
export async function diffusionSirene(
  texte: (url: string) => Promise<string>,
  sirens: Iterable<string>,
  dire: (m: string) => void = console.log,
): Promise<{ noms: Map<string, NomSirene>; refuses: Set<string> }> {
  const noms = new Map<string, NomSirene>();
  const tousRefuses = new Set<string>();
  const uniques = [...new Set(sirens)].filter((s) => /^\d{9}$/.test(s));
  for (let i = 0; i < uniques.length; i += 100) {
    const lot = uniques.slice(i, i + 100);
    const t = await texte(
      `${SIRENE}?select=${encodeURIComponent(CHAMPS.join(', '))}` +
        `&where=${encodeURIComponent(`siren in (${lot.map((x) => `"${x}"`).join(',')})`)}` +
        `&group_by=${encodeURIComponent(CHAMPS.join(', '))}&delimiter=%3B`,
    );
    const l = lignes(t);
    const j = CHAMPS.map((c) => l[0]?.indexOf(c) ?? -1);
    if (j.some((x) => x === -1)) throw new Error('SIRENE : l’export des unités légales a changé de forme');
    const refuses = new Set<string>();
    const vus = new Map<string, NomSirene>();
    for (const r of l.slice(1)) {
      const [siren, statut, categorie, denomination, nom, usage, prenomUsuel, prenom, etat] = j.map((k) => (r[k] ?? '').trim());
      if (!siren) continue;
      if (statut !== 'O') {
        refuses.add(siren);
        continue;
      }
      const ei = categorie === '1000';
      const affiche = ei ? nomPersonne(nom, usage, prenomUsuel, prenom) : denomination || nomPersonne(nom, usage, prenomUsuel, prenom);
      // Un établissement par ligne : l'unité légale est cessée si une ligne le dit.
      const cessee = /^c/i.test(etat) || vus.get(siren)?.cessee === true;
      if (affiche) vus.set(siren, { nom: affiche, ei, cessee });
    }
    for (const [siren, n] of vus) if (!refuses.has(siren)) noms.set(siren, n);
    for (const siren of refuses) tousRefuses.add(siren);
  }
  // Les entrepreneurs, relus à l'INSEE : la copie a jusqu'à un mois de retard.
  const ei = [...noms].filter(([, n]) => n.ei).map(([s]) => s);
  const refusAJour = await refusesAJour(ei, dire);
  if (refusAJour) {
    for (const s of refusAJour) {
      noms.delete(s);
      tousRefuses.add(s);
    }
  }
  return { noms, refuses: tousRefuses };
}

const CHAMPS_ETABLISSEMENT = [
  'siret',
  'siren',
  'codecommuneetablissement',
  'statutdiffusionunitelegale',
  'categoriejuridiqueunitelegale',
  'denominationunitelegale',
  'nomunitelegale',
  'nomusageunitelegale',
  'prenomusuelunitelegale',
  'prenom1unitelegale',
] as const;

export interface EtablissementSirene {
  siren: string;
  /** Le code INSEE de la commune de l'établissement ; vide si le répertoire ne le donne pas. */
  commune: string;
  /** Vrai pour un entrepreneur individuel (catégorie juridique 1000). */
  ei: boolean;
  /** Le nom publiable ; null pour un entrepreneur que le répertoire ne diffuse pas. */
  nom: string | null;
}

/**
 * Les établissements de ces SIRET : leur commune, et le nom de leur unité
 * légale quand il peut être publié — une société par sa dénomination, un
 * entrepreneur individuel par son nom seulement s'il est diffusible, relu à
 * l'INSEE. Un SIRET absent du résultat est inconnu de la copie du répertoire.
 */
export async function etablissementsSirene(
  texte: (url: string) => Promise<string>,
  sirets: Iterable<string>,
  dire: (m: string) => void = console.log,
  lot = 150,
): Promise<Map<string, EtablissementSirene>> {
  const sortie = new Map<string, EtablissementSirene>();
  const uniques = [...new Set(sirets)].filter((s) => /^\d{14}$/.test(s)).sort();
  for (let i = 0; i < uniques.length; i += lot) {
    const morceau = uniques.slice(i, i + lot);
    const t = await texte(
      `${SIRENE}?select=${encodeURIComponent(CHAMPS_ETABLISSEMENT.join(', '))}` +
        `&where=${encodeURIComponent(`siret in (${morceau.map((x) => `"${x}"`).join(',')})`)}&delimiter=%3B`,
    );
    const l = lignes(t.replace(/^﻿/, ''));
    const j = CHAMPS_ETABLISSEMENT.map((c) => l[0]?.indexOf(c) ?? -1);
    if (j.some((x) => x === -1)) throw new Error('SIRENE : l’export des établissements a changé de forme');
    for (const r of l.slice(1)) {
      const [siret, siren, commune, statut, categorie, denomination, nom, usage, prenomUsuel, prenom] = j.map((k) => (r[k] ?? '').trim());
      if (!siret) continue;
      const ei = categorie === '1000';
      const affiche = ei ? nomPersonne(nom, usage, prenomUsuel, prenom) : denomination || nomPersonne(nom, usage, prenomUsuel, prenom);
      sortie.set(siret, { siren, commune, ei, nom: statut === 'O' && affiche ? affiche : null });
    }
    if ((i / lot) % 50 === 49) dire(`  SIRENE : ${Math.min(i + lot, uniques.length)} établissements lus sur ${uniques.length}.`);
  }
  // Les entrepreneurs, relus à l'INSEE : la copie a jusqu'à un mois de retard.
  const ei = [...sortie.values()].filter((e) => e.ei && e.nom).map((e) => e.siren);
  const refuses = await refusesAJour(ei, dire);
  if (refuses) for (const e of sortie.values()) if (e.ei && refuses.has(e.siren)) e.nom = null;
  return sortie;
}
