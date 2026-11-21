/**
 * France Travail, par ses API publiques (francetravail.io) : l'agence dont
 * relève chaque commune, et les offres d'emploi et les embauches de chaque
 * intercommunalité.
 *
 * **L'agence.** Le référentiel des agences donne, pour chacune, sa **zone de
 * compétence** : les communes qu'elle dessert. C'est ce qui manquait pour les
 * France services, dont on a refusé de deviner le ressort à vol d'oiseau : ici
 * le ressort est publié. Une commune peut relever d'une agence et d'un relais ;
 * l'agence passe en tête. Les horaires sont ceux du référentiel : le matin en
 * accès libre, l'après-midi sur rendez-vous, comme France Travail le dit de ses
 * agences (« Vous rendre dans une agence », foire aux questions).
 *
 * **Les offres et les embauches.** L'API Marché du travail refuse l'échelon de
 * la commune (« Le type de territoire COM n'est pas autorisé », constaté le
 * 21 novembre 2026, bien que son catalogue l'annonce) ; elle répond pour
 * l'intercommunalité. On en garde :
 *   — les offres des douze derniers mois, toutes origines (France Travail et
 *     partenaires), et celles déposées à France Travail, avec la répartition
 *     par contrat ;
 *   — les embauches du dernier trimestre publié, tous candidats, toutes durées
 *     et de plus d'un mois.
 * France Travail arrondit ces nombres à la dizaine.
 *
 * **Ce qui n'est pas repris** : l'« indicateur de dynamisme », une prévision
 * du trimestre suivant par une méthode d'intelligence artificielle dont rien
 * n'est publié — un chiffre qu'on ne peut pas vérifier, et un indice composé.
 *
 * **La licence.** Les conditions générales de francetravail.io soumettent les
 * API de données publiques à la « licence Etalab », mais en décrivent les
 * obligations comme celles de l'ODbL (partage à l'identique, bases
 * redistribuées maintenues ouvertes). Tant que France Travail ne l'a pas
 * précisé, le fichier est écrit à part, `public/territoires/francetravail.json`,
 * sous la plus exigeante des deux. *À valider par un avocat.*
 *
 * **Les identifiants.** L'accès est gratuit mais demande un compte :
 * `FRANCETRAVAIL_IDENTIFIANT` et `FRANCETRAVAIL_SECRET` (secrets de GitHub
 * Actions, ou `.env` de l'ingestion locale). Sans eux, la collecte renonce et
 * laisse le fichier précédent en place.
 *
 * Lancé seul : `tsx scripts/francetravail-emettre.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';
import { reportsDuDecoupage } from './par-departement.ts';

const JETON = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const AGENCES = 'https://api.francetravail.io/partenaire/referentielagences/v1';
const MARCHE = 'https://api.francetravail.io/partenaire/stats-offres-demandes-emploi/v1';
const PORTEE_AGENCES = 'api_referentielagencesv1 organisationpe';
const PORTEE_MARCHE = 'api_stats-offres-demandes-emploiv1 offresetdemandesemploi';

/** Une agence : libellé, adresse (voie), code postal et ville, latitude, longitude, horaires, courriel, 1 si relais. */
export type AgenceFT = [string, string, string, number, number, HoraireFT[], string, 0 | 1];
/** Un jour : 1 (lundi) à 7, accès libre (« 08:30-12:30 », plages séparées par une virgule, '' si aucune), sur rendez-vous. */
export type HoraireFT = [number, string, string];
/**
 * Les offres d'une intercommunalité sur douze mois : trimestre de fin, toutes
 * offres, dont France Travail, puis la répartition de toutes les offres par
 * contrat : CDI, CDD de plus de six mois, CDD de un à six mois, CDD de moins
 * d'un mois, autres (intérim, emplois aidés, apprentissage).
 */
export type OffresFT = [string, number, number, number, number, number, number, number];
/** Les embauches d'un trimestre : trimestre, toutes durées, contrats de plus d'un mois. */
export type EmbauchesFT = [string, number, number];

export interface FranceTravail {
  maj: string;
  agences: Record<string, AgenceFT>;
  communes: Record<string, string[]>;
  epci: Record<string, { o?: OffresFT; b?: EmbauchesFT }>;
}

type Horaire = Record<string, string | number | undefined>;
interface Agence {
  code: string;
  libelle: string;
  libelleEtendu?: string;
  type?: string;
  contact?: { email?: string };
  adressePrincipale?: { ligne4?: string; ligne5?: string; ligne6?: string; gpsLat?: number; gpsLon?: number };
  horaires?: Horaire[];
  zoneCompetences?: { communeInsee: string }[];
}
interface Valeur {
  codeNomenclature: string;
  codePeriode: string;
  valeurPrincipaleNombre?: number;
  listeValeurParCaract?: { codeTypeCaract: string; codeCaract: string; nombre?: number; masque?: boolean }[];
}

/** Les codes des départements, d'après le découpage administratif : le filtre des agences les prend en préfixe. */
export function departementsFrance(): string[] {
  const chemin = createRequire(import.meta.url).resolve('@etalab/decoupage-administratif/data/departements.json');
  return (JSON.parse(readFileSync(chemin, 'utf8')) as { code: string }[]).map((d) => d.code);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Un client qui garde son jeton et le renouvelle avant qu'il n'expire, ou sur un refus. */
function client(identifiant: string, secret: string) {
  const jetons = new Map<string, { valeur: string; fin: number }>();
  const jeton = async (portee: string, forcer = false) => {
    const j = jetons.get(portee);
    if (j && !forcer && Date.now() < j.fin) return j.valeur;
    // Le serveur d'authentification décroche parfois : trois essais avant de renoncer.
    let r: Response | null = null;
    for (let essai = 0; essai < 3; essai++) {
      r = await fetch(JETON, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${identifiant}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: portee }),
      }).catch(() => null);
      if (r?.ok) break;
      await pause(2000 * (essai + 1));
    }
    if (!r?.ok) throw new Error(`France Travail : jeton refusé (${r ? r.status : 'pas de réponse'}) pour ${portee}`);
    const d = (await r.json()) as { access_token: string; expires_in?: number };
    jetons.set(portee, { valeur: d.access_token, fin: Date.now() + Math.max(60, (d.expires_in ?? 1400) - 60) * 1000 });
    return d.access_token;
  };
  /** Rend le corps JSON, `null` sur une réponse vide (204) ; réessaie sur un refus de jeton, un 429 ou un 5xx. */
  return async <T>(portee: string, url: string, corps?: unknown): Promise<T | null> => {
    for (let essai = 0; ; essai++) {
      const r = await fetch(url, {
        method: corps ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${await jeton(portee, essai > 0)}`,
          Accept: 'application/json',
          ...(corps ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corps ? JSON.stringify(corps) : undefined,
      }).catch(() => null);
      if (r && r.status === 204) return null;
      if (r && r.ok) return (await r.json()) as T;
      const reessayer = !r || r.status === 401 || r.status === 429 || r.status >= 500;
      if (!reessayer || essai >= 3) throw new Error(`France Travail : ${r ? r.status : 'pas de réponse'} sur ${url}`);
      await pause(1000 * 2 ** essai);
    }
  };
}

/** « 08:30 » et « 12:30 » → « 08:30-12:30 » ; rien si l'une manque. */
const plage = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' && a && b ? `${a}-${b}` : '');

export function horairesDe(h: Horaire[] | undefined): HoraireFT[] {
  return (h ?? [])
    .map((j): HoraireFT => {
      const libre = j.horaireFerme === 'O' ? [] : [plage(j.ouvertureMatin, j.fermetureMatin), plage(j.ouvertureApresMidi, j.fermetureApresMidi)];
      const rdv = j.horaireFermeRDV === 'O' ? [] : [plage(j.ouvertureMatinRDV, j.fermetureMatinRDV), plage(j.ouvertureApresMidiRDV, j.fermetureApresMidiRDV)];
      return [Number(j.jour), libre.filter(Boolean).join(','), rdv.filter(Boolean).join(',')];
    })
    .filter(([jour, libre, rdv]) => jour >= 1 && jour <= 7 && (libre || rdv))
    .sort((a, b) => a[0] - b[0]);
}

/** Le nombre d'une caractéristique, 0 si masquée ou absente. */
const caract = (v: Valeur, type: string, code: string) =>
  v.listeValeurParCaract?.find((c) => c.codeTypeCaract === type && c.codeCaract === code && !c.masque)?.nombre ?? 0;

export function offresDe(valeurs: Valeur[]): OffresFT | undefined {
  const toutes = valeurs.find((v) => v.codeNomenclature === 'TOFF-CUMUL12MOIS');
  if (!toutes || toutes.valeurPrincipaleNombre === undefined) return undefined;
  const ft = valeurs.find((v) => v.codeNomenclature === 'PE-CUMUL12MOIS' && v.codePeriode === toutes.codePeriode);
  const c = (code: string) => caract(toutes, 'TYPECTR', code);
  return [toutes.codePeriode, toutes.valeurPrincipaleNombre, ft?.valeurPrincipaleNombre ?? 0, c('CDI'), c('CDD3'), c('CDD2'), c('CDD1'), c('AUTR')];
}

export function embauchesDe(valeurs: Valeur[]): EmbauchesFT | undefined {
  const toute = valeurs.find((v) => v.codeNomenclature === 'TOUT-TOUTE');
  if (!toute || toute.valeurPrincipaleNombre === undefined) return undefined;
  const plus = valeurs.find((v) => v.codeNomenclature === 'TOUT-SUP1M' && v.codePeriode === toute.codePeriode);
  return [toute.codePeriode, toute.valeurPrincipaleNombre, plus?.valeurPrincipaleNombre ?? 0];
}

export async function collecterFranceTravail(
  departements: string[],
  dire: (m: string) => void,
  aujourdhui = new Date().toISOString().slice(0, 10),
): Promise<FranceTravail | null> {
  const identifiant = process.env.FRANCETRAVAIL_IDENTIFIANT;
  const secret = process.env.FRANCETRAVAIL_SECRET;
  if (!identifiant || !secret) return indisponible(dire, 'France Travail : FRANCETRAVAIL_IDENTIFIANT ou FRANCETRAVAIL_SECRET manque.');
  const api = client(identifiant, secret);

  // Les agences, département par département : le filtre « commune » prend un début de code INSEE.
  const agences: Record<string, AgenceFT> = {};
  const parCommune = new Map<string, { code: string; relais: boolean }[]>();
  const { actuelles, reports } = reportsDuDecoupage();
  for (const dep of departements) {
    const liste = (await api<Agence[]>(PORTEE_AGENCES, `${AGENCES}/agences?commune=${dep}&zonecompetence=true&horaire=true`)) ?? [];
    for (const a of liste) {
      const adr = a.adressePrincipale ?? {};
      const relais = a.type === 'RPE';
      agences[a.code] ??= [
        (a.libelleEtendu || a.libelle).trim(),
        [adr.ligne4, adr.ligne5].filter((x) => x && x.trim()).join(', ').trim(),
        (adr.ligne6 ?? '').trim(),
        adr.gpsLat ?? 0,
        adr.gpsLon ?? 0,
        horairesDe(a.horaires),
        (a.contact?.email ?? '').trim(),
        relais ? 1 : 0,
      ];
      for (const z of a.zoneCompetences ?? []) {
        // Un arrondissement municipal, une commune déléguée : rattachés aussi à la commune actuelle.
        for (const c of new Set([z.communeInsee, reports.get(z.communeInsee) ?? z.communeInsee])) {
          const l = parCommune.get(c) ?? [];
          if (!l.some((x) => x.code === a.code)) l.push({ code: a.code, relais });
          parCommune.set(c, l);
        }
      }
    }
    await pause(150);
  }
  if (Object.keys(agences).length < 500) {
    return indisponible(dire, `France Travail : ${Object.keys(agences).length} agences seulement, on garde l’ingestion précédente.`);
  }
  const communes: Record<string, string[]> = {};
  for (const [c, l] of parCommune) if (actuelles.has(c)) communes[c] = [...l].sort((a, b) => Number(a.relais) - Number(b.relais) || a.code.localeCompare(b.code)).map((x) => x.code);

  // Les intercommunalités, d'après le référentiel de l'API elle-même.
  const liste =
    (await api<{ listeTerritoire?: { codeTerritoire: string }[]; territoires?: { codeTerritoire: string }[] }>(PORTEE_MARCHE, `${MARCHE}/referentiel/territoires/EPCI`)) ?? {};
  const sirens = (liste.listeTerritoire ?? liste.territoires ?? Object.values(liste).find(Array.isArray) ?? []) as { codeTerritoire: string }[];
  const epci: FranceTravail['epci'] = {};
  let echecs = 0;
  const critere = (siren: string, nomenclature: string) => ({
    codeTypeTerritoire: 'EPCI',
    codeTerritoire: siren,
    codeTypeActivite: 'CUMUL',
    codeActivite: 'CUMUL',
    codeTypePeriode: 'TRIMESTRE',
    codeTypeNomenclature: nomenclature,
    dernierePeriode: true,
  });
  for (const { codeTerritoire: siren } of sirens) {
    try {
      const o = await api<{ listeValeursParPeriode?: Valeur[] }>(PORTEE_MARCHE, `${MARCHE}/indicateur/stat-offres`, critere(siren, 'ORIGINEOFF'));
      const b = await api<{ listeValeursParPeriode?: Valeur[] }>(PORTEE_MARCHE, `${MARCHE}/indicateur/stat-embauches`, critere(siren, 'CATCANDxDUREEEMP'));
      const x = { o: offresDe(o?.listeValeursParPeriode ?? []), b: embauchesDe(b?.listeValeursParPeriode ?? []) };
      if (x.o || x.b) epci[siren] = x;
    } catch {
      echecs++;
    }
    await pause(100);
  }
  if (sirens.length < 1000 || Object.keys(epci).length < sirens.length * 0.9) {
    return indisponible(dire, `France Travail : ${Object.keys(epci).length} intercommunalités lues sur ${sirens.length} (${echecs} en erreur), on garde l’ingestion précédente.`);
  }
  dire(`France Travail : ${Object.keys(agences).length} agences et relais, ${Object.keys(communes).length} communes rattachées, ${Object.keys(epci).length} intercommunalités (${echecs} en erreur).`);
  return { maj: aujourdhui, agences, communes, epci };
}

/** Un fichier à part, sous la plus exigeante des deux licences que les conditions de francetravail.io évoquent. */
export function ecrireFranceTravail(sortie: string, f: FranceTravail): void {
  writeFileSync(
    join(sortie, 'francetravail.json'),
    JSON.stringify({
      licence:
        'Données publiques de France Travail (francetravail.io) : réutilisation sous la licence Etalab, avec partage à l’identique et maintien en accès ouvert des bases redistribuées, selon les conditions générales de francetravail.io (§ 5.2 a).',
      source: 'France Travail, API Référentiel des agences et API Marché du travail (francetravail.io)',
      maj: f.maj,
      a: f.agences,
      c: f.communes,
      e: f.epci,
    }),
  );
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sortie = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'territoires');
  const f = await collecterFranceTravail(departementsFrance(), console.log);
  if (f) ecrireFranceTravail(sortie, f);
}
