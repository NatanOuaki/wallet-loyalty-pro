# Integration Apple Wallet et Google Wallet

## Apple Wallet

Apple Wallet utilise des fichiers `.pkpass`. En production, le backend doit :

1. Avoir un compte Apple Developer.
2. Creer un Pass Type ID.
3. Generer et installer le certificat Wallet.
4. Construire un dossier de pass avec `pass.json`, `icon.png`, `logo.png`, etc.
5. Creer un `manifest.json` avec les hash des fichiers.
6. Signer le manifest avec le certificat Apple.
7. Zipper le tout en `.pkpass`.
8. Servir le fichier avec le MIME type `application/vnd.apple.pkpass`.

Champs utiles pour une carte fidelite :

```json
{
  "formatVersion": 1,
  "passTypeIdentifier": "pass.com.tonapp.loyalty",
  "serialNumber": "MEMBER-0001",
  "teamIdentifier": "APPLE_TEAM_ID",
  "organizationName": "Maison Cafe",
  "description": "Carte fidelite Maison Cafe",
  "logoText": "Maison Cafe",
  "foregroundColor": "rgb(255, 255, 255)",
  "backgroundColor": "rgb(18, 97, 73)",
  "barcode": {
    "message": "MEMBER-0001",
    "format": "PKBarcodeFormatQR",
    "messageEncoding": "iso-8859-1"
  },
  "storeCard": {
    "primaryFields": [
      {
        "key": "points",
        "label": "Tampons",
        "value": "4 / 10"
      }
    ],
    "secondaryFields": [
      {
        "key": "reward",
        "label": "Recompense",
        "value": "10 tampons = 1 cafe offert"
      }
    ]
  }
}
```

Pour les mises a jour, ajouter dans le pass :

- `webServiceURL`
- `authenticationToken`

Puis implementer les endpoints PassKit pour enregistrer les appareils, retourner les nouveaux serial numbers et servir la derniere version du pass.

## Google Wallet

Google Wallet utilise une classe et un objet :

- `LoyaltyClass` : modele du programme commerçant
- `LoyaltyObject` : carte individuelle du client

Etapes :

1. Creer un compte issuer Google Wallet.
2. Creer un projet Google Cloud.
3. Creer un service account.
4. Autoriser ce service account dans Google Wallet Business Console.
5. Creer une `LoyaltyClass` par programme.
6. Creer un `LoyaltyObject` par client.
7. Signer un JWT avec la cle du service account.
8. Generer un lien `https://pay.google.com/gp/v/save/{JWT}`.

Payload simplifie :

```json
{
  "iss": "service-account@project.iam.gserviceaccount.com",
  "aud": "google",
  "typ": "savetowallet",
  "origins": ["https://ton-domaine.com"],
  "payload": {
    "loyaltyObjects": [
      {
        "id": "issuerId.MEMBER-0001",
        "classId": "issuerId.maison-cafe-club",
        "state": "ACTIVE",
        "accountId": "MEMBER-0001",
        "accountName": "Sarah Cohen",
        "barcode": {
          "type": "QR_CODE",
          "value": "MEMBER-0001"
        },
        "loyaltyPoints": {
          "label": "Tampons",
          "balance": {
            "int": 4
          }
        }
      }
    ]
  }
}
```

## Mise a jour du solde

Quand le commerçant ajoute des points :

1. Creer une transaction.
2. Recalculer le solde.
3. Mettre a jour l'objet Google Wallet via l'API.
4. Regenerer le `.pkpass` Apple.
5. Envoyer une notification push Apple PassKit aux appareils enregistres.

## Securite

- Ne jamais mettre les certificats Apple ou cles Google dans le frontend.
- Garder les tokens Wallet cote serveur.
- Utiliser des identifiants non devinables pour les URLs privees.
- Ajouter rate limiting aux endpoints de scan.
- Journaliser chaque scan et chaque redemption.
