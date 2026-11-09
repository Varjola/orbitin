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

- **Top bar**, over the scene: the Orbitin mark, a button showing the current
  mode, and the menu button. The mode button opens a panel listing **Orbit
  Lab**, **Interception**, **Routes** (the Route Planner) and **Real Objects** (in
  Finnish *Radat*, *Hakeutuminen*, *Reitit* and *Satelliitit*), each with a line
  saying what it is for.
- **View tools** at the top right (the left edge in landscape): **2D/3D**,
  **Layers** and **Fit**. Interception has its own set; see below.
- **Object chip** above the dock: the number of objects (opens the objects
  list), the selected object's name and altitude (opens its card), and ✕ to
  clear the selection. Swipe the chip sideways to step through the scene.
- **Dock** along the bottom: play or pause, the playback speed (tap to cycle
  1×, 1 min/s, 10 min/s and 1 h/s), the UTC time (tap for the time panel), and
  the mode's actions: **＋** and **Edit** in Orbit Lab, **Game** in Interception,
  **Edit** and **Plan** in Routes, **Add** in Real Objects.
- **Landscape** works in Orbit Lab only. Held sideways, the other modes are
  covered by a note asking for the phone upright, with a button that opens
  Orbit Lab: their controls leave too little room for the view. A web page
  cannot lock the orientation itself outside full screen.
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

## Interception: the thruster bar

In Interception the game opens in the orbital plane altitude view (see
[`modes-and-scenes.md`](./modes-and-scenes.md#interception)): drag to pan, pinch
to zoom; a plain tap still hides and shows the controls. The view tools stay on
the right in both orientations and hold what the game needs: **2D/3D** switches
between it and the 3D view, **Recentre** fits the view again (in 3D also turning
it face-on to the game's plane, as on desktop), and the round **i** button at
the bottom opens a short note on the Hohmann transfer. Under it the tank is an
upright gauge. The goals (the distance to the target, and whether the shape and
period match) are plain text at the top left, one per line, where desktop has
the "not to scale" note, and a tap on them opens the game panel. Above the dock
are two large hold-to-burn buttons, **Slow down** and **Speed up**, with the
**Aid** switch between them, which marks your apogee and perigee. A burn runs
only while a finger is down, even if it slides off the button: lifting it, a
cancelled touch or leaving the page ends it. While a burn is held the clock runs
at 1× and the dock's play and speed controls wait for the release.

The dock's **Game** button opens the same panel: **New game** and **Restart** at
the top, then the goal, the tank, where the target is, both orbits, the burn log
and the model notes. A won or lost game opens it by itself. The bar steps aside
while any panel is open. The speed pill steps 1 min/s, 2 min/s and 10 min/s,
never 1×. The time label opens a speed slider in place of the date, Now, Reset
and Reverse. The menu's **Share link** shares only a link to the mode's
starting view.

## Routes: planning a route

The Route Planner on a phone keeps the desktop's loop, one panel at a time: set
up the two satellites, **Plan**, choose a route, watch it, **Exit**.

- **The scene** opens on the same two satellites as the desktop, with a key at
  the top left, plain text one per line, naming the interceptor and the target,
  and one line above the dock saying where the target is, how much higher and
  how far apart the planes are. The dock's play and speed run the scene; its
  time reads as on the desktop and opens nothing. The view tools are **Fit**,
  **View** (Free, Face-on, Along where the planes cross, Follow, and Turn to
  each burn), **Planes** and the info button, which opens **Δv budgets**: what
  real satellites carry for their whole life.
- **Edit** (the pencil, or a tap on the line) opens a strip over both orbits:
  **Interceptor** or **Target**, **Swap**, and the list button for **Choose**; the
  chips **Height**, **Tilt**, **Node** and **Ahead** (where the target is) set one
  value on the Shape strip's ruler. The ruler settles on the other satellite's
  height, tilt and node, reads **Same plane** where the two planes become one, and
  on the space station, GPS and geostationary heights, polar, equatorial and
  Sun-synchronous tilts, and together or opposite. Orbits are circular on a
  phone: changing the height of an eccentric catalogue satellite makes it
  circular, and the strip says so.
- **Choose** holds the nine examples, which set both satellites, and **Real
  satellites**: **Load the satellite list**, then one search; a result takes the
  place of the satellite chosen in Edit.
- **Plan** pauses the scene and opens a sheet: the routes found as a chart, cost
  against arrival time, over a list from the fastest to the cheapest, filling as
  the search goes. A mark lights its row; a row opens the route's details, with
  the height and the angle between the planes over its timeline, each burn in
  words, the fuel and what it costs beside changing height alone. **Play this
  route** plays it; closing the sheet lets the scene run on.
- **Playback** puts a bar in the dock's place: previous burn, play, next burn,
  the time and rate, **Route** for the details and **Exit playback** (the square),
  over the height and angle profile and the timeline, which can be dragged. Panels
  open above the bar. A caption above it says the burn held, or the next, in words,
  and opens the details at that burn; it steps aside while a panel is open. Only
  the thrust arrow is labelled in the scene. Exit first asks **Exit playback?**,
  with **Keep watching**, since the square sits beside Route; Back exits at once.
  Either returns to the scene as it was when the route was planned.

## Undo instead of confirmation

Adding objects, creating an orbit, removing one object and **Remove all** take
effect at once and show a short notice with **Undo**. Undo restores the scene
and selection exactly as they were, as long as nothing else has changed that
scene since. The desktop presentation asks for confirmation instead. A phone
asks first only in two places: the Interception panel's **New game** and
**Restart** once a burn has been made in an unfinished game, and the Route
Planner's Exit playback, whose button sits next to Route.

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
scene file**; in Interception and Routes it is **Share link**, a link to the
mode's starting view, and a line under it says so), **Language · Kieli**, **Examples** (ready-made scenes that open
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
slider, and opening a scene file. In the Route Planner the time and fuel limits,
the engine (the phone plans at 300 s Isp unless it was changed on a larger
screen in the same visit), eccentric orbits, each burn's
components in numbers, playback in reverse, Manual speed and the speed multiples
are desktop only. Orbitin says in About that it has more tools on a larger
screen.

## Platform notes

The phone presentation uses the phone's own interface font, 16 px body text
and nothing smaller than 12 px, respects the screen's safe areas and the
on-screen keyboard, and turns off pull-to-refresh, double-tap zoom and the
long-press callout on the scene. Every control is at least 44 × 44 CSS pixels.
Like the desktop presentation, it stores only the language choice
(`orbitin.locale`) in the browser.
