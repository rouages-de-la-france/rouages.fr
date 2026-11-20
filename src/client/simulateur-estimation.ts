/**
 * Le simulateur d'estimation, côté navigateur : les prix unitaires de la
 * commune (`/territoires/simulateurs/estimation/XX.json`), les surfaces
 * saisies, et le calcul poste par poste à chaque frappe.
 */
import { aLieu } from '../modele/signalement.ts';
import { brancherRapport, restaurerSaisie } from './rapport.ts';
import { brancherChampLieu, quandLieu, resoudre, retenirLieu, type Lieu, type OptionsLieu } from './jeux-lieu.ts';

/** Voir `Estimation` dans `scripts/estimation-emettre.ts`. */
type Estimation = [
  number | null,
  number | null,
  number | null,
  [number, number, number] | null,
  number | null,
  [number, number],
  [number, number, number] | null,
  number,
  number,
  number,
  (number | null)?,
  (number | null)?,
  (number | null)?,
];
type EffetsDpe = { multiplicateurs: Record<string, number>; ventes: number; repartition: Record<string, number>; ecart: [number, number]; portee: string; sachantPeriode?: Record<string, number> };
type EffetsPeriode = { multiplicateurs: number[]; periodes: string[]; ventes: number; ecart: [number, number]; portee: string };
type ClassesIntervalles = Record<'seule' | 'voisines', { ventes: number; bornes: [number, number][]; tenue: number[] }>;
type Intervalles = { niveaux: number[]; classes: ClassesIntervalles; periode?: ClassesIntervalles };
type Fichier = { maj: string; annees: number[]; tailles: [number, number]; partActivite: number; dpe: EffetsDpe | null; periode?: EffetsPeriode | null; c: Record<string, Estimation> };

const LIEUX: OptionsLieu = { source: '/jeux/territoires.json', genres: ['commune'] };
const euros = (x: number) => `${Math.round(x).toLocaleString('fr-FR')} €`;
const arrondi = (x: number) => Math.round(x / 1000) * 1000;
const m2 = (x: number) => `${Math.round(x).toLocaleString('fr-FR')} m²`;
const ha = (x: number) => `${(x / 10_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ha`;

export function brancherEstimation(): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  if (!$('se')) return;
  brancherChampLieu('se-lieu', LIEUX);
  const form = $<HTMLFormElement>('se-form');
  // La saisie d'un lien de calcul ou d'un rapport n'est remise qu'une fois, au premier lieu chargé.
  let restaure = false;
  brancherRapport(form, $('se-resultat'), () => lieu?.nom ?? null);
  let lieu: Lieu | null = null;
  let f: Fichier;
  let e: Estimation;

  const message = (t: string) => {
    $('se-message').textContent = t;
    $('se-message').hidden = !t;
  };
  const champ = (n: string) => Math.max(0, Number((form.elements.namedItem(n) as HTMLInputElement).value) || 0);

  const calculer = () => {
    const [h, c, cSeul, terres, bois, [nMaisons, anneaux], precision] = e;
    const H = champ('habitable');
    const A = champ('activite');
    const part = champ('part') / 100;
    const C = champ('constructible');
    const Na = champ('agricole');
    const Nb = champ('bois');
    // L'état : non renseigné tant que la case n'est pas cochée — l'estimation vaut alors pour une maison dans l'état
    // moyen de celles vendues autour ; une fois cochée, le curseur part de « moyen ».
    const etatConnu = (form.elements.namedItem('etatConnu') as HTMLInputElement).checked;
    const curseur = form.elements.namedItem('etat') as HTMLInputElement;
    curseur.disabled = !etatConnu;
    $('se-etat-curseur').hidden = !etatConnu;
    $('se-etat-aide').textContent = etatConnu
      ? 'Votre jugement place la maison dans la fourchette mesurée, sans la faire sortir des bornes observées.'
      : 'Non renseigné : l’estimation vaut pour une maison dans l’état moyen de celles vendues autour.';
    const etat = etatConnu ? Number(curseur.value) / 100 : 0;
    // L'étiquette : le prix d'une maison de cette étiquette, rapporté à celui d'une maison ordinaire de la commune.
    const etiquette = (form.elements.namedItem('dpe') as HTMLSelectElement).value;
    // La période de construction : le prix d'une maison de cette période, rapporté à celui d'une maison ordinaire de la commune.
    const periodeChoisie = (form.elements.namedItem('periode') as HTMLSelectElement).value;
    const k = periodeChoisie === '' ? -1 : Number(periodeChoisie);
    const melangePeriode = e[11] ?? null;
    const effetPeriode = k >= 0 && f.periode && melangePeriode ? f.periode.multiplicateurs[k] / melangePeriode : 1;
    // Les deux donnés : l'étiquette à période égale, pour ne pas compter deux fois l'âge de la maison.
    const conjoint = effetPeriode !== 1 && !!etiquette;
    const melange = conjoint ? (e[12] ?? null) : (e[10] ?? null);
    const multEtiquette = conjoint ? f.dpe?.sachantPeriode : f.dpe?.multiplicateurs;
    const effetEtiquette = etiquette && multEtiquette && melange ? multEtiquette[etiquette] / melange : 1;
    const effetDpe = effetEtiquette * effetPeriode;
    $('se-periode-note').textContent =
      k >= 0 && f.periode && melangePeriode
        ? `Une maison ${f.periode.periodes[k] === 'avant 1919' || f.periode.periodes[k] === 'depuis 2006' ? 'construite ' : 'de '}${f.periode.periodes[k]} vaut ${Math.round((effetPeriode - 1) * 100) >= 0 ? '+' : '−'}${Math.abs(Math.round((effetPeriode - 1) * 100))} % par rapport à une maison ordinaire de la commune, d’après ${f.periode.ventes.toLocaleString('fr-FR')} ventes datées par la base nationale des bâtiments (${f.periode.portee}).` +
          (etiquette && !f.dpe?.sachantPeriode ? ' L’étiquette n’est pas comptée en plus : son effet à période égale n’est pas mesuré ici.' : '')
        : '';
    $('se-dpe-note').textContent =
      etiquette && f.dpe && melange
        ? `Une maison ${etiquette} vaut ${Math.round((effetEtiquette - 1) * 100) >= 0 ? '+' : '−'}${Math.abs(Math.round((effetEtiquette - 1) * 100))} % par rapport à une maison ordinaire de la commune${conjoint ? ' de la même période' : ''}, d’après ${f.dpe.ventes.toLocaleString('fr-FR')} ventes rapprochées d’un DPE (${f.dpe.portee}).`
        : f.dpe
          ? 'Sans étiquette, l’estimation vaut pour une maison ordinaire de la commune.'
          : '';
    $('se-etat-valeur').textContent = etat === 0 ? 'moyen' : `${etat > 0 ? '+' : '−'}${Math.abs(Math.round(etat * 100))} % sur le bâti`;

    const lignes: { part: string; surface: string; prix: string; valeur: number | null; note?: string }[] = [];
    const bati = H > 0 || A > 0;
    if (H > 0) lignes.push({ part: 'Habitable', surface: m2(H), prix: h ? `${euros(Math.round(h * effetDpe))}/m²` : '—', valeur: h ? h * effetDpe * H * (1 + etat) : null, note: effetDpe !== 1 ? [etiquette && effetEtiquette !== 1 && `étiquette ${etiquette}`, k >= 0 && f.periode && `${f.periode.periodes[k]}`].filter(Boolean).join(', ') : undefined });
    if (A > 0) lignes.push({ part: 'Local d’activité', surface: m2(A), prix: h ? `${Math.round(part * 100)} % de ${euros(h)}/m²` : '—', valeur: h ? h * part * A * (1 + etat) : null });
    if (C > 0) {
      // Le terrain d'une maison se mesure dans les ventes de maisons ; un terrain seul, dans les ventes de terrain seul.
      const brut = bati ? (c ?? cSeul) : (cSeul ?? c);
      // L'étiquette pèse sur la maison et son terrain, mesurés ensemble ; pas sur un terrain seul.
      const unitaire = brut !== null && H > 0 ? Math.round(brut * effetDpe * 10) / 10 : brut;
      lignes.push({ part: bati ? 'Terrain de la maison' : 'Terrain constructible', surface: m2(C), prix: unitaire !== null ? `${unitaire.toLocaleString('fr-FR')} €/m²` : '—', valeur: unitaire !== null ? unitaire * C : null });
    }
    if (Na > 0) {
      const t = Na < f.tailles[0] ? 0 : Na < f.tailles[1] ? 1 : 2;
      lignes.push({ part: 'Terres et prés', surface: ha(Na), prix: terres ? `${euros(terres[t])}/ha` : '—', valeur: terres ? (Na / 10_000) * terres[t] : null, note: ['moins d’un demi-hectare', 'd’un demi à deux hectares', 'plus de deux hectares'][t] });
    }
    if (Nb > 0) lignes.push({ part: 'Bois', surface: ha(Nb), prix: bois ? `${euros(bois)}/ha` : '—', valeur: bois ? (Nb / 10_000) * bois : null });

    const tbody = $('se-lignes');
    tbody.innerHTML = '';
    for (const l of lignes) {
      const tr = document.createElement('tr');
      const td = (t: string, note?: string, classe?: string) => {
        const x = document.createElement('td');
        x.textContent = t;
        if (classe) x.className = classe;
        if (note) x.append(Object.assign(document.createElement('small'), { textContent: note }));
        return x;
      };
      const part = td(l.part, l.note);
      // Le prix relevé, répété sous la part pour les petits écrans, où sa colonne disparaît.
      part.append(Object.assign(document.createElement('small'), { className: 'se-prix-court', textContent: l.prix }));
      tr.append(part, td(l.surface), td(l.prix, undefined, 'se-col-prix'), td(l.valeur === null ? 'pas assez de ventes' : euros(l.valeur)));
      tbody.append(tr);
    }
    const manque = lignes.some((l) => l.valeur === null);
    const brut = lignes.reduce((s, l) => s + (l.valeur ?? 0), 0);
    // Le bâti seul porte l'état ; sans lui, l'estimation d'une maison dans l'état moyen de celles vendues autour.
    const bati_ = lignes.filter((l) => l.part === 'Habitable' || l.part === 'Local d’activité').reduce((s, l) => s + (l.valeur ?? 0), 0);
    const base = brut - bati_ + bati_ / (1 + etat);
    /**
     * La fourchette mesurée contient déjà des maisons dans tous les états. L'état indiqué ne peut pas en faire
     * sortir : il dit dans quelle partie de la fourchette la maison se trouve. Un bon état remonte la borne basse,
     * un mauvais abaisse la borne haute ; l'estimation reste entre les deux.
     */
    const borner = (bas: number, haut: number, enveloppe?: [number, number]) => {
      const r = base > 0 ? brut / base : 1;
      let lo: number;
      let hi: number;
      if (enveloppe) {
        // Une fourchette entourée d'une plus large glisse avec l'état, à largeur égale, sans en sortir :
        // elle garde la même part des ventes autour de l'estimation, autant que l'enveloppe le permet.
        const [eLo, eHi] = enveloppe;
        lo = bas * r;
        hi = haut * r;
        if (hi > eHi) [lo, hi] = [Math.max(eLo, (eHi * bas) / haut), eHi];
        if (lo < eLo) [lo, hi] = [eLo, Math.min(eHi, (eLo * haut) / bas)];
        lo *= base;
        hi *= base;
      } else {
        // La plus large n'a pas d'enveloppe : un bon état remonte sa borne basse, un mauvais abaisse sa borne haute.
        lo = base * bas * (r > 1 ? r : 1);
        hi = base * haut * (r < 1 ? r : 1);
      }
      return { lo, hi, estimation: Math.min(Math.max(brut, lo), hi), butee: brut > hi + 1 || brut < lo - 1 };
    };
    let total = brut;
    $('se-total').textContent = lignes.length === 0 ? '—' : `${manque ? 'au moins ' : ''}${euros(arrondi(total))}`;
    $('se-resultat').hidden = lignes.length === 0;

    const fourchette = $('se-fourchette');
    const precisionTexte = $('se-precision');
    fourchette.textContent = '';
    precisionTexte.textContent = '';
    // La fourchette au niveau choisi, calibrée sur le banc d'essai ; à défaut, la moitié centrale mesurée dans la commune.
    const niveau = Number((form.elements.namedItem('niveau') as RadioNodeList | null)?.value ?? 0.8) || 0.8;
    const jeu = effetPeriode !== 1 && intervalles?.periode ? intervalles.periode : intervalles?.classes;
    const classe = jeu?.[anneaux === 0 ? 'seule' : 'voisines'];
    const rang = intervalles ? intervalles.niveaux.indexOf(niveau) : -1;
    $('se-niveau').hidden = !(bati && classe);
    if (bati && classe && rang >= 0 && !manque && total > 0) {
      const [bas, haut] = classe.bornes[rang];
      const tenue = classe.tenue[rang];
      const sur = niveau === 0.5 ? 'une maison sur deux' : niveau === 0.8 ? 'huit maisons sur dix' : 'neuf maisons sur dix';
      const enveloppe = classe.bornes[rang + 1];
      const b = borner(bas, haut, enveloppe);
      total = b.estimation;
      $('se-total').textContent = `${euros(arrondi(total))}`;
      fourchette.textContent = `Entre ${euros(arrondi(b.lo))} et ${euros(arrondi(b.hi))}`;
      precisionTexte.textContent =
        // La part mesurée vaut pour la fourchette centrée sur l'estimation ; déplacée par l'état, elle n'est plus vérifiée.
        (etatConnu && etat !== 0
          ? `Sans l’état, cette fourchette contenait ${niveau === 0.5 ? 'la moitié' : niveau === 0.8 ? 'huit sur dix' : 'neuf sur dix'} des ventes que le simulateur n’avait pas vues ${anneaux === 0 ? 'dans les communes mesurées seules' : 'dans les communes mesurées avec leurs voisines'} ` +
            `(contrôle sur des ventes tenues à part : ${Math.round(tenue * 100)} %) ; déplacée par l’état, cette part n’est plus vérifiée. `
          : `Sur des ventes que le simulateur n’avait pas vues, ${sur} ${anneaux === 0 ? 'dans les communes mesurées seules' : 'dans les communes mesurées avec leurs voisines'} ` +
            `${niveau === 0.5 ? 's’est vendue' : 'se sont vendues'} dans cette fourchette autour de ${niveau === 0.5 ? 'son' : 'leur'} estimation (contrôle sur des ventes tenues à part : ${Math.round(tenue * 100)} %). `) +
        'Plus la fourchette est large, plus elle a de chances de contenir le prix, et moins elle en dit. ' +
        (f.dpe && etiquette ? `Avec l’étiquette, l’écart médian passe de ${Math.round(f.dpe.ecart[0] * 100)} à ${Math.round(f.dpe.ecart[1] * 100)} % sur les ventes rapprochées d’un DPE (${f.dpe.portee}) ; la fourchette est celle sans étiquette. ` : '') +
        `Ont servi ${nMaisons} ventes de maisons ${anneaux === 0 ? 'de la commune' : `de la commune et de ses voisines (${anneaux} anneau${anneaux > 1 ? 'x' : ''})`}. ` +
        (etatConnu && etat !== 0
          ? (enveloppe
              ? `L’état que vous indiquez fait glisser la fourchette ${etat > 0 ? 'vers le haut' : 'vers le bas'}, à largeur égale, sans sortir de la fourchette ${niveau === 0.5 ? 'large' : 'très large'} mesurée` +
                (b.butee ? ' : il place la maison à son extrémité.' : '.')
              : `L’état que vous indiquez ne fait pas sortir de la fourchette mesurée, qui contient déjà des maisons dans tous les états : il la resserre, ${etat > 0 ? 'en remontant sa borne basse' : 'en abaissant sa borne haute'}` +
                (b.butee ? ', et place la maison à son extrémité : au-delà, il ne reste qu’une vente sur vingt.' : '.')) +
            ' De combien exactement l’état déplace le prix, les ventes ne permettent pas de le mesurer : elles ne disent rien de l’état d’une maison.'
          : 'L’état d’une maison est l’essentiel de l’écart : les ventes n’en disent rien. Vous pouvez l’indiquer ci-dessus.');
    } else if (bati && precision && !manque && total > 0) {
      const [ecart, bas, haut] = precision;
      const b = borner(bas, haut);
      total = b.estimation;
      $('se-total').textContent = `${euros(arrondi(total))}`;
      fourchette.textContent = `Entre ${euros(arrondi(b.lo))} et ${euros(arrondi(b.hi))}`;
      precisionTexte.textContent =
        (f.dpe && etiquette ? `Avec l’étiquette, l’écart médian passe de ${Math.round(f.dpe.ecart[0] * 100)} à ${Math.round(f.dpe.ecart[1] * 100)} % sur les ventes rapprochées d’un DPE (${f.dpe.portee}) ; la fourchette ci-dessus est celle sans étiquette. ` : '') +
        `La moitié des ${nMaisons} ventes de maisons ${anneaux === 0 ? 'de la commune' : `de la commune et de ses voisines (${anneaux} anneau${anneaux > 1 ? 'x' : ''})`} ` +
        `se sont vendues dans cette fourchette autour de leur estimation ; l’écart médian est de ${Math.round(ecart * 100)} %. ` +
        'L’état d’une maison est l’essentiel de l’écart : les ventes n’en disent rien.';
    } else if (!bati && lignes.length) {
      precisionTexte.textContent = `Terrains : les prix sont les médianes de ${e[7]} ventes de terres, ${e[8]} de bois et ${e[9]} de terrain constructible seul, dans la commune et autour. Leur précision n’est pas mesurée, comme celle des maisons : une médiane dit le prix du milieu, pas l’écart autour.`;
    }
  };

  form.addEventListener('input', calculer);
  // Le choix de la fourchette est hors du formulaire, sous le résultat : il a son écouteur.
  $('se-niveau').addEventListener('change', calculer);

  // Les fourchettes calibrées par le banc d'essai (`scripts/banc-estimation.ts`) ; absentes avant le premier calcul.
  let intervalles: Intervalles | null = null;
  void fetch('/territoires/simulateurs/estimation/intervalles.json')
    .then((r) => (r.ok ? (r.json() as Promise<Intervalles>) : null))
    .then((x) => {
      intervalles = x;
      if (e) calculer();
    })
    .catch(() => {});

  const preparer = async (cle: string) => {
    lieu = await resoudre(cle, LIEUX).catch(() => null);
    if (!lieu) return message('Cherchez la commune du bien par son nom ou son code postal.');
    retenirLieu(lieu.cle);
    try {
      const r = await fetch(`/territoires/simulateurs/estimation/${lieu.deps[0]}.json`);
      if (!r.ok) throw new Error(String(r.status));
      f = (await r.json()) as Fichier;
    } catch {
      return message('Les prix n’ont pas pu être lus. Réessayez dans un instant.');
    }
    const code = lieu.cle.slice(2);
    if (!f.c[code]) return message(`Trop peu de ventes ${aLieu(lieu.nom)} et autour pour une estimation.`);
    e = f.c[code];
    message('');
    $('se-titre').textContent = `${aLieu(lieu.nom).replace(/^./, (x) => x.toUpperCase())}, ventes de ${f.annees[0]} à ${f.annees[f.annees.length - 1]}`;
    (form.elements.namedItem('part') as HTMLInputElement).value = String(Math.round(f.partActivite * 100));
    $('se-dpe-bloc').hidden = !(f.dpe && e[10]);
    // La période : les choix de la base des bâtiments, quand l'effet est mesuré pour ce département.
    const choixPeriode = form.elements.namedItem('periode') as HTMLSelectElement;
    const garde = choixPeriode.value;
    choixPeriode.replaceChildren(new Option('Je ne sais pas', ''), ...(f.periode?.periodes ?? []).map((p, i) => new Option(p, String(i))));
    choixPeriode.value = garde && f.periode ? garde : '';
    $('se-periode-bloc').hidden = !(f.periode && e[11]);
    if (!restaure) {
      restaurerSaisie(form);
      restaure = true;
    }
    form.hidden = false;
    calculer();
    (form.elements.namedItem('habitable') as HTMLInputElement).focus();
  };
  quandLieu(LIEUX, null, (cle) => void preparer(cle));
}
