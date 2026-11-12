# 13 — Une page par programme et par zonage : cadrage

> Statut : **proposition du 12 novembre 2026, à valider par le mainteneur.**
> Demandée le même jour, à partir de la page d'Ygrande : un programme
> « Villages d'avenir » y est cité, sans dire ce qu'il est. Rien n'est
> construit avant la décision. Aucun texte n'est cité ici de mémoire : chaque
> page de programme se fonde sur le texte qui le crée, lu au moment de
> l'écrire.

## Ce que le site sait déjà

`scripts/zonages-emettre.ts` rattache à chaque commune :

- **neuf programmes de l'ANCT** — Petites villes de demain, Action cœur de
  ville, Villages d'avenir, et, depuis le tableau de croisement des
  dispositifs, Avenir montagnes, cités éducatives, cités de l'emploi,
  Fabriques prospectives, habitat inclusif, un neuvième (`ami`) ;
- **des contrats et des territoires** — Territoire d'industrie, contrat pour
  la réussite de la transition écologique (CRTE) ;
- **des zonages** — zone de montagne, zonage ABC, quartiers prioritaires de
  la politique de la ville, zone tendue de la taxe sur les logements
  vacants.

La page de commune les nomme ; celle de l'intercommunalité et du département
les compte (`ZonagesGroupe`). Aucune ne dit ce qu'ils sont. Le site a déjà,
ailleurs, de quoi les expliquer : les processus (`contenu/processus/`), le
glossaire, la page de l'argent public (`/argent-public`, le budget de l'État
par programme budgétaire).

## Ce que serait une page

`/programme/<id>` — par exemple `/programme/villages-d-avenir` — et
`/zonage/<id>`, sur un seul modèle :

1. **Ce que c'est**, en une phrase, d'après le texte qui le crée (circulaire,
   décret, loi), lié.
2. **Qui décide** : qui choisit les communes (le préfet, l'ANCT, un arrêté
   ministériel), qui pilote, qui paie — des nœuds du réseau quand ils
   existent (préfet, ANCT, intercommunalité).
3. **Ce que ça apporte à une commune** : ingénierie, crédits fléchés,
   avantage fiscal, règle d'urbanisme — ce que dit le texte, pas ce qu'en dit
   la communication du programme.
4. **Ce que ça coûte**, quand une source publique le chiffre : l'enveloppe
   annoncée, le programme budgétaire de l'État qui la porte et le lien vers
   sa page sur `/argent-public`. Sinon, la page dit qu'aucun chiffre public
   ne le donne.
5. **L'index inversé** : la liste des communes concernées, par département,
   chacune vers sa page, avec la date de la liste.
6. **Quelques chiffres descriptifs**, calculés sur les données que le site a
   déjà : nombre de communes, population couverte, répartition par
   département, taille des communes (médiane). Recoupés comme le reste.

La page de commune, celle de l'intercommunalité et celle du département
renvoient à ces pages depuis le nom du programme ou du zonage.

## Le retour sur investissement : la limite

Le demander est légitime : c'est la question qu'un habitant se pose. Mais le
site ne peut pas y répondre lui-même sans enfreindre ses deux règles :

- **un chiffre non vérifié** : un retour sur investissement suppose un
  contrefactuel — ce que la commune serait devenue sans le programme —, que
  ni les données du site ni personne ne mesurent de façon simple. Comparer
  « avant / après », ou « dedans / dehors », ne l'isole pas : les communes
  sont choisies justement parce qu'elles diffèrent des autres ;
- **une opinion** : un indicateur calculé et présenté comme le rendement d'un
  programme est un jugement sur une politique publique. Le site n'en a pas.

Ce qui tient :

- **citer les évaluations publiées** — Cour des comptes, inspections
  générales, rapports d'évaluation de l'ANCT, travaux parlementaires —, avec
  leur conclusion telle qu'elle est écrite, leur date, et le lien ;
- **montrer, sans conclure, quelques séries** que le site a déjà pour les
  communes du programme — population, logements autorisés, commerces de la
  base des équipements — avec la phrase qui dit qu'elles ne mesurent pas
  l'effet du programme. À décider : les montrer, ou s'en tenir aux
  évaluations.

## Le premier lot proposé

Les trois programmes de commune, parce qu'ils ont chacun leur liste, leur
texte et leurs évaluations : **Petites villes de demain**, **Action cœur de
ville**, **Villages d'avenir**. Puis la **zone de montagne** et le **zonage
ABC**, dont les effets sont écrits dans la loi. Les petits programmes du
tableau de croisement viendraient après, s'ils ont une source qui les décrit.

## Ce que le mainteneur doit trancher

1. **Le principe** : une page par programme et par zonage, sur ce modèle ?
2. **Le retour sur investissement** : seulement les évaluations publiées, ou
   aussi des séries descriptives avant / après, avec leur avertissement ?
3. **Le premier lot** : les trois programmes de commune, puis montagne et
   ABC ?
4. **L'adresse** : `/programme/…` et `/zonage/…`, ou une seule famille
   `/dispositif/…` ?
