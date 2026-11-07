/**
 * La mesure d'audience : une instance Umami hébergée par l'éditeur
 * (décision du 7 novembre 2026, `docs/07-risques.md`, section 12).
 *
 * Elle n'est active que si le build connaît l'adresse du script et
 * l'identifiant du site — deux variables publiques, posées dans les
 * variables du dépôt et lues par le workflow de déploiement. Sans elles, ni
 * script ni mention : un build local ou une copie du dépôt ne mesure rien.
 *
 * Les réglages gardent la mesure dans l'exemption de consentement de la
 * CNIL : aucun cookie, le seul domaine rouages.fr compté, la recherche et le
 * fragment des adresses jamais transmis (une référence cadastrale ou un nom
 * cherché n'ont pas à partir), le signal « ne pas me suivre » respecté.
 */
export interface Audience {
  script: string;
  site: string;
  domaine: string;
}

function lire(): Audience | null {
  const script = (import.meta.env.PUBLIC_UMAMI_SCRIPT ?? '').trim();
  const site = (import.meta.env.PUBLIC_UMAMI_SITE ?? '').trim();
  if (!script || !site) return null;
  try {
    if (new URL(script).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(site)) return null;
  return { script, site, domaine: 'rouages.fr' };
}

export const audience = lire();
