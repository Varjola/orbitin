# Orbitin on a phone

Orbitin has two presentations of the same application: the desktop
presentation described in the other documents, and a **phone presentation**
designed for a small screen, touch input and short sessions. Both show the same
scenes, clock, catalogue, sharing and languages; only the controls differ.

## When the phone presentation is used

The phone presentation applies when the page is at most 699 CSS pixels wide,
or at most 500 CSS pixels high with a touch screen (a phone turned sideways).
Tablets and desktops use the desktop presentation. Rotating a phone keeps the
phone presentation. There is no switch for learners; resizing a desktop window
across the boundary rebuilds the interface in place and keeps both scenes, the
selection, the mode, the clock, the loaded catalogue, the camera, the language
and whether the 2D map is showing. Open panels, menus and dialogs close.

## Layout

- **Top bar**, over the scene: the Orbitin mark, the mode switch (**Orbit
  Lab** and **Real Objects**; in Finnish *Radat* and *Satelliitit*) and the
  menu button.
- **View tools** at the top right (the left edge in landscape): **2D/3D**,
  **Layers** and **Fit**.
- **Object chip** above the dock: the number of objects (opens the objects
  list), the selected object's name and altitude (opens its card), and ✕ to
  clear the selection. Swipe the chip sideways to step through the scene.
- **Dock** along the bottom: play or pause, the playback speed (tap to cycle
  1×, 1 min/s, 10 min/s and 1 h/s), the UTC time (tap for the time panel), and
  the mode's actions: **＋** and **Edit** in Orbit Lab, **Add** in Real
  Objects.
- **Panels** open above the dock in portrait and as a column at the right in
  landscape, one at a time. Short panels (the Shape strip, the object card,
  time, layers) move Earth so it stays centred in the space that remains
  visible; tall panels (Add, the objects list, New orbit, the menu) cover the
  scene until they close. Drag the handle down, tap ✕, press Escape or use the
  phone's Back gesture to close a panel.

## Gestures

- Drag with one finger to turn Earth; pinch with two fingers to zoom. A
  two-finger gesture never selects anything.
- Tap an orbit, a marker or a ground track to select that object. Taps use
  larger tolerances than a mouse, so a fingertip does not need to be exact.
  When several objects are under the finger, a list at the bottom asks which
  one.
- Tap empty space to hide every control and see only the scene; tap again to
  bring them back. A tap on empty space while a tall panel or the Shape strip
  is open closes it instead.
- Back (Android) or the back swipe (iOS) closes the open panel first. It never
  changes the page address.

## Orbit Lab: shaping an orbit

The page opens on the scene with no panel. **Edit** opens the Shape strip.
Its chips pick one element at a time: **Size** (semi-major axis), **Shape** (eccentricity), **Tilt** (inclination), **Node**
(RAAN), **Periapsis** (argument of periapsis), **Position** (true anomaly) and
**Drift** (the orbit model). The ruler below them moves under a fixed needle:
drag it, or tap **−** and **+** (hold to repeat, faster after a second). A
step is a visible change (1° of tilt, 5° of the other angles, 0.01 of
eccentricity, about 2 % of the altitude) and stops on a meaningful value it
passes. With a keyboard, the arrow keys step, Page Up and Page Down step five,
and Home and End go to the limits.

While the strip is open the dock and the object chip step aside so the scene
has more room; in landscape the strip is a smaller card in the bottom-right
corner. Tap empty space, use Back or press Escape to close it.

- The ruler settles on meaningful values: space-station, Earth-observation,
  GPS and geostationary altitudes; a circular orbit; equatorial, polar and
  retrograde tilts, and with J2 drift on the critical and Sun-synchronous
  tilts; periapsis and apoapsis. Where the phone supports it, arriving on one
  gives a short vibration.
- One short line under the value says what changed, such as the altitude and
  period, the lowest and highest points, or why a value stopped at a limit.
- While Size or Shape is dragged the view zooms out just enough to keep the
  whole orbit visible; afterwards it eases back in if the orbit became small.
- Light-grey guides on the selected orbit show what the chip controls: the
  equatorial reference ring, the line of nodes and the ascending node; or the
  line of apsides with periapsis and apoapsis. They follow J2 drift and
  disappear when the strip closes. Ground tracks are hidden while an orbit is
  edited. Desktop shows the same guides for the element control under the
  pointer or in use.
- **Drift** chooses **Ideal** or **J2 drift**, with **Keep Sun-synchronous**.

**＋** opens **New orbit**: four quick orbit types and six examples. On a
phone an example always creates a new orbit; it never replaces the selected
one.

## Real Objects: adding satellites

Nothing loads the published catalogue by itself. The Add sheet first offers
**Load the satellite list**; until then its search field and group tiles are
shown but disabled. After loading:

- one search field finds objects by name, common name (such as ISS or
  Hubble), NORAD id or international designator, exactly as the desktop Quick
  Search does; a tap on a result adds it, or shows it when it is already in
  the scene;
- **Start with** offers a few well-known single objects (the ISS, Tiangong,
  Hubble and others) that add with one tap;
- each official group appears as a tile with its member count and the first
  sentence of its education page; a tap adds its members that are in the
  loaded catalogue;
- the sheet stays open after an add, and the keyboard with it while typing,
  so several objects can be added in a row; the camera fits the scene behind
  it. A tap on something already in the scene closes the sheet to show it.
  The data credit is in About.

Only the records of the objects actually added are fetched.

## Undo instead of confirmation

Adding objects, creating an orbit, removing one object and **Remove all** take
effect at once and show a short notice with **Undo**. Undo restores the scene
and selection exactly as they were, as long as nothing else has changed that
scene since. The desktop presentation asks for confirmation instead.

## Object card and objects list

The object card shows the source, the altitude, speed and period, switches for
the orbit path and ground track, and **Focus**, **Edit** (Orbit Lab only),
**Remove** and ‹ ›. Drag it up, or tap **More details**, for the point below
the object and its key orbit or record facts. The objects list shows every
object with an always-visible remove button, and **Remove all** at the top
(repeated at the bottom of a long list).

## Time, layers and the 2D map

The time panel sets the UTC date and time, **Now**, **Reset** and **Reverse**.
Real Objects opens at the current time at 1×; the time button shows **Live**
while the clock follows real time.
**Layers** switches orbit paths and ground tracks for the whole scene, within
the same budgets as desktop. **2D** shows the ground-track map as a
full-screen alternative view; **3D** returns to the globe.

## My place

**Show my place** in Layers asks the phone for its location, only on that tap.
A marker appears on the globe and on the 2D map, and the object card says
whether the selected object is above your horizon and at what elevation. The
location is kept in memory only: it is never stored, put into scenes or links,
logged or sent anywhere, and it is forgotten on reload or when switched off.

## Sharing, language and About

The menu has **Share scene** (the phone's own share sheet where available,
otherwise the link is copied; a scene too large for a link offers **Download
scene file**), **Language · Kieli**, **Examples** (ready-made scenes that open
like a shared link), **How to use** and **About Orbitin**.
Scenes, links and files are the same on both presentations: a link made on a
phone opens the same scene on a desktop, and settings the phone cannot change
are kept.

## What stays on desktop

To keep the phone presentation simple, these tools are desktop only: the
Catalogue workspace (Explore pages, filters, the results table, details,
comparison and working selection), Quick Search details and View all, manual
TLE and OMM input, multi-selection and bulk editing, colour, rename, marker
size and marker scaling, sensor footprints and their parameters, ground-track
history recording, plane-drift readouts and detailed SGP4 fields, the sub-solar point, the speed
slider, and opening a scene file. Orbitin says in About that it has more tools
on a larger screen.

## Platform notes

The phone presentation uses the phone's own interface font, 16 px body text
and nothing smaller than 12 px, respects the screen's safe areas and the
on-screen keyboard, and turns off pull-to-refresh, double-tap zoom and the
long-press callout on the scene. Every control is at least 44 × 44 CSS pixels.
Like the desktop presentation, it stores only the language choice
(`orbitin.locale`) in the browser.
