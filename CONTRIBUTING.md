# Contributing

Thanks for helping. Bug reports, device reports ("works on my Pi 4 with Ubuntu") and pull requests are all welcome.

## Before you open a pull request

Agent:

```bash
cd agent && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
python -m pytest -q tests && ruff check .
```

App:

```bash
cd app && npm ci
npx tsc --noEmit && npx eslint . && npx jest
```

Guidelines:

- Keep the agent free of root at runtime. New privileged actions go through polkit and an allowlist in `/etc/hal-agent`.
- Every user facing string goes into both `app/src/i18n/en.ts` and `app/src/i18n/nl.ts`, and agent messages use `L(nl, en)`.
- No analytics, tracking or third party services in the app.
- Security issues: see [SECURITY.md](SECURITY.md), not a public issue.

By contributing you agree that your contribution is licensed under the MIT license of this project.
