/**
 * Ce qu'une réingestion a changé dans `public/territoires`, jeu par jeu : à
 * relire avant de fusionner sa PR.
 *
 * Le contrôle de la CI dit si les fichiers sont valides ; il ne dit pas si une
 * collecte a rendu moitié moins de communes que la fois d'avant. Une source
 * qui répond à moitié — une page manquante, un département vide, une colonne
 * renommée — passe la validation, et la PR réécrit des milliers de fichiers :
 * l'écart ne se voit qu'en comparant. Ce script compare chaque fichier modifié
 * à sa version dans une révision git (par défaut `HEAD`, l'état d'avant la
 * réingestion), et compte pour chacun :
 *
 * - les **communes** : les clés de son objet `c`, quand il en a un — la forme
 *   des fichiers `dep/XX-<jeu>.json` ;
 * - les **valeurs** : les feuilles de l'arbre JSON, nombres, textes, booléens ;
 * - les **octets**.
 *
 * Il signale, sans rien bloquer : un fichier supprimé, un fichier vidé, et un
 * jeu ou un fichier qui perd plus de 5 % de ses communes ou plus de 10 % de ses
 * valeurs. Une baisse n'est pas une erreur — une source peut retirer des lignes
 * à bon droit —, mais elle doit être expliquée avant la fusion.
 *
 * `npm run comparer-reingestion` (contre `HEAD`), ou
 * `npx tsx scripts/comparer-reingestion.ts <révision>`. Sortie en Markdown,
 * reprise dans le corps de la PR du workflow « Réingestion des territoires ».
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOSSIER = 'public/territoires';

/** Les seuils des alertes. */
export const SEUILS = { communes: 0.05, valeurs: 0.1 };

export interface Mesure {
  communes: number | null;
  valeurs: number;
  octets: number;
}

/** Les feuilles d'un arbre JSON. */
function feuilles(v: unknown): number {
  if (v === null || typeof v !== 'object') return 1;
  let n = 0;
  for (const x of Array.isArray(v) ? v : Object.values(v)) n += feuilles(x);
  return n;
}

export function mesurer(texte: string): Mesure {
  let d: unknown;
  try {
    d = JSON.parse(texte);
  } catch {
    return { communes: null, valeurs: 0, octets: Buffer.byteLength(texte) };
  }
  const c = d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>).c : undefined;
  return {
    communes: c && typeof c === 'object' && !Array.isArray(c) ? Object.keys(c).length : null,
    valeurs: feuilles(d),
    octets: Buffer.byteLength(texte),
  };
}

/** Le jeu d'un fichier, comme le compte le workflow : `dep/03-dvf.json` → `dvf`, `marches/…` → `marches/`. */
export function jeu(chemin: string): string {
  return chemin
    .replace(/^public\/territoires\//, '')
    .replace(/^dep\/[0-9AB]+-/, '')
    .replace(/^([a-z0-9_-]+)\/.*$/, '$1/')
    .replace(/\.json$/, '');
}

export interface Ligne {
  chemin: string;
  avant: Mesure | null;
  apres: Mesure | null;
}

export interface Alerte {
  jeu: string;
  chemin: string | null;
  message: string;
}

const baisse = (a: number | null | undefined, b: number | null | undefined) => (a && b !== null && b !== undefined ? 1 - b / a : 0);
const pc = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('fr-FR')} %`;
const n = (x: number) => x.toLocaleString('fr-FR');

/** Les alertes d'un ensemble de lignes : par fichier, puis par jeu. */
export function alertes(lignes: Ligne[]): Alerte[] {
  const sortie: Alerte[] = [];
  for (const l of lignes) {
    const j = jeu(l.chemin);
    if (l.avant && !l.apres) sortie.push({ jeu: j, chemin: l.chemin, message: 'fichier supprimé' });
    else if (l.avant && l.apres) {
      // Vidé : un fichier qui portait quelque chose n'en garde que sa coquille.
      if (l.avant.valeurs > 5 && l.apres.valeurs <= 2) sortie.push({ jeu: j, chemin: l.chemin, message: `vidé : ${n(l.avant.valeurs)} valeurs → ${n(l.apres.valeurs)}` });
      else {
        const bc = baisse(l.avant.communes, l.apres.communes);
        const bv = baisse(l.avant.valeurs, l.apres.valeurs);
        if (bc > SEUILS.communes) sortie.push({ jeu: j, chemin: l.chemin, message: `communes ${n(l.avant.communes!)} → ${n(l.apres.communes ?? 0)} (−${pc(bc)})` });
        else if (bv > SEUILS.valeurs) sortie.push({ jeu: j, chemin: l.chemin, message: `valeurs ${n(l.avant.valeurs)} → ${n(l.apres.valeurs)} (−${pc(bv)})` });
      }
    }
  }
  // Par jeu : une baisse répartie sur cent fichiers ne se voit pas fichier par fichier.
  for (const [j, t] of totaux(lignes)) {
    const bc = baisse(t.avant.communes, t.apres.communes);
    const bv = baisse(t.avant.valeurs, t.apres.valeurs);
    if (bc > SEUILS.communes) sortie.push({ jeu: j, chemin: null, message: `communes ${n(t.avant.communes)} → ${n(t.apres.communes)} (−${pc(bc)}) sur l’ensemble du jeu` });
    else if (bv > SEUILS.valeurs) sortie.push({ jeu: j, chemin: null, message: `valeurs ${n(t.avant.valeurs)} → ${n(t.apres.valeurs)} (−${pc(bv)}) sur l’ensemble du jeu` });
  }
  return sortie;
}

interface Total {
  fichiers: { modifies: number; ajoutes: number; supprimes: number };
  avant: { communes: number; valeurs: number; octets: number };
  apres: { communes: number; valeurs: number; octets: number };
}

/** Les totaux par jeu, sur les fichiers présents des deux côtés pour les communes et les valeurs. */
export function totaux(lignes: Ligne[]): Map<string, Total> {
  const t = new Map<string, Total>();
  for (const l of lignes) {
    const j = jeu(l.chemin);
    let x = t.get(j);
    if (!x) {
      x = { fichiers: { modifies: 0, ajoutes: 0, supprimes: 0 }, avant: { communes: 0, valeurs: 0, octets: 0 }, apres: { communes: 0, valeurs: 0, octets: 0 } };
      t.set(j, x);
    }
    if (l.avant && l.apres) x.fichiers.modifies++;
    else if (l.apres) x.fichiers.ajoutes++;
    else x.fichiers.supprimes++;
    for (const [cote, m] of [['avant', l.avant], ['apres', l.apres]] as const) {
      if (!m) continue;
      x[cote].communes += m.communes ?? 0;
      x[cote].valeurs += m.valeurs;
      x[cote].octets += m.octets;
    }
  }
  return t;
}

/** Le rapport en Markdown : les alertes d'abord, puis le tableau des jeux. */
export function rapport(lignes: Ligne[], revision: string, maxAlertes = 60): string {
  const a = alertes(lignes);
  const t = [...totaux(lignes)].sort((x, y) => x[0].localeCompare(y[0]));
  const signe = (avant: number, apres: number) => (avant === 0 ? (apres === 0 ? '—' : 'nouveau') : `${apres >= avant ? '+' : '−'}${pc(Math.abs(apres / avant - 1))}`);
  const out: string[] = [];
  out.push(`Comparaison avec \`${revision}\` : ${n(lignes.length)} fichiers modifiés, ajoutés ou supprimés, dans ${t.length} jeux.`, '');
  if (a.length === 0) out.push('**Aucune alerte** : aucun fichier supprimé ni vidé, aucune baisse de plus de 5 % des communes ni de 10 % des valeurs.', '');
  else {
    out.push(`**${a.length} alerte${a.length > 1 ? 's' : ''}** — à expliquer avant la fusion (une source peut retirer des lignes à bon droit) :`, '');
    // Les alertes d'ensemble d'abord, puis les fichiers, un jeu après l'autre.
    const triees = [...a].sort((x, y) => Number(x.chemin !== null) - Number(y.chemin !== null) || x.jeu.localeCompare(y.jeu));
    for (const x of triees.slice(0, maxAlertes)) out.push(`- **${x.jeu}**${x.chemin ? ` — \`${x.chemin.replace(/^public\/territoires\//, '')}\`` : ''} : ${x.message}`);
    if (triees.length > maxAlertes) out.push(`- … et ${triees.length - maxAlertes} autres (lancer \`npm run comparer-reingestion\`).`);
    out.push('');
  }
  out.push('| Jeu | Fichiers | Communes | Valeurs | Octets |', '|---|---:|---:|---:|---:|');
  for (const [j, x] of t) {
    const f = [x.fichiers.modifies && `${x.fichiers.modifies}`, x.fichiers.ajoutes && `+${x.fichiers.ajoutes}`, x.fichiers.supprimes && `−${x.fichiers.supprimes}`].filter(Boolean).join(' ');
    const c = x.avant.communes || x.apres.communes ? `${n(x.apres.communes)} (${signe(x.avant.communes, x.apres.communes)})` : '—';
    out.push(`| ${j} | ${f} | ${c} | ${signe(x.avant.valeurs, x.apres.valeurs)} | ${signe(x.avant.octets, x.apres.octets)} |`);
  }
  return out.join('\n') + '\n';
}

/** Les fichiers JSON qui diffèrent de la révision, suivis ou non. */
function changes(revision: string): { chemin: string; etat: 'A' | 'M' | 'D' }[] {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: RACINE, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  const vus = new Map<string, 'A' | 'M' | 'D'>();
  for (const l of git('diff', '--name-status', '--no-renames', revision, '--', DOSSIER).split('\n')) {
    const [e, c] = l.split('\t');
    if (c?.endsWith('.json')) vus.set(c, e === 'D' ? 'D' : e === 'A' ? 'A' : 'M');
  }
  for (const c of git('ls-files', '--others', '--exclude-standard', '--', DOSSIER).split('\n')) if (c.endsWith('.json')) vus.set(c, 'A');
  return [...vus].map(([chemin, etat]) => ({ chemin, etat }));
}

/** Le contenu de fichiers dans une révision, en un seul `git cat-file --batch`. */
async function contenus(revision: string, chemins: string[]): Promise<Map<string, string>> {
  const p = spawn('git', ['cat-file', '--batch'], { cwd: RACINE });
  const morceaux: Buffer[] = [];
  p.stdout.on('data', (b: Buffer) => morceaux.push(b));
  const fin = new Promise<void>((ok, ko) => p.on('close', (c) => (c ? ko(new Error(`git cat-file : ${c}`)) : ok())));
  p.stdin.end(chemins.map((c) => `${revision}:${c}\n`).join(''));
  await fin;
  const tout = Buffer.concat(morceaux);
  const sortie = new Map<string, string>();
  let i = 0;
  for (const c of chemins) {
    const nl = tout.indexOf(0x0a, i);
    const entete = tout.subarray(i, nl).toString();
    i = nl + 1;
    const m = /^\S+ blob (\d+)$/.exec(entete);
    if (!m) continue; // « missing »
    const taille = Number(m[1]);
    sortie.set(c, tout.subarray(i, i + taille).toString('utf8'));
    i += taille + 1;
  }
  return sortie;
}

export async function comparer(revision = 'HEAD'): Promise<Ligne[]> {
  const ch = changes(revision);
  const lignes: Ligne[] = [];
  // Par lots : la réingestion réécrit près d'un gigaoctet, qu'on ne garde pas en mémoire d'un coup.
  for (let k = 0; k < ch.length; k += 500) {
    const lot = ch.slice(k, k + 500);
    const anciens = await contenus(revision, lot.filter((x) => x.etat !== 'A').map((x) => x.chemin));
    for (const { chemin, etat } of lot) {
      lignes.push({
        chemin,
        avant: anciens.has(chemin) ? mesurer(anciens.get(chemin)!) : null,
        apres: etat === 'D' ? null : mesurer(readFileSync(join(RACINE, chemin), 'utf8')),
      });
    }
  }
  return lignes;
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const revision = process.argv[2] ?? 'HEAD';
  process.stdout.write(rapport(await comparer(revision), revision));
}
