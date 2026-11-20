/**
 * Les stations de traitement des eaux usées de chaque commune, d'après le
 * référentiel du Sandre (base des eaux résiduaires urbaines du ministère de la
 * Transition écologique), servi en WFS.
 *
 * Pour chaque station en service : son nom, la commune où elle se trouve, la
 * commune principale de l'agglomération d'assainissement qu'elle traite, sa
 * capacité nominale en équivalents-habitants, l'année de sa mise en service,
 * et ce que le référentiel dit de son autosurveillance. Le référentiel ne
 * nomme ni le maître d'ouvrage ni l'exploitant : le service qui en a la
 * charge est celui de la section « Les eaux usées », d'après SISPEA
 * (`assainissement-emettre.ts`).
 *
 * Une station est rattachée à la commune où elle se trouve ; elle traite
 * souvent les eaux de plusieurs communes, que le référentiel ne liste pas.
 *
 * Lancé seul — `tsx scripts/steu-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-steu.json`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';
import { communeDe, ecrireParDepartement, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

const WFS = 'https://services.sandre.eaufrance.fr/geo/odp?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=sa:SysTraitementEauxUsees';
const PAGE = 1000;

/** Une station : nom, capacité (EH), année de mise en service, autosurveillance telle que libellée, commune principale de l'agglomération. */
export type Station = [string, number | null, number | null, string, string];

export interface Stations {
  maj: string;
  communes: Map<string, Station[]>;
}

const deEntites = (x: string) =>
  x
    .replace(/&#39;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Les stations d'une page GML : un dictionnaire de champs par membre. */
export function lireMembres(gml: string): Record<string, string>[] {
  const membres: Record<string, string>[] = [];
  for (const m of gml.split('<wfs:member>').slice(1)) {
    const champs: Record<string, string> = {};
    for (const c of m.matchAll(/<sa:([A-Za-z0-9]+)>([^<]*)<\/sa:\1>/g)) champs[c[1]] = deEntites(c[2].trim());
    membres.push(champs);
  }
  return membres;
}

export async function collecterStations(cache: string, dire: (m: string) => void): Promise<Stations | null> {
  const vers = join(cache, `sandre-steu-${new Date().toISOString().slice(0, 10)}.json`);
  let membres: Record<string, string>[];
  if (existsSync(vers)) membres = JSON.parse(readFileSync(vers, 'utf8')) as Record<string, string>[];
  else {
    membres = [];
    let echecs = 0;
    for (let debut = 0; ; ) {
      try {
        const r = await fetch(`${WFS}&COUNT=${PAGE}&STARTINDEX=${debut}`, { signal: AbortSignal.timeout(300_000) });
        if (!r.ok) throw new Error(`${r.status}`);
        const page = lireMembres(await r.text());
        membres.push(...page);
        debut += page.length;
        echecs = 0;
        if (page.length < PAGE) break;
      } catch (e) {
        if (++echecs > 8) return indisponible(dire, `Stations d’épuration : la page ${debut} du Sandre est refusée (${String(e)}).`);
        await new Promise((ok) => setTimeout(ok, 2000 * echecs));
      }
    }
    writeFileSync(vers, JSON.stringify(membres));
  }
  if (membres.length < 15000) return indisponible(dire, `Stations d’épuration : ${membres.length} stations seulement, on garde l’ingestion précédente.`);

  const { actuelles, reports } = reportsDuDecoupage();
  const actuelle = (brut: string) => communeDe(actuelles.has(brut) ? brut : (reports.get(brut) ?? ''));
  const communes = new Map<string, Station[]>();
  let horsService = 0;
  let sansCommune = 0;
  for (const s of membres) {
    if (s.DateMiseHorServiceOuvrageDepollution) {
      horsService++;
      continue;
    }
    const code = actuelle(s.CdCommuneLocalisation ?? '');
    if (!code) {
      sansCommune++;
      continue;
    }
    const capacite = Number(s.CapaciteNom ?? s.SomCapaNom);
    const annee = Number((s.DateMiseServiceOuvrageDepollution ?? '').slice(0, 4));
    const station: Station = [
      s.NomOuvrageDepollution ?? '',
      capacite > 0 ? capacite : null,
      annee > 1900 ? annee : null,
      s.LbConformiteAutosurveillance ?? '',
      actuelle(s.CdCommunePrincipale ?? '') || '',
    ];
    (communes.get(code) ?? communes.set(code, []).get(code)!).push(station);
  }
  for (const l of communes.values()) l.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  const n = [...communes.values()].reduce((s, l) => s + l.length, 0);
  dire(
    `Stations d’épuration (Sandre) : ${n.toLocaleString('fr-FR')} en service dans ${communes.size.toLocaleString('fr-FR')} communes ; ` +
      `${horsService} hors service, ${sansCommune} sans commune actuelle.`,
  );
  return { maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireStations(sortie: string, s: Stations): number {
  return ecrireParDepartement(sortie, 'steu', s.communes, () => ({ maj: s.maj }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const s = await collecterStations(cache, console.log);
  if (s) console.log(`${ecrireStations(sortie, s)} départements écrits.`);
}
