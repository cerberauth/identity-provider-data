# identity-provider-data

Structured data about identity providers: IAM / CIAM capabilities and OpenID
Connect protocol support.

## Layout

- `providers/<id>.json` — one file per provider. Shared metadata (name, abstract,
  website, license, nationality, icon, pricing) plus:
  - `features` — the IAM / CIAM feature list.
  - `oidc.features` — the OpenID Connect feature list, kept in its own category.
- `definitions/`
  - `iam-categories.json`, `oidc-categories.json` — ordered category definitions
    (`identifier` + `translationKey`).
  - `iam-features.json`, `oidc-features.json` — the feature catalogs (identifier,
    category, tier, status, canonical English name/description, spec links).
  - `statuses.json` — allowed feature support statuses.
  - `tiers.json` — allowed feature tiers.
- `i18n/<locale>.json` — translations for category and feature names /
  descriptions, split into `iam` and `oidc`. English is the canonical fallback
  and mirrors the catalogs; other locales only carry overrides.
