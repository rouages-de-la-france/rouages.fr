/**
 * La photo de la commune, en tête de sa page : le même bouton que dans « La
 * commune mystère » (`photo-commune.ts`), qui ne charge rien sans un clic.
 */
import { boutonPhoto } from './photo-commune.ts';

for (const c of document.querySelectorAll<HTMLElement>('[data-photo-commune]')) boutonPhoto(c, c.dataset.photoCommune ?? '', c.dataset.nom ?? 'la commune');
