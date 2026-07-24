# WODFLOW · Competition Planner

Application Angular pour créer les horaires de compétitions CrossFit. L’interface utilise un nom d’utilisateur et un mot de passe; Firebase Authentication reçoit un identifiant courriel interne afin de conserver le fournisseur email/password. Chaque utilisateur retrouve ses compétitions dans sa propre branche de Firebase Realtime Database.

## Développement local

```bash
npm install
npm start
```

Puis ouvrir `http://localhost:4200/`.

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
