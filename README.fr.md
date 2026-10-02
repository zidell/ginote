[![CI](https://github.com/zidell/ginote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zidell/ginote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/zidell/ginote/branch/main/graph/badge.svg)](https://codecov.io/gh/zidell/ginote)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | **Français** | [Italiano](README.it.md) | [Español](README.es.md)

# Ginote

## Présentation

Ginote est une application web simple et sûre qui permet d'utiliser les Issues GitHub
comme des notes personnelles. J'aime les Issues GitHub, mais leur lenteur et leur UX peu
pratique m'ont toujours frustré. J'ai donc créé une SPA qui reprend quasiment toutes
leurs fonctionnalités tout en offrant l'expérience d'une application de prise de notes.
L'application est composée uniquement de JS statique et le navigateur communique
directement avec l'API GitHub, ce qui la rend sûre.

Application en ligne (utilisable librement par tous) : [https://note.gitools.net](https://note.gitools.net)

## Aperçu

![Aperçu de Ginote](docs/preview.gif)

La procédure pour régénérer le GIF d'aperçu est décrite dans [docs/screencasting.md](docs/screencasting.md).

## Fonctionnalités

- **Stockage direct dans un dépôt privé :** les Issues d'un dépôt privé servent de notes,
  sans serveur applicatif ni base de données dédiés.
- **Connexion directe depuis le navigateur :** le navigateur appelle directement l'API
  GitHub. Aucun serveur intermédiaire géré par l'opérateur de l'application ne reçoit ni
  ne conserve vos notes ou votre PAT.
- **Tags, recherche et corbeille :** les labels GitHub servent de tags (chaque tag peut
  recevoir une description), avec une recherche dans le contenu et une corbeille basée
  sur les Issues fermées. Les notes consultées souvent peuvent être épinglées en haut.
- **Commentaires :** les commentaires d'Issue servent d'entrées de suivi sur une note.
  Vous pouvez aussi y joindre des fichiers ou les dicter à la voix.
- **Pièces jointes (fichiers et images) :** les pièces jointes des notes et des
  commentaires sont stockées dans le même dépôt et consultables à la fois dans
  l'application et sur GitHub. Voir [le stockage des pièces jointes](docs/ATTACHMENTS.md)
  pour plus de détails.
- **Enregistrement vocal, transcription et mise en forme (OpenAI uniquement) :** l'audio
  enregistré dans le navigateur est transcrit directement par OpenAI, et la transcription
  peut être retravaillée en un texte écrit naturel. Cette étape peut aussi proposer un
  titre et des tags existants, et l'audio d'origine peut être conservé en pièce jointe si
  besoin. Les fonctions vocales ne prennent en charge que l'API OpenAI pour le moment.
- **Verrouillage des notes (chiffrement supplémentaire) :** si un dépôt privé ne suffit
  pas, verrouillez une note avec un code à 6 chiffres pour chiffrer une seconde fois son
  contenu et ses commentaires dans le navigateur avec AES-GCM. Voir
  [le fonctionnement du chiffrement](docs/ENCRYPTION.md) pour plus de détails.
- **Outils d'édition :** fusionner plusieurs notes en une seule, rechercher et remplacer
  dans le contenu (expressions régulières prises en charge) et afficher le rendu dans la
  visionneuse Markdown.
- **Plusieurs dépôts :** enregistrez plusieurs dépôts et passez de l'un à l'autre depuis
  la liste ou avec les touches numériques.
- **Contrôle au clavier :** parcourir, ouvrir et sélectionner les notes, créer une note ou
  changer de dépôt, le tout au clavier.
- **Intégration MCP :** en connectant le serveur MCP officiel de GitHub, vos outils d'IA
  peuvent lire et écrire les mêmes notes (Issues). Aucun serveur MCP spécifique à
  l'application n'est nécessaire.
- **Web et bureau :** disponible en PWA installable et en applications macOS, Windows et
  Linux basées sur Tauri. Pour l'empaquetage et les versions de l'application de bureau,
  consultez la [documentation de l'application de bureau](docs/DESKTOP.md).

## Utilisation

### Où vont mes données ?

**Ginote est une application web statique distribuée sous forme de fichiers.** Le
serveur d'hébergement ne fait que livrer les fichiers de l'application (HTML, CSS,
JavaScript…). Il n'existe aucun backend applicatif pour la connexion ou le stockage des
notes : une fois l'application ouverte, tous les échanges de données se font
directement entre votre navigateur et l'API GitHub.

```text
Votre navigateur  ←──── connexion directe ────→  GitHub
     │
     └─ PAT, réglages et brouillons non enregistrés restent uniquement dans ce navigateur
```

- Les notes, tags et pièces jointes sont stockés uniquement dans le dépôt GitHub que vous
  indiquez.
- Votre PAT et les réglages de l'application sont conservés uniquement dans votre
  navigateur et ne sont envoyés à l'API GitHub que pour l'authentification.
- Les brouillons non enregistrés restent uniquement dans ce navigateur.
- Le chiffrement optionnel des notes est décrit dans
  [le fonctionnement du chiffrement](docs/ENCRYPTION.md).
- Aucune API n'envoie les notes, le PAT ou les réglages à l'opérateur de l'application,
  et aucun service d'analyse ou de suivi n'est utilisé.

En bref, en dehors des requêtes de téléchargement des fichiers de l'application, aucune
de vos données n'est envoyée à l'opérateur de l'application ni à un autre serveur que
GitHub. Vos notes n'existent réellement **que dans votre propre navigateur et dans le
dépôt GitHub que vous avez choisi**.

### Utiliser l'enregistrement vocal

Avant la première utilisation de l'enregistrement vocal, il vous faut une clé API
OpenAI. Créez une clé API sur OpenAI, puis saisissez-la dans Ginote sous
**Réglages → Enregistrement vocal → Clé API OpenAI**. OpenAI peut vous facturer selon
votre consommation de l'API.

Une fois configuré, lancez un enregistrement avec le bouton micro de la barre latérale ou
de la vue d'une note. À la fin de l'enregistrement, l'audio est transcrit, puis le modèle
de mise en forme et les règles de mise en forme (facultatifs) sont appliqués pour
proposer un contenu, un titre et des tags existants. Dans les réglages, vous pouvez
changer le modèle de transcription, le modèle de mise en forme et le vocabulaire
fréquent pour la transcription ; laissez le modèle de mise en forme vide pour
n'enregistrer que la transcription brute. Activez **Conserver l'audio d'origine** pour
enregistrer aussi l'audio des enregistrements réussis en pièce jointe de la note.

Les fichiers audio et les transcriptions sont envoyés directement du navigateur à l'API
OpenAI, sans passer par un serveur de l'application. La clé API est stockée en clair
dans le `localStorage` du navigateur de cet appareil : utilisez-la uniquement sur des
appareils personnels. Nous recommandons une clé de projet dédiée, des limites
d'utilisation et une rotation régulière.

### Raccourcis clavier

Les raccourcis suivants sont disponibles dans la liste des notes. Ils sont désactivés
pendant la saisie dans un champ. `Ctrl/Cmd + R` est le raccourci de rechargement du
navigateur et recharge donc l'application de n'importe où.

| Touche | Action |
| --- | --- |
| `↑` / `↓` | Se déplacer dans la liste des notes |
| `Enter` | Ouvrir la note courante · appuyer à nouveau pour éditer |
| `N` | Créer une note |
| `` ` `` | Ouvrir le sélecteur de dépôt |
| `1`–`9` | Changer de dépôt dans l'ordre d'enregistrement |
| `Esc` | Désélectionner · annuler la suppression · fermer l'aide |
| `Space` | Sélectionner la note courante |
| `Shift` + `↑` / `↓` | Sélectionner une plage de notes |
| `Delete` / `Backspace` | Mettre les notes sélectionnées à la corbeille |
| `Ctrl/Cmd + R` | Recharger l'application |

Lorsqu'une note est ouverte et qu'aucun champ de saisie n'a le focus, ces raccourcis sont
également disponibles.

| Touche | Action |
| --- | --- |
| `T` | Ajouter un tag |
| `A` | Joindre un fichier |
| `P` | Épingler en haut / désépingler |
| `L` | Verrouiller · déverrouiller |
| `Delete` | Mettre la note à la corbeille |
| `G` | Voir l'Issue GitHub |
| `M` | Ouvrir · fermer la visionneuse MD |
| `R` | Recharger toute l'application |
| `S` | Enregistrer la note courante |

### PWA (application web installable)

Les builds de production fonctionnent comme une PWA que vous pouvez installer depuis le
navigateur et utiliser comme une application. Ouvrez l'application en ligne dans votre
navigateur et utilisez son menu d'installation. Le manifeste et le service worker ne
dépendent d'aucun domaine ni hébergeur particulier et fonctionnent par rapport au chemin
où l'application est déployée. Le service worker (fonction qui permet au navigateur de
conserver temporairement les fichiers de l'application) ne met en cache que les fichiers
de même origine que l'application, jamais les requêtes à l'API GitHub, le PAT ni les
données des notes.

### Télécharger l'application de bureau

Les installateurs pour macOS, Windows et Linux sont disponibles sur
[GitHub Releases](https://github.com/zidell/ginote/releases). macOS utilise un DMG et
Windows 10/11 un MSI. Les nouvelles versions Windows seront publiées sous forme de MSI
signés une fois la signature SignPath Foundation configurée. L'application de bureau
ouvre [note.gitools.net](https://note.gitools.net) et nécessite une connexion Internet.
Les modifications de l'interface et des fonctionnalités générales sont livrées via les
déploiements web.

[Code signing policy](docs/CODE_SIGNING.md)

L'installation via Homebrew sur macOS, l'exécution en local, l'empaquetage par
plateforme et la procédure de publication sont décrits dans la
[documentation de l'application de bureau](docs/DESKTOP.md).

## Exploitation et développement

Pour modifier l'application web, installez les dépendances à partir du fichier de
verrouillage et assurez-vous que les vérifications statiques, les tests et le build de
production passent tous avant de déployer. L'application est déployée sous forme de
fichiers statiques, et l'empaquetage et la signature de l'application de bureau sont
gérés séparément du déploiement web. Toute modification touchant au format des données
ou à la sécurité doit d'abord être confrontée aux documents sur les pièces jointes et le
chiffrement. L'environnement de développement, les commandes de vérification et les
procédures de déploiement et de maintenance sont décrits dans la
[documentation de développement et d'exploitation](docs/DEVELOPMENT.md).

## Demandes de fonctionnalités

Si vous souhaitez une fonctionnalité, forkez le projet et modifiez-le vous-même. Il
répond déjà largement à mes besoins, je n'accepte donc pas de propositions de
fonctionnalités.

## Licence

[MIT License](LICENSE)
