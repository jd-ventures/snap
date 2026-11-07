# Handoff: publishing Snap on the Chrome Web Store

For whoever takes this from "works on my machine" to "installable from a
link". No knowledge of the code is needed: the build is one command and the
rest is a web form. Budget an hour the first time, ten minutes per release
after that, plus Google's review wait.

## What you are publishing

Snap photographs the current tab, drops a markup surface over it (boxes,
arrows, notes), and copies the finished PNG to the clipboard. Nothing leaves
the machine. `README.md` has the behaviour and architecture; you do not need
it for this.

What the store sees, and what it checks:

| thing | value | why the store cares |
|---|---|---|
| Manifest version | 3 | V2 is no longer accepted |
| Permissions | `activeTab`, `scripting`, `storage`, `clipboardWrite` | each needs a one-line justification (given below) |
| Host permissions | none | the main thing that makes review fast |
| Remote code | none | must be declared |
| Data collected | none | must be declared |
| Icons | 16 / 48 / 128 px in `public/icons/` | 128 is mandatory for the listing |

## Before you start

1. **A Google account to own the listing.** Use a team account, not a
   personal one: the listing, its reviews and the right to update it belong
   to whoever registered. If the company has Google Workspace, use an
   account in that domain so the *Private* visibility option exists.
2. **Developer registration.** Go to
   https://chrome.google.com/webstore/devconsole, sign in with that account,
   accept the agreement, pay the one-time registration fee (US$5 at the time
   of writing), and verify the contact email.
3. **A URL for the privacy policy.** The form asks for one. The text is
   written in `store/privacy-policy.md`; fill in the contact line and put it
   anywhere public you control: a GitHub Pages page, a public Notion page, a
   gist, a page on the company site.
4. **Node 22+** on the machine that builds the package.

## Step 1: build the package

From this folder:

```sh
npm install
npm run release -- 0.3.0
```

The argument is the version to publish. Every upload must carry a higher
version than the last, so pick the next number each time (`0.3.1`, `0.4.0`).
The command sets it in both manifests, builds, runs the automated smoke test
if `CHROMIUM` points at a Chromium binary, and writes
`release/snap-0.3.0.zip`.

Check the zip before uploading: unzip it into an empty folder and confirm
`manifest.json` is at the top level, not inside a subfolder. The store
rejects a zip with a wrapping folder, with a message about a missing
manifest.

Recommended: load that unzipped folder with *Load unpacked* on
`chrome://extensions` and snap one page, so what you upload is what you
tested.

## Step 2: create the item

In the developer console press **New item** and upload the zip. You land on
the item's edit page with several tabs. Nothing is live until you press
*Submit for review*.

### Store listing tab

- **Title**: Snap (from the manifest; not editable here).
- **Summary** (max 132 characters):

  > Photograph the page, draw on it, copy it. Boxes, arrows and notes over a screenshot, straight to your clipboard. Nothing leaves your machine.

- **Description**: paste `store/description.txt`.
- **Category**: Productivity → Tools. **Language**: English.
- **Store icon**: `public/icons/128.png`.
- **Screenshots**: `store/screenshot-1280x800.png`. One is the minimum; a
  second of the settings page is nice to have. Must be exactly 1280×800 or
  640×400.
- Promo tiles, video, homepage, support URL: optional. Skip them.

### Privacy tab

Answer exactly as below; this wording is what reviewers read.

- **Single purpose description**:

  > Take a screenshot of the current tab, mark it up with boxes, arrows and notes, and copy the result to the clipboard.

- **Permission justifications**:
  - `activeTab`:
    > Captures the tab the user just pressed the button on, and lets the markup surface be placed into that one tab. Granted per press, per tab; no access to any other tab or site.
  - `scripting`:
    > Injects the markup surface into the active tab after the screenshot is taken, and reads the tab's device pixel ratio so the picture is drawn at the page's own sharpness. Only used on the tab the user activated.
  - `storage`:
    > Saves the user's settings (theme, default ink colour, where the surface opens) in sync storage, and holds the captured image in session storage for a moment while the fallback tab opens.
  - `clipboardWrite`:
    > The purpose of the extension: the finished picture is written to the clipboard.
- **Host permission justification**: leave blank; there are none.
- **Are you using remote code?** No.
- **Data usage**: tick **Website content** and nothing else. Google counts
  a screenshot of the page as handling user data even though it never
  leaves the machine (User Data FAQ: "taking screenshots", "even when data
  is processed or stored locally"). Ticking nothing contradicts the privacy
  policy and is a common rejection. Then tick the three certifications at
  the bottom (no sale of data, no use unrelated to the single purpose, no
  use for creditworthiness or lending).
- **Privacy policy URL**: the page from *Before you start*.

### Distribution tab

- **Payments**: free.
- **Visibility**, pick one:
  - **Unlisted**: anyone with the link can install; search will not find it.
    The right choice for a team tool.
  - **Private**: only signed-in members of your Google Workspace domain. The
    owning account must be in that domain, and a Workspace admin may need to
    allow the extension under Admin console → Devices → Chrome → Apps &
    extensions.
  - **Public**: findable by everyone. Fine too; nothing in it is sensitive.
- **Regions**: all.

### Test instructions for the reviewer

There is a *Test instructions* box (on the privacy or distribution tab,
depending on the console version). Paste:

> Pin the Snap icon. Open any https page and press the icon (or Shift+Alt+S). The page is captured and a toolbar appears at the bottom. Drag on the picture to draw a box; the arrow and text tools are the next two buttons. Press Copy, then paste into any image-accepting field to see the result. Escape leaves without copying. Settings: right-click the icon → Options.

## Step 3: submit and wait

Press **Submit for review**. Leave *Publish automatically after review*
ticked unless you want to time the release.

- Review takes from a few hours to about three business days. No host
  permissions and no data collection is the fast lane.
- Status shows on the item in the console; an email arrives on approval or
  rejection.
- A rejection comes with a reason. The two that happen to extensions like
  this: a permission justification the reviewer found too thin (add words,
  resubmit), or the privacy policy URL not loading (fix the page, resubmit).
  Neither needs a code change.

Once approved the listing is at `https://chromewebstore.google.com/detail/<item id>`.
The item id is on the item's page in the console. That link is what you
hand to people.

## Step 4: after it is live

- Tell everyone who used *Load unpacked* to remove that copy and install
  from the link. Two copies of Snap means two toolbar icons and two
  shortcut registrations, and only the store copy updates.
- The shortcut defaults to `Shift+Alt+S`, but Chrome drops it silently if
  another extension already holds it. Anyone can set their own at
  `chrome://extensions/shortcuts`; the settings page has a button to it.

## Each later release

The first version must be uploaded by hand (step 2): that creates the item
and its id. Every version after that ships itself from `main`.

Write commit messages in Conventional Commits form. The prefix decides the
next version, counted from the last `v<version>` tag:

| commit | next version from 0.3.0 |
|---|---|
| `fix: …` or `perf: …` | 0.3.1 (patch) |
| `feat: …` | 0.4.0 (minor) |
| `feat!: …`, or a `BREAKING CHANGE:` line in the body | 1.0.0 (major) |
| `chore:`, `docs:`, `ci:`, `refactor:`, `test:`, `style:`, `build:` | nothing ships |

Several commits in one release take the biggest bump among them.

`.github/workflows/deploy.yml` runs on every push to `main` and once a day
(14:00 UTC). It works out the version (`scripts/next-version.mjs`), asks the
store whether a version is still in review, and if one is, it stops and
waits: the next push or the daily run ships everything that piled up, so
nothing is lost and no review is restarted. Otherwise it sets the version in
both manifests, builds, runs the smoke test, uploads, submits for review,
commits `chore(release): <version>` to `main` and tags `v<version>`. Until
the store credentials below are set, it does nothing and says so.

To ship an exact version by hand: **Actions → Deploy → Run workflow** and
type it. Versions must go up and be one to four dot-separated integers
(`0.4.0`, `1.0`, `1.0.0.1`). No `-beta`, no letters.

`ci.yml` builds and smoke-tests every push and pull request. Both run on
Blacksmith runners.

Manual fallback, if Actions is unavailable: `npm run release -- <version>`,
then in the console **Package → Upload new package**, upload the zip,
**Submit for review**, commit the version bump, and tag it `v<version>`.

### How users get the update

Nobody does anything. Chrome checks the store for updates to every
installed extension every few hours and installs a new version on its own,
silently. Expect most people on the new version within a day of approval;
anyone in a hurry can press *Update* on `chrome://extensions` with
Developer mode on. A new version that asks for *more permissions* is the
exception: Chrome disables it until each user accepts the new permissions,
so avoid adding permissions casually. Copies installed with *Load unpacked*
never update.

### Automated releases: one-time setup

The workflow signs in to the Chrome Web Store API as a Google Cloud service
account. Do this once, after the item exists:

1. **Google Cloud project.** At https://console.cloud.google.com create (or
   pick) a project, open *APIs & Services → Library*, find **Chrome Web
   Store API** and enable it.
2. **Service account.** *IAM & Admin → Service accounts → Create*. Any name
   (`snap-deploy`); grant it no roles. Open it → *Keys → Add key → JSON*;
   a key file downloads.
3. **Link it to the store.** In the developer console, *Account*, add the
   service account's email. One service account per publisher.
4. **2-step verification** must be on for the Google account that owns the
   listing, or publishing through the API is refused.
5. **GitHub.** In `jd-ventures/snap` → *Settings → Secrets and variables →
   Actions*:
   - Secret `CWS_SERVICE_ACCOUNT_KEY`: the whole JSON key file. Then delete
     the file from your machine.
   - Variable `CWS_PUBLISHER_ID`: console → *Publisher → Settings*.
   - Variable `CWS_EXTENSION_ID`: the 32-letter id on the item's page.

## Who owns what

Fill in on handover:

- Store owner account: ________
- Privacy policy URL: https://github.com/jd-ventures/snap/blob/main/store/privacy-policy.md
- Source location: https://github.com/jd-ventures/snap
- Listing link once live: ________

The source is self-contained: `npm install && npm run release` from a fresh
clone produces the same package. `README.md` §4 says how to verify a build
and §5 lists what differs from artc's original, if someone has to change the
code.
