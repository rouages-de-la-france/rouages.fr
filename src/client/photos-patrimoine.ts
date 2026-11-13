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
import { boutonGalerie, credits, fichierDe, json, morceaux, SPARQL, type Credit } from './commons.ts';

/** Les identifiants par requête SPARQL. */
const PAR_SPARQL = 150;
/** Au-delà, la galerie s'arrête et renvoie aux bases du ministère. */
const PLAFOND = 60;

interface Element {
  reference: string;
  titre: string;
  base: 'merimee' | 'palissy';
}
type PhotoPatrimoine = Element & Credit;


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
      const f = fichierDe(b.img.value);
      if (f && !trouves.has(b.id.value)) trouves.set(b.id.value, f);
    }
    if (trouves.size >= PLAFOND) break;
  }
  return trouves;
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

/** Le bouton de la section des monuments historiques de la commune. */
export function boutonPhotosPatrimoine(conteneur: HTMLElement): void {
  const { dep, code, nom } = conteneur.dataset as { dep: string; code: string; nom: string };
  boutonGalerie(conteneur, '📷 Voir les monuments et les objets en photo', async () => {
    const { photos, total } = await photosPatrimoine(dep, code);
    if (photos.length === 0) return `Aucune photo des monuments ni des objets de ${nom} sur Wikidata.`;
    return {
      vignettes: photos.map((p) => ({ ...p, lien: `https://pop.culture.gouv.fr/notice/${p.base}/${p.reference}`, externe: true })),
      bilan:
        `${photos.length} photo${photos.length > 1 ? 's' : ''} pour ${total} monument${total > 1 ? 's' : ''} et objet${total > 1 ? 's' : ''} protégé${total > 1 ? 's' : ''}` +
        (photos.length >= PLAFOND ? ` (les ${PLAFOND} premières)` : '') +
        ', d’après Wikidata et Wikimedia Commons ; chaque photo garde la licence et l’auteur que Commons indique. Les monuments sans photo n’en ont pas sur Wikidata.',
    };
  });
}

for (const c of document.querySelectorAll<HTMLElement>('[data-photos-patrimoine]')) boutonPhotosPatrimoine(c);
