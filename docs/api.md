# API backend recommandee

Base URL : `/api`

## Auth

`POST /auth/register`

```json
{
  "businessName": "Maison Cafe",
  "email": "owner@maisoncafe.com",
  "password": "secret"
}
```

`POST /auth/login`

## Programmes

`POST /programs`

```json
{
  "merchantId": "mer_123",
  "name": "Club Cafe",
  "rewardRule": "10 tampons = 1 cafe offert",
  "target": 10,
  "stampValue": 1,
  "brandColor": "#126149",
  "accentColor": "#f2c14e"
}
```

`GET /programs/:programId`

`PATCH /programs/:programId`

## Clients

`POST /programs/:programId/customers`

```json
{
  "name": "Sarah Cohen",
  "phone": "+972500000000",
  "email": "sarah@email.com"
}
```

Retour :

```json
{
  "customerId": "cus_123",
  "memberId": "MEMBER-0001",
  "appleWalletUrl": "/api/passes/apple/pass_123.pkpass",
  "googleWalletUrl": "https://pay.google.com/gp/v/save/..."
}
```

## Wallet

`GET /passes/apple/:passId.pkpass`

Genere et retourne un fichier Apple Wallet signe.

`GET /passes/google/:passId`

Retourne ou redirige vers un lien Google Wallet signe.

`POST /passes/:passId/refresh`

Force la regeneration du contenu Wallet.

## Scan boutique

`POST /passes/:memberId/scan`

```json
{
  "merchantId": "mer_123",
  "points": 1,
  "source": "pos"
}
```

Retour :

```json
{
  "memberId": "MEMBER-0001",
  "points": 5,
  "target": 10,
  "rewardAvailable": false
}
```

## Recompenses

`POST /passes/:memberId/redeem`

```json
{
  "merchantId": "mer_123",
  "rewardId": "rew_123"
}
```

## Webhooks

`POST /webhooks/apple/passkit`

Reception des enregistrements Apple Wallet si tu actives le PassKit web service.

`POST /webhooks/google-wallet`

Callbacks Google Wallet si actives dans la console.
