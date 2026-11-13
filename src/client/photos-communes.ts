/**
 * Les photos des communes d'une intercommunalité ou d'un département : l'image
 * principale de chacune sur Wikidata (P18), trouvée par son code INSEE (P374),
 * avec le crédit lu sur Commons. Au clic seulement, comme les autres photos.
 *
 * Le conteneur porte la liste des communes, déjà ordonnée et plafonnée par la
 * page (`PhotosCommunes.astro`) : code, nom.
 */
import { boutonGalerie, credits, fichierDe, json, morceaux, SPARQL } from './commons.ts';

async function photos(liste: [string, string][]) {
  const fichiers = new Map<string, string>();
  for (const lot of morceaux(liste, 150)) {
    const valeurs = lot.map(([code]) => `"${code.replace(/[^0-9AB]/g, '')}"`).join(' ');
    // Une commune déléguée garde parfois le code de sa commune nouvelle : on prend la première image trouvée.
    const requete = `SELECT ?code ?img WHERE { VALUES ?code { ${valeurs} } ?c wdt:P374 ?code ; wdt:P18 ?img . FILTER NOT EXISTS { ?c wdt:P576 ?fin } }`;
    const r = await json<{ results?: { bindings?: { code: { value: string }; img: { value: string } }[] } }>(
      `${SPARQL}?${new URLSearchParams({ query: requete, format: 'json' })}`,
    );
    for (const b of r.results?.bindings ?? []) if (!fichiers.has(b.code.value)) fichiers.set(b.code.value, fichierDe(b.img.value));
  }
  const c = await credits([...new Set(fichiers.values())]);
  return liste.flatMap(([code, nom]) => {
    const x = c.get(fichiers.get(code) ?? '');
    return x ? [{ ...x, titre: nom, lien: `/commune/${code}`, externe: false }] : [];
  });
}

for (const conteneur of document.querySelectorAll<HTMLElement>('[data-photos-communes]')) {
  const liste = JSON.parse(conteneur.dataset.photosCommunes ?? '[]') as [string, string][];
  const total = Number(conteneur.dataset.total ?? liste.length);
  boutonGalerie(conteneur, '📷 Voir les communes en photo', async () => {
    const vignettes = await photos(liste);
    if (vignettes.length === 0) return 'Aucune photo de ces communes sur Wikidata.';
    return {
      vignettes,
      bilan:
        `${vignettes.length} photo${vignettes.length > 1 ? 's' : ''}` +
        (total > liste.length ? ` des ${liste.length} communes les plus peuplées, sur ${total}` : ` pour ${liste.length} commune${liste.length > 1 ? 's' : ''}`) +
        ', d’après l’image principale de chaque commune sur Wikidata ; chaque photo garde la licence et l’auteur que Commons indique.',
    };
  });
}
