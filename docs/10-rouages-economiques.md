# 10 — Les rouages économiques : cadrage

> Statut : proposition du 18 octobre 2026, à valider. Rien n'est écrit dans
> `contenu/` avant l'accord du mainteneur.

`02-familles.md` décrit la famille C — « qui fait quoi dans une organisation »
— et la dit **la moins sourçable**. Ce document dit comment la peupler sans
renoncer aux deux règles qui ne se négocient pas : aucune personne nommée,
aucun chiffre non vérifié.

## Ce que le site sait déjà de l'économie

Beaucoup, mais en **données**, pas en **graphe** :

- les entreprises d'une commune (SIRENE, BODACC), les effectifs salariés par
  secteur (Urssaf), ce qu'on trouve sur place (base des équipements) ;
- l'argent public qui va aux entreprises : marchés publics (données
  essentielles), aides de la PAC, fonds européens, subventions ;
- les représentants d'intérêts (HATVP), l'agriculture, l'emploi du recensement.

Le graphe, lui, n'a que quelques nœuds économiques : les employeurs, le
délégataire de l'eau, le bailleur social, l'exploitant des transports, Enedis,
trois professions (notaire, commissaire de justice, géomètre-expert), le flux
des cotisations, le versement mobilité. Le schéma est prêt : un acteur peut
déjà être `entreprise` ou `metier`, un processus peut déjà être de la famille
`economiques`. **Aucun processus économique n'existe encore.**

La famille C, c'est donc le graphe qui explique ce que les données montrent :
pourquoi la commune a tant d'établissements dans tel secteur, ce que fait une
entreprise qui remporte un marché, où va le prix d'une baguette.

## Ce qui peut mal tourner

- **Le chiffre sans source.** « Qui gagne quoi sur une baguette » circule
  partout avec des chiffres d'origine inconnue. Le site ne publie qu'une
  décomposition officielle, avec son année ; sinon il se tait.
- **L'exemple qui devient une publicité, ou une accusation.** Nommer une
  enseigne pour illustrer une marge, c'est faire sa publicité ou la mettre en
  cause. Le graphe décrit des archétypes — « une boulangerie artisanale »,
  « une PME de vingt salariés » —, jamais une entreprise.
- **La généralité fausse.** L'organisation d'une entreprise varie bien plus
  que la répartition des compétences entre collectivités. Une fiche qui
  prétend dire « comment fonctionne une PME » se trompe pour la plupart.
- **Le conseil.** Un circuit de facturation ou un délai de paiement mal dit
  engage une entreprise qui s'y fie. Même règle que la section 2 de
  `07-risques.md` : renvoyer au texte et à l'interlocuteur, ne jamais
  conseiller.
- **L'opinion.** Les marges, la grande distribution, les intermédiaires sont
  des sujets de controverse. Le site montre la décomposition que publie la
  source, sans qualificatif — ni « excessive », ni « juste ».

## Les sources qui tiennent

Trois sources publiques, officielles et mises à jour, suffisent à un premier
lot. Chacune est à relire au moment d'écrire la fiche qui s'en sert.

| Source | Ce qu'elle permet | Producteur |
|---|---|---|
| **ROME 4.0**, répertoire opérationnel des métiers et des emplois | les métiers : ce qu'ils font, leurs compétences, leurs contextes — de quoi décrire « qui fait quoi » sans inventer ; 14 301 appellations, mis à jour au moins deux fois par an, en données ouvertes sur data.gouv.fr | France Travail |
| **Rapport annuel de l'Observatoire de la formation des prix et des marges** | la décomposition du prix au détail — matière première agricole, valeur ajoutée de la transformation, de la distribution — pour des produits suivis chaque année : la baguette (filière blé tendre, farine, pain), le lait de consommation, le yaourt, l'emmental… ; quinzième rapport au Parlement en 2026, marges brutes à N-1, nettes à N-2 | FranceAgriMer |
| **Les textes**, sur Légifrance | les règles qui organisent les circuits : délais de paiement, mentions d'une facture, commande publique, facturation électronique | État |

Deux autres sont à étudier avant de s'en servir : les tableaux
entrées-sorties de la comptabilité nationale (ce que chaque branche achète
aux autres), pour dessiner une filière sans archétype ; et la nomenclature
des activités (NAF), pour relier un nœud aux effectifs par secteur déjà
affichés sur la page de commune.

## Comment ça entre dans le modèle

Sans entité nouvelle :

- **un métier** est un acteur `metier`, comme le notaire aujourd'hui, avec son
  lien vers la fiche ROME (et MétierScope) ;
- **une organisation type** — la boulangerie artisanale, la PME, le
  supermarché — est un acteur `entreprise` décrit comme un archétype ;
- **un circuit** — de la commande à la facture, du blé à la baguette — est un
  processus de la famille `economiques`, avec ses étapes, ses délais
  (`maximum_legal` quand un texte les fixe) et ses leviers ;
- **ce qui circule** — l'argent, la facture, la commande — est un flux, et la
  part de chacun dans un prix porte sa source et son année.

Trois règles de validation à ajouter, pour que les risques ci-dessus tiennent
d'eux-mêmes :

1. **Pas d'entreprise nommée** dans un nœud économique, sauf celles que la loi
   désigne pour une mission (Enedis, gestionnaire du réseau de distribution) —
   le pendant de la règle « pas de personnes » de la famille influence.
2. **Tout chiffre d'un nœud économique** cite une source statistique avec son
   millésime ; la validation refuse un pourcentage ou un montant sans eux.
3. **Une nouvelle valeur de confiance**, `variable_selon_organisation`, pour
   dire qu'une description d'organisation est un cas type — comme
   `variable_selon_territoire` le dit d'une compétence.

## Un premier lot, et le critère pour continuer

Trois processus, choisis parce qu'ils ont chacun une source qui tient et
qu'ils se raccrochent à ce que le site montre déjà :

1. **Comment une commune achète** — le marché public vu du côté de
   l'entreprise : l'avis, la candidature, l'attribution, l'exécution, le
   paiement. Le pont entre les familles A et C, et l'explication des marchés
   affichés sur chaque page de commune. Source : le code de la commande
   publique.
2. **De la commande à la facture** — le circuit dans une petite entreprise :
   le devis, le bon de commande, la livraison, la facture et ses mentions, le
   délai de paiement, le recouvrement. D'actualité : la réception des
   factures électroniques est obligatoire pour toutes les entreprises depuis
   le 1er septembre 2026, leur émission le sera pour les PME au 1er septembre
   2027 — calendrier à vérifier sur la page de l'administration fiscale avant
   d'écrire la fiche. Sources : le code de commerce, le code général des
   impôts.
3. **Du blé à la baguette** — la filière, maillon par maillon, et la
   décomposition du prix telle que l'Observatoire la publie, avec son année.
   Source : le rapport de l'Observatoire.

**Le critère pour continuer** : chaque nœud du lot a une source officielle
pour chacune de ses affirmations, aucun ne nomme une entreprise, et un
lecteur qui ne connaît pas le sujet comprend le circuit en une page. Si un
nœud ne trouve pas sa source, il n'est pas publié — on le note ici plutôt
que de l'écrire de mémoire.

## Ce qu'on ne fait pas

- Pas de classement d'entreprises, ni de « bonnes » ou « mauvaises »
  pratiques.
- Pas de salaires par métier tant qu'une source officielle par métier n'est
  pas retenue : un salaire « moyen » sans source est exactement le chiffre que
  la règle refuse.
- Pas d'organigramme d'une entreprise réelle.
