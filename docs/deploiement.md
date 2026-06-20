# Deploiement production

## 1. Preparer le serveur

Sur un VPS Ubuntu :

```bash
apt update
apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
```

## 2. Configurer l'app

Copier `.env.example` vers `.env` :

```bash
cp .env.example .env
```

Modifier :

- `BASE_URL=https://wallet.ton-domaine.com`
- variables Apple Wallet
- variables Google Wallet

## 3. Lancer

```bash
docker compose up -d --build
```

Verifier :

```bash
curl http://127.0.0.1:4173/api/health
```

## 4. Nginx reverse proxy

Exemple :

```nginx
server {
  server_name wallet.ton-domaine.com;

  location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Puis :

```bash
certbot --nginx -d wallet.ton-domaine.com
```

## 5. Avant de vendre

- changer le mot de passe demo dans `data/db.json`
- brancher Stripe ou facturation manuelle
- ajouter tes certificats Apple dans `secure/apple`
- ajouter le service account Google dans `secure/google`
- tester Apple Wallet sur iPhone
- tester Google Wallet sur Android
- imprimer un QR d'inscription pour une boutique pilote

## Limite importante

Apple Wallet et Google Wallet ne peuvent pas etre emis en vrai sans comptes officiels :

- Apple Developer Program + certificat Wallet
- Google Wallet issuer valide + service account

L'app est prete pour ces secrets, mais ils doivent etre crees sur tes comptes.

## Option rapide : Render

Le fichier `render.yaml` est inclus.

Workflow :

1. Pousser ce dossier dans un repo GitHub.
2. Dans Render, creer un Blueprint depuis le repo.
3. Render detecte `render.yaml`.
4. Configurer `BASE_URL` avec l'URL publique Render ou ton domaine.
5. Ajouter les secrets Apple/Google quand ils sont disponibles.

Sans secrets Apple/Google, le site se deploie quand meme et reste utilisable pour demos, inscriptions, dashboard, scans et gestion commerces.
