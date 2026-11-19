# Land Scout

**https://aishwaryawambule.github.io/landscout/**

Find residential land for sale in Kathmandu, Lalitpur and Bhaktapur, starting from your budget.

This repository publishes the website. Every 3 hours a GitHub Actions job collects new listings, checks prices and map data, rebuilds the site, and updates the [feed of new plots](https://aishwaryawambule.github.io/landscout/feed.xml).

**Found a sold or wrong listing?** [Report it here](../../issues/new/choose).

## Settings

All settings are optional. Add them under **Settings → Secrets and variables → Actions**.

| Name | Kind | What it does |
|---|---|---|
| `CONTACT_EMAIL` | Variable | Email address shown on the About page |
| `TELEGRAM_CHANNEL` | Variable | Public channel that new plots are posted to, e.g. `@landscoutnepal` |
| `TELEGRAM_BOT_TOKEN` | Secret | Token of the bot that posts to the channel. The bot must be an admin of the channel |
| `CODE_DEPLOY_KEY` | Secret | Read-only key to the private app code (already set) |
