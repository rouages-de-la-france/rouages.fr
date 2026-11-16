/**
 * Les deux dates qui disent de quand date ce qu'on lit : celle du site
 * (le dernier déploiement) et celle des données (la dernière réingestion).
 *
 * Le site se construit puis se publie aussitôt (`.github/workflows/deployer.yml`) :
 * l'heure de la construction est celle du déploiement, à quelques minutes près.
 * La version est le commit publié, que GitHub Actions donne dans `GITHUB_SHA` ;
 * hors CI, on la demande à git, et sans git il n'y en a pas.
 *
 * La date des données vient de `public/territoires/ingestion.json`, que
 * `npm run territoires` écrit à la fin d'une réingestion complète. Avant la
 * première, on se rabat sur la lecture la plus récente notée dans
 * `provenance.json`, et on le dit : ce n'est pas la même chose.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './graphe.ts';

export interface VersionSite {
  construit: Date;
  /** Le commit publié, en entier ; `null` si on ne le connaît pas. */
  commit: string | null;
}

export interface Ingestion {
  /** `complete` : une réingestion entière ; `lecture` : la date de lecture la plus récente d'une source. */
  nature: 'complete' | 'lecture';
  fin: Date;
  debut: Date | null;
  echecs: string[];
}

const COMMIT = /^[0-9a-f]{40}$/;

function commitCourant(): string | null {
  const ci = process.env.GITHUB_SHA;
  if (ci && COMMIT.test(ci)) return ci;
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return COMMIT.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

let version: VersionSite | undefined;
/** Relevée une fois par construction : toutes les pages portent la même. */
export function versionSite(): VersionSite {
  return (version ??= { construit: new Date(), commit: commitCourant() });
}

function lireJson<T>(chemin: string): T | null {
  if (!existsSync(chemin)) return null;
  try {
    return JSON.parse(readFileSync(chemin, 'utf8')) as T;
  } catch {
    return null;
  }
}

const date = (s: unknown): Date | null => {
  if (typeof s !== 'string') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Lit les fichiers de `dossier` ; exporté pour la vérification. */
export function lireIngestion(dossier = join(RACINE, 'public', 'territoires')): Ingestion | null {
  const brut = lireJson<{ debut?: unknown; fin?: unknown; echecs?: unknown }>(join(dossier, 'ingestion.json'));
  const fin = date(brut?.fin);
  if (brut && fin) {
    const echecs = Array.isArray(brut.echecs) ? brut.echecs.filter((e): e is string => typeof e === 'string') : [];
    return { nature: 'complete', fin, debut: date(brut.debut), echecs };
  }
  const provenance = lireJson<Record<string, { r?: unknown }>>(join(dossier, 'provenance.json'));
  const lectures = Object.values(provenance ?? {})
    .map((v) => (typeof v?.r === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.r) ? v.r : null))
    .filter((r): r is string => r !== null)
    .sort();
  const derniere = lectures.at(-1);
  return derniere ? { nature: 'lecture', fin: new Date(`${derniere}T12:00:00Z`), debut: null, echecs: [] } : null;
}

let ingestion: Ingestion | null | undefined;
export function derniereIngestion(): Ingestion | null {
  if (ingestion === undefined) ingestion = lireIngestion();
  return ingestion;
}

/** « 16 novembre 2026 », à l'heure de Paris : un déploiement à 23 h 30 UTC est du lendemain. */
export function jourParis(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
}

/** « 16 novembre 2026 à 21 h 09 », à l'heure de Paris. */
export function momentParis(d: Date): string {
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', ' h ');
  return `${jourParis(d)} à ${heure}`;
}

/** « 3 h 12 », « 47 min ». */
export function duree(debut: Date, fin: Date): string {
  const min = Math.max(0, Math.round((fin.getTime() - debut.getTime()) / 60_000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}
