/**
 * Le développé d'un sigle, au toucher.
 *
 * `<abbr title>` montre sa définition au survol de la souris (`Glose.astro`) ;
 * un écran tactile n'a pas de survol, et la définition restait introuvable.
 * Un toucher — ou Entrée, ou Espace, au clavier — ouvre une bulle sous le
 * sigle avec le même texte ; un second toucher, Échap, ou un toucher ailleurs
 * la referme. Le `title` reste en place : c'est lui que les lecteurs d'écran
 * annoncent, et sans JavaScript rien ne change.
 *
 * Un sigle placé dans un lien n'est pas intercepté : le toucher suit le lien.
 */
const bulle = document.createElement('div');
bulle.className = 'bulle-sigle';
bulle.id = 'bulle-sigle';
bulle.setAttribute('role', 'tooltip');
bulle.hidden = true;
document.body.append(bulle);

let ouvert: HTMLElement | null = null;

const sigles = () => document.querySelectorAll<HTMLElement>('abbr[title]');
const interceptable = (a: Element) => !a.closest('a, button, summary');

/** Rend chaque sigle atteignable au clavier, y compris ceux ajoutés après coup. */
function preparer() {
  for (const a of sigles()) {
    if (!interceptable(a) || a.hasAttribute('tabindex')) continue;
    a.tabIndex = 0;
  }
}

function fermer() {
  if (!ouvert) return;
  ouvert.removeAttribute('aria-describedby');
  ouvert.removeAttribute('aria-expanded');
  ouvert = null;
  bulle.hidden = true;
}

function ouvrir(a: HTMLElement) {
  fermer();
  bulle.textContent = a.title;
  bulle.hidden = false;
  const r = a.getBoundingClientRect();
  const marge = 16;
  const largeur = Math.min(bulle.offsetWidth, document.documentElement.clientWidth - 2 * marge);
  const gauche = Math.max(marge, Math.min(r.left, document.documentElement.clientWidth - largeur - marge));
  bulle.style.left = `${gauche + scrollX}px`;
  bulle.style.top = `${r.bottom + scrollY + 6}px`;
  a.setAttribute('aria-describedby', bulle.id);
  a.setAttribute('aria-expanded', 'true');
  ouvert = a;
}

document.addEventListener('click', (e) => {
  const a = (e.target as Element | null)?.closest?.<HTMLElement>('abbr[title]');
  if (a && interceptable(a)) {
    e.preventDefault();
    if (ouvert === a) fermer();
    else ouvrir(a);
    return;
  }
  if (!bulle.contains(e.target as Node)) fermer();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const a = ouvert;
    fermer();
    a?.focus();
    return;
  }
  const a = (e.target as Element | null)?.closest?.<HTMLElement>('abbr[title]');
  if (a && interceptable(a) && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    if (ouvert === a) fermer();
    else ouvrir(a);
  }
});

addEventListener('resize', fermer);
preparer();
// Les blocs chargés à la demande (la suite des marchés, l'explorateur) apportent leurs sigles.
new MutationObserver(preparer).observe(document.body, { childList: true, subtree: true });
