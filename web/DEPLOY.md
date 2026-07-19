# Déploiement en ligne (hébergé)

Le jeu est déployé et jouable ici :

## 🔗 https://ember-dragon-604.higgsfield.gg/

- Hébergement : plateforme de jeux Higgsfield (mode `rules`, multijoueur géré côté serveur).
- Artefacts déployés : `web/logic.js` (règles, source de vérité) + `web/index.html` (page).
- `game_id` (pour mettre à jour en gardant la même URL) : `d96e42d4-dc8c-4373-a82c-22210d27b311`
- Archive source du déploiement : `smuggler-game.zip` (logic.js + index.html à la racine).

## Comment jouer (téléphone)
1. **Une personne** ouvre le lien, entre son pseudo → elle arrive dans un salon
   (un code est ajouté à l'URL, ex. `?room=ABCDE`).
2. Cette personne appuie sur **Copier** et envoie **son** lien aux amis.
3. Les amis ouvrent ce lien → ils rejoignent le même salon.
4. À 3 joueurs minimum, l'hôte appuie sur **Lancer la partie**.

> Important : il faut partager le lien **avec le code** (depuis le salon),
> pas l'URL nue — sinon chacun crée un salon différent.

## Mettre à jour le jeu (même URL)
Re-zipper `logic.js` + `index.html` à la racine, le rendre accessible en https,
puis `deploy_game` avec le même `game_id`.

## Historique
- **v2** — ajout des tours de table réglables par l'hôte, des objets de plus
  en plus rares en fin de partie (tableau volé, lingots d'or), et des 6
  jokers (Hamoud Boualem, Double point, L'œil d'El Hajj, José, Voleur pro
  max, Sangsue). Testé avec une suite de 38 assertions fonctionnelles sur
  `logic.js` avant déploiement.
