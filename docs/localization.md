# Interface languages

Orbitin's interface is available in **English** and **Finnish**. English is
the product language: Orbitin opens in English, and this repository and its
documentation are English only. Finnish is an optional interface language for
learners, mainly children and older people who are new to space topics.

This page explains how the interface text is organized, how to add or correct
a translation, and what is never translated.

## Choosing the language

**Options** (the ⋮ button at the right of the top bar; on a phone, the menu
button, see [`mobile.md`](./mobile.md)) has a **Language · Kieli** group with **English** and **Suomi**. The group label is
in both languages so a learner who landed in the wrong language can always
find it, and each language is named in its own language.

- The choice applies at once. The interface is rebuilt in place: both mode
  scenes, the selection, the clock, the catalogue workspace, open drawers,
  the map and the camera are kept. Open menus and dialogs close, and one-off
  notices clear. Nothing is fetched again.
- The choice is remembered **only in this browser**, under the local storage
  key `orbitin.locale` (`en` or `fi`). It is the only thing Orbitin stores in
  the browser. It is never sent anywhere: no cookie, request, URL parameter,
  scene link, Worker or R2 object carries it. If storage is blocked, the choice
  lasts for the current page.
- A first visit, a browser without the key, or cleared site data opens in
  English. The browser's own language settings are not used.
- Shared scene links and scene files never change the language.

## Where the text lives

Every word the interface shows comes from a message catalogue under
`src/i18n/`:

```text
src/i18n/
  locale.ts          the locales, their Intl tags and the language names
  messages/en.ts     the English catalogue: the source of every message
  messages/types.ts  MessageCatalogue, the shape every locale must satisfy
  messages/fi.ts     the Finnish catalogue
  messages/pseudo.ts development-only pseudo-locale (see below)
  format.ts          numbers, units, durations, lists and plurals per locale
  active.ts          the active catalogue and formatter
  index.ts           the public boundary views import
```

The catalogues are nested by product area (`shell`, `orbitLab`, `inspector`,
`catalogue`, `sharing` and so on). A leaf is either a string or a message
function that takes typed parameters (counts, names, preformatted values) and
returns a string. Word order and plural forms live inside the message
function, never in the calling code. The `mobile` section holds the phone
presentation's short forms, such as the mode names *Radat* and *Satelliitit*;
elsewhere the desktop wording is used.

Views read the active catalogue with `text()` and format values with
`format()`. `src/app/LocaleController.ts` is the only module that changes the
active language, and it owns the `orbitin.locale` key.

## Adding or correcting a translation

A translation is a resource edit:

1. Find the message in `src/i18n/messages/en.ts`. Its path, for example
   `inspector.period`, is the same in every locale.
2. Edit the same path in `src/i18n/messages/fi.ts`.
3. Run `npx tsc --noEmit` and `npm run test:run`.

The compiler rejects a Finnish catalogue with a missing or extra key, or with a
message function whose parameters differ from English. The catalogue tests
also reject empty messages and any Finnish message identical to its English
source unless it is on the reviewed `SAME_IN_FINNISH` allowlist in
`src/i18n/messages/catalogue.test.ts` (product and provider names,
abbreviations, units and formats).

To add a new message, add it to `en.ts` first, then to `fi.ts`, then use it
from the view through `text()`. Markup templates contain structure only: a
source test fails on literal text nodes and on literal `aria-label`, `title`,
`placeholder` or `alt` values. Interpolate text through the `html` template
helper in `src/ui/markup.ts`, which escapes it.

## Finnish style

- Write natural, everyday Finnish that is easy to learn from, not a literal
  translation. Short sentences, familiar words first, one idea per help text.
  A Finnish help text may explain differently from English as long as it is
  correct.
- Put names only where the nominative is correct (`Kohde: {name}`), never where
  they would need inflecting.
- Use sentence case for labels, `vrk` for day in rates, and keep abbreviations
  as in English (LEO, TLE, UTC).
- The mode names are **Kiertoradan mekaniikat** (Orbit Lab) and
  **Kiertoratojen kappaleet** (Real Objects). They are never abbreviated.
- The word for a scene is **näkymä**. Every form of it is kept in one place
  at the top of `fi.ts`, so the term can be changed in one edit. The
  view-controls drawer is **Näyttö**, so the two do not collide.
- Ground track is **maareitti** and orbit path **radan reitti**. Epoch is
  **epookki**, explained in help text and tooltips.
- Prefer "Valitse rata" to "Valitse yksi rata": avoid *yksi* where only one
  thing is meant anyway.
- Terms follow TEPA-termipankki (IEC Electropedia IEV 725), Tieteen
  termipankki, Finnish Wikipedia and Seepia *Kiertorata*. Examples:
  periapsis / apoapsis, periapsisin argumentti, nousevan solmun pituus,
  luonnollinen anomalia, peittoalue, korkeuskulma, viistoetäisyys.

## Taught terms

Learners should meet the correct English word for an important orbital term.
The `terms` section of the English catalogue holds these English terms (for
example `inclination`, `semi-major axis`, `ground track`). Wherever a taught
term labels a control, readout or heading, the Finnish interface shows the
Finnish label with its English term beside it, in a secondary style:
*Radan kaltevuus · inclination*. The English interface shows nothing extra.

Views never assemble the pair themselves: `src/ui/termLabel.ts` produces it
(`termLabelMarkup`, `termLabel`, `termAccessibleName`). The English term is
marked `lang="en"` so screen readers pronounce it in English, and the
accessible name of a control includes both words.

Finnish labels are longer than English ones, so the side panels are a little
wider in Finnish. A Finnish label does not break inside itself while it fits
on one line; when the English term does not fit beside it, the line breaks
between the Finnish label and the English term.

A Finnish help text names the technical Finnish term and gives the English in
the fixed form `(engl. X)`. A test checks that every `X` is an English taught
term.

## Numbers, units and time

Numbers follow the interface language, whatever the browser's locale:

| Kind | English | Finnish |
| --- | --- | --- |
| Decimal | 1,234.5 | 1 234,5 |
| Distance | 6,916 km | 6 916 km |
| Percentage | 12.5% | 12,5 % |
| Duration | 1h 36m | 1 h 36 min |
| Cardinal point | 12.3°N | 12,3° P |
| Rate | +0.99°/day | +0,99°/vrk |
| Solar time | 10:30 | 10.30 |

Simulation time is shown as `YYYY-MM-DD HH:MM:SS UTC` in both languages. The
date and time input is the browser's own control and always carries an ISO
value. Unit words and cardinal letters are catalogue data (`units`), so a
correction is a resource edit too.

## What is never translated

- Object names: catalogue names, pasted TLE and OMM names and names a learner
  typed. A **new** Orbit Lab orbit gets a generated name in the active
  language; from then on the name is learner data and is kept as typed.
- Provider names, the provider's required data citation (only its connecting
  words are translated), provider codes shown as published, NORAD catalogue
  numbers, international designators, and TLE and OMM field names.
- Abbreviations such as TLE, OMM, SGP4, NORAD, UTC, J2, LEO, MEO, GEO and HEO,
  and the product name Orbitin.
- Developer messages such as console warnings.
- This documentation, the README and the rest of the repository.

## Data never depends on the language

Scene documents, scene files, `s1` links, catalogue search and sorting, TLE and
OMM parsing and the Workers are language-independent. A scene saved in Finnish
opens identically in English, byte for byte. Orbitin stores the notes it writes
on objects, such as an example orbit's description, as fixed English text, so
links keep encoding them compactly; the interface translates them for display
only. An architecture test keeps `src/data`, `src/core`, `src/orbital`,
`src/simulation` and the Workers from importing the localization boundary, and
keeps locale-dependent browser formatting out of the rest of the code.

## Pseudo-locale for development

In a development server, `?locale=pseudo` shows English wrapped in `⟦…⟧` and
lengthened by about 40 %. Text that appears without the brackets bypassed the
catalogue, and longer words reveal layouts that break. The pseudo-locale is
never remembered and never reaches a production build; the build check fails
if it does.
