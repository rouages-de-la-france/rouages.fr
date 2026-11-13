/**
 * Ce que partagent les galeries de photos (`photos-patrimoine.ts`,
 * `photos-communes.ts`) : les requêtes à Wikidata et à Wikimedia Commons, le
 * bouton qui ne charge rien sans un clic, et la grille avec ses crédits.
 *
 * L'auteur et la licence sont lus sur Commons au moment de l'affichage ; ils
 * n'entrent dans aucun fichier de Rouages (décision du 13 novembre 2026).
 */
export const SPARQL = 'https://query.wikidata.org/sparql';
const API_COMMONS = 'https://commons.wikimedia.org/w/api.php';
/** Les fichiers par requête à Commons : son plafond. */
const PAR_COMMONS = 50;
/** Ce qu'une galerie montre d'abord ; le reste vient d'un second bouton. */
const D_ABORD = 12;

export interface Credit {
  src: string;
  page: string;
  auteur: string;
  licence: string;
}

const texte = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
export const morceaux = <T>(t: T[], n: number) => Array.from({ length: Math.ceil(t.length / n) }, (_, i) => t.slice(i * n, i * n + n));

export async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json, application/sparql-results+json' } });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

/** Le nom du fichier Commons d'une URL `Special:FilePath` de Wikidata. */
export const fichierDe = (url: string) => decodeURIComponent(url.split('/Special:FilePath/')[1] ?? '');

/** La vignette, l'auteur et la licence de chaque fichier, lus sur Commons, par le nom demandé. */
export async function credits(noms: string[], largeur = 480): Promise<Map<string, Credit>> {
  const sortie = new Map<string, Credit>();
  for (const lot of morceaux(noms, PAR_COMMONS)) {
    const params = new URLSearchParams({
      action: 'query',
      titles: lot.map((n) => `File:${n}`).join('|'),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: String(largeur),
      format: 'json',
      origin: '*',
    });
    type Page = { title: string; imageinfo?: { thumburl: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] };
    const r = await json<{ query?: { pages?: Record<string, Page>; normalized?: { from: string; to: string }[] } }>(`${API_COMMONS}?${params}`);
    const versDemande = new Map((r.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of Object.values(r.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const demande = (versDemande.get(p.title) ?? p.title).replace(/^File:/, '');
      sortie.set(demande, {
        src: ii.thumburl,
        page: ii.descriptionurl,
        auteur: texte(ii.extmetadata?.Artist?.value ?? '') || 'auteur non indiqué',
        licence: ii.extmetadata?.LicenseShortName?.value ?? 'licence sur la page du fichier',
      });
    }
  }
  return sortie;
}

/** Une photo de la galerie : ce qu'elle montre, où mène son titre, et son crédit. */
export interface Vignette extends Credit {
  titre: string;
  lien: string;
  /** Le lien du titre sort-il du site (une fiche POP) ? */
  externe: boolean;
}

/** La grille, ses douze premières photos, puis « Voir les N autres », et la phrase de source. */
function galerie(conteneur: HTMLElement, vignettes: Vignette[], bilan: string): void {
  const grille = Object.assign(document.createElement('div'), { className: 'photos-patrimoine' });
  for (const [i, v] of vignettes.entries()) {
    const figure = document.createElement('figure');
    if (i >= D_ABORD) figure.hidden = true;
    const img = Object.assign(document.createElement('img'), { src: v.src, alt: `${v.titre}, photo de Wikimedia Commons`, loading: 'lazy', decoding: 'async' });
    const legende = document.createElement('figcaption');
    const titre = Object.assign(document.createElement('a'), { href: v.lien, textContent: v.titre });
    if (v.externe) Object.assign(titre, { rel: 'noopener', target: '_blank' });
    const credit = Object.assign(document.createElement('span'), { className: 'photo-credit' });
    credit.append(`${v.auteur} · ${v.licence} · `, Object.assign(document.createElement('a'), { href: v.page, textContent: 'Commons', rel: 'noopener', target: '_blank' }));
    legende.append(titre, credit);
    figure.append(img, legende);
    grille.append(figure);
  }
  conteneur.append(grille);
  if (vignettes.length > D_ABORD) {
    const plus = Object.assign(document.createElement('button'), { type: 'button', className: 'plat', textContent: `Voir les ${vignettes.length - D_ABORD} autres photos` });
    plus.addEventListener('click', () => {
      for (const f of grille.querySelectorAll<HTMLElement>('figure[hidden]')) f.hidden = false;
      plus.remove();
    });
    conteneur.append(plus);
  }
  conteneur.append(Object.assign(document.createElement('p'), { className: 'p-source-territoire', textContent: bilan }));
}

/**
 * Le bouton qui, au clic seulement, charge les photos et remplace son
 * conteneur par la galerie — ou par la phrase qui dit qu'il n'y en a pas.
 */
export function boutonGalerie(
  conteneur: HTMLElement,
  libelle: string,
  charger: () => Promise<{ vignettes: Vignette[]; bilan: string } | string>,
): void {
  conteneur.innerHTML = '';
  const bouton = Object.assign(document.createElement('button'), { type: 'button', className: 'plat', textContent: libelle });
  const note = Object.assign(document.createElement('small'), { className: 'photo-note', textContent: ' — photos de Wikimedia Commons, chargées au clic seulement' });
  bouton.addEventListener('click', async () => {
    bouton.disabled = true;
    bouton.textContent = 'Chargement…';
    try {
      const r = await charger();
      conteneur.innerHTML = '';
      if (typeof r === 'string') conteneur.append(Object.assign(document.createElement('p'), { className: 'p-strate', textContent: r }));
      else galerie(conteneur, r.vignettes, r.bilan);
    } catch {
      bouton.disabled = false;
      bouton.textContent = libelle;
      note.textContent = ' — Wikimedia ne répond pas, réessayez plus tard';
    }
  });
  conteneur.append(bouton, note);
}
