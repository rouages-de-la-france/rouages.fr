/**
 * Les photos des monuments historiques et des objets mobiliers protégés d'une
 * commune, d'après Wikidata (l'image principale, P18, des éléments qui portent
 * leur identifiant Mérimée, P380, ou Palissy, P481) et Wikimedia Commons (la
 * vignette, l'auteur et la licence).
 *
 * Comme pour la photo de la commune (`photo-commune.ts`) : rien ne part vers
 * Wikimedia sans un clic, et le bouton le dit. La liste des monuments et des
 * objets est lue au clic dans les fichiers du site, pour ne pas alourdir la
 * page. L'auteur n'est lu qu'à l'affichage, sur Commons : il n'entre dans
 * aucun fichier de Rouages.
 */
const SPARQL = 'https://query.wikidata.org/sparql';
const API_COMMONS = 'https://commons.wikimedia.org/w/api.php';
/** Les identifiants par requête SPARQL, et les fichiers par requête à Commons (son plafond). */
const PAR_SPARQL = 150;
const PAR_COMMONS = 50;
/** Au-delà, la galerie s'arrête et renvoie aux bases du ministère. */
const PLAFOND = 60;
/** Ce que la galerie montre d'abord ; le reste vient d'un second bouton. */
const D_ABORD = 12;

interface Element {
  reference: string;
  titre: string;
  base: 'merimee' | 'palissy';
}
interface PhotoPatrimoine extends Element {
  src: string;
  page: string;
  auteur: string;
  licence: string;
}

const texte = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
const morceaux = <T>(t: T[], n: number) => Array.from({ length: Math.ceil(t.length / n) }, (_, i) => t.slice(i * n, i * n + n));

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json, application/sparql-results+json' } });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

/** Les monuments et les objets de la commune, d'après les fichiers du site. */
async function elements(dep: string, code: string): Promise<Element[]> {
  const sortie: Element[] = [];
  const [m, o] = await Promise.all([
    json<{ c: Record<string, [string, string, number][]> }>(`/territoires/dep/${dep}-monuments.json`).catch(() => null),
    json<{ c: Record<string, [number, number, [string, string, number][]]> }>(`/territoires/dep/${dep}-objets.json`).catch(() => null),
  ]);
  for (const [reference, titre] of m?.c[code] ?? []) sortie.push({ reference, titre, base: 'merimee' });
  for (const [reference, titre] of o?.c[code]?.[2] ?? []) sortie.push({ reference, titre, base: 'palissy' });
  return sortie;
}

/** Le fichier Commons de chaque élément qui en a un, par sa référence. */
async function fichiers(liste: Element[]): Promise<Map<string, string>> {
  const trouves = new Map<string, string>();
  for (const lot of morceaux(liste, PAR_SPARQL)) {
    const valeurs = lot.map((e) => `"${e.reference.replace(/[^A-Z0-9]/g, '')}"`).join(' ');
    const requete = `SELECT ?id ?img WHERE { VALUES ?id { ${valeurs} } { ?m wdt:P380 ?id } UNION { ?m wdt:P481 ?id } ?m wdt:P18 ?img }`;
    const r = await json<{ results?: { bindings?: { id: { value: string }; img: { value: string } }[] } }>(
      `${SPARQL}?${new URLSearchParams({ query: requete, format: 'json' })}`,
    );
    for (const b of r.results?.bindings ?? []) {
      const f = decodeURIComponent(b.img.value.split('/Special:FilePath/')[1] ?? '');
      if (f && !trouves.has(b.id.value)) trouves.set(b.id.value, f);
    }
    if (trouves.size >= PLAFOND) break;
  }
  return trouves;
}

/** La vignette, l'auteur et la licence de chaque fichier, lus sur Commons. */
async function credits(noms: string[]): Promise<Map<string, Omit<PhotoPatrimoine, keyof Element>>> {
  const sortie = new Map<string, Omit<PhotoPatrimoine, keyof Element>>();
  for (const lot of morceaux(noms, PAR_COMMONS)) {
    const params = new URLSearchParams({
      action: 'query',
      titles: lot.map((n) => `File:${n}`).join('|'),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '480',
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

export async function photosPatrimoine(dep: string, code: string): Promise<{ photos: PhotoPatrimoine[]; total: number }> {
  const liste = await elements(dep, code);
  if (liste.length === 0) return { photos: [], total: 0 };
  const parRef = await fichiers(liste);
  const choisis = liste.filter((e) => parRef.has(e.reference)).slice(0, PLAFOND);
  const c = await credits([...new Set(choisis.map((e) => parRef.get(e.reference)!))]);
  const photos = choisis.flatMap((e) => {
    const x = c.get(parRef.get(e.reference)!);
    return x ? [{ ...e, ...x }] : [];
  });
  return { photos, total: liste.length };
}

/** Le bouton qui, au clic, remplace son conteneur par la galerie et ses crédits. */
export function boutonPhotosPatrimoine(conteneur: HTMLElement): void {
  const { dep, code, nom } = conteneur.dataset as { dep: string; code: string; nom: string };
  conteneur.innerHTML = '';
  const libelle = '📷 Voir les monuments et les objets en photo';
  const bouton = Object.assign(document.createElement('button'), { type: 'button', className: 'plat', textContent: libelle });
  const note = Object.assign(document.createElement('small'), { className: 'photo-note', textContent: ' — photos de Wikimedia Commons, chargées au clic seulement' });
  bouton.addEventListener('click', async () => {
    bouton.disabled = true;
    bouton.textContent = 'Chargement…';
    try {
      const { photos, total } = await photosPatrimoine(dep, code);
      conteneur.innerHTML = '';
      if (photos.length === 0) {
        conteneur.append(Object.assign(document.createElement('p'), { className: 'p-strate', textContent: `Aucune photo des monuments ni des objets de ${nom} sur Wikidata.` }));
        return;
      }
      const grille = Object.assign(document.createElement('div'), { className: 'photos-patrimoine' });
      for (const [i, p] of photos.entries()) {
        const figure = document.createElement('figure');
        if (i >= D_ABORD) figure.hidden = true;
        const img = Object.assign(document.createElement('img'), { src: p.src, alt: `${p.titre}, photo de Wikimedia Commons`, loading: 'lazy', decoding: 'async' });
        const legende = document.createElement('figcaption');
        const fiche = Object.assign(document.createElement('a'), {
          href: `https://pop.culture.gouv.fr/notice/${p.base}/${p.reference}`,
          textContent: p.titre,
          rel: 'noopener',
          target: '_blank',
        });
        const credit = Object.assign(document.createElement('span'), { className: 'photo-credit' });
        credit.append(`${p.auteur} · ${p.licence} · `, Object.assign(document.createElement('a'), { href: p.page, textContent: 'Commons', rel: 'noopener', target: '_blank' }));
        legende.append(fiche, credit);
        figure.append(img, legende);
        grille.append(figure);
      }
      const bilan = Object.assign(document.createElement('p'), {
        className: 'p-source-territoire',
        textContent:
          `${photos.length} photo${photos.length > 1 ? 's' : ''} pour ${total} monument${total > 1 ? 's' : ''} et objet${total > 1 ? 's' : ''} protégé${total > 1 ? 's' : ''}` +
          (photos.length >= PLAFOND ? ` (les ${PLAFOND} premières)` : '') +
          ', d’après Wikidata et Wikimedia Commons ; chaque photo garde la licence et l’auteur que Commons indique. Les monuments sans photo n’en ont pas sur Wikidata.',
      });
      conteneur.append(grille);
      if (photos.length > D_ABORD) {
        const reste = photos.length - D_ABORD;
        const plus = Object.assign(document.createElement('button'), { type: 'button', className: 'plat', textContent: `Voir les ${reste} autres photos` });
        plus.addEventListener('click', () => {
          for (const f of grille.querySelectorAll<HTMLElement>('figure[hidden]')) f.hidden = false;
          plus.remove();
        });
        conteneur.append(plus);
      }
      conteneur.append(bilan);
    } catch {
      bouton.disabled = false;
      bouton.textContent = libelle;
      note.textContent = ' — Wikimedia ne répond pas, réessayez plus tard';
    }
  });
  conteneur.append(bouton, note);
}

for (const c of document.querySelectorAll<HTMLElement>('[data-photos-patrimoine]')) boutonPhotosPatrimoine(c);
