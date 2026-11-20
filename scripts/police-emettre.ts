/**
 * La police municipale, commune par commune : l'enquête annuelle du ministère
 * de l'Intérieur (direction des libertés publiques et des affaires
 * juridiques), sous Licence Ouverte.
 *
 * Pour chaque commune qui a un service de police municipale : le nombre
 * d'agents de police municipale, d'agents de surveillance de la voie
 * publique (ASVP ; à Paris, les agents de surveillance de Paris), de gardes
 * champêtres, et si elle met des agents en commun avec d'autres communes
 * (article L. 512-1 du code de la sécurité intérieure). Une commune qui n'y
 * figure pas n'a pas déclaré de service : la page le dit ainsi, au conditionnel
 * de l'enquête, sans conclure qu'aucun agent n'y patrouille — la gendarmerie
 * ou la police nationale y exercent de toute façon.
 *
 * **Le fichier ne donne pas de code commune**, seulement le département et le
 * nom, saisi à la main (« SAINT POURCAIN SUR SIOULE », « BOURBON
 * L’ARCHAMBAULT », parfois suivi de « (Fait partie de la Communauté de
 * communes …) »). On le rapproche du découpage administratif dans le
 * département, nom plié, anciennes communes comprises ; deux homonymes se
 * départagent par la population que l'enquête donne. Une ligne qu'on ne
 * rapproche pas est comptée, jamais devinée.
 *
 * Les services intercommunaux (« … (EPCI) ») ne sont pas rattachés à une
 * commune : l'enquête ne dit pas lesquelles ils couvrent. Ils sont comptés
 * dans le journal de l'ingestion.
 *
 * Lancé seul — `tsx scripts/police-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-police.json`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { ressourcesQuiPortent } from './ressource-motif.ts';
import { indisponible } from './echecs.ts';
import { telechargerSiAbsent } from './par-departement.ts';

const JEU = 'police-municipale-effectifs-par-commune';

/** Par commune : [agents de police municipale, ASVP, gardes champêtres, 1 si agents mis en commun]. */
export type PoliceCommune = [number, number, number, 0 | 1];

export interface Police {
  annee: number;
  maj: string;
  communes: Map<string, PoliceCommune>;
}

/** Sans accents, casse ni ponctuation ; « St » et « Ste » écrits en entier. */
export const plier = (x: string) =>
  ` ${x
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `
    .replace(/ st /g, ' saint ')
    .replace(/ ste /g, ' sainte ')
    .trim();

type CommuneDecoupage = { code: string; nom: string; type: string; departement?: string; chefLieu?: string; commune?: string; population?: number };

/** Les noms d'un département, pliés, vers les codes actuels qu'ils peuvent désigner. */
export function nomsParDepartement(toutes: CommuneDecoupage[]): Map<string, Map<string, { code: string; population: number }[]>> {
  const actuelles = new Map(toutes.filter((c) => c.type === 'commune-actuelle').map((c) => [c.code, c]));
  const parDep = new Map<string, Map<string, { code: string; population: number }[]>>();
  for (const c of toutes) {
    const actuelle = c.type === 'commune-actuelle' ? c : actuelles.get(c.chefLieu ?? c.commune ?? '');
    if (!actuelle?.departement) continue;
    const dep = actuelle.departement;
    const m = parDep.get(dep) ?? parDep.set(dep, new Map()).get(dep)!;
    // « Le Tampon » se cherche aussi sans son article.
    const plie = plier(c.nom);
    for (const cle of new Set([plie, plie.replace(/^(le|la|les|l) /, '')])) {
      const l = m.get(cle) ?? m.set(cle, []).get(cle)!;
      if (!l.some((x) => x.code === actuelle.code)) l.push({ code: actuelle.code, population: actuelle.population ?? 0 });
    }
  }
  return parDep;
}

/** Le code d'une ligne de l'enquête, ou null. */
export function rapprocher(
  noms: Map<string, Map<string, { code: string; population: number }[]>>,
  dep: string,
  nom: string,
  habitants: number,
): string | null {
  const m = noms.get(dep);
  if (!m) return null;
  // « Conquet (le) » : l'article rejeté en fin de nom revient devant ; toute autre parenthèse tombe.
  const article = /^(.*?)\s*\(\s*(le|la|les|l['’]?)\s*\)\s*$/i.exec(nom);
  const propre = article ? `${article[2].replace(/['’]$/, '')} ${article[1]}` : nom.replace(/\(.*$/, '').trim();
  const proche = (x: { population: number }) => habitants > 0 && Math.abs(x.population - habitants) / habitants < 0.3;
  const cle = plier(propre);
  const l = m.get(cle) ?? m.get(cle.replace(/^(le|la|les|l) /, ''));
  if (l && l.length === 1) return l[0].code;
  if (l && l.length > 1) {
    // Des homonymes dans le département : la population la plus proche, si elle tranche nettement.
    const tries = [...l].sort((a, b) => Math.abs(a.population - habitants) - Math.abs(b.population - habitants));
    const ecart = (x: { population: number }) => Math.abs(x.population - habitants) / Math.max(1, habitants);
    return habitants > 0 && ecart(tries[0]) < 0.3 && ecart(tries[1]) > 0.5 ? tries[0].code : null;
  }
  // Un nom abrégé (« BERRE » pour Berre-l'Étang) ou allongé (« VALLAURIS GOLFE JUAN ») :
  // retenu seulement si une seule commune du département s'y prête et que sa population concorde.
  const candidats = [...m].filter(([n]) => n.startsWith(`${cle} `) || cle.startsWith(`${n} `)).flatMap(([, v]) => v);
  const uniques = [...new Map(candidats.map((c) => [c.code, c])).values()].filter(proche);
  return uniques.length === 1 ? uniques[0].code : null;
}

const nombre = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0);

/** Le département tel que l'enquête l'écrit : 3, « 2A », 971… */
const departement = (v: unknown) => {
  const t = String(v ?? '').trim().toUpperCase();
  return /^\d$/.test(t) ? `0${t}` : t;
};

export async function collecterPolice(
  telecharger: (url: string, vers: string) => Promise<void>,
  json: <T>(url: string) => Promise<T>,
  cache: string,
  dire: (m: string) => void,
): Promise<Police | null> {
  // L'année est dans le titre de chaque fichier : on prend la plus récente, quel que soit l'ordre de la liste.
  type Ressource = { title?: string; url?: string };
  let ressources: Ressource[] = [];
  try {
    ressources = (await json<{ data?: Ressource[] }>(`https://www.data.gouv.fr/api/2/datasets/${JEU}/resources/?page_size=100`)).data ?? [];
  } catch {
    return indisponible(dire, 'Police municipale : le jeu n’a pas répondu.');
  }
  const annees = ressourcesQuiPortent(ressources.filter((r) => r.url), 'police municipale')
    .map((r) => ({ url: r.url!, annee: Number(/(20\d\d)/.exec(r.title ?? '')?.[1] ?? 0) }))
    .sort((a, b) => b.annee - a.annee);
  const adresse = annees[0]?.url;
  if (!adresse) return indisponible(dire, 'Police municipale : le fichier de l’enquête est introuvable.');
  const XLSX = (await import('xlsx')).default;
  XLSX.set_fs(fs);
  // L'année dans le nom : un fichier gardé en cache ne masque pas l'enquête suivante.
  const fichier = join(cache, `police-municipale-${annees[0].annee}${adresse.slice(adresse.lastIndexOf('.'))}`);
  await telecharger(adresse, fichier);
  const classeur = XLSX.readFile(fichier);
  const lignes = XLSX.utils.sheet_to_json<unknown[]>(classeur.Sheets[classeur.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const titre = lignes.slice(0, 10).map((l) => l.join(' ')).join(' ');
  const annee = Number(/ENQU[ÊE]TE POLICES? MUNICIPALES? (\d{4})/i.exec(titre)?.[1] ?? /(20\d\d)/.exec(adresse)?.[1] ?? 0);
  // Les colonnes, d'après l'en-tête : on les cherche par leur libellé, pas par leur rang.
  const iEntete = lignes.findIndex((l) => l.some((c) => /Nombre d.agents de police municipale/i.test(String(c))));
  if (iEntete < 0 || !annee) return indisponible(dire, 'Police municipale : l’enquête a changé de forme.');
  const entete = lignes[iEntete].map(String);
  const col = (re: RegExp) => entete.findIndex((c) => re.test(c));
  const iNom = col(/Nom des communes/i);
  const iHabitants = col(/Nombre d.habitants/i);
  const iCommun = col(/Mise en commun/i);
  const iAgents = col(/Nombre d.agents de police municipale/i);
  const iAsvp = col(/ASVP/i);
  const iGardes = col(/gardes champ/i);
  if ([iNom, iAgents, iAsvp, iGardes].some((i) => i < 0)) return indisponible(dire, 'Police municipale : une colonne attendue manque.');

  const decoupage = JSON.parse(
    readFileSync(createRequire(import.meta.url).resolve('@etalab/decoupage-administratif/data/communes.json'), 'utf8'),
  ) as CommuneDecoupage[];
  const noms = nomsParDepartement(decoupage);
  const communes = new Map<string, PoliceCommune>();
  let epci = 0;
  const perdues: string[] = [];
  for (const l of lignes.slice(iEntete + 1)) {
    const dep = departement(l[0]);
    const nom = String(l[iNom] ?? '').trim();
    if (!/^(\d{2,3}|2[AB])$/.test(dep) || !nom) continue;
    // « DOMONT / PISCOP », « Hem – Lannoy – Leers » : un service partagé, que l'enquête porte
    // au nom de la première commune ; il lui est rattaché, agents mis en commun.
    const liste = nom.split(/\s*\/\s*|\s+[–-]\s+|\s*\+\s*/).filter(Boolean);
    const partage = liste.length > 1;
    if (/\(EPCI\)|\bEPCI\b|^communaut[ée]|^(CC|CA|CU|CdC|COM COM|COM  COMMUNES|COM COMMUNES)\b|\bagglo|\bm[ée]tropole|pluricommunale|intercommunale|mutualisation|\bSIVOM\b|\bsyndicat\b|brigade verte|\(.*,/i.test(nom)) {
      epci++;
      continue;
    }
    // Le nom entier d'abord (« LES PENNES - MIRABEAU » est une commune), la première de la liste ensuite.
    const entier = rapprocher(noms, dep, nom, nombre(l[iHabitants]));
    const code = entier ?? (partage ? rapprocher(noms, dep, liste[0], 0) : null);
    const commun = !entier && partage;
    if (!code) {
      perdues.push(`${dep} ${nom}`);
      continue;
    }
    const v: PoliceCommune = [nombre(l[iAgents]), nombre(l[iAsvp]), nombre(l[iGardes]), commun || (iCommun >= 0 && nombre(l[iCommun]) > 0) ? 1 : 0];
    const deja = communes.get(code);
    // Deux lignes pour une même commune — une commune nouvelle et une déléguée : on additionne.
    communes.set(code, deja ? [deja[0] + v[0], deja[1] + v[1], deja[2] + v[2], (deja[3] || v[3]) as 0 | 1] : v);
  }
  if (communes.size < 3000) {
    return indisponible(dire, `Police municipale : ${communes.size} communes seulement rapprochées, on garde l’ingestion précédente.`);
  }
  dire(
    `Police municipale (enquête ${annee}) : ${communes.size.toLocaleString('fr-FR')} communes, ` +
      `${perdues.length} lignes non rapprochées, ${epci} services intercommunaux non rattachés.`,
  );
  for (const p of perdues.slice(0, Number(process.env.ROUAGES_POLICE_PERDUES ?? 12))) dire(`  non rapprochée : ${p}`);
  return { annee, maj: new Date().toISOString().slice(0, 10), communes };
}

/**
 * Un fichier par département, même sans aucune commune : l'absence d'une
 * commune y veut dire « pas de service déclaré », pas « donnée manquante ».
 */
export function ecrirePolice(sortie: string, p: Police): number {
  const parDep = new Map<string, Record<string, PoliceCommune>>();
  for (const [code, v] of [...p.communes].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dep = code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2);
    (parDep.get(dep) ?? parDep.set(dep, {}).get(dep)!)[code] = v;
  }
  let n = 0;
  for (const f of readdirSync(join(sortie, 'dep'))) {
    const dep = /^([0-9AB]{2,3})\.json$/.exec(f)?.[1];
    if (!dep || !existsSync(join(sortie, 'dep', f))) continue;
    writeFileSync(join(sortie, 'dep', `${dep}-police.json`), JSON.stringify({ maj: p.maj, annee: p.annee, c: parDep.get(dep) ?? {} }));
    n++;
  }
  return n;
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const p = await collecterPolice(telecharger, lireJson as <T>(url: string) => Promise<T>, cache, console.log);
  if (p) console.log(`${ecrirePolice(sortie, p)} départements écrits.`);
}
