/**
 * Les restaurants collectifs de chaque commune — cantines scolaires, crèches,
 * établissements de santé et médico-sociaux, restaurants administratifs et
 * d'entreprise —, d'après le registre national des cantines de Ma Cantine
 * (ministère de l'Agriculture), sous Licence Ouverte.
 *
 * Pour chacun : son nom, ses secteurs, s'il relève du public ou du privé,
 * s'il est géré en direct ou concédé à un prestataire, si les repas sont
 * préparés sur place ou livrés par une cuisine centrale, et le nombre de
 * repas par jour qu'il déclare. Une cuisine centrale qui n'est pas elle-même
 * au registre est donnée par son SIRET, avec le lien vers sa fiche à
 * l'annuaire des entreprises : la page ne nomme pas le prestataire à la
 * place de la source.
 *
 * **Les achats.** La loi EGalim (article L. 230-5-1 du code rural et de la
 * pêche maritime) demande au moins 50 % de produits durables et de qualité,
 * dont 20 % de bio. Chaque restaurant déclare ses achats sur Ma Cantine ; la
 * dernière campagne publiée donne la part de bio et la part des autres
 * produits EGalim. Quand une cuisine centrale déclare pour ses restaurants
 * satellites, c'est sa déclaration qui vaut pour eux, et la page le dit. Un
 * restaurant sans déclaration publiée n'a pas de taux : ce n'est pas un zéro.
 *
 * Les oppositions de `retraits.yaml` (section `entreprises`, par SIREN)
 * retirent le nom.
 *
 * Lancé seul — `tsx scripts/cantines-emettre.ts` —, il réécrit
 * `public/territoires/dep/XX-cantines.json`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indisponible } from './echecs.ts';
import { communeDe, ecrireParDepartement, lignesCsv, reportsDuDecoupage, telechargerSiAbsent } from './par-departement.ts';
import { ressourcesQuiPortent } from './ressource-motif.ts';
import { retraitsEntreprises } from '../src/modele/retraits-entreprises.ts';

const REGISTRE = 'registre-national-des-cantines';
const CAMPAGNES = 'resultats-de-campagnes-de-teledeclaration-des-cantines';

/**
 * Un restaurant : nom, secteurs (séparés par « ; »), 0 public / 1 privé / null,
 * 0 gestion directe / 1 concédée / null, mode de production (S sur place,
 * L livré, C cuisine centrale, CS cuisine centrale qui sert aussi sur place,
 * '' inconnu), repas par jour ou null, SIRET de la cuisine centrale qui livre
 * ou '', part de bio, part des autres produits EGalim (de 0 à 1, null sans
 * déclaration publiée), et 0 si le restaurant a déclaré lui-même, 1 si c'est
 * sa cuisine centrale, null sans déclaration.
 */
export type Cantine = [string, string, 0 | 1 | null, 0 | 1 | null, string, number | null, string, number | null, number | null, 0 | 1 | null];

export interface Cantines {
  maj: string;
  campagne: number | null;
  communes: Map<string, Cantine[]>;
}

const PRODUCTION: Record<string, string> = { site: 'S', site_cooked_elsewhere: 'L', central: 'C', central_serving: 'CS' };

const taux = (v: string | undefined): number | null => {
  const t = (v ?? '').trim();
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) && x >= 0 && x <= 1 ? Math.round(x * 1000) / 1000 : null;
};

export async function collecterCantines(
  telecharger: (url: string, vers: string) => Promise<void>,
  json: <T>(url: string) => Promise<T>,
  cache: string,
  dire: (m: string) => void,
): Promise<Cantines | null> {
  type Ressource = { title?: string; url?: string; format?: string };
  const ressources = async (jeu: string): Promise<Ressource[]> =>
    ((await json<{ data?: Ressource[] }>(`https://www.data.gouv.fr/api/2/datasets/${jeu}/resources/?page_size=50`)).data ?? []).filter(
      (r) => r.url && (r.format ?? '').toLowerCase() === 'csv',
    );
  let registre: string | undefined;
  let campagnes: Ressource[] = [];
  try {
    registre = ressourcesQuiPortent(await ressources(REGISTRE), 'registre')[0]?.url;
    campagnes = ressourcesQuiPortent(await ressources(CAMPAGNES), 'données');
  } catch {
    return indisponible(dire, 'Cantines : les jeux de Ma Cantine n’ont pas répondu.');
  }
  if (!registre) return indisponible(dire, 'Cantines : le registre est introuvable.');

  // La dernière campagne publiée : l'année des données est dans le titre.
  const derniere = campagnes
    .map((r) => ({ url: r.url!, annee: Number(/donn[ée]es (20\d\d)/i.exec(r.title ?? '')?.[1] ?? 0) }))
    .filter((r) => r.annee)
    .sort((a, b) => b.annee - a.annee)[0];

  // Les déclarations : par identifiant de restaurant, et celles des cuisines centrales qui déclarent pour leurs satellites, par SIRET.
  const parCantine = new Map<string, [number | null, number | null]>();
  const parCentrale = new Map<string, [number | null, number | null]>();
  if (derniere) {
    const fichier = join(cache, `cantines-campagne-${derniere.annee}.csv`);
    await telecharger(derniere.url, fichier);
    let entete: string[] | null = null;
    for await (const l of lignesCsv([readFileSync(fichier, 'utf8')], ',')) {
      if (!entete) {
        entete = l;
        continue;
      }
      const v = (n: string) => l[entete!.indexOf(n)];
      const t: [number | null, number | null] = [taux(v('teledeclaration_ratio_bio')), taux(v('teledeclaration_ratio_egalim_hors_bio'))];
      if (t[0] === null && t[1] === null) continue;
      parCantine.set(v('canteen_id') ?? '', t);
      if (v('teledeclaration_mode') === 'CENTRAL_ALL' && v('canteen_siret')) parCentrale.set(v('canteen_siret')!, t);
    }
  }

  const fichier = join(cache, 'cantines-registre.csv');
  await telecharger(registre, fichier);
  const { actuelles, reports } = reportsDuDecoupage();
  const opposes = retraitsEntreprises().entreprises;
  const communes = new Map<string, Cantine[]>();
  let entete: string[] | null = null;
  let n = 0;
  let declarees = 0;
  for await (const l of lignesCsv([readFileSync(fichier, 'utf8')], ',')) {
    if (!entete) {
      entete = l;
      if (!['id', 'name', 'city_insee_code', 'management_type', 'production_type'].every((c) => entete!.includes(c))) {
        return indisponible(dire, 'Cantines : le registre a changé de forme.');
      }
      continue;
    }
    const v = (c: string) => (l[entete!.indexOf(c)] ?? '').trim();
    const brut = v('city_insee_code');
    const code = communeDe(actuelles.has(brut) ? brut : (reports.get(brut) ?? ''));
    if (!code) continue;
    const siren = v('siren_unite_legale') || v('siret').slice(0, 9);
    const nom = opposes.has(siren) ? '' : v('name');
    const modele = v('economic_model') === 'public' ? 0 : v('economic_model') === 'private' ? 1 : null;
    const gestion = v('management_type') === 'direct' ? 0 : v('management_type') === 'conceded' ? 1 : null;
    const repas = Number(v('daily_meal_count')) || null;
    const centrale = v('central_producer_siret');
    const propre = parCantine.get(v('id'));
    const viaCentrale = !propre && centrale ? parCentrale.get(centrale) : undefined;
    const t = propre ?? viaCentrale ?? null;
    if (t) declarees++;
    const secteurs = v('sector_list')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ; ');
    const c: Cantine = [nom, secteurs, modele, gestion, PRODUCTION[v('production_type')] ?? '', repas, centrale, t?.[0] ?? null, t?.[1] ?? null, propre ? 0 : viaCentrale ? 1 : null];
    (communes.get(code) ?? communes.set(code, []).get(code)!).push(c);
    n++;
  }
  if (n < 30000) return indisponible(dire, `Cantines : ${n} restaurants seulement au registre, on garde l’ingestion précédente.`);
  // Les plus grands d'abord, puis par nom.
  for (const l of communes.values()) l.sort((a, b) => (b[5] ?? 0) - (a[5] ?? 0) || a[0].localeCompare(b[0], 'fr'));
  dire(
    `Cantines : ${n.toLocaleString('fr-FR')} restaurants collectifs dans ${communes.size.toLocaleString('fr-FR')} communes, ` +
      `${declarees.toLocaleString('fr-FR')} avec des achats déclarés${derniere ? ` (données ${derniere.annee})` : ''}.`,
  );
  return { maj: new Date().toISOString().slice(0, 10), campagne: derniere?.annee ?? null, communes };
}

export function ecrireCantines(sortie: string, c: Cantines): number {
  return ecrireParDepartement(sortie, 'cantines', c.communes, () => ({ maj: c.maj, campagne: c.campagne }));
}

// Lancé seul.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { telecharger, cache, sortie, lireJson } = telechargerSiAbsent(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const c = await collecterCantines(telecharger, lireJson as <T>(url: string) => Promise<T>, cache, console.log);
  if (c) console.log(`${ecrireCantines(sortie, c)} départements écrits.`);
}
