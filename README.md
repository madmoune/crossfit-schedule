# WODFLOW · Competition Planner

Application Angular pour créer les horaires de compétitions CrossFit. L’interface utilise un nom d’utilisateur et un mot de passe; Firebase Authentication reçoit un identifiant courriel interne afin de conserver le fournisseur email/password. Chaque utilisateur retrouve ses compétitions dans sa propre branche de Firebase Realtime Database.

## Développement local

```bash
npm install
npm start
```

Puis ouvrir `http://localhost:4200/`.

## Optimisation locale avec le backend

Le bouton **Générer un horaire** demande un nom puis envoie la compétition au backend Java local :
`POST http://localhost:8080/api/schedules/optimize`.

Démarrer les deux projets dans deux terminaux :

```bash
# Terminal backend
cd "/c/Users/linki/OneDrive/Desktop/Crossfit Schedule/crossfit-backend"
./mvnw spring-boot:run

# Terminal frontend
cd "/c/Users/linki/OneDrive/Desktop/Crossfit Schedule/crossfit-schedule"
npm start
```

L’adresse du backend est configurable dans `src/environments/environment.ts`. Chaque résultat nommé est ajouté à la collection d’horaires de la compétition et sauvegardé avec Firebase ainsi que dans le cache local. Les versions peuvent être sélectionnées ou supprimées avec confirmation; elles sont invalidées lorsqu’une équipe, un WOD ou un horaire de configuration est modifié.

Le floor 2 utilise le nombre minimal de vagues, peut mélanger les deux catégories fusionnées et vise une heure de fin aussi proche que possible de celle du floor 1, tout en conservant les 60 minutes de repos obligatoires.

Dans la vue **Par floor**, les équipes d’un horaire généré peuvent être glissées vers une autre vague, échangées ou déposées dans une case libre. La modification est enregistrée immédiatement dans l’horaire actif. Le déplacement est refusé uniquement s’il crée moins de 60 minutes de repos autour d’un WOD du floor 2.

Le bouton **⇩ Excel** télécharge l’horaire actif au format `.xlsx`. Le fichier contient une feuille **Résumé**, puis une feuille par floor. Chaque feuille reprend la vue **Par floor** avec les blocs WOD, les catégories, les waves en colonnes, le nombre de lanes configuré, les cases vides, les bordures et les couleurs Scaled, Master, Inter et RX.

## Firebase

La configuration Web se trouve dans `src/environments/environment.ts`. La base Realtime Database utilisée est :

```text
https://wodflow-4312c-default-rtdb.firebaseio.com
```

Dans la console Firebase :

1. Vérifier que le fournisseur Authentication **Email/Password** est activé.
2. Ajouter `madmoune.github.io` dans les domaines autorisés de l’Authentication.
3. Publier les règles de sécurité présentes dans `database.rules.json` :

```bash
npx firebase-tools login
npx firebase-tools deploy --only database --project wodflow-4312c
```

Les règles autorisent uniquement l’utilisateur authentifié à lire et modifier `users/<uid>/competitions`.

## Mode hors ligne

En production, Angular installe un service worker qui met en cache l’application et ses ressources. Les compétitions sont également conservées localement par utilisateur : les modifications faites sans connexion sont placées dans une file d’attente et synchronisées automatiquement lorsque l’événement `online` est détecté.

## Build et tests

```bash
npm run build
npm test -- --watch=false
```

Le workflow `.github/workflows/deploy-pages.yml` publie l’application sur GitHub Pages à chaque push vers `main`.
