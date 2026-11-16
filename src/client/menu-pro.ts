/**
 * Le menu des services de l'éditeur, dans l'en-tête : un <details> natif, qui
 * s'ouvre au clavier sans script. Celui-ci le referme d'un clic ailleurs ou
 * de la touche Échap, et rend alors le focus au bouton.
 */
for (const menu of document.querySelectorAll<HTMLDetailsElement>('details.menu-pro')) {
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
}
