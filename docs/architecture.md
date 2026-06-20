# Architecture complete

## Parcours client

1. Le client scanne un QR code en boutique.
2. Il arrive sur une page d'inscription.
3. Il entre nom, telephone et email.
4. Le backend cree une carte fidelite.
5. Le client clique sur Apple Wallet ou Google Wallet.
6. La carte est ajoutee au telephone.
7. En boutique, le commercant scanne le QR code affiche sur la carte.
8. Le backend ajoute des points.
9. Le Wallet se met a jour.

## Parcours commercant

1. Creation de compte.
2. Creation du programme de fidelite.
3. Choix du logo, couleurs, recompense, objectif.
4. Impression du QR code d'inscription.
5. Scan des cartes clients au comptoir.
6. Suivi clients, points, recompenses et campagnes.

## Modules techniques

- `merchant-admin` : dashboard commercant
- `customer-signup` : inscription client
- `wallet-service` : Apple pkpass + Google JWT
- `loyalty-engine` : calcul points, tampons, recompenses
- `scanner` : lecture QR/barcode
- `campaigns` : offres et notifications
- `billing` : abonnements Stripe

## Donnees principales

- Merchant : commerce
- Program : programme de fidelite
- Customer : client final
- Pass : carte Wallet
- Transaction : ajout/retrait points
- Reward : recompense acquise/utilisee

## MVP vendable

Le MVP doit rester simple :

- QR code plutot que NFC
- ajout manuel de points par scan
- un programme par commerce
- carte Wallet avec solde visible
- export client pour le commerçant

Le NFC peut venir plus tard avec Apple VAS / Google Smart Tap, mais ce n'est pas necessaire pour vendre aux petits commerces.
