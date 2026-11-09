# Route Planner model

The Route Planner takes two satellites at one instant, an **interceptor** and a
**target**, and searches for routes from one to the other. A route is a series
of burns with coasting between them. It ends with the interceptor in the
target's place and moving with it. The model is made for teaching why some
routes cost so much more than others. It is **not usable for real
operations**, and it shows the best routes it found, not proven optimal ones.

How the mode is used is described in [modes-and-scenes.md](./modes-and-scenes.md#route-planner)
and, for phones, in [mobile.md](./mobile.md#routes-planning-a-route).

## Where the satellites start

- **Built-in pairs** (the opening scene and **Try these**) are orbits in round
  numbers. They need no network.
- **Catalogue satellites** are placed from their newest published element set
  at the planning instant. Size and shape are SGP4's averaged (mean) elements
  there. The plane and the position along the orbit are SGP4's own state, so a
  satellite starts where Real Objects would show it. Reading SGP4's
  instantaneous state as a Keplerian orbit instead would put the semi-major
  axis up to about 10 km off, which drifts by about 100 km an orbit.
  Such a satellite starts within about 10 km of SGP4's position. Over three days
  in low orbit it stays within about 10 to 26 km of SGP4, and within about 12 km
  at geostationary height.
- Changing a catalogue satellite's orbit marks it as edited. The element set's
  age is shown beside it, as in Real Objects.

## Motion between burns

- **Waiting and drifting** use secular J2, the model of Orbit Lab's J2 drift
  ([orbit-perturbation-model.md](./orbit-perturbation-model.md)): the planes and
  the perigees turn as they do for real over days and months. The target
  follows the same model throughout.
- **Transfer arcs** are two-body conics between burns (solutions of Lambert's
  problem). Each is flown in a frame turning about Earth's axis at the node
  rate of an orbit spanning the two ends, because over a few orbits that
  turning is too large to leave out. The final arc meets the target's modelled
  position exactly. The rest of J2 on an arc is not modelled. It costs a route a
  few m/s at most, so the model cannot tell a cost below about 20 m/s from
  zero.

## Burns and propellant

- **Burns are instantaneous.** Real burns take minutes to hours, and a
  low-thrust engine could not fly these routes at all.
- Each burn is given as its size (Δv) and its parts as seen riding along with
  Earth below: **forward** along the motion (prograde), **left** out of the
  orbit's plane (normal) and **up** away from Earth (radial).
- **Propellant** follows from the total Δv by the rocket equation: the
  propellant share of the starting mass is 1 − exp(−Δv / (Isp · g₀)). For
  example, 7.67 km/s at 300 s Isp is 92.6 % propellant. The engine (chemical
  300 s, electric 1,500 s, or any value from 200 to 4,000 s) changes how much
  propellant a route needs, never the route itself.
- **What it costs** compares a route with changing height alone: a Hohmann
  transfer between the two orbits. The rest is the price of turning the plane
  and meeting the target where it is. Δv is a vector, so that rest is not split
  further.

## Limits

- Every part of a route keeps its perigee at or above **200 km** and its
  apogee at or below **100,000 km**. The model has no atmosphere, and
  two-body motion stops being honest near the Moon. A satellite whose orbit
  goes beyond either limit cannot be planned with.
- A search looks up to a year ahead. A **time limit** can be set from one hour
  to a year, and a **fuel limit** as Δv from 10 m/s to 20 km/s. Orbitin's clock
  ends in 2050, which can shorten a search; within an hour of its end nothing
  can be planned.
- Not modelled: drag, the Sun's and the Moon's gravity, radiation pressure,
  finite or low-thrust burns, collision checks, and the approach and docking
  at the end.

## Four kinds of route

Every kind ends with the same final arc, which matches the target.

| Kind | Burns | The idea | Typical time |
| --- | --- | --- | --- |
| **Direct** | 2 | One transfer orbit from here to the target, perhaps after waiting for a better moment to leave | Hours to days |
| **Turn at the node** | 3 to 4 | Turn into the target's plane where the two planes cross, then head for the target. With a height change, part of the turn waits for the far end of the climb, where the satellite is slower | Hours to days |
| **Go high to turn** | 3 to 4 | Climb far out, turn where the satellite moves slowly, and come back down. Pays only for a large turn | One to three days |
| **Natural drift** | 3 to 4 | Move to an orbit of another height and wait while Earth's bulge turns the planes at different rates | Days to months |

## The search

- The search runs in a background thread (a Web Worker) in the browser, with
  progress and Cancel. Nothing is sent to a server. The same request always
  gives the same routes.
- **Direct** is searched on a grid of departure and flight times, in both
  directions round Earth and up to a few whole revolutions, then refined
  locally. Between orbits of nearly the same period it also tries long flights
  of many revolutions, because that is how such orbits change their phase.
- **The other kinds** each depend on one or two values, such as the height to
  drift at, how far out to climb, or which crossing of the planes to use. Each
  stage ends in a final arc searched like Direct.
- **The routes offered.** Of all the candidates, only those where none is both
  cheaper and sooner than another are kept. The table shows up to nine of them,
  from the fastest to the cheapest, chosen so that each differs considerably in
  time or fuel. A limit leaves out the routes beyond it; when no route keeps
  within the limits, the nearest are shown instead.
- **Fine-tuning.** A chosen route is first fine-tuned on its own: its final
  arc's departure and flight time are searched to the second. The details say
  what that saved, or that it saved nothing.

## Playback

Playback shows a route in at most a minute. It hurries through waits and holds
the clock for a moment at each burn. When an orbit would pass in under a
second, the orbit is drawn instead of a flickering satellite, and Earth's
rotation is held. During playback the shared clock is paused and set to the
route's instant each frame.

## Accuracy

The numbers are those of the model above. For one route against another they
show the real trade-offs: what a plane change costs, how waiting or drifting
saves Δv, and why climbing first can be cheaper. They are not a prediction for
any real spacecraft.
