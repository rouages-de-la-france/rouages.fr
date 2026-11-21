/**
 * France Travail pour une commune (`scripts/francetravail-emettre.ts`) :
 * l'agence dont elle relève, par la zone de compétence que publie le
 * référentiel des agences, et les offres et embauches de son
 * intercommunalité — l'API refuse l'échelon de la commune.
 *
 * Le fichier est à part : sa licence n'est pas encore éclaircie (voir le
 * script).
 */
import { national } from './fiche-commune.ts';

type AgenceBrute = [string, string, string, number, number, [number, string, string][], string, 0 | 1];
interface FichierFT {
  licence: string;
  maj: string;
  a: Record<string, AgenceBrute>;
  c: Record<string, string[]>;
  e: Record<string, { o?: [string, number, number, number, number, number, number, number]; b?: [string, number, number] }>;
}
const fichier = national<FichierFT>('francetravail.json');

export interface AgenceFT {
  nom: string;
  adresse: string;
  ville: string;
  relais: boolean;
  /** Les jours groupés quand leurs horaires sont les mêmes : « du lundi au vendredi », « 8 h 30 – 12 h 30 ». */
  libre: { jours: string; heures: string }[];
  rdv: { jours: string; heures: string }[];
}

export interface FranceTravailIci {
  agences: AgenceFT[];
  epci: {
    nom: string;
    offres: { periode: string; toutes: number; francetravail: number; contrats: { nom: string; part: number }[] } | null;
    embauches: { periode: string; toutes: number; plusDunMois: number } | null;
  } | null;
  /** La recherche d'offres de francetravail.fr, autour de la commune. */
  lienOffres: string;
  maj: string;
}

const JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
/** « 08:30-12:30,13:30-16:30 » → « 8 h 30 – 12 h 30 et 13 h 30 – 16 h 30 ». */
const heures = (p: string) =>
  p
    .split(',')
    .map((x) => x.split('-').map((h) => h.replace(/^0/, '').replace(':', ' h ').replace(/ h 00$/, ' h')).join(' – '))
    .join(' et ');

/** Des jours consécutifs aux mêmes horaires forment une plage : « du lundi au jeudi ». */
export function grouper(jours: [number, string][]): { jours: string; heures: string }[] {
  const groupes: { de: number; a: number; p: string }[] = [];
  for (const [j, p] of jours) {
    if (!p) continue;
    const g = groupes.at(-1);
    if (g && g.p === p && g.a === j - 1) g.a = j;
    else groupes.push({ de: j, a: j, p });
  }
  return groupes.map((g) => ({
    jours: g.de === g.a ? `le ${JOURS[g.de]}` : g.a === g.de + 1 ? `le ${JOURS[g.de]} et le ${JOURS[g.a]}` : `du ${JOURS[g.de]} au ${JOURS[g.a]}`,
    heures: heures(g.p),
  }));
}

/** « 2026T2 » → « 2ᵉ trimestre 2026 ». */
export const trimestre = (p: string) => {
  const m = /^(\d{4})T([1-4])$/.exec(p);
  return m ? `${m[2] === '1' ? '1er' : `${m[2]}e`} trimestre ${m[1]}` : p;
};

const CONTRATS = ['en CDI', 'en CDD de plus de six mois', 'en CDD de un à six mois', 'en CDD de moins d’un mois', 'en intérim, emploi aidé ou apprentissage'];

export function franceTravail(code: string, epci: { siren: string; nom: string } | null): FranceTravailIci | null {
  const d = fichier();
  if (!d) return null;
  const agences = (d.c[code] ?? [])
    .map((k) => d.a[k])
    .filter((a): a is AgenceBrute => !!a)
    .map(([nom, adresse, ville, , , h, , relais]) => ({
      nom,
      adresse,
      ville,
      relais: relais === 1,
      libre: grouper(h.map(([j, l]) => [j, l])),
      rdv: grouper(h.map(([j, , r]) => [j, r])),
    }));
  const e = epci ? d.e[epci.siren] : undefined;
  const o = e?.o;
  const b = e?.b;
  const ici: FranceTravailIci = {
    agences,
    epci:
      epci && (o || b)
        ? {
            nom: epci.nom,
            offres:
              o && o[1] > 0
                ? {
                    periode: o[0],
                    toutes: o[1],
                    francetravail: o[2],
                    contrats: ([o[3], o[4], o[5], o[6], o[7]] as number[]).map((n, i) => ({ nom: CONTRATS[i], part: Math.round((100 * n) / o[1]) })),
                  }
                : null,
            embauches: b && b[1] > 0 ? { periode: b[0], toutes: b[1], plusDunMois: b[2] } : null,
          }
        : null,
    lienOffres: `https://candidat.francetravail.fr/offres/recherche?lieux=${code}&offresPartenaires=true&rayon=10&tri=0`,
    maj: d.maj,
  };
  return ici.agences.length || ici.epci ? ici : null;
}
