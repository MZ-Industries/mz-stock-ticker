---
name: release
description: Cut a release of this Tauri desktop app — picking the version, the release-please PR dance, the four-platform build, and publishing. Use this whenever the user asks to release, ship, cut, publish, tag or version the app, or names a target version ("release 0.5.3", "ship a patch", "let's get this out there"), or asks why a release PR looks wrong or proposes a version downgrade, or asks how the in-app auto-updater gets its build. Use it *before* committing work that is headed for a release too, because the commit type silently decides the version number.
---

# Releasing mz-stock-ticker

Releases are cut by [release-please](https://github.com/googleapis/release-please-action) from
conventional commits on `main`. Nothing is ever tagged or published by hand — the
`.github/workflows/release.yml` pipeline owns that, and the in-app updater reads whatever it
publishes.

## The model

```
commit to a branch  →  PR  →  squash-merge to main
                                    ↓
              release-please opens/updates "chore(main): release X.Y.Z"
                                    ↓ (you merge it)
              DRAFT GitHub release  →  tests  →  4-platform build  →  notarize DMGs
                                    ↓ (only if everything is green)
              publish: draft=false, which CREATES THE TAG and makes latest.json live
                                    ↓ (only if repo variable IOS_TESTFLIGHT == "true")
              iOS build (ios.yml)  →  upload to App Store Connect / TestFlight
```

Two things follow from that shape, and most confusion here traces back to one of them:

- **A draft release carries no git tag.** Between merging the release PR and the build going
  green, the repo is in a state where release-please cannot see the version it just released.
- **The publish step is the point of no return.** Publishing is what the auto-updater in every
  installed copy of the app is watching, via `releases/latest/download/latest.json`.

## The commit type picks the version

release-please derives the next version from the commits merged since the last release, so the
version is decided when you write the commit message, not at release time:

| Commit prefix | Bump | Example |
|---|---|---|
| `fix:` | patch (0.5.2 → 0.5.3) | `fix(updater): report checks in a dialog` |
| `feat:` | minor (0.5.2 → 0.6.0) | `feat: settings pane for endpoints` |
| `feat!:` or `BREAKING CHANGE:` footer | major | |
| `chore:`, `docs:`, `refactor:`, `test:` | none — no release PR appears | |

When the user names a version, work backwards: if they ask for a patch and the work is arguably a
feature, type the commit `fix:` and say so in your summary. That keeps history honest about the
version they asked for and needs no special machinery.

Only reach for a `Release-As: X.Y.Z` commit footer when the version genuinely cannot be reached by
commit type (a deliberate jump, or re-releasing a burned number). It leaves a permanent marker in
history that release-please can walk back to later — an old `Release-As: 0.2.3` chore commit is
exactly what produced the downgrade PRs described below.

## Procedure

**1. Sync first.** The publish job pushes a `chore: sync Cargo.lock for vX.Y.Z` commit to `main`
after every release, so a local `main` from before the last release is stale. Branch off the remote,
not off local `main`:

```bash
git fetch origin
git checkout -b fix/<slug> origin/main
```

**2. Check it locally** before asking CI: `npm test` and `npm run build`. If anything under
`src-tauri/` changed, also `cd src-tauri && cargo test`.

**3. Commit** with the type from the table above.

**4. Open a PR and let CI finish.** `ci.yml` runs two checks on every PR — "Frontend tests +
typecheck" and "Rust tests" (~2 min):

```bash
gh pr create --base main --title "<conventional subject>" --body "..."
gh pr checks <N> --watch --interval 20
```

**5. Squash-merge the feature PR** (`gh pr merge <N> --squash --delete-branch`).

Squash matters: a merge commit whose body repeats the PR title makes release-please count the same
change twice, and the changelog then lists it on two lines with two different SHAs. That is how the
duplicate entries under 0.5.2 and 0.5.3 in `CHANGELOG.md` got there. Squashing leaves exactly one
conventional commit on `main`.

**6. Check the release PR release-please opens.** It appears within a minute of the merge, titled
`chore(main): release X.Y.Z`. Read its diff before merging and confirm the version is the one the
user asked for, in all of: `.release-please-manifest.json`, `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, plus a sensible `CHANGELOG.md` entry.

```bash
gh pr diff <release-pr>
```

**If that PR proposes a version LOWER than the last released one, do not merge it. Close it.** It
is the draft-window failure: release-please found no tag for the release in flight, walked back to
the old `Release-As: 0.2.3` commit, and proposed a manifest downgrade. This happened three times
(PRs #10, #12, #14) before `release.yml` was split into two release-please invocations to prevent
it. The next push to `main` regenerates a correct one.

**7. Merge the release PR** with a merge commit (`--merge`, matching how #15 and #17 were merged).
This is the irreversible step — everything after it is automatic.

**8. Watch the build.** A release run takes roughly 7–8 minutes end to end; a normal push to `main`
finishes in about 20 seconds, so a short run means release-please only refreshed the PR and no
release was cut.

```bash
gh run watch $(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

**9. Confirm it published**, since a draft looks like success from a distance:

```bash
gh release view vX.Y.Z --json isDraft,assets --jq '{isDraft, assets: [.assets[].name]}'
```

Expect `isDraft: false` and bundles for all four targets plus `latest.json` — that file is what the
in-app updater fetches, so a release without it publishes nothing to existing users.

**10. Check TestFlight** if `IOS_TESTFLIGHT` is on: the `iOS (TestFlight)` job runs after publish.
Its build number is the workflow run number (CFBundleVersion `X.Y.Z.<run>`), and App Store Connect
takes several minutes to process an upload before it shows in TestFlight.

**11. Pull `main`** afterwards to pick up the Cargo.lock sync commit.

## When it goes wrong

**The build failed.** The release stays an unpublished draft and no tag exists, which is the
designed outcome — nothing reached users. Fix the cause, then **re-run the failed jobs** rather than
pushing a fresh version bump:

```bash
gh run rerun <run-id> --failed
```

Pushing new commits instead leaves the consumed version number stranded and starts the version
dance over.

**A published release is wrong.** It cannot be repaired. This repo has GitHub immutable releases
enabled, so published releases, their assets and their tags can never be edited or deleted. The only
route forward is shipping the next patch version. For the same reason, never publish a draft release
by hand mid-build — the workflow publishes only after every upload has landed.

**The iOS job failed.** The desktop release is already published and unaffected. Re-run just that
job (`gh run rerun <run-id> --failed`), or run `ios.yml` from the Actions tab with the tag as `ref`.
A re-run gets a new build number, so App Store Connect never sees a duplicate. Its signing uses the
`IOS_*` and `APPSTORE_*` secrets listed at the top of `ios.yml`, not the `APPLE_*` ones.

**Someone pushed to `main` during a build.** That push meets the missing tag and can be answered
with a downgrade PR. The publish job closes stale `release-please--*` PRs as a backstop, but avoid
pushing to `main` while a release is building.

**Signing.** Updater bundles are signed with the keypair at `~/.tauri/mz-stock-ticker.key` (plus
`.key.password`), mirrored into the repo secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. If those local files are ever lost, updates can no longer be
signed with the key that installed copies of the app trust. macOS builds additionally need the
`APPLE_*` secrets for notarization; without them the notarize step skips with a warning rather than
failing.

## Where things live

- `.github/workflows/release.yml` — the whole pipeline, with the reasoning for the two-invocation
  split in comments at the top
- `.github/workflows/ios.yml` — the TestFlight build, called from release.yml or run by hand
- `.github/workflows/ci.yml` — the PR checks, including an iOS `cargo check`
- `release-please-config.json` — `draft: true`, and the `extra-files` list that keeps
  `tauri.conf.json` and `Cargo.toml` versions in step with `package.json`
- `.release-please-manifest.json` — the current released version, and the file a downgrade PR
  quietly edits

## A note on permissions

Merging PRs is the one step commonly blocked for an agent in this repo, and it is the step that
starts an irreversible process. If a merge is denied, do everything up to it — branch, commit, push,
open the PR, get CI green, verify the release PR's version — then hand over with the exact PR number
and what merging it will set in motion.
