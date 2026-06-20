# Wallet Loyalty Pro

Application SaaS vendable pour proposer des cartes de fidelite digitales aux commercants,
compatibles Apple Wallet et Google Wallet.

## Lancer localement

```bash
npm start
```

Puis ouvrir :

```text
http://127.0.0.1:4173
```

Compte demo :

```text
Super admin : super@wallet.local / admin1234
Commerce demo : admin@demo.local / demo1234
```

## Fonctionnalites incluses

- connexion commerçant avec session cookie
- connexion super admin avec session cookie
- gestion des commerces souscrits
- creation de commerces avec slug public
- design de carte Wallet depuis le super admin
- lien client separe par commerce : `/join/:slug`
- dashboard statistiques
- configuration du programme de fidelite
- creation de clients
- liens Apple Wallet et Google Wallet
- scan boutique manuel
- scan camera via BarcodeDetector quand disponible
- ajout/retrait de points
- utilisation de recompenses
- CRM client avec recherche
- preparation de campagnes marketing
- export JSON
- base persistante JSON
- endpoints API
- Dockerfile et docker-compose
- guide deploiement VPS
- statut de configuration Apple/Google Wallet

## Production Wallet

L'app fonctionne en demo sans secrets.

Pour emettre de vrais Wallet :

- Apple : configurer `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_CERT_P12`, `APPLE_WWDR_CERT`
- Google : configurer `GOOGLE_ISSUER_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`

Sans ces variables, l'app reste operationnelle pour les demos commerciales, mais les passes Apple/Google sont en mode fallback.

## Fichiers importants

- `server.js` : serveur HTTP, API, auth, Wallet adapters
- `index.html` : interface SaaS
- `join.html` : inscription publique client par commerce
- `app.js` : logique front
- `styles.css` : design responsive
- `.env.example` : configuration production
- `Dockerfile` et `docker-compose.yml` : deploiement
- `docs/deploiement.md` : guide VPS
- `docs/offre-commerciale.md` : pitch et pricing

## Prochaines integrations business

- Stripe Billing pour abonnements
- Twilio ou Brevo pour SMS
- SendGrid ou Resend pour email
- vrai multi-tenant avec PostgreSQL
- import CSV clients existants
- webhooks caisse / POS
