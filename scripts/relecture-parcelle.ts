/**
 * La fiche de relecture de « Ce qui touche ma parcelle », pour le praticien
 * qui doit la relire avant que la page soit ouverte (`docs/07-risques.md`,
 * section 10) : pour chaque parcelle d'essai au Mayet-de-Montagne, ce que la
 * page affiche, ligne par ligne, avec une case à cocher et le lien vers la
 * même lecture sur le site.
 *
 * Contrairement à la fiche de l'orienteur, celle-ci lit le Géoportail : elle
 * dit ce que la page répondait le jour où on l'a tirée, et ce jour est écrit
 * en tête. `npm run relecture-parcelle` la réécrit ; aucune vérification
 * automatique ne la compare, faute de réseau en intégration continue.
 *
 * Les parcelles sont une proposition, à confirmer avec le mainteneur, qui
 * connaît la commune : une dans le bourg, une à cheval sur une limite de
 * zone, une en zone agricole, une que la zone voisine ne touche qu'au bord.
 */
import { writeFileSync } from 'node:fs';
import { STANDARD } from '../src/modele/cnig.ts';
import { CONTACTS, ETATS, FAMILLES, lireParcelle, parcelleParIdu, type Element, type Famille, type Lecture } from '../src/modele/parcelle-plu.ts';
import { enFrancais } from '../src/modele/urbanisme.ts';

export const FICHIER = 'docs/11-relecture-parcelle.md';
const SITE = 'https://rouages.fr/simulateurs/ma-parcelle';

const CAS: { idu: string; titre: string; pourquoi: string }[] = [
  {
    idu: '03165000AC0062',
    titre: 'Dans le bourg, place de l’Église',
    pourquoi: 'Une parcelle bâtie du centre, entièrement dans une zone urbaine, où se superposent prescriptions et informations.',
  },
  {
    idu: '03165000AC0184',
    titre: 'À cheval sur une limite de zone',
    pourquoi: 'La limite entre la zone urbaine du bourg et la zone agricole passe au travers de la parcelle : la page doit dire les deux zones.',
  },
  {
    idu: '03165000AE0014',
    titre: 'En zone agricole',
    pourquoi: 'Une grande parcelle hors du bourg, entièrement en zone agricole.',
  },
  {
    idu: '03165000AE0001',
    titre: 'Touchée au bord par la zone voisine',
    pourquoi: 'En zone agricole, mais la zone urbaine voisine en touche une bande étroite le long de la limite : la page doit le signaler sans le présenter comme une zone qui s’applique à la parcelle entière.',
  },
];

const QUESTIONS = [
  '**La bande étroite.** Une zone qui couvre moins du dixième de la parcelle, et rien à plus de trois mètres de sa limite, est dite « ne touche qu’une bande de 3 mètres au plus le long de la limite — souvent un écart entre le dessin du document et celui du cadastre ». Ces seuils sont-ils raisonnables, et la phrase juste ?',
  '**La tolérance des lignes et des points.** Une prescription ou une information linéaire ou ponctuelle à moins d’un mètre de la limite, dehors, est montrée comme « longe la limite de la parcelle ». Faut-il la montrer, ou la taire ?',
  '**Le type CNIG à côté du libellé.** La collectivité range parfois une couche sous un code qui ne lui correspond pas tout à fait (au Mayet-de-Montagne, « Sismicité faible » sous le code 02, « Limitations de la constructibilité pour des raisons environnementales, de risques, d’intérêt général »). La page montre les deux, le libellé d’abord. Le code, cité tel que le standard le nomme, risque-t-il d’induire en erreur ?',
  '**Le caractère exécutoire.** La page dit que la publication au Géoportail « conditionne en principe le caractère exécutoire d’un PLU », d’après l’article L153-23 du code de l’urbanisme tel que la fiche de la DGCL le résume, et que le document tenu en mairie fait foi. Est-ce exact, et assez prudent ?',
  '**Ce qui manque.** Faut-il dire autre chose à la fin de chaque lecture que la mairie, l’orienteur des autorisations et le certificat d’urbanisme ?',
];

function ligne(e: Element, l: Lecture): string[] {
  const morceaux = [`**${e.libelle}**${e.libelleLong ? ` — ${e.libelleLong}` : ''} : ${CONTACTS[e.contact]}.`];
  if (e.type && e.famille === 'servitude') {
    const d = l.documents.get(e.document);
    morceaux.push(`Catégorie ${e.type.code} : ${e.type.libelle}${d?.producteur ? `, gestionnaire : ${d.producteur}` : ''}.`);
  } else if (e.type && e.famille === 'zone') morceaux.push(`Type ${e.type.code}, ${e.type.libelle}.`);
  else if (e.type) morceaux.push(`Type CNIG ${e.type.code} : « ${e.type.libelle.replace(/\.$/, '')} »${e.type.references ? ` (${e.type.references})` : ''}.`);
  else morceaux.push('Type non reconnu dans le standard CNIG.');
  if (e.piece) morceaux.push(`[${e.famille === 'zone' ? 'règlement' : e.famille === 'servitude' ? 'acte instituant la servitude' : 'pièce écrite'}${e.page ? `, p. ${e.page}` : ''}](${e.piece})`);
  return [`- ${morceaux.join(' ')}`, '  - [ ] conforme au Géoportail et au document', '  - [ ] à corriger — remarque :'];
}

function cas(n: number, c: (typeof CAS)[number], l: Lecture): string[] {
  const p = l.parcelle;
  const out = [
    `## ${n}. ${c.titre} — section ${p.section}, n° ${Number(p.numero)}`,
    '',
    `${c.pourquoi}`,
    '',
    `Parcelle ${p.idu}, ${p.contenance?.toLocaleString('fr-FR') ?? '?'} m² de contenance cadastrale. [La même lecture sur le site](${SITE}?parcelle=${p.idu}).`,
    '',
  ];
  for (const d of l.documents.values()) {
    if (d.categorie) continue;
    const etat = [d.etat && (ETATS[d.etat] ?? d.etat), d.application && (ETATS[d.application] ?? d.application), d.procedure && `dernière procédure approuvée le ${enFrancais(d.procedure)}`].filter(Boolean).join(' ; ');
    out.push(`**Document** : ${d.titre ?? d.nom} — ${etat}.`, '');
  }
  if (l.manquantes.length) out.push(`> Le service n’a pas rendu ${l.manquantes.join(', ')} ce jour-là : relancer \`npm run relecture-parcelle\`.`, '');
  for (const f of Object.keys(FAMILLES) as Famille[]) {
    const items = l.elements.filter((e) => e.famille === f);
    out.push(`### ${FAMILLES[f].titre}`, '');
    if (!items.length) out.push(f === 'servitude' ? '_Aucune assiette de servitude publiée ne touche la parcelle._' : '_Rien de publié qui touche la parcelle._', '', '- [ ] le Géoportail ne montre rien non plus', '- [ ] il montre quelque chose — quoi :', '');
    else out.push(...items.flatMap((e) => ligne(e, l)), '');
  }
  return out;
}

const lectures: Lecture[] = [];
for (const c of CAS) {
  const p = await parcelleParIdu(c.idu);
  if (!p) throw new Error(`${c.idu} introuvable au cadastre`);
  lectures.push(await lireParcelle(p));
}
const jour = new Date().toISOString().slice(0, 10);
const l: string[] = [
  '# Relecture de « Ce qui touche ma parcelle »',
  '',
  '<!-- Fichier produit par `npm run relecture-parcelle`, qui lit le Géoportail de l’urbanisme : ne pas le modifier à la main, sauf pour cocher et annoter. -->',
  '',
  `La page \`/simulateurs/ma-parcelle\` dit, depuis une adresse ou une référence cadastrale, les zones, prescriptions, informations et servitudes que le Géoportail de l’urbanisme publie sur une parcelle, chacune avec son libellé, son type en clair et la pièce à lire. Elle ne dit pas ce qu’on peut construire. Elle reste **hors du menu et des moteurs de recherche** tant qu’un praticien de l’urbanisme n’a pas relu ses réponses (\`docs/07-risques.md\`, section 10).`,
  '',
  `**Lecture du ${enFrancais(jour)}**, sur ${CAS.length} parcelles du Mayet-de-Montagne (03165), commune de référence du projet. Le Géoportail change : une ligne qui ne correspond plus se vérifie d’abord sur la date du document.`,
  '',
  `**Comment relire.** Pour chaque parcelle, ouvrir le [Géoportail de l’urbanisme](https://www.geoportail-urbanisme.gouv.fr/map/), chercher la parcelle, cliquer dessus, et comparer avec la liste ci-dessous : rien de plus, rien de moins, le bon libellé, la bonne page du règlement. Cocher une case par ligne, annoter ce qui est faux, puis trancher les questions de la fin. Compter une demi-heure.`,
  '',
  `**L’erreur qui compte** est la règle qui manque — une prescription ou une servitude que la page tait — et la zone affichée sur une parcelle qu’elle ne touche pas. Les types en clair viennent du ${STANDARD.titre} du CNIG (${enFrancais(STANDARD.date)}), mot pour mot.`,
  '',
  '---',
  '',
  ...CAS.flatMap((c, i) => cas(i + 1, c, lectures[i])),
  '---',
  '',
  '## Questions',
  '',
  ...QUESTIONS.flatMap((q, i) => [`${i + 1}. ${q}`, '   - Réponse :', '']),
];
writeFileSync(FICHIER, l.join('\n').replace(/\n{3,}/g, '\n\n'));
console.log(`${FICHIER} réécrite : ${CAS.length} parcelles, ${lectures.reduce((t, x) => t + x.elements.length, 0)} lignes à relire.`);
