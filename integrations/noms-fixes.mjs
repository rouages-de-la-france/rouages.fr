/**
 * Des noms sans empreinte pour ce que le navigateur télécharge.
 *
 * Avec l'empreinte, retoucher une règle de CSS changeait le nom de la feuille,
 * donc la balise qui la cite dans chacune des 35 000 pages, donc toutes les
 * pages à renvoyer au serveur. Sans elle, une page ne change que si son contenu
 * change.
 *
 * Le cache ne s'y perd pas : le `.htaccess` fait revalider ces fichiers à
 * chaque visite — une réponse 304 de quelques octets —, et le déploiement
 * purge Cloudflare.
 *
 * Les scripts viennent de la cible `client`. Les feuilles de style, elles, sont
 * émises par le rendu des pages (cible `server`), dont les autres morceaux ne
 * quittent jamais la machine de build : on n'y renomme que le CSS, sans quoi
 * ces modules atterriraient dans `dist/_astro/`.
 *
 * Astro 7 n'appelle plus le crochet qu'une fois, avec un environnement Vite
 * par cible : la règle s'applique à chacun. Sans cela, les noms reprenaient
 * leur empreinte sans que rien ne le signale (constaté au passage à la 7.4).
 */
export function nomsFixes() {
  /** Les noms de sortie d'un environnement : sans empreinte pour le CSS partout, et pour tout le reste côté client. */
  const fusion = (o, client) => {
    const avant = o?.assetFileNames;
    const assets = (info) => {
      const nom = info.names?.[0] ?? info.name ?? '';
      if (nom.endsWith('.css')) return '_astro/[name][extname]';
      if (client) return '_astro/[name][extname]';
      return typeof avant === 'function' ? avant(info) : (avant ?? '_astro/[name].[hash][extname]');
    };
    return client
      ? { ...(o ?? {}), entryFileNames: '_astro/[name].js', chunkFileNames: '_astro/[name].js', assetFileNames: assets }
      : { ...(o ?? {}), assetFileNames: assets };
  };
  /** Vite 8 lit `rolldownOptions` ; `rollupOptions` n'en est plus qu'un alias déprécié. */
  const regler = (build, client) => {
    const cle = build.rolldownOptions || !build.rollupOptions ? 'rolldownOptions' : 'rollupOptions';
    build[cle] ??= {};
    const sortie = build[cle].output;
    build[cle].output = Array.isArray(sortie) ? sortie.map((o) => fusion(o, client)) : fusion(sortie, client);
  };
  return {
    name: 'rouages-noms-fixes',
    hooks: {
      'astro:build:setup': ({ vite, target }) => {
        // Astro 7 : un seul appel, et un environnement Vite par cible (`client`, `prerender`, `ssr`…).
        if (vite.environments && Object.keys(vite.environments).length) {
          for (const [nom, env] of Object.entries(vite.environments)) {
            if (!env) continue;
            env.build ??= {};
            regler(env.build, nom === 'client');
          }
          return;
        }
        // Astro 5 : un appel par cible.
        vite.build ??= {};
        regler(vite.build, target === 'client');
      },
    },
  };
}
