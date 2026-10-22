/**
 * Ce qui touche ma parcelle, côté navigateur : une adresse ou une référence
 * cadastrale, la parcelle choisie sur une petite carte, puis la liste que
 * calcule `src/modele/parcelle-plu.ts` — zones, prescriptions, informations,
 * servitudes — avec le document, son état et les pièces à lire.
 *
 * Rien ne part sans un clic : l'adresse au géocodeur de la Géoplateforme, la
 * parcelle et les couches au service WFS de l'IGN, l'état des documents à
 * l'API du Géoportail de l'urbanisme. Ces services voient l'adresse IP ;
 * Rouages ne garde rien. La parcelle choisie passe dans l'adresse de la page,
 * pour qu'un lien mène à la même lecture.
 *
 * Tout ce qui vient des services est écrit en texte, jamais en HTML.
 */
import {
  chercherAdresse,
  CONTACTS,
  ETATS,
  FAMILLES,
  idu,
  lireParcelle,
  parcelleParIdu,
  parcellesAutour,
  planLocal,
  polygones,
  PRECISION,
  type Adresse,
  type Element,
  type Famille,
  type Lecture,
  type Parcelle,
} from '../modele/parcelle-plu.ts';
import { enFrancais } from '../modele/urbanisme.ts';

const NS = 'http://www.w3.org/2000/svg';
const CU = 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1633';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, classe = '', texte = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texte) e.textContent = texte;
  return e;
}

function lien(href: string, texte: string): HTMLAnchorElement {
  const a = el('a', '', texte);
  // Seules les adresses web passent : un lien venu d'un service ne peut pas porter de script.
  a.href = /^https:\/\//.test(href) ? href : '#';
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

const nomParcelle = (p: Parcelle) => `section ${p.section.replace(/^0/, '')}, n° ${Number(p.numero)}`;
const surface = (p: Parcelle) => (p.contenance ? `, ${p.contenance.toLocaleString('fr-FR')} m² de contenance cadastrale` : '');

/** Une date « 01/10/2026 18:52:25 » de l'API du Géoportail, en toutes lettres. */
function dateGpu(d: string | null): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(d ?? '');
  return m ? enFrancais(`${m[3]}-${m[2]}-${m[1]}`) : null;
}

export function brancherMaParcelle(): void {
  const formAdresse = document.getElementById('mp-adresse') as HTMLFormElement | null;
  const formReference = document.getElementById('mp-reference') as HTMLFormElement | null;
  const etat = document.getElementById('mp-etat');
  const choix = document.getElementById('mp-choix');
  const resultat = document.getElementById('mp-resultat');
  if (!formAdresse || !formReference || !etat || !choix || !resultat) return;

  const dire = (t: string): void => {
    etat.textContent = t;
  };

  // --- 1. L'adresse, puis la parcelle sur la carte.
  formAdresse.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = String(new FormData(formAdresse).get('q') ?? '').trim();
    if (q.length < 3) return dire('Saisissez au moins trois caractères.');
    choix.replaceChildren();
    resultat.replaceChildren();
    dire('Recherche de l’adresse auprès du géocodeur de la Géoplateforme…');
    let adresses: Adresse[];
    try {
      adresses = await chercherAdresse(q);
    } catch {
      return dire('Le géocodeur n’a pas répondu. Réessayez, ou saisissez la référence cadastrale.');
    }
    if (!adresses.length) return dire('Aucune adresse trouvée. Essayez avec le nom de la commune, ou la référence cadastrale.');
    dire(`${adresses.length} adresse${adresses.length > 1 ? 's' : ''} trouvée${adresses.length > 1 ? 's' : ''} : choisissez la bonne.`);
    const ul = el('ul', 'mp-adresses');
    for (const a of adresses) {
      const b = el('button', 'mp-bouton', a.libelle);
      b.type = 'button';
      b.addEventListener('click', () => autour(a));
      const li = el('li');
      li.append(b, el('span', 'mp-precision', ` — localisée ${PRECISION[a.type] ?? `au niveau « ${a.type} »`}`));
      ul.append(li);
    }
    choix.replaceChildren(ul);
  });

  const autour = async (a: Adresse): Promise<void> => {
    dire('Lecture des parcelles autour du point au cadastre de l’IGN…');
    resultat.replaceChildren();
    let trouve: Awaited<ReturnType<typeof parcellesAutour>>;
    try {
      trouve = await parcellesAutour(a.lon, a.lat, a.type === 'housenumber' ? 40 : 80);
    } catch {
      return dire('Le cadastre de la Géoplateforme n’a pas répondu. Réessayez plus tard.');
    }
    if (!trouve.parcelles.length) return dire('Aucune parcelle cadastrale autour de ce point : la voie publique n’est pas cadastrée. Choisissez une autre adresse, ou saisissez la référence.');
    const precision = PRECISION[a.type] ?? `au niveau « ${a.type} »`;
    dire(
      `« ${a.libelle} » est localisée ${precision}. ` +
        (a.type === 'housenumber'
          ? 'Le point tombe en général sur la parcelle, mais pas toujours : vérifiez sur la carte et choisissez-en une autre au besoin.'
          : 'Le point n’est pas celui de votre terrain : choisissez la parcelle sur la carte ou dans la liste.'),
    );
    carte(a, trouve.parcelles, a.type === 'housenumber' ? trouve.sous : null);
  };

  const carte = (a: Adresse, parcelles: Parcelle[], sous: string | null): void => {
    const W = 360;
    const H = 260;
    const plan = planLocal(a.lon, a.lat);
    const formes = parcelles.map((p) => ({ p, polys: polygones(p.geometrie, plan) }));
    const xs = formes.flatMap((f) => f.polys.flat(2).map(([x]) => x));
    const ys = formes.flatMap((f) => f.polys.flat(2).map(([, y]) => y));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(W / (x1 - x0 || 1), H / (y1 - y0 || 1)) * 0.96;
    const ox = (W - (x1 - x0) * k) / 2;
    const oy = (H - (y1 - y0) * k) / 2;
    const ecran = ([x, y]: number[]) => `${(ox + (x - x0) * k).toFixed(1)} ${(oy + (y1 - y) * k).toFixed(1)}`;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'mp-carte');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Les parcelles cadastrales autour de l’adresse ; la liste qui suit permet de choisir.');
    const boutons = new Map<string, { path: SVGPathElement; bouton: HTMLButtonElement }>();
    const ul = el('ul', 'mp-parcelles');
    for (const { p, polys } of formes) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', polys.flat().map((r) => 'M' + r.map(ecran).join('L') + 'Z').join(''));
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('class', 'mp-parcelle');
      const t = document.createElementNS(NS, 'title');
      t.textContent = nomParcelle(p);
      path.append(t);
      path.addEventListener('click', () => choisir(p));
      svg.append(path);
      const b = el('button', 'mp-bouton', `${p.commune}, ${nomParcelle(p)}${surface(p)}`);
      b.type = 'button';
      b.addEventListener('click', () => choisir(p));
      const li = el('li');
      li.append(b);
      ul.append(li);
      boutons.set(p.idu, { path, bouton: b });
    }
    // Le point du géocodeur.
    const [cx, cy] = ecran(plan([a.lon, a.lat])).split(' ').map(Number);
    const point = document.createElementNS(NS, 'circle');
    point.setAttribute('cx', String(cx));
    point.setAttribute('cy', String(cy));
    point.setAttribute('r', '4');
    point.setAttribute('class', 'mp-point');
    svg.append(point);

    const marquer = (id: string) => {
      for (const [i, { path, bouton }] of boutons) {
        path.classList.toggle('mp-choisie', i === id);
        bouton.setAttribute('aria-pressed', String(i === id));
      }
    };
    async function choisir(p: Parcelle) {
      marquer(p.idu);
      await lire(p);
    }
    const fig = el('figure', 'mp-figure');
    const leg = el('figcaption', 'p-strate', 'Le point est celui que donne le géocodeur ; la parcelle choisie est en couleur. Cliquez une autre parcelle pour la choisir.');
    fig.append(svg, leg);
    // La liste se replie quand le point a déjà désigné une parcelle : la lecture vient alors juste dessous.
    const premiere = parcelles.find((p) => p.idu === sous);
    const liste = el('details', 'mp-autres');
    liste.open = !premiere;
    liste.append(el('summary', 'mp-sous-titre', `Les ${parcelles.length} parcelles autour de ce point`), ul);
    choix.replaceChildren(fig, liste);
    if (premiere) void choisir(premiere);
  };

  // --- 2. La référence cadastrale.
  formReference.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = new FormData(formReference);
    const insee = String(d.get('insee') ?? '').trim().toUpperCase();
    const section = String(d.get('section') ?? '').trim().toUpperCase();
    const numero = String(d.get('numero') ?? '').trim();
    if (!/^\d[\dAB]\d{3}$/.test(insee) || !/^[0-9A-Z]{1,2}$/.test(section) || !/^\d{1,4}$/.test(numero))
      return dire('La référence se compose du code INSEE de la commune (5 caractères), de la section (1 ou 2 lettres) et du numéro (4 chiffres au plus).');
    choix.replaceChildren();
    await chercherReference(idu(insee, section, numero));
  });

  const chercherReference = async (id: string): Promise<void> => {
    resultat.replaceChildren();
    dire('Lecture de la parcelle au cadastre de l’IGN…');
    let p: Parcelle | null;
    try {
      p = await parcelleParIdu(id);
    } catch {
      return dire('Le cadastre de la Géoplateforme n’a pas répondu. Réessayez plus tard.');
    }
    if (!p) return dire(`Aucune parcelle ${id} au cadastre. Une commune associée ou déléguée a parfois son propre préfixe : passez plutôt par l’adresse.`);
    await lire(p);
  };

  // --- 3. La lecture.
  const lire = async (p: Parcelle): Promise<void> => {
    dire(`Lecture de ce qui touche la parcelle ${nomParcelle(p)} sur la Géoplateforme et le Géoportail de l’urbanisme…`);
    resultat.replaceChildren();
    let l: Lecture;
    try {
      l = await lireParcelle(p);
    } catch {
      return dire('La Géoplateforme n’a pas répondu. Réessayez plus tard, ou consultez le Géoportail de l’urbanisme.');
    }
    const url = new URL(location.href);
    url.searchParams.set('parcelle', p.idu);
    history.replaceState(null, '', url);
    dire('');
    afficher(l);
    resultat.querySelector('h2')?.focus();
  };

  const afficher = (l: Lecture): void => {
    const p = l.parcelle;
    const h = el('h2', 'mp-titre', `${p.commune}, parcelle ${nomParcelle(p)}`);
    h.tabIndex = -1;
    const lue = new Date(l.lueLe);
    const intro = el(
      'p',
      'mp-intro',
      `Référence ${p.idu}${surface(p)}. Lu le ${lue.toLocaleDateString('fr-FR')} à ${lue.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} sur la Géoplateforme de l’IGN, tel que le Géoportail de l’urbanisme le publie : rien n’est gardé par Rouages.`,
    );
    resultat.append(h, intro);

    if (l.manquantes.length)
      resultat.append(
        el('p', 'mp-alerte', `Le service n’a pas rendu ${l.manquantes.length} couche${l.manquantes.length > 1 ? 's' : ''} sur onze (${l.manquantes.join(', ')}) : la liste ci-dessous est incomplète. Relancez la lecture.`),
      );

    // Les documents d'urbanisme (pas les servitudes, dites avec leur catégorie).
    const documentsDu = [...new Set(l.elements.filter((e) => e.famille !== 'servitude').map((e) => e.document))];
    if (!documentsDu.length)
      resultat.append(
        el(
          'p',
          'mp-alerte',
          'Le Géoportail de l’urbanisme ne publie aucun document d’urbanisme sur cette parcelle : soit la commune relève du règlement national d’urbanisme, soit son document n’y a pas été versé. La mairie le sait.',
        ),
      );
    for (const id of documentsDu) {
      const d = l.documents.get(id);
      const bloc = el('div', 'mp-document');
      if (!d) {
        bloc.append(el('p', '', 'Document publié au Géoportail de l’urbanisme ; son état n’a pas pu être lu.'));
      } else {
        bloc.append(el('p', 'mp-document-titre', d.titre ?? d.nom ?? 'Document d’urbanisme'));
        const morceaux = [
          d.etat ? (ETATS[d.etat] ?? d.etat) : null,
          d.application ? (ETATS[d.application] ?? d.application) : null,
          d.procedure ? `dernière procédure approuvée le ${enFrancais(d.procedure)}` : null,
          dateGpu(d.publication) ? `publié au Géoportail le ${dateGpu(d.publication)}` : null,
        ].filter(Boolean);
        bloc.append(el('p', 'mp-document-etat', `${morceaux.join(' ; ')}.`));
      }
      resultat.append(bloc);
    }

    for (const famille of Object.keys(FAMILLES) as Famille[]) {
      const items = l.elements.filter((e) => e.famille === famille);
      const s = el('section', 'mp-famille');
      s.append(el('h3', '', FAMILLES[famille].titre), el('p', 'p-strate', FAMILLES[famille].aide));
      if (!items.length) {
        s.append(
          el(
            'p',
            'mp-vide',
            famille === 'servitude'
              ? 'Aucune assiette de servitude publiée ne touche la parcelle. Toutes ne sont pas numérisées : l’absence ne prouve rien, la liste des servitudes annexée au document fait foi.'
              : `Le Géoportail ne publie aucun${famille === 'zone' ? 'e zone' : famille === 'prescription' ? 'e prescription' : 'e information'} qui touche la parcelle. Une absence ne prouve rien.`,
          ),
        );
      } else {
        const ul = el('ul', 'mp-liste');
        for (const e of items) ul.append(ligne(e, l));
        s.append(ul);
      }
      resultat.append(s);
    }

    const fin = el('section', 'mp-famille');
    fin.append(el('h3', '', 'Pour la suite'));
    const ul = el('ul', 'mesure');
    const mairie = el('li');
    const a = el('a', '', p.commune);
    a.href = `/commune/${p.insee}`;
    mairie.append('Le document tenu en mairie fait foi : son service de l’urbanisme répond aux questions. La page de la commune sur ce site (', a, ') donne son document d’urbanisme et les coordonnées de la mairie.');
    const orienteur = el('li');
    const b = el('a', '', 'quelle autorisation demander pour des travaux courants');
    b.href = '/simulateurs/autorisation';
    orienteur.append('Pour des travaux : ', b, '.');
    const cu = el('li');
    cu.append('Le ', lien(CU, 'certificat d’urbanisme'), ', demandé en mairie, est la seule réponse qui engage l’administration sur les règles applicables à un terrain.');
    ul.append(mairie, orienteur, cu);
    fin.append(ul);
    resultat.append(fin);
  };

  const ligne = (e: Element, l: Lecture): HTMLLIElement => {
    const li = el('li', `mp-element mp-${e.contact}`);
    li.append(el('strong', '', e.libelle));
    if (e.libelleLong) li.append(` — ${e.libelleLong}`);
    li.append(el('span', 'mp-contact', ` : ${CONTACTS[e.contact]}.`));
    if (e.type) {
      const t = el('span', 'mp-type');
      if (e.famille === 'servitude') {
        t.append(`Catégorie ${e.type.code}${e.type.libelle ? ` : ${e.type.libelle}` : ' (libellé indisponible : le Géoportail de l’urbanisme n’a pas répondu)'}`);
        if (e.type.references) t.append(' (', lien(e.type.references, 'fiche de la catégorie'), ')');
        const d = l.documents.get(e.document);
        if (d?.producteur) t.append(`, gestionnaire : ${d.producteur}`);
        t.append('.');
      } else if (e.famille === 'zone') {
        t.append(`Type ${e.type.code}, ${e.type.libelle}${e.type.references ? ` : « ${e.type.references.replace(/\.$/, '')} »` : ''}.`);
      } else {
        t.append(`Type CNIG ${e.type.code} : « ${e.type.libelle.replace(/\.$/, '')} »${e.type.references ? ` (${e.type.references})` : ''}.`);
      }
      li.append(t);
    } else if (e.famille !== 'servitude') li.append(el('span', 'mp-type', 'Type non reconnu dans le standard CNIG.'));
    if (e.piece) {
      const p = el('span', 'mp-piece');
      const quoi = e.famille === 'zone' ? 'règlement' : e.famille === 'servitude' ? 'acte instituant la servitude' : 'pièce écrite';
      p.append(lien(e.piece, e.page ? `${quoi}, p. ${e.page}` : quoi));
      // Niveau 2 : la page elle-même, dessinée dans la page, quand le document dit laquelle.
      if (e.famille === 'zone' && e.page) {
        const voir = el('button', 'mp-bouton mp-voir', `Voir la page ${e.page} ici`);
        voir.type = 'button';
        const url = e.piece;
        const page = e.page;
        voir.addEventListener('click', async () => {
          voir.disabled = true;
          const { montrerPage } = await import('./page-reglement.ts');
          await montrerPage(li, url, page, 'règlement');
          voir.disabled = false;
        });
        p.append(' ', voir);
      }
      li.append(p);
    }
    return li;
  };

  // Une parcelle dans l'adresse : la lecture qu'un lien a demandée.
  const demandee = new URLSearchParams(location.search).get('parcelle');
  if (demandee && /^[0-9A-Z]{14}$/.test(demandee)) void chercherReference(demandee);
}

