/**
 * La page du règlement telle qu'elle est : la lecture assistée du PLU,
 * niveau 2 (`docs/07-risques.md`, section 10).
 *
 * Le PDF est lu au clic sur les annexes de la Géoplateforme, et la page est
 * dessinée en image par pdf.js — **sans couche de texte et sans extraction** :
 * le tableau des destinations perd ses coches dès qu'on extrait le texte, et
 * le site ne cite jamais un texte qu'il aurait extrait. Ce que la personne
 * voit est le document, pas une copie. Le lien vers le PDF original reste à
 * côté, pour un lecteur d'écran et pour tout le reste du document.
 *
 * Le service ne sert pas le fichier par morceaux (mesuré le 22 octobre 2026 :
 * une requête `Range` reçoit le fichier entier) : le règlement entier est
 * téléchargé, plusieurs mégaoctets, une fois par visite. Rien n'est gardé
 * au-delà de la page ouverte.
 */
type Pdf = import('pdfjs-dist').PDFDocumentProxy;

const ouverts = new Map<string, Promise<Pdf>>();

async function ouvrir(url: string): Promise<Pdf> {
  const deja = ouverts.get(url);
  if (deja) return deja;
  const promesse = (async () => {
    const pdfjs = await import('pdfjs-dist');
    const travailleur = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = travailleur;
    const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw new Error(`${r.status}`);
    const donnees = new Uint8Array(await r.arrayBuffer());
    // Un PDF venu d'ailleurs : ni évaluation de code, ni script, ni police chargée hors du document.
    return pdfjs.getDocument({ data: donnees, isEvalSupported: false, enableXfa: false }).promise;
  })();
  ouverts.set(url, promesse);
  promesse.catch(() => ouverts.delete(url));
  return promesse;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, classe = '', texte = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texte) e.textContent = texte;
  return e;
}

/**
 * Ouvre, au bout de `ancre`, la page `page` du PDF `url`, avec de quoi feuilleter.
 * `quoi` nomme la pièce (« règlement ») pour les libellés.
 */
export async function montrerPage(ancre: HTMLElement, url: string, page: number, quoi: string): Promise<void> {
  const fig = el('figure', 'mp-page');
  const etat = el('p', 'mp-page-etat', `Téléchargement du ${quoi} entier sur la Géoplateforme de l’IGN…`);
  etat.setAttribute('role', 'status');
  fig.append(etat);
  // Dans l'élément de liste lui-même : une figure ne peut pas être enfant direct d'une liste.
  ancre.append(fig);
  let pdf: Pdf;
  try {
    pdf = await ouvrir(url);
  } catch {
    etat.textContent = `Le ${quoi} n’a pas pu être téléchargé. Il reste lisible par le lien.`;
    return;
  }
  const toile = el('canvas', 'mp-page-toile');
  toile.setAttribute('role', 'img');
  const nav = el('div', 'mp-page-nav');
  const avant = el('button', 'mp-bouton', 'Page précédente');
  const apres = el('button', 'mp-bouton', 'Page suivante');
  const fermer = el('button', 'mp-bouton', 'Fermer');
  for (const b of [avant, apres, fermer]) b.type = 'button';
  const numero = el('span', 'mp-page-numero');
  nav.append(avant, numero, apres, fermer);
  const legende = el('figcaption', 'p-strate');
  const original = el('a', '', `le ${quoi} original, en PDF`);
  original.href = /^https:\/\//.test(url) ? `${url.replace(/#.*$/, '')}#page=${page}` : '#';
  original.target = '_blank';
  original.rel = 'noopener';
  legende.append(
    `La page telle que le document la publie, dessinée en image : Rouages n’en extrait pas le texte et n’en garde rien. Pour la lire avec un lecteur d’écran, ou lire le reste — dispositions générales, lexique, orientations d’aménagement auxquelles la page peut renvoyer —, ouvrez `,
    original,
    '.',
  );
  fig.replaceChildren(nav, toile, legende);

  let courante = Math.min(Math.max(1, page), pdf.numPages);
  let tache: { cancel(): void } | null = null;
  const dessiner = async () => {
    tache?.cancel();
    const p = await pdf.getPage(courante);
    const base = p.getViewport({ scale: 1 });
    const largeur = Math.min(fig.clientWidth || 640, 900);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const vue = p.getViewport({ scale: (largeur / base.width) * ratio });
    toile.width = Math.floor(vue.width);
    toile.height = Math.floor(vue.height);
    toile.style.width = `${Math.floor(vue.width / ratio)}px`;
    toile.setAttribute('aria-label', `Page ${courante} sur ${pdf.numPages} du ${quoi}, en image. Le texte se lit dans le PDF original, lié sous l’image.`);
    numero.textContent = `p. ${courante} / ${pdf.numPages}`;
    avant.disabled = courante <= 1;
    apres.disabled = courante >= pdf.numPages;
    const ctx = toile.getContext('2d');
    if (!ctx) return;
    const rendu = p.render({ canvasContext: ctx, viewport: vue });
    tache = rendu;
    try {
      await rendu.promise;
    } catch {
      // Un rendu annulé par un changement de page.
    }
  };
  avant.addEventListener('click', () => {
    courante--;
    void dessiner();
  });
  apres.addEventListener('click', () => {
    courante++;
    void dessiner();
  });
  fermer.addEventListener('click', () => {
    fig.remove();
    ancre.querySelector<HTMLButtonElement>('.mp-voir')?.focus();
  });
  await dessiner();
}
