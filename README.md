# 🕵️ Douane & Contrebande

Party game multijoueur de bluff et de corruption, jouable au navigateur.
Un joueur est le **douanier**, les autres des **contrebandiers** qui tentent de
faire passer leur cargaison (vraie ou bidon) avec un éventuel pot-de-vin.

**Boucle :** préparer sa cargaison → bluffer → soudoyer → fouiller ou laisser passer → encaisser → rejouer.

## 🔗 Jouer en ligne
**https://ember-dragon-604.higgsfield.gg/**

## Objets et jokers
- **Contrebande de plus en plus rare** au fil des manches : pâtes/œufs en début
  de partie jusqu'aux diamants, à l'ivoire, aux armes puis, tout en fin de
  partie, au tableau volé et aux lingots d'or — la rareté et les montants
  (gains comme pertes) progressent proportionnellement au nombre de manches
  choisi par l'hôte.
- **Tours de table réglables** : dans le salon, l'hôte choisit combien de fois
  chacun sera douanier (1 à 4) avant de lancer la partie.
- **Jokers** : un objet-joker apparaît aléatoirement dans une main chaque
  manche (~60% de chance). Il faut le **faire passer** en douane pour
  l'obtenir — si le douanier ouvre le coffre pendant qu'il est dedans, c'est
  **lui** qui le confisque et le détient à la place.
  - 🥤 **Hamoud Boualem** — saoule le douanier : ta cargaison passe direct,
    quoi qu'il y ait dedans. Actif pendant la préparation, ou pile quand
    c'est ton tour au contrôle.
  - ✨ **Double point** — double tes gains de la manche si ta cargaison passe.
  - 👁️ **L'œil d'El Hajj** — révèle le classement détaillé (pièces exactes de
    chacun) pour la manche en cours.
  - 🐈 **José** — envoie un chat 100% anonyme miauler « J'suis un con » sur
    l'écran des joueurs de ton choix.
  - 🥷 **Voleur pro max** — pendant la préparation, regarde les mains et
    coffres verrouillés des autres marchands et vole gratuitement un objet,
    direct dans ta valise (même si elle est déjà pleine).
  - 🧛 **Sangsue** — aspire 10 pièces à un joueur au tout début de la manche.
  - Un récap (sauf José, qui reste anonyme) s'affiche avant le premier
    contrôle de chaque manche pour dire ce qui s'est passé.

## Stack
- **Front :** HTML / CSS / JS vanilla (aucun framework)
- **Temps réel :** Socket.IO
- **Serveur :** Node.js + Express (état de jeu autoritaire, anti-triche)
- État en mémoire (suffisant pour des parties entre amis)

## Lancer en local
> ⚠️ **Note** : la version de référence du jeu (avec tours de table, objets de
> fin de partie et jokers) est celle du dossier [`web/`](web), déployée en
> ligne. Les dossiers `server/` et `public/` sont l'**ancienne version locale
> Socket.IO**, sans ces nouveautés.

```bash
npm install
npm start
# ouvre http://localhost:3000
```

## Jouer
1. Saisis un pseudo, **crée un salon** → un code à 5 lettres est généré.
2. Partage le lien (bouton « Copier le lien ») à tes amis.
3. Quand 3 à 6 joueurs sont là, l'hôte lance la partie.
4. Le rôle de douanier tourne à chaque manche.

## Règles d'équilibrage (recommandées)
- Le douanier **laisse passer** → il prend le pot-de-vin.
- Il **ouvre** et le joueur **ment** → confiscation + amende pour le contrebandier.
- Il **ouvre** et le joueur **dit vrai** → pas de pot-de-vin + indemnité au joueur.

Tous les paramètres (manches, argent, valeurs, pénalités, timers…) sont
ajustables dans [`server/config.js`](server/config.js).

## Déploiement (serveur Linux)
```bash
git clone <repo> && cd SmugglerDeenGame
npm install --omit=dev
PORT=3000 node server/index.js
```
Voir [`deploy/`](deploy) pour le service systemd + reverse-proxy.
