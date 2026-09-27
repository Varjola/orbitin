# Scene sharing

Orbitin can hand the scene of the current mode to someone else, or keep it
for later, without accounts or server storage. **Share** in the top bar shares
the **active mode's scene only**: an Orbit Lab share never contains the Real
Objects scene, and the other way round.

## What is shared

A shared scene contains the objects of one mode with their settings:
names, orbit elements or records, colour, marker size, sensor and reach
settings, which layers are on, and the selection. It also contains two view
settings: whether the 2D map is shown and whether markers scale with zoom.

It does not contain the simulation time or playback state, the camera, map
maximization, drawer state, or the session-only group a catalogue object was
added with. A renamed catalogue object opens with its published name.

When a scene is opened:

- **Orbit Lab** scenes open at Orbitin's start time, 20 March 2026 12:00:00
  UTC, with playback paused.
- **Real Objects** scenes open at the current time with playback running, so
  current element sets stay close to their epochs.
- Playback speed and direction are kept, except that a link that is the first
  entry into Real Objects in a page follows real time at 1×, like any first
  entry. Recorded ground-track trails restart.
- Only the shared mode's scene is replaced; the other mode's scene is kept.
  Opening a link pasted during a session, or a scene file, asks first when the
  scene it would replace has objects. Following a link into a fresh page does
  not ask.

## Links

**Copy link** puts the scene into the address fragment
(`#scene=s1.<payload>`). Browsers never send the fragment to the server, so
scene content does not reach Orbitin's servers or logs. After a link is
opened, the application removes the `scene` part of the fragment without
adding a history entry, and a refresh starts a fresh page.

Links use a compact binary encoding, `s1`, optionally compressed. A link must
stay short enough for chat tools and operating systems to carry it, so every
link fits in 16,000 payload characters and each mode has a fixed limit that a
link can always hold, however long the names are:

| Mode | Link limit |
| --- | --- |
| Orbit Lab | 20 orbits |
| Real Objects | 100 objects, of which at most 10 are pasted TLE or OMM records |

Catalogue objects are shared by NORAD catalogue number and take only a few
bytes each; pasted records carry their full text. Names up to 80 characters
fit a link. A scene above a limit, or a hand-edited scene with a longer name
or an unusual OMM record, cannot be linked, and the Share dialog says why.
Such scenes can always be saved as a file.

Typical links are far shorter than the limit: a 32-object catalogue group takes
about 500 payload characters, and 100 catalogue objects about 1,300.

## Scene files

**Download scene file** saves the same scene as readable JSON named
`orbitin-scene-<mode>-YYYYMMDD-HHMM.orbitin.json` (UTC). Files have no limit
beyond the 100-object scene capacity. **Open scene file…** in the Options menu
opens one. Files larger than 1 MiB are refused.

A scene file is an `orbitin.scene` version 1 document in its sharing form:
one mode's scene, `simulation: null`, the other mode's scene empty, and object
ids normalized to `orbit-1…`, `catalogue-<NORAD>`, `tle-1…` and `omm-1…`.
Openers apply those rules to any valid version 1 document, so a document with
both scenes opens only its active mode's scene.

## Catalogue objects over time

Opening a scene resolves catalogue objects against the **current** published
catalogue, loading only the records the scene references. A scene without
catalogue objects makes no catalogue request. The element-set epoch and
snapshot saved with the scene are for information only. After opening, a
notice reports catalogue objects that now use newer element sets, objects no
longer in the catalogue (left out, listed by NORAD number), records that could
not be read, and any layers turned off to stay within the scene's layer
budgets. These never block the open. If the catalogue cannot be loaded, the
scene is not opened and the current session is left as it was.

## Privacy

Anyone with a link or file can open the scene. A scene contains no personal
data by construction: only objects, their settings and the two view settings.
Links and files never choose a URL, a catalogue origin or any markup; names
are always shown as plain text.

## Compatibility

Every Orbitin frontend opens `orbitin.scene` version 1 files and `s1` links,
unless a future major release documents otherwise. A new format is added as a
version 2 document or an `s2` link encoding alongside the version 1 formats. The link encoding's frozen tables
(presentation defaults, the manual OMM field order and the append-only table
of example-orbit notes) never change meaning. Golden fixtures in
`src/data/fixtures/scene-v1/` lock the contract in the test suite.

Links made by a newer version of Orbitin, or opened in a browser that cannot
decompress them, show a specific message instead of opening.

## Examples

**Examples** (in the Options menu on desktop and in the menu on a phone) are
curated scenes such as *GPS right now* or *Four orbit shapes*. Each is an
ordinary `s1` link kept in `src/data/sceneExamples.ts`; opening one is exactly
opening that link, including the question before a scene with objects is
replaced. An example never changes once published, so its link keeps working;
a changed example gets a new link. Example links shared outside the
application carry `?example=<id>` before the fragment, which only tells the
anonymous visit count that an example was opened.
