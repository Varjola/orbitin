# Modes and scenes

Orbitin has four product modes: **Orbit Lab** for learner-authored idealized
orbits, **Interception** for a game of catching a target in one orbital plane,
the **Route Planner** for planning routes between two satellites, and **Real
Objects** for pasted TLE/OMM records and published catalogue objects. Orbit Lab
and Real Objects each keep their own scene while the page is open; Interception
keeps its game and the Route Planner its two satellites and routes instead.
Switching between the two scene modes does not change view settings or the
other scene. The modes share one clock, but Orbit Lab keeps a setting of its
own: coming back to it from any mode puts the clock back as Orbit Lab left it
(instant, speed, play and direction). Entering Real Objects always goes live:
the current time at 1×. Interception and the Route Planner set the clock
themselves: a game starts at 2 min/s and the Route Planner at 1 min/s.

The top bar shows the current mode. Pressing it opens a window listing every
mode with an icon and a line saying what it is for. Arrow keys, Home and End move
between the cards, and Escape or a press outside closes the window.

This page describes the desktop presentation. Phones get a separate touch
presentation of the same modes and scenes; see [`mobile.md`](./mobile.md).

The active scene list floats beside the right Inspector rail. The Orbit Lab
drawer contains Edit orbit controls and idealized examples; its Create orbit
launcher sits beside the left rail in the same position used by the Real
Objects catalogue launcher. Create orbit offers LEO, MEO, GEO and HEO starting
geometries with distinct color families. Example cards replace the selected
Orbit Lab object's orbit instead of adding another object. The Real Objects
drawer contains manual input. The right inspector shows the selected object's
editable name, source, live readouts, display settings, notes and sensor
settings. Both side rails start retracted to compact name-and-button controls.
Time controls are bottom-left; global view controls, including Fit visible
orbits and a dedicated 2D map button, are bottom-right.

## Interception

Interception is a game about changing orbits. The learner's satellite and a
target start on circular orbits in the same plane. The default view is the
**orbital plane altitude view**: a 2D map of the plane in which distance from
the centre shows altitude, with rings every 100 km and the 200 km re-entry line
as a small disc in the middle. Angles and altitudes are exact; path lengths and
shapes are not to scale, and the view says so. Drag to pan, scroll or pinch to
zoom, and double-click or **Recentre** to fit it again. The **3D view** shows the
same game at true scale, looking straight down onto the plane; **2D**, **3D** and
**Recentre** are individual buttons at the bottom right, where the other modes
have the View drawer's button. Holding **Speed up** or **Slow down** (or W/↑ and S/↓)
fires along or against the direction of motion; a quick tap makes the smallest
correction, 2 m/s. While a burn is held the clock runs at 1× and a dashed line
shows the next half orbit if the burn ended now. Releasing it restores the
earlier speed and play state, and the line stays until the satellite reaches
its far end or the next burn replaces it. From a circular orbit, or from the
highest or lowest point, the far end is the opposite one of those points. The
game is won within 100 km of the target with the same eccentricity and period,
and ends if the satellite reaches 200 km altitude. The tank holds 500 to 1000 m/s
of Δv, growing with the altitude gap between the two starting orbits from 150 km
to 600 km. Even the smallest tank is more than the largest transfer a game can
draw.

The **Aid** switch between the burn buttons, off by default, marks your apogee
and perigee (highest and lowest point) by name. In the last ten simulated minutes
before you get there, a mark also counts down in whole minutes. A practically
circular orbit has neither, so it has no marks.

The left drawer starts with **New game** and **Restart**, then shows the goal,
the tank, where the target is, both orbits and every burn. The right drawer, in
the Inspector's place, is **Hohmann transfer**: a short note on the transfer and,
at the bottom, **About this model**. While the left drawer is closed, a line
under the burn buttons says what is happening: a burn running, then what the
last burn did, the result once the game is decided, or an empty tank.

The game has no scene: **Share** gives only a link that opens Interception at
its starting view, never the game itself. The Inspector and the 2D map are not
used, and time only runs forward from the game's start, so
the time controls are one row with play, speed and a speed slider, without the
date, Now, Reset or Reverse. The first entry to the mode starts a game running.
Leaving the mode keeps the game where
it was; returning puts the shared clock back at that instant, paused. A new
page load starts without a game. On a phone, see
[`mobile.md`](./mobile.md#interception-the-thruster-bar).

## Route Planner

The Route Planner plans a route from one satellite, the **interceptor**, to
another, the **target**: when to burn, how hard, and what it costs. It opens
on two satellites flying in one plane, one in low orbit and one at the height
of navigation satellites.

**The live scene.** The left drawer runs the scene and sets up the two
satellites. **View** keeps the camera face-on to the interceptor's orbit,
along the line where the two planes cross, or following the interceptor,
until the scene is turned by hand. Each satellite's card sets its height (or
perigee and apogee), inclination and node. **Swap** exchanges the two. **How
far apart** sets how far ahead of the interceptor the target is, and shows the
difference in height, the angle between the planes, how fast Earth
turns the planes apart, when they line up by themselves and what changing
height alone would cost. The clock at the bottom left plays, pauses and
speeds up the scene.

**Satellites.** **Try these** offers nine pairs, each showing one lesson:
seven built-in pairs that need no network, and two real pairs from the
catalogue, Hubble to ISS and ISS to Tiangong. **Use the catalogue** loads the
published catalogue for the rest of the session, in every mode; any satellite
it has now can then be found and taken as the interceptor or the target.
Changing its orbit marks it as edited.

**Planning.** **Plan route** pauses the scene and opens a window planning from
that moment. It holds the time and fuel limits, the engine, a table of up to
nine routes from the fastest to the cheapest found, and the same routes as a
chart of cost against arrival time; a row and its mark light together. The
search runs in the background, with progress and Cancel. Pressing a route
shows its details: a timeline under the interceptor's height and the angle
between the planes, each burn in words (such as "1,967 m/s forward, 137 m/s
left") with its numbers behind **Details**, the propellant, and what the route
costs beside changing height alone. Closing the window lets the scene run on.

**Δv budgets.** The right drawer, in the Inspector's place, holds **Δv
budgets** under the route: rough lifetime Δv for real spacecraft (a CubeSat,
a small satellite with electric propulsion, a low-orbit constellation
satellite, a geostationary satellite, a kick stage) and two costs for scale,
so a route's total can be judged. Then comes **About this model**.

**Playback.** **Play this route** plays the route in the 3D view, with its
details in the right drawer. At each burn a thrust arrow shows its size and
direction, the velocity before and after shows how far the burn turns it, and
the orbit reshapes. **Turn to each burn** looks at each burn from above its
plane as it comes, and **Planes** shows the two orbit planes and the line
where they cross. Playback takes at most a minute and pauses at each burn
unless **Autoplay** is on; **Manual speed** sets the simulated rate by hand.
Space plays or pauses, the left and right arrows step, and comma and full stop
go to the previous and next burn. **Exit playback** returns to the scene as it
was when the route was planned.

The Route Planner has no scene: **Share** gives only a link that opens the
Route Planner at its starting view, without the satellites or routes. The
Inspector and the 2D map are not used. Leaving the mode pauses the scene and playback where they
are, and a search carries on. What the model includes and leaves out is in
[`route-planner-model.md`](./route-planner-model.md). On a phone, see
[`mobile.md`](./mobile.md#routes-planning-a-route).

## Scene capacity and layer budgets

Each mode scene holds up to **100** objects; the count reads `<n> / 100
objects`. An add that would exceed the capacity is refused as a whole, and the
message states how many slots remain. New real objects start with their marker
and orbit path on and their ground track, history recording and sensor
geometry off.

The expensive optional layers have per-scene budgets, measured on a reference
desktop: orbit paths, ground tracks and recorded ground-track histories may be
on for all 100 objects, and sensor geometry for up to 75. A change that would
exceed a budget - a single toggle, a bulk inspector control or a scene-wide
View toggle - is refused as a whole and explained next to the control that
asked. Turning **Record ground-track history** on also shows the ground track,
and hiding a ground track also stops its recording, including in bulk. Loading
a saved scene document never fails for a budget: the layer stays on for the
first objects in document order up to the budget and is turned off on the rest,
and the load reports which objects changed.

At the highest playback speeds with many objects, orbit paths and ground-track
windows are refreshed in turn within a small per-frame time budget, so a path
may briefly lag its marker; markers themselves are always computed exactly for
the current instant.

## Picking and selection

Objects can be picked directly in the 3D view and on the 2D map:

- a click on a marker or on a visible orbit path (3D) or ground track (map)
  selects that object; Ctrl-click or Cmd-click toggles it in the selection;
- a press that moves more than a few pixels is camera navigation and never
  changes the selection;
- a left click on empty space never changes the selection; a **right click**
  on the 3D view or the map clears it (the browser context menu is suppressed
  there only);
- markers hidden behind the Earth, hidden objects and objects in a
  propagation-error state cannot be picked;
- hovering emphasizes the object under the pointer and names it; when several
  objects are under the pointer the label reads `<name> +<k> more`.

When a click cannot be resolved - for example on an orbit plane shared by
several satellites - a chooser lists up to eight candidates in a fixed order
(markers before lines, then distance, then depth, then id). Arrow keys move
between entries, Enter or a click applies the choice with the same plain or
Ctrl/Cmd intent as the original click, and Escape or a click elsewhere closes
it without change. More than eight candidates end with a pointer to the Scene
Objects search. Selected markers have a halo; the primary selection has a
stronger halo and a name label, hidden while its object is behind the Earth or
out of view.

## Colours

Each object has one colour, used for its marker, orbit path, ground track and
sensor areas. The inspector offers a palette of 24 swatches - hues, light
tints and neutrals chosen to stay visible against space - and a **Custom**
colour for any other value. Colour names describe colours only. New objects
receive distinct palette colours automatically; Orbit Lab's Create orbit keeps
a colour family per orbit type as a starting point, which can be changed like
any other colour.

## Scene Objects

The floating Scene Objects list manages the active scene. Its top bar always
shows the active object (the primary selection, with `+<k>` for further
selected objects) and collapses the list to that bar alone or expands it
again. Expanded, it shows a count, a selected count, a search field (name, NORAD id, or the group an object was added with),
and one row per object with a checkbox, a name button and a remove button.
Checkboxes add or remove an object without changing the primary selection. A
header checkbox selects or deselects all objects, or only the rows matching the
current search; its accessible name states which. The name button selects and
briefly reveals an object. **Remove selected** asks for confirmation when more
than one object would be removed. The search text is not saved and is cleared
when switching modes.

With two or more objects selected, the inspector shows the selection count and
names, tri-state controls for Orbit path, Ground track, Record ground-track
history and Sensor geometry (a mixed control turns the layer on for all), one
colour for all selected objects (no swatch is marked while they differ), and
**Reveal selected**, **Fit selected**, **Remove selected** and **Clear
selection**. Element editing, sensor parameters
and marker size stay single-object controls. With one object selected, the
inspector also offers **Reveal** and **Focus**, which turns the view about the
Earth's centre until the object faces the camera, keeping the current distance.
Reveal pulses the object's 3D and map markers for about a second; with reduced
motion requested it shows a steady ring instead.

## Adding a whole group

An official group's page in the Catalogue offers **Add all members to
scene**. It previews how many members are present in the loaded
catalogue, already in the scene and new, and how many slots remain; it is
disabled with an explanation when the new members do not fit, and asks for
confirmation before adding ten or more. The add is atomic. Newly created
members share one colour; members already in the scene keep theirs. Every
member present afterwards is selected and remembers, for this session only,
which group it was added with. Members absent from the loaded catalogue are
reported and never added. Group membership is a manually reviewed roster
taken from each system's public status page, not a live health status, and
changes only with a new reviewed revision (see
[`models-and-limitations.md`](./models-and-limitations.md#satellite-groups)).

Editing orbital elements requires exactly one Orbit Lab object.

A fresh page starts with one selected Orbit Lab orbit using a randomized
two-word name; the Real Objects scene starts empty. Recorded ground-track
trails restart when returning to a mode. Nothing is saved automatically: a
refresh starts a fresh page. To keep or hand over a scene, use **Share** in the
top bar, which shares the active mode's scene as a link or a scene file, and
**Open scene file…** in the Options menu. See
[`scene-sharing.md`](./scene-sharing.md).
