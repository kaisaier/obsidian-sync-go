# Private fork maintenance policy

This repository is maintained as a private, personal-use fork of Remotely Save
0.5.25. It is not intended for redistribution or commercial use.

## License boundary

- `src/`, `tests/`, `docs/`, and `assets/` are covered by Apache License 2.0.
- `pro/` is covered by PolyForm Strict License 1.0.0.
- Changes under `pro/` must remain for permitted personal/noncommercial use and
  must not be published or distributed without separately confirming the
  license grant.

## Branches

- `stable/0.5.25` and tag `baseline-0.5.25` preserve the untouched upstream
  baseline.
- `hardening/0.5.25` contains reliability, safety, dependency, and test work.
- New product changes should use `feature/<short-name>` branches created from
  the current hardening branch.

## Change requirements

Before merging a change into the hardening branch:

1. Add or update a regression test for synchronization behavior.
2. Run `npm ci`, `npm test`, `npm run build2`, and `npm run build`.
3. Treat failed or incomplete remote listings as errors, never as evidence of
   deletion.
4. Update per-item sync history only after the corresponding I/O succeeds.
5. Do not use `npm audit fix --force`; review breaking dependency upgrades
   individually.

Real-device, multi-device soak testing is intentionally outside this fork's
maintenance workflow. Use backups and disposable vaults for any manual checks.
