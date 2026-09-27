# Modes and scenes

Orbitin has two product modes: **Orbit Lab** for learner-authored idealized
orbits and **Real Objects** for pasted TLE/OMM records and published catalogue
objects. Each mode keeps its own scene while the page is open. Switching modes
does not change the shared clock, view settings, or the other scene.

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
