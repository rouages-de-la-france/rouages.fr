# 12 — Les rouages de l'influence : cadrage

> Statut : **proposition du 6 novembre 2026, à valider par le mainteneur.**
> Rien n'entre dans `contenu/` avant sa décision. Les sources citées plus bas
> sont des pistes : chacune se relit au moment d'écrire la fiche qui s'en sert,
> et aucun article de loi n'est cité ici de mémoire.

`02-familles.md` décrit la famille D — « comment on vous oriente » — et la
place en dernier : le prebunking n'a d'effet que porté par une source déjà
perçue comme neutre, et le publier trop tôt ferait passer le site pour un
média d'opinion. `07-risques.md` (section 3) en a posé les garde-fous :
mécanismes uniquement, aucun nom, sources académiques ou cas documentés
publiquement, séparation visuelle. Ce document dit comment peupler la famille
sans les trahir, et ce que le mainteneur doit trancher avant.

## Ce que le site sait déjà de l'influence

Plus qu'il n'y paraît, mais sous l'angle des **institutions**, pas des
mécanismes :

- les **représentants d'intérêts** inscrits au répertoire de la HATVP, avec
  leurs dirigeants, sur les pages de commune et de département ;
- les **déclarations d'intérêts** des élus, et le rapprochement par le nom avec
  les titulaires des marchés, présenté comme un recoupement qui ne conclut
  rien ;
- les **voies par lesquelles un citoyen pèse** : la question écrite, l'enquête
  publique, la délibération, le recours.

Le schéma est prêt : un processus peut être de la famille `influence`. **Aucun
n'existe encore.** La famille D serait donc l'envers des processus déjà
écrits : non plus « comment faire entendre sa voix », mais « comment d'autres
font entendre la leur, et à quoi on le reconnaît ».

## Ce qui peut mal tourner

- **L'exemple qui accuse.** Tout exemple concret désigne quelqu'un. « Un faux
  mouvement citoyen contre un projet éolien » fait penser à un projet précis,
  et à ceux qui s'y opposent sincèrement. La règle des familles A à C — une
  entreprise est nommée quand une source publique la désigne — ne suffit pas
  ici : être désigné comme exemple d'un mécanisme d'influence, c'est être mis
  en cause.
- **La symétrie perdue.** Une fiche sur la désinformation qui ne prendrait ses
  exemples que d'un bord politique ferait du site un camp. Chaque mécanisme
  doit être décrit de façon que n'importe quel acteur puisse l'employer.
- **Le soupçon généralisé.** Apprendre les signaux d'une campagne coordonnée
  peut conduire à voir des campagnes partout. Une fiche dit ce que le signal
  montre, et ce qu'il ne prouve pas — comme le rapprochement par le nom dit
  qu'il ne dit pas si l'élu a pris part à la décision.
- **L'efficacité supposée.** Que le prebunking « marche » est une affirmation
  de recherche. Elle se documente, études lues et citées, avant le premier lot
  — ou elle ne s'écrit pas.
- **La confusion avec le légal.** La représentation d'intérêts déclarée est
  licite et encadrée ; l'astroturfing ne l'est pas toujours. Mêler les deux
  sous « influence » laisserait croire que tout lobbying est une manipulation.

## Les sources qui tiendraient

À vérifier une à une avant usage ; c'est ce qui décidera du premier lot.

| Source | Ce qu'elle permettrait | Producteur |
|---|---|---|
| Le répertoire des représentants d'intérêts et ses lignes directrices | qui doit s'inscrire, ce qu'il déclare, ce que le public peut vérifier | HATVP |
| Les rapports publics sur les manipulations de l'information venues de l'étranger | des modes opératoires décrits par une administration, signaux observables compris | Viginum (SGDSN) |
| Les décisions et rapports sur le pluralisme et la concentration des médias | qui possède quoi, ce que la loi impose | Arcom |
| Les règles des sondages électoraux et les mises au point publiées | ce qu'un sondage doit dire, ce qu'on peut lui reprocher | Commission des sondages |
| Les pratiques commerciales trompeuses et la conception trompeuse des interfaces | les mécanismes de l'économie de l'attention qui relèvent du droit | DGCCRF, CNIL |
| La littérature sur l'inoculation et le prebunking | ce que l'on sait de l'effet, et de ses limites | travaux académiques, à lire |

## Comment ça entre dans le modèle

Sans entité nouvelle, comme les rouages économiques :

- **un mécanisme** — se faire inscrire comme représentant d'intérêts, monter
  une campagne coordonnée, publier un sondage — est un processus de la famille
  `influence`, avec ses étapes et, surtout, ses **leviers** : ce que le lecteur
  peut vérifier, et où ;
- **ceux qui y prennent part** sont des archétypes (« un cabinet de conseil en
  affaires publiques », « un réseau de comptes ») ou des institutions (HATVP,
  Arcom, Viginum, Commission des sondages) ;
- **ce qui circule** — l'argent d'une campagne, une déclaration au répertoire —
  est un flux, comme ailleurs.

Trois règles de validation proposées, propres à la famille :

1. **Aucune organisation privée nommée**, même désignée par une source :
   `designee_par` est refusé dans la famille `influence`. Seules les
   institutions publiques y ont un nom. (Plus strict que la règle des
   rouages économiques, pour la raison dite plus haut : ici, l'exemple
   accuse.)
2. **Chaque processus cite au moins une source institutionnelle ou
   académique**, et chaque signal décrit porte sa limite : ce qu'il ne prouve
   pas.
3. **Une séparation visible** : un bandeau propre à la famille — « Comment on
   vous oriente : des mécanismes, jamais des personnes » — sur chaque page, et
   une entrée de menu à part, pour que la famille ne colore pas la lecture des
   autres.

## Un premier lot possible

Trois processus, choisis parce qu'ils s'adossent à une institution et à ce que
le site montre déjà, et qu'aucun n'oblige à prendre un exemple :

1. **Comment un intérêt se fait entendre de la décision publique** — la
   représentation d'intérêts déclarée : qui doit s'inscrire au répertoire, ce
   qu'il déclare, et comment le lecteur vérifie qui a cherché à peser sur un
   texte. Le pont avec les dirigeants du répertoire, déjà affichés.
2. **Ce qu'un sondage électoral doit dire** — les mentions obligatoires, le
   rôle de la Commission des sondages, ce qu'une marge d'erreur permet de
   conclure, et ce qu'elle ne permet pas. Le pont avec les résultats
   électoraux, déjà affichés.
3. **Reconnaître une campagne coordonnée en ligne** — les signaux que décrivent
   les rapports publics de Viginum, chacun avec ce qu'il ne prouve pas, et à
   qui signaler. Le plus délicat des trois : à écrire en dernier, et à faire
   relire.

Restent pour plus tard, faute de source institutionnelle qui tienne : « le
cycle de vie d'une rumeur locale », « comment un amendement apparaît sans
auteur apparent », « à qui appartient mon journal local » (à étudier avec ce
que publie l'Arcom).

**Le critère pour continuer** : chaque affirmation a sa source, aucune fiche ne
nomme une organisation privée ni ne laisse deviner un cas, et une relecture
par une personne de sensibilité politique opposée à celle du rédacteur ne
trouve rien à redire à la symétrie.

## Ce que le mainteneur doit trancher

1. **Le moment.** `07-risques.md` voulait la famille D « seulement après la
   phase 2 ». La phase 2 (densifier) est-elle assez avancée pour que la
   crédibilité du site soit installée — ou faut-il attendre, par exemple,
   la relecture par un praticien des deux outils d'urbanisme ?
2. **La règle sur les organisations** : aucune organisation privée nommée dans
   la famille, même désignée par une source (proposé), ou la règle des
   rouages économiques ?
3. **Le premier lot** : les trois processus ci-dessus, ou seulement les deux
   premiers, adossés au droit, en laissant les campagnes coordonnées pour
   après ?
4. **La relecture extérieure** : qui relit la symétrie avant publication ?
