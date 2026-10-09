# Better Than GrokBot website

A static, responsive one-page site at https://betterthangrokbot.com, hosted on Railway. Hostinger manages the domain's DNS. The workspace demo is illustrative; the free download contains source, license and setup instructions. Provider usage costs are separate.

## Package and preview

```sh
npm run site:package
python3 -m http.server 4321 --bind 127.0.0.1 --directory dist-desktop/website/public_html
```

The script creates a website ZIP, `public_html/download/Better-Than-GrokBot-source.zip`, and the container deployment directory `dist-desktop/website/railway`. It copies only the site's explicit public file list and Git-visible source, respecting `.gitignore`. Local environment files, state, dependencies and build output are excluded; only `.env.example` is allowed.

## Railway deployment

Project: `better-than-grokbot` (`5a39b724-26c6-4f23-a2cf-b2109b03bb23`). Production service: `website` (`aa7a1e82-7327-45e8-a885-ead55fac9148`).

```sh
npm run site:package
railway up dist-desktop/website/railway --path-as-root \
  --project 5a39b724-26c6-4f23-a2cf-b2109b03bb23 \
  --environment production --service aa7a1e82-7327-45e8-a885-ead55fac9148
```

Nginx listens on port 8080, exposes `/health`, and redirects www to the canonical HTTPS domain. The Railway fallback is https://website-production-9833.up.railway.app.

Hostinger DNS uses ALIAS `@` → `y4bpeudl.up.railway.app` and CNAME `www` → `5afrbx3c.up.railway.app`, both TTL 300. Railway ownership TXT records are also configured. No Hostinger hosting purchase was made.

The initial published source archive was packaged from the newer merged Mac checkout, preserving its instance and profile features. For future publishes, package from that current checkout rather than an older branch.

Verify HTTPS, www redirect, narrow-screen layout, source ZIP integrity, license, FAQ and install-copy button after deployment. A native prebuilt ZIP is not advertised: build a fresh portable app on Apple silicon after merging the rename into the latest checkout.

## Product screenshots and comparison copy

The three files in `site/screenshots/` are direct browser captures of the running local app on October 9, 2026. They show the role editor, OpenRouter model selector, and task thinking/computer controls. Captures are cropped to controls; account details, private conversations and credential values are excluded. Agent settings were not changed to create these screenshots.

Comparison copy was checked against https://x.ai/pricing and the public Bot documentation at https://docs.x.ai/grok-bot/overview and https://docs.x.ai/grok-bot/bots. Grok Bot supports teams, bot descriptions and collaboration. The page distinguishes those from editable runtime source and avoids unsupported reliability, speed, universal savings or personal-use-only claims. Recheck pricing and product capabilities before refreshing the comparison date.
