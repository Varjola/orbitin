# Changelog

Versions follow `x.y.z`, set in the repository-root `VERSION` file: `x` is a
major release, `y` a feature release and `z` a fix release. An overview is
published at [orbitin.net/changelog](https://orbitin.net/changelog).

## 1.1.0

### Choosing a mode

- The top bar now shows the current mode. Pressing it opens a window listing
  every mode with an icon and a line saying what it is for, on desktop and on
  phones. This makes room for more modes than fit side by side.
- Orbit Lab keeps its own clock setting: coming back to it from any mode puts
  the clock back as it was. Entering Real Objects always goes live, at the
  current time at 1×. Interception and the Route Planner set the clock
  themselves: a game starts at 2 min/s and the Route Planner at 1 min/s.
- Share works in Interception and the Route Planner too: it gives a link that
  opens the mode at its starting view (`#mode=interception`,
  `#mode=route-planner`) and says that the game, satellites and routes are not
  included.

### Interception

- A new mode: an interception game in one orbital plane. Hold Speed up or Slow
  down to fire along or against your motion. While you hold, time runs at 1×
  and a dashed line shows the next half orbit if you let go; it stays until you
  reach its end or burn again. Reach the target within 100 km with the same
  shape and period before you drop to 200 km. The tank holds 500 to 1000 m/s of
  Δv, more the further apart the two orbits start in altitude; an empty tank
  ends the burns, not the game. The first game starts running as soon as you
  enter the mode.
- The Aid switch marks your apogee and perigee by name, and each mark counts
  down in minutes for the last ten minutes before you get there.
- The Hohmann transfer drawer on the right explains the transfer in a few lines
  and describes the model. On a phone the note opens from the lowest view button.
- The game opens in an altitude view of the orbital plane: distance from the
  centre shows altitude, with rings every 100 km, so nearby orbits are easy
  to tell apart. Drag to pan and scroll or pinch to zoom. A 3D view shows the
  same game at true scale. The 2D, 3D and Recentre buttons are at the bottom
  right, and on a phone the view buttons stay on the right in both orientations.
- The panel starts with New game and Restart, then shows the goal, the tank,
  where the target is, both orbits and every burn. On a phone the goals are
  plain text at the top left, one per line (a tap opens the game panel), the
  tank is an upright gauge under the view buttons, and the two burn buttons sit
  above the dock. A burn holds until the finger lifts, even if it slides off the
  button.

### Route Planner

- A new mode: plan a route from an interceptor to a target and see when to
  burn, how hard, and what it costs. It opens on two satellites flying, one in
  low orbit and one at the height of navigation satellites. Play, pause or
  speed up the scene, set either satellite's orbit and where the target is, and
  see how far apart they are, including when their planes line up by
  themselves.
- **Try these** offers nine pairs, each showing one lesson: seven built-in
  pairs that need no network, and Hubble to ISS and ISS to Tiangong from the
  catalogue. **Use the catalogue** loads the published catalogue for the
  session, so any satellite in it can be the interceptor or the target.
- **Plan route** pauses the scene and searches in the background, within
  optional time and fuel limits. Up to nine routes, from the fastest to the
  cheapest found, are listed and drawn on a **Time buys fuel** chart of cost
  against arrival time. Four kinds of route are compared: **Direct**, **Turn at
  the node**, **Go high to turn** and **Natural drift**, which lets Earth's
  bulge turn the plane over weeks or months.
- A route's details give every burn's time, size and direction in words, the
  propellant for a chemical or an electric engine, and the cost beside changing
  height alone.
- **Δv budgets**, in the right drawer and behind the info button on phones,
  set a route's cost beside what real satellites carry for their whole life,
  from a CubeSat's tens of m/s to several km/s.
- **Play this route** shows it in 3D in at most a minute: at each burn a thrust
  arrow and the velocity before and after, as the orbit reshapes. The view can
  follow the orbits or the interceptor, **Turn to each burn** looks at each
  burn from above, and playback can pause, scrub, reverse and step from burn to
  burn, also by keyboard.
- **On phones** (*Routes*, in Finnish *Reitit*): the same loop one panel at a
  time, with circular orbits, the examples and catalogue search, the chart over
  a list of routes, and playback with a caption naming each burn. The limits,
  the engine, eccentric orbits and some playback controls stay on the desktop.
- What the model includes and leaves out is in `docs/route-planner-model.md`.

### Privacy

- Two more anonymous counts: Interception game results and routes played. See
  `docs/privacy.md`.

### Phones

- Held sideways, Interception, Routes and Real Objects ask for the phone
  upright and offer Orbit Lab, which still works in landscape: in the other
  modes the controls left too little room for the view.
- The object card's altitude, speed and period are back in one row of plain
  figures; since 1.0.0 they had taken the Live badge's green capitals and dot.

## 1.0.1

### Orbit Lab

- On desktop, Edit orbit is open when the page loads, so the orbit's sliders
  are ready to use. The first-visit hint that pointed to it is removed. Phones
  are unchanged.

## 1.0.0

Initial public release.

### Orbit Lab

- Conceptual orbits you edit directly: size, shape, tilt, node, periapsis and
  position, with orbit guides while you edit.
- Ideal two-body and secular J2 drift models, with a Sun-synchronous lock and
  plane-drift readouts: nodal and apsidal drift, local solar time, beta angle.
- LEO, MEO, GEO, polar, highly elliptical and Sun-synchronous examples.
- An idealized sensor with footprint, field of regard and a ground reach limit.

### Real Objects

- A published satellite catalogue, loaded on request and searched locally by
  name, NORAD number, designator or common name (ISS, Hubble, Tiangong and
  more), with filters, details, comparison and a working selection.
- Eight reviewed satellite groups: GPS, Galileo, GLONASS, BeiDou, the crewed
  space stations, geostationary weather satellites, the Copernicus Sentinels
  and Norway's Arctic HEO satellites, each with an education page whose facts
  come from the loaded catalogue.
- Featured picks for a first look: the ISS, Tiangong, Hubble, Landsat 9,
  Sentinel-2C, GOES-19, a Molniya and Vanguard 1.
- Group members and featured picks stay in the catalogue while their newest
  element set is up to 30 days old, where other objects need one from the last
  ten days.
- SGP4/SDP4 propagation of catalogue objects and pasted TLE or OMM records,
  with element epoch and age shown.
- The clock opens at the current time at 1× with a Live badge.

### Everywhere

- A 3D Earth with day and night, city lights, a scattering atmosphere, the Sun
  with its glare, the stars and the Milky Way; a synchronized 2D ground-track
  map with day and night.
- A Map-style Earth with country borders on the globe and the 2D map.
- In Orbit Lab, a light Lab backdrop: a plain Earth inside a grid box.
- A separate touch presentation for phones.
- Scene sharing as links and files, and curated example scenes.
- English and Finnish.
- Clear error messages when the 3D view or the catalogue cannot load.
- Anonymous, cookieless usage and error counts; see `docs/privacy.md`.
