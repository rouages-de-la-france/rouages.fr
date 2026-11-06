/**
 * Une adresse venue d'un registre tiers ne devient un lien que si elle est en
 * http ou https. Audit du 6 novembre 2026 : l'adresse d'une délibération est
 * saisie par la collectivité ou son agrégateur ; reprise telle quelle dans un
 * `href`, une adresse `javascript:` s'exécuterait au clic, sur l'origine du
 * site. Astro échappe la valeur d'un attribut, pas son schéma.
 */
export function lienWeb(adresse: string | null | undefined): string | null {
  const brut = (adresse ?? '').trim();
  if (!brut) return null;
  try {
    const u = new URL(brut);
    return u.protocol === 'https:' || u.protocol === 'http:' ? brut : null;
  } catch {
    return null;
  }
}
