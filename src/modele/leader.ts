/**
 * Les groupes d'action locale (GAL) LEADER, d'après les Régions qui publient
 * leurs périmètres (`scripts/leader-emettre.ts`).
 *
 * La couverture est partielle et le dit : une commune d'une région que la
 * collecte n'a pas lue n'est pas « hors LEADER », on ne sait pas. Chaque
 * fichier porte la liste des régions lues ; c'est elle qui permet de dire
 * « dans aucun GAL » plutôt que rien.
 */
import { parDepartement } from './fiche-commune.ts';
import { metaTerritoires } from './territoires.ts';

type LeaderDep = { maj: string; regions: Record<string, string>; c: Record<string, [string]> };
const leaderDep = parDepartement<LeaderDep>('leader');

let couverture: { regions: Record<string, string>; maj: string } | null | undefined;

/** Les régions lues par la dernière collecte (code → date), et la date de la collecte. */
export function couvertureLeader(): { regions: Record<string, string>; maj: string } | null {
  if (couverture !== undefined) return couverture;
  couverture = null;
  for (const dep of Object.keys(metaTerritoires()?.codesRegion ?? {})) {
    const d = leaderDep.get(dep);
    if (d) {
      couverture = { regions: d.regions, maj: d.maj };
      break;
    }
  }
  return couverture;
}

/** Le nom de chaque région couverte, pour la page. */
export function regionsCouvertes(): string[] {
  const c = couvertureLeader();
  const meta = metaTerritoires();
  if (!c || !meta) return [];
  const noms = new Set<string>();
  for (const [dep, reg] of Object.entries(meta.codesRegion ?? {})) if (c.regions[reg] && meta.regions?.[dep]) noms.add(meta.regions[dep]);
  return [...noms].sort((a, b) => a.localeCompare(b, 'fr'));
}

export interface LeaderCommune {
  /** Le nom du GAL, ou null. */
  gal: string | null;
  /** La région de la commune a-t-elle été lue ? Sinon, on ne sait pas si elle est dans un GAL. */
  couvert: boolean;
  /** Le nom de la région, pour dire laquelle manque. */
  region: string | null;
  maj: string;
}

/**
 * Le GAL de la commune ; `couvert: false` si sa région n'a pas été lue — on ne
 * sait pas, et la page le dit. `null` seulement quand aucune collecte n'a
 * encore tourné.
 */
export function leaderDe(dep: string, code: string): LeaderCommune | null {
  const d = leaderDep.get(dep);
  const gal = d?.c[code]?.[0] ?? null;
  const c = couvertureLeader();
  const meta = metaTerritoires();
  const region = meta?.regions?.[dep] ?? null;
  if (gal && d) return { gal, couvert: true, region, maj: d.maj };
  if (!c) return null;
  const reg = meta?.codesRegion?.[dep];
  return { gal: null, couvert: Boolean(reg && c.regions[reg]), region, maj: c.maj };
}

/** Toutes les communes dans un GAL, par département : pour la page du dispositif. */
export function communesLeader(dep: string): Record<string, [string]> {
  return leaderDep.get(dep)?.c ?? {};
}
