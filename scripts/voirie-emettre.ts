/**
 * La longueur de voirie retenue pour la dotation globale de fonctionnement,
 * commune par commune : un des critères que la DGCL publie chaque année avec
 * le calcul des dotations.
 *
 * Depuis 2026, ce n'est plus la voirie classée dans le domaine public
 * communal que la commune déclarait, mais les voies que l'IGN recense
 * (article R. 2334-8-1 du code général des collectivités territoriales,
 * selon la Banque des Territoires — à relire sur Légifrance) ; la longueur
 * compte double en montagne. Elle pèse dans deux fractions de la dotation de
 * solidarité rurale.
 *
 * **Une collecte à l'essai.** Le site des dotations de la DGCL ne répond pas
 * depuis l'environnement de développement ; on ne connaît donc ni l'adresse
 * exacte du fichier des critères des communes ni ses colonnes. La collecte
 * part de la page des critères, suit les liens de téléchargement qu'elle y
 * trouve, et prend le premier fichier qui a une colonne de code commune et une
 * colonne de voirie. Elle écrit dans le journal ce qu'elle a vu — liens,
 * en-têtes — pour qu'on la corrige si elle ne trouve rien. La couche
 * cartographique de l'IGN (`voirie-dgf` sur data.gouv.fr) ne sert pas : 8,4
 * millions de tronçons sans code commune.
 *
 * Lancé seul — `tsx scripts/voirie-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-voirie.json`.
 */
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decoder } from './donnees-ouvertes.ts';
import { indisponible } from './echecs.ts';
import { communeDe, ecrireParDepartement, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

const BASE = 'https://www.dotations-dgcl.interieur.gouv.fr';
const DEPARTS = [`${BASE}/consultation/criteres_repartition.php`, `${BASE}/consultation/accueil.php`, `${BASE}/`];

export interface Voirie {
  annee: number | null;
  maj: string;
  /** Longueur de voirie retenue, en mètres. */
  communes: Map<string, number>;
}

/** Les liens d'une page, absolus. */
export function liensDe(html: string, depuis: string): { url: string; texte: string }[] {
  const l: { url: string; texte: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      l.push({ url: new URL(m[1].replace(/&amp;/g, '&'), depuis).href, texte: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    } catch {
      // une adresse illisible : ignorée
    }
  }
  return l;
}

/** Le tableau d'un fichier téléchargé : CSV (point-virgule ou virgule) ou classeur. */
async function tableau(fichier: string): Promise<string[][]> {
  const octets = readFileSync(fichier);
  if (octets.subarray(0, 2).toString('latin1') === 'PK' || /\.(xlsx?|ods)$/i.test(fichier)) {
    const XLSX = (await import('xlsx')).default;
    XLSX.set_fs(fs);
    const c = XLSX.readFile(fichier);
    return XLSX.utils.sheet_to_json<unknown[]>(c.Sheets[c.SheetNames[0]], { header: 1, raw: false, defval: '' }).map((l) => l.map(String));
  }
  const texte = decoder(octets);
  const sep = (texte.split('\n')[0].match(/;/g) ?? []).length >= (texte.split('\n')[0].match(/,/g) ?? []).length ? ';' : ',';
  return texte.split(/\r?\n/).map((l) => l.split(sep).map((x) => x.replace(/^"|"$/g, '').trim()));
}

/** Dans un tableau, la ligne d'en-tête, la colonne du code commune et celle de la voirie. */
export function colonnesVoirie(t: string[][]): { ligne: number; code: number; voirie: number } | null {
  for (let i = 0; i < Math.min(15, t.length); i++) {
    const h = t[i].map((x) => x.toLowerCase());
    const code = h.findIndex((x) => /insee|depcom|code\s*commune|^code$/.test(x));
    // La longueur retenue, pas la seule part « montagne ».
    const voirie = h.findIndex((x) => /voirie/.test(x) && !/montagne|insulaire/.test(x));
    if (code >= 0 && voirie >= 0) return { ligne: i, code, voirie };
  }
  return null;
}

export async function collecterVoirie(
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Voirie | null> {
  const vus = new Set<string>();
  const candidats: { url: string; texte: string }[] = [];
  for (const depart of DEPARTS) {
    let html = '';
    try {
      const r = await fetch(depart, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) {
        dire(`  Voirie : ${depart} répond ${r.status}.`);
        continue;
      }
      html = await r.text();
    } catch (e) {
      dire(`  Voirie : ${depart} injoignable (${String(e)}).`);
      continue;
    }
    for (const l of liensDe(html, depart)) {
      if (vus.has(l.url)) continue;
      vus.add(l.url);
      if (/\.(csv|zip|xlsx?|ods)(\?|$)|telecharg|export|fichier/i.test(`${l.url} ${l.texte}`)) candidats.push(l);
    }
  }
  dire(`  Voirie : ${candidats.length} liens de téléchargement trouvés : ${candidats.slice(0, 20).map((c) => `${c.texte || '—'} <${c.url}>`).join(' ; ')}`);
  // Les fichiers des communes d'abord, les plus récents d'après l'année du lien.
  const annee = (c: { url: string; texte: string }) => Number(/(20\d\d)/.exec(`${c.url} ${c.texte}`)?.[1] ?? 0);
  const ordre = candidats
    .filter((c) => /commun/i.test(`${c.url} ${c.texte}`))
    .sort((a, b) => annee(b) - annee(a))
    .slice(0, 6);
  for (const c of ordre) {
    const vers = join(cache, `dgcl-criteres-${annee(c) || 'x'}-${vus.size}-${ordre.indexOf(c)}`);
    try {
      await telecharger(c.url, vers);
      const t = await tableau(vers);
      const cols = colonnesVoirie(t);
      if (!cols) {
        dire(`  Voirie : ${c.url} n’a pas de colonne de voirie ; en-tête : ${t.slice(0, 3).map((l) => l.slice(0, 40).join('|')).join(' // ').slice(0, 1200)}`);
        continue;
      }
      const { actuelles, reports } = reportsDuDecoupage();
      const communes = new Map<string, number>();
      for (const l of t.slice(cols.ligne + 1)) {
        const brut = (l[cols.code] ?? '').trim().padStart(5, '0');
        const code = communeDe(actuelles.has(brut) ? brut : (reports.get(brut) ?? ''));
        const m = Number((l[cols.voirie] ?? '').replace(/\s/g, '').replace(',', '.'));
        if (!code || !Number.isFinite(m)) continue;
        communes.set(code, (communes.get(code) ?? 0) + Math.round(m));
      }
      if (communes.size < 30000) {
        dire(`  Voirie : ${c.url} ne donne que ${communes.size} communes.`);
        continue;
      }
      dire(`Voirie retenue pour la DGF (${annee(c) || 'année non dite'}) : ${communes.size.toLocaleString('fr-FR')} communes, d’après ${c.url}.`);
      return { annee: annee(c) || null, maj: new Date().toISOString().slice(0, 10), communes };
    } catch (e) {
      dire(`  Voirie : ${c.url} illisible (${String(e)}).`);
    }
  }
  return indisponible(dire, 'Voirie : aucun fichier des critères des communes n’a été trouvé sur le site des dotations de la DGCL (voir les lignes ci-dessus).');
}

export function ecrireVoirie(sortie: string, v: Voirie): number {
  return ecrireParDepartement(sortie, 'voirie', v.communes, () => ({ maj: v.maj, annee: v.annee }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const v = await collecterVoirie(telecharger, cache, console.log);
  if (v) console.log(`${ecrireVoirie(sortie, v)} départements écrits.`);
}
