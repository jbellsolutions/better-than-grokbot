# Better than GrokBot website

A static, responsive one-page site (https://betterthangrokbot.com). The workspace demo is illustrative; the free download contains source, license and setup instructions. Provider usage costs are separate.

## Package and preview

```sh
npm run site:package
python3 -m http.server 4321 --bind 127.0.0.1 --directory dist-desktop/website/public_html
```

The script creates a website ZIP, `public_html/download/Better-Than-GrokBot-source.zip`, and the container deployment directory `dist-desktop/website/railway`. It copies only the site's explicit public file list and Git-visible source, respecting `.gitignore`. Local environment files, state, dependencies and build output are excluded; only `.env.example` is allowed.

## Deploy

The packaged `dist-desktop/website/railway` folder is a small nginx container (`Dockerfile`,
`nginx.conf`, `railway.json`) for any container host. On Railway, with your own project and service:

```sh
npm run site:package
railway up dist-desktop/website/railway --path-as-root \
  --project <your-project-id> --environment production --service <your-service-id>
```

Nginx listens on port 8080, exposes `/health`, and redirects www to the canonical HTTPS domain.
Verify HTTPS, the www redirect, narrow-screen layout, source ZIP integrity, license, FAQ and the
install-copy button after deploying.

## Product screenshots and comparison copy

The three files in `site/screenshots/` are direct browser captures of the running local app. They show the role editor, OpenRouter model selector, and task thinking/computer controls. Captures are cropped to controls; account details, private conversations and credential values are excluded. Agent settings were not changed to create these screenshots.

Comparison copy was checked against https://x.ai/pricing and the public Bot documentation at https://docs.x.ai/grok-bot/overview and https://docs.x.ai/grok-bot/bots. Grok Bot supports teams, bot descriptions and collaboration. The page distinguishes those from editable runtime source and avoids unsupported reliability, speed, universal savings or personal-use-only claims. Recheck pricing and product capabilities before refreshing the comparison date.
