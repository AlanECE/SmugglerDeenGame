# 🕵️ Douane & Contrebande

Party game multijoueur de bluff et de corruption, jouable au navigateur.
Un joueur est le **douanier**, les autres des **contrebandiers** qui tentent de
faire passer leur cargaison (vraie ou bidon) avec un éventuel pot-de-vin.

**Boucle :** préparer sa cargaison → bluffer → soudoyer → fouiller ou laisser passer → encaisser → rejouer.

## Stack
- **Front :** HTML / CSS / JS vanilla (aucun framework)
- **Temps réel :** Socket.IO
- **Serveur :** Node.js + Express (état de jeu autoritaire, anti-triche)
- État en mémoire (suffisant pour des parties entre amis)

## Lancer en local
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
