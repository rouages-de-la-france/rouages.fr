/**
 * Les eaux usées : qui les collecte et les traite, commune par commune, et
 * comment le service est géré.
 *
 * Deux services, que la loi distingue :
 * - **l'assainissement collectif** — le réseau d'égouts et la station
 *   d'épuration ;
 * - **l'assainissement non collectif** — le SPANC, qui contrôle les
 *   installations individuelles des maisons que le réseau ne dessert pas.
 *
 * La source est la « composition communale des services » du système
 * d'information SISPEA (Office français de la biodiversité), publiée sous
 * Licence Ouverte sur l'Observatoire des services d'eau et d'assainissement :
 * une ligne par commune et par service, avec la collectivité qui en a la
 * charge, le mode de gestion (régie, délégation), l'opérateur et, pour une
 * délégation, les dates du contrat. Le catalogue de l'OFB référence les
 * exercices jusqu'en 2021 ; les fichiers suivants sont à la même adresse,
 * régénérés chaque nuit (constaté le 19 novembre 2026, exercice 2025).
 *
 * Au Mayet-de-Montagne : les deux services sont à Vichy Communauté, en régie.
 *
 * Lancé seul — `tsx scripts/assainissement-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-assainissement.json`.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';
import { communeDe, ecrireParDepartement, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';

const ADRESSE = (service: Service, annee: number) =>
  `https://www.services.eaufrance.fr/documents/serviceMembers/CompositionCommunaleServices_${service}_${annee}.zip`;

export const SERVICES = ['AC', 'ANC'] as const;
export type Service = (typeof SERVICES)[number];

/**
 * Un service qui dessert la commune, en positions : nom de l'entité de
 * gestion, collectivité qui en a la charge, son SIREN, mode de gestion
 * (« Régie », « Délégation »…), statut de l'opérateur (« Régie à autonomie
 * financière », « Délégation de service public »…), nom de l'opérateur, début
 * et fin du mode de gestion (AAAA-MM-JJ, ou vide).
 */
export type ServiceCommune = [string, string, string, string, string, string, string, string];

export interface Assainissement {
  /** L'exercice lu, par service. */
  exercices: Record<Service, number>;
  maj: string;
  /** Par code INSEE : les services d'assainissement collectif, puis non collectif. */
  communes: Map<string, [ServiceCommune[], ServiceCommune[]]>;
}

/** Une date au format du tableur — un nombre de jours depuis 1899-12-30 — ou un texte. */
export function dateTableur(v: unknown): string {
  if (typeof v === 'number' && v > 0) return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

const texte = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s === '-' ? '' : s;
};

async function classeur(archive: string): Promise<Buffer> {
  return new Promise<Buffer>((ok, ko) => {
    const p = spawn('unzip', ['-p', archive, '*.xlsx']);
    const morceaux: Buffer[] = [];
    p.stdout.on('data', (b: Buffer) => morceaux.push(b));
    p.on('error', () => ko(new Error('« unzip » est requis pour lire l’archive de SISPEA')));
    p.on('close', (c) => (c === 0 ? ok(Buffer.concat(morceaux)) : ko(new Error(`unzip a rendu ${c}`))));
  });
}

export async function collecterAssainissement(
  telecharger: (url: string, vers: string) => Promise<void>,
  cache: string,
  dire: (m: string) => void,
): Promise<Assainissement | null> {
  const XLSX = await import('xlsx');
  const { actuelles, reports } = reportsDuDecoupage();
  const communes = new Map<string, [ServiceCommune[], ServiceCommune[]]>();
  const exercices = {} as Record<Service, number>;
  const cetteAnnee = new Date().getUTCFullYear();

  for (const [rang, service] of SERVICES.entries()) {
    // L'exercice le plus récent publié : l'année en cours n'y est pas toujours.
    let lu: { annee: number; lignes: unknown[][] } | null = null;
    for (let annee = cetteAnnee; annee >= cetteAnnee - 3 && !lu; annee--) {
      const archive = join(cache, `sispea-composition-${service.toLowerCase()}-${annee}.zip`);
      try {
        // Un exercice pas encore publié répond 500 : une seule requête pour le savoir, sans
        // les huit essais du téléchargeur, qui chargeraient le serveur pour rien.
        const tete = await fetch(ADRESSE(service, annee), { method: 'HEAD', signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (!tete?.ok) continue;
        await telecharger(ADRESSE(service, annee), archive);
        const wb = XLSX.read(await classeur(archive), { type: 'buffer' });
        const lignes = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
        if (lignes.length > 1000) lu = { annee, lignes };
      } catch (e) {
        // L'exercice suivant, plus ancien.
        dire(`  assainissement ${service} ${annee} : ${(e as Error).message}`);
      }
    }
    if (!lu) return indisponible(dire, `Assainissement : la composition communale « ${service} » de SISPEA est introuvable.`);
    exercices[service] = lu.annee;

    const entete = (lu.lignes[0] as unknown[]).map((h) => String(h ?? '').trim());
    const col = (nom: string) => entete.indexOf(nom);
    const c = {
      insee: col('Code INSEE de la commune adhérente'),
      entite: col("Nom de l'entité de gestion à laquelle la commune adhère"),
      collectivite: col("Nom de la collectivité de l'entité de gestion à laquelle la commune adhère"),
      siren: col('N° SIREN'),
      mode: col('Type du mode de gestion'),
      statut: col("Statut de l'opérateur"),
      operateur: col("Nom de l'opérateur"),
      debut: col('Date de début du mode de gestion'),
      fin: col('Date de fin du mode de gestion'),
    };
    const manquantes = Object.entries(c).filter(([, i]) => i < 0).map(([n]) => n);
    if (manquantes.length) {
      return indisponible(dire, `Assainissement « ${service} » : colonnes absentes (${manquantes.join(', ')}) — le fichier a changé de forme.`);
    }

    let lignes = 0;
    for (const l of lu.lignes.slice(1)) {
      const brut = String(l[c.insee] ?? '').trim().padStart(5, '0');
      if (!/^[0-9AB]{5}$/.test(brut)) continue;
      const code = communeDe(actuelles.has(brut) ? brut : (reports.get(brut) ?? ''));
      if (!code) continue;
      const s: ServiceCommune = [
        texte(l[c.entite]),
        texte(l[c.collectivite]),
        String(l[c.siren] ?? '').replace(/\D/g, ''),
        texte(l[c.mode]),
        texte(l[c.statut]),
        texte(l[c.operateur]),
        dateTableur(l[c.debut]),
        dateTableur(l[c.fin]),
      ];
      if (!communes.has(code)) communes.set(code, [[], []]);
      const liste = communes.get(code)![rang];
      // Une commune desservie par plusieurs secteurs d'un même service n'en voit qu'un par entité.
      if (!liste.some((x) => x[0] === s[0] && x[2] === s[2])) liste.push(s);
      lignes++;
    }
    const dsp = [...communes.values()].filter((x) => x[rang].some((s) => /d[ée]l[ée]gation/i.test(s[3]))).length;
    dire(
      `Assainissement ${service === 'AC' ? 'collectif' : 'non collectif'} ${lu.annee} : ${lignes.toLocaleString('fr-FR')} lignes, ` +
        `${[...communes.values()].filter((x) => x[rang].length > 0).length.toLocaleString('fr-FR')} communes, ` +
        `dont ${dsp.toLocaleString('fr-FR')} en délégation.`,
    );
  }
  return { exercices, maj: new Date().toISOString().slice(0, 10), communes };
}

export function ecrireAssainissement(sortie: string, a: Assainissement): number {
  return ecrireParDepartement(sortie, 'assainissement', a.communes, () => ({ maj: a.maj, exercices: a.exercices }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const a = await collecterAssainissement(telecharger, cache, console.log);
  if (a) console.log(`${ecrireAssainissement(sortie, a)} départements écrits.`);
}
