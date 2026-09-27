# Privacy

Orbitin counts page views and a few anonymous events, such as "satellite list
loaded" or "link shared", to learn which features are used and where it
breaks. It sets no cookies, stores no identifiers, and records no IP addresses
or search text. Your language choice is kept only in your browser. Shared
scene links keep the scene after `#`, which browsers do not send to the
server. The service runs on Cloudflare, which keeps short-lived request logs
for operating it.

The rest of this page gives the details.

## What your browser keeps

- **Language.** One entry in local storage, `orbitin.locale`, holds the
  interface language you chose. Nothing else is stored in your browser.
- **Your location.** *Show my place* on a phone asks for your location only
  when you switch it on. It is used in memory to draw your place and is
  forgotten when you switch it off or leave; it is never stored, put into a
  link or sent anywhere.
- **Scenes.** Your scenes exist only while the page is open. A shared link
  carries its scene in the fragment after `#`, which browsers never send to a
  server; a scene file stays wherever you save it.
- **Pasted TLE and OMM records** stay in the page and are not uploaded.

## What is counted

**Page views.** [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/)
counts visits, referring sites, countries, browsers, device types and page
performance. It does not use cookies or local storage and does not
fingerprint visitors.

**Anonymous events.** The page sends a small batch of coarse events to
Orbitin's own site (`POST /events/v1`) when you leave the page or after the
first minute. Every event is one of these, with only the values listed:

| Event | When | What it contains |
| --- | --- | --- |
| `visit` | once per page load | desktop or phone, English or Finnish, whether a scene link or an example was opened |
| `mode` | first entry to a mode | Orbit Lab or Real Objects |
| `orbit_created` | an orbit is created | which kind of example orbit |
| `catalogue_loaded` / `catalogue_failed` | the satellite list loads or fails | a load-time range, or a failure class such as "network" |
| `search` | a search leads to an add or to details | a result-count range, never the search text |
| `object_added` | an object is added | how it was added and, for a catalogue object, its public NORAD catalogue number |
| `group_added` | a satellite group is added | the group |
| `example_opened` | an example is opened | the example |
| `share` / `scene_opened` | a link or file is shared or opened | link or file, the mode and an object-count range |
| `view` | the 2D map is maximized or the language changed | which |
| `error` | the 3D view cannot start or stops, or an unexpected error | the kind of error only |

A NORAD catalogue number identifies a public satellite, not you; it tells which
satellites people look at.

Orbitin's server adds the country the request came from and a coarse browser
family (for example "firefox" or "linkedin-app"), then stores each event as a
single anonymous count in Cloudflare Workers Analytics Engine. It does **not**
store your IP address, your browser's user-agent string, a cookie, an
identifier or anything you typed. Each event is kept with the time it
arrived, like any counter, and there is nothing to link one visit to another.

No events are sent when your browser sends **Global Privacy Control** or **Do
Not Track**, or from development builds. A copy of Orbitin hosted by someone
else reports only to its own site, never to Orbitin.

## Cloudflare

Orbitin runs on Cloudflare Workers. Like any web host, Cloudflare processes
requests to deliver the site and keeps short-lived request logs to operate
and protect it. See Cloudflare's [privacy policy](https://www.cloudflare.com/privacypolicy/).

## Questions

Open an issue on [GitHub](https://github.com/Varjola/orbitin/issues).
