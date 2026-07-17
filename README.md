# Kiarina Apps

Static web apps published directly from the repository root with GitHub Pages.

## Routes

- `/` — app index
- `/<app-name>/` — each static app

The production URL is:

```text
https://kiarina.github.io/apps/
```

Each app lives in its own directory and must work under the `/apps/<app-name>/`
base path. Prefer relative URLs for assets and navigation.

## Development

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. No shared build step or package installation is
required. If an app needs a build step, commit its generated static files to its
app directory.

GitHub Pages uses `main` and `/(root)` as its publishing source.
