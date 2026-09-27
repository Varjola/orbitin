import type { LocaleFormat, UnitWords } from '../format.ts'
import type { ProductMode } from '../../state/AppState.ts'
import type { BudgetedLayer } from '../../state/sceneComplexity.ts'
import type { CatalogueFailure } from '../../data/catalogueFailure.ts'
import type { TleValidationError } from '../../data/tle.ts'
import type { OmmValidationError } from '../../data/omm.ts'
import type { OrbitPropagationErrorCode } from '../../orbital/propagationError.ts'
import type { MessageCatalogue } from './types.ts'

/** The Finnish message catalogue. Written for learners - mainly children
 *  and older people new to space - in plain, natural Finnish rather than as
 *  a literal translation. Important orbital terms show their English beside
 *  them; help texts name the technical Finnish and give the English as
 *  `(engl. …)`. Terms follow the project glossary (`docs/localization.md`
 *  describes the rules). */

export const finnishUnits: UnitWords = {
  degreesPerDay: '°/vrk',
  hour: 'h', minute: 'min', second: 's', durationGap: ' ',
  north: 'P', south: 'E', east: 'I', west: 'L', cardinalGap: ' ',
  clockSeparator: '.',
}

/** Every form of the scene word the Finnish sentences use. The provisional
 *  "tilanne" was replaced with "näkymä"; a later change replaces these forms
 *  and nothing else. */
const S = {
  nom: 'näkymä', gen: 'näkymän', par: 'näkymää', ine: 'näkymässä', ela: 'näkymästä', ill: 'näkymään',
  compound: 'näkymä', plural: 'näkymät',
}

const M: Readonly<Record<ProductMode, string>> = { orbitLab: 'Kiertoradan mekaniikat', realObjects: 'Kiertoratojen kappaleet' }

const cap = (value: string): string => value.charAt(0).toLocaleUpperCase('fi') + value.slice(1)

export function finnish(f: LocaleFormat): MessageCatalogue {
  const count = (value: number, one: string, other: string): string => `${f.integer(value)} ${f.plural(value, { one, other })}`
  const objects = (value: number): string => count(value, 'kohde', 'kohdetta')
  const layerSubjects: Readonly<Record<BudgetedLayer, string>> = {
    orbitPath: 'Radan reitin voi näyttää', groundTrack: 'Maareitin voi näyttää',
    groundTrackHistory: 'Maareitin historian voi tallentaa', sensorGeometry: 'Sensorin geometrian voi näyttää',
  }
  const addToScene = `Lisää ${S.ill}`
  const sceneFull = `${cap(S.nom)} on täynnä`
  const workingSelection = 'Työvalinta'
  const catalogueLoading = 'Ladataan julkaistua luetteloa…'
  const catalogueUnavailable = 'Luettelo ei ole käytettävissä. TLE- ja OMM-tiedot voi silti syöttää käsin.'
  const catalogueRefreshFailed = 'Luettelon päivitys epäonnistui. Viimeisin toimiva luettelo on yhä käytössä.'
  const sceneObjectCount = (mode: ProductMode, value: number): string => mode === 'orbitLab' ? count(value, 'rata', 'rataa') : objects(value)
  // The mode names stay in the nominative after a case-marked 'osio'.
  const inMode = (mode: ProductMode): string => `osiossa ${M[mode]}`
  const fromMode = (mode: ProductMode): string => `osiosta ${M[mode]}`
  const toMode = (mode: ProductMode): string => `osioon ${M[mode]}`

  return {
    units: finnishUnits,

    scene: { noun: S.nom, plural: S.plural },

    /** The Finnish words for the taught terms; the interface shows the
     *  English catalogue's term beside the Finnish label. */
    terms: {
      orbit: 'kiertorata', orbitalElements: 'rataelementit', orbitalPlane: 'ratataso', semiMajorAxis: 'isoakselin puolikas',
      eccentricity: 'eksentrisyys', inclination: 'inklinaatio', ascendingNode: 'nouseva solmu', descendingNode: 'laskeva solmu',
      raan: 'nousevan solmun pituus', argumentOfPeriapsis: 'periapsisin argumentti', periapsis: 'periapsis', apoapsis: 'apoapsis',
      trueAnomaly: 'luonnollinen anomalia', meanAnomaly: 'keskianomalia', argumentOfLatitude: 'leveysargumentti',
      orbitalPeriod: 'kiertoaika', epoch: 'epookki', elementSet: 'ratatiedot', propagation: 'radan laskenta',
      perturbation: 'häiriö', groundTrack: 'maareitti', subSatellitePoint: 'kohta suoraan alapuolella',
      fieldOfView: 'näkökenttä', footprint: 'peittoalue', fieldOfRegard: 'tavoitettava alue', steeringLimit: 'kääntöraja',
      nadir: 'nadiiri', elevationAngle: 'korkeuskulma', slantRange: 'viistoetäisyys', horizon: 'horisontti',
      sunSynchronousOrbit: 'aurinkosynkroninen kiertorata', j2: 'J2', nodalDrift: 'solmun siirtymä', apsidalDrift: 'apsidien siirtymä',
      localMeanSolarTime: 'paikallinen keskiaurinkoaika', betaAngle: 'beetakulma', subSolarPoint: 'Auringon alapiste',
      geocentricLatitude: 'geosentrinen leveys', longitude: 'pituus', altitude: 'korkeus',
      leo: 'matala Maan kiertorata', meo: 'keskikorkea Maan kiertorata', geo: 'geostationaarinen rata', heo: 'hyvin elliptinen kiertorata',
      polarOrbit: 'polaarirata', catalogue: 'satelliittiluettelo',
    },

    shell: {
      productMode: 'Osion valinta',
      modeNote: `Kummallakin osiolla on oma ${S.nom}, niin kauan kuin sivu on auki.`,
      modes: M,
      workspace: 'Työtila',
      workspaceHeading: { orbitLab: 'Muokkaa rataa', realObjects: 'Lisää kappale' },
      expandWorkspace: 'Laajenna työtila',
      collapseWorkspace: 'Pienennä työtila',
      inspector: 'Tiedot',
      expandInspector: 'Laajenna tiedot',
      collapseInspector: 'Pienennä tiedot',
      createOrbitRegion: 'Luo rata',
      catalogueAccess: 'Luettelon käyttö',
      sceneObjectsRegion: `${cap(S.gen)} kohteet`,
      timeControls: 'Ajan säätimet',
      viewControls: 'Näytön säätimet',
      catalogueNotLoaded: 'Luetteloa ei ole ladattu',
      catalogueLoading,
      catalogueUnavailable,
      catalogueRefreshFailed,
      catalogueLoaded: (entryCount: number) => `Luettelo ladattu · ${objects(entryCount)}`,
      editOrbitNoSelection: `Valitse ${S.ela} rata muokattavaksi tai luo uusi rata.`,
      editOrbitMultiple: 'Valitse vain yksi rata, niin voit muuttaa sen muotoa ja asentoa.',
      sceneLimit: (max: number) => `${cap(S.ine)} voi olla enintään ${max} kohdetta. Poista jokin kohde, jotta voit lisätä uuden.`,
      objectCount: (value: number, max: number) => `${value} / ${max} kohdetta`,
      selectedCount: (value: number) => `${value} valittuna`,
      sourceLabels: {
        keplerian: `${M.orbitLab} · oma rata`, tle: `${M.realObjects} · liitetty TLE`,
        catalogue: `${M.realObjects} · julkaistu luettelotietue`, omm: `${M.realObjects} · liitetty OMM-tietue`,
      },
      layerBudget: (layer: BudgetedLayer, budget: number, wouldBe: number) => `${layerSubjects[layer]} enintään ${budget} kohteelle kerrallaan. Päällä olisi ${wouldBe}. Ota joitakin pois päältä tai valitse vähemmän kohteita.`,
    },

    options: {
      label: 'Valinnat',
      about: 'Tietoja Orbitinista',
    },

    about: {
      title: 'Tietoja Orbitinista – Kiertoratojen opetustyökalu',
      close: 'Sulje Tietoja Orbitinista',
      closeTitle: 'Sulje',
      summary: 'Orbitin on vuorovaikutteinen työkalu kiertoratojen ja satelliittien tutkimiseen. Sen avulla voi oppia, miten kiertoradat toimivat, sekä kolmiulotteisen Maan ympärillä että kaksiulotteisella maareittikartalla.',
      educationalNote: 'Vain opetus- ja havainnollistuskäyttöön. Ei sovellu törmäysvaaran arviointiin eikä operatiivisiin päätöksiin.',
      creditsHeading: 'Aineistot ja kiitokset',
      links: { source: 'Lähdekoodi GitHubissa', models: 'Mallit ja rajoitukset', feedback: 'Palaute: GitHubin Issues-sivu', privacy: 'Tietosuoja' },
      madeBy: 'Tekijä',
      privacyLine: 'Orbitin laskee sivun katselukerrat ja muutamia nimettömiä tapahtumia nähdäkseen, mitä käytetään ja missä tulee virheitä. Se ei käytä evästeitä eikä tallenna tunnisteita.',
      licence: 'Lähdekoodi © 2026 Lauri Varjola, julkaistu MIT-lisenssillä. Muiden tekijöiden aineistoilla ja kuvilla on omat ehtonsa.',
      creditSubjects: {
        orbitalData: 'Ratatiedot', earthImagery: 'Maan kuvat', milkyWay: 'Linnunrata',
        stars: 'Tähdet', coastlines: 'Rantaviivat', sgp4: 'SGP4-ratalaskenta',
      },
      versionLabel: (version: string, preRelease: boolean) => `${preRelease ? 'BETA ' : 'Versio '}${version}`,
      versionDetails: (revision: string, environment: string) => `revisio ${revision} · ${environment}`,
      changelogTitle: 'Versioiden muutokset (englanniksi)',
    },

    loading: {
      title: 'Orbitin valmistautuu',
      textures: 'Ladataan Maan kuvia…',
      texturesProgress: (loaded: number, total: number) => `Ladataan Maan kuvia ${loaded}/${total}…`,
      unavailableTitle: 'Orbitin ei ole käytettävissä',
      unknownError: '3D-näkymän käynnistyksessä tapahtui odottamaton virhe.',
      requirements: 'Orbitin tarvitsee selaimen, joka tukee WebGL2-grafiikkaa.',
      initializationFailed: '3D-näkymää ei voitu käynnistää.',
      failures: {
        webgl: { title: 'Selain ei käynnistänyt 3D-näkymää', detail: 'Orbitin tarvitsee WebGL2-grafiikkaa, eikä tämä selain tai laite tarjonnut sitä.', hint: 'Päivitä selain tai ota laitteistokiihdytys käyttöön selaimen asetuksista ja lataa sivu sitten uudelleen.' },
        textures: { title: 'Maata ei voitu ladata', detail: 'Maan kuvat eivät latautuneet.', hint: 'Tarkista verkkoyhteys ja yritä uudelleen.' },
        contextLost: { title: '3D-näkymä pysähtyi', detail: 'Selain nollasi grafiikkansa. Näin voi käydä, kun laitteen muisti on vähissä.', hint: 'Jatka lataamalla sivu uudelleen. Jaettu linkki säilyttää näkymänsä.' },
        frame: { title: 'Jokin meni vikaan', detail: 'Orbitin lopetti näkymän piirtämisen odottamattoman virheen jälkeen.', hint: 'Jatka lataamalla sivu uudelleen.' },
      },
      retry: 'Yritä uudelleen',
      reload: 'Lataa uudelleen',
    },

    firstVisit: {
      orbitLab: 'Avaa vasemmalta Muokkaa rataa ja muuta rataa liukusäätimillä.',
      realObjects: 'Ota luettelo käyttöön ja hae sitten satelliittia, esimerkiksi ISS.',
      dismiss: 'Sulje vihje',
    },

    orbitLab: {
      emptyTitle: 'Ei näytettäviä kappaleita',
      emptyText: 'Luo rata ja muuta sen muotoa, tai valitse vertailtavaksi valmis esimerkki.',
      tabList: 'Radan työkalut',
      tabs: { edit: 'Muokkaa rataa', examples: 'Esimerkit' },
      examplesIntro: 'Yksinkertaistettuja lähtökohtia. Ne eivät ole luettelon oikeita satelliitteja.',
      lessonHeading: 'Maareitti',
      lessonText: 'Piste näyttää kohdan, joka on Maan pinnalla suoraan kappaleen alapuolella. Yhtenäinen viiva on edellinen kierros ja katkoviiva seuraava kierros, jonka valittu malli ennustaa. Maareitin viivalla ei ole leveyttä, eikä se näytä, kuinka laajalle alueelle kappale näkee. Vertaa LEO-rataa ja GEO-rataa, kallistettua LEO-rataa ja polaarirataa sekä polaarirataa ja aurinkosynkronista rataa, kun yhteinen kello kulkee eteen- tai taaksepäin.',
      sensorLesson: 'Laita Sensorin geometria päälle ja anna LEO- ja GEO-kappaleelle sama näkökentän puolikulma, esimerkiksi 5°. Sensori on molemmissa sama. Vertaa peittoalueen sädettä, keskuskulmaa, pinta-alaa, viistoetäisyyttä ja reunan korkeuskulmaa, ja katso, rajaako horisontti jompaakumpaa peittoaluetta. Mieti sitten, millaisen puolikulman kumpikin rata tarvitsisi, jotta ne näkisivät maassa yhtä suuren alueen. Nosta lopuksi pienintä korkeuskulmaa ja katso, miten käytännön yhteysraja pienentää aluetta horisontin sisällä.',
      setOrbit: 'Aseta rata',
      setOrbitTo: (name: string) => `Aseta radaksi ${name}`,
      createOrbit: 'Luo rata',
      orbitKinds: {
        leo: { code: 'LEO', name: 'Matala rata' }, meo: { code: 'MEO', name: 'Keskikorkea rata' },
        geo: { code: 'GEO', name: 'Geostationaarinen rata' }, heo: { code: 'HEO', name: 'Hyvin soikea rata' },
      },
      selectOneTitle: 'Valitse rata muokattavaksi',
      selectOneText: 'Luo rata tai valitse kohde olemassa olevien kohteiden luettelosta.',
      startingExample: (note: string) => `Lähtökohta: ${note}`,
      geometryHeading: 'Radan muoto ja asento',
      geometryHint: 'koko, muoto ja taso',
      modelHeading: 'Radan malli',
      modelHint: 'miten rata muuttuu ajan myötä',
      modelLabel: 'Radan malli',
      models: { idealTwoBody: 'Ihanteellinen kahden kappaleen rata', j2Secular: 'J2-siirtymä' },
      lockTitle: 'Laskee kaltevuuden niin, että ratataso pysyy keskimääräisen Auringon tahdissa.',
      lockLabel: 'Pidä aurinkosynkronisena',
      positionHeading: 'Kappaleen sijainti',
      positionHint: 'missä kappale on nyt',
      phaseTitle: 'Siirrä kappaletta radalla muuttamatta radan muotoa.',
      trueAnomaly: 'Paikka radalla',
      minimumPeriapsis: `Periapsis on alle Orbitinin ${f.integer(200)} km:n rajan. Ilmakehän vastus ei kuulu tähän kahden kappaleen malliin.`,
      maximumApoapsis: `Apoapsis on yli ${f.integer(60_000)} km:n rajan, johon tämän työkalun näkymä on mitoitettu.`,
      circular: 'Ympyrärata: radan lähin kohta ei ole yksiselitteinen, joten periapsisin argumentti ja paikka radalla eivät tässä ole kumpikaan yksiselitteisiä.',
      equatorial: 'Päiväntasaajan rata: nousevaa solmua ei voi määrittää yksiselitteisesti, joten nousevan solmun pituus ei yksinään ole yksiselitteinen. Nousevan solmun pituus ja periapsisin argumentti voivat korvata toisiaan.',
    },

    elements: {
      semiMajorAxisKm: { label: 'Radan koko', help: 'Radan koko. Mitä suurempi arvo, sitä kauemmin yksi kierros kestää. Tähtitieteessä tätä kutsutaan isoakselin puolikkaaksi (engl. semi-major axis).' },
      eccentricity: { label: 'Radan soikeus', help: 'Kuinka soikea rata on. Nolla on täysi ympyrä. Tähtitieteessä tätä kutsutaan eksentrisyydeksi (engl. eccentricity).' },
      inclinationRad: { label: 'Radan kaltevuus', help: 'Kuinka paljon ratataso on kallellaan päiväntasaajaan nähden. Tähtitieteessä tätä kutsutaan inklinaatioksi (engl. inclination).' },
      raanRad: { label: 'Nousevan solmun pituus', help: 'Kääntää kohtaa, jossa kappale ylittää päiväntasaajan etelästä pohjoiseen. Suunta mitataan päiväntasaajaa pitkin (engl. RAAN).' },
      argOfPeriapsisRad: { label: 'Periapsisin argumentti', help: 'Kääntää radan lähintä kohtaa (periapsis) ratatason sisällä. Arvo kertoo, missä kohtaa rataa lähin piste on (engl. argument of periapsis).' },
    },

    presets: {
      leo: { name: 'LEO-esimerkki', description: `Matala Maan kiertorata: ympyrärata 500 km Maan yläpuolella, ${f.number(51.5, 1)}° kallellaan päiväntasaajaan nähden.` },
      meo: { name: 'MEO-esimerkki', description: 'Keskikorkea Maan kiertorata: korkeampi ympyrärata, jonka kierros kestää kauemmin kuin LEO-radalla. Paikannussatelliitit käyttävät tämänkokoisia ratoja.' },
      geo: { name: 'GEO-geometrian esimerkki', description: 'Päiväntasaajan ympyrärata, jonka kierros kestää tähtivuorokauden eli noin 23 h 56 min. Se kiertää Maan pyörimisen tahdissa ja pysyy lähes saman pituuspiirin kohdalla.' },
      polar: { name: 'Polaarisen LEO-radan esimerkki', description: `Ympyrärata 800 km Maan yläpuolella. Sen ratataso kulkee molempien napojen kautta. Vertaa sitä aurinkosynkroniseen esimerkkiin, joka on samalla korkeudella ja vain ${f.number(8.6, 1)}° kaltevampi. Kun J2-siirtymä on päällä, tämän radan taso kiertää vuodessa kaikkien paikallisten aurinkoaikojen läpi, mutta toinen rata pitää ylitysaikansa.` },
      elliptical: { name: 'Hyvin soikean radan esimerkki', description: `Venytetty rata. Sen lähin ja kaukaisin kohta ovat ${f.integer(6916)} km ja ${f.integer(46_284)} km päässä Maan keskipisteestä. Kappale liikkuu nopeimmin lähimmän kohdan lähellä. Radan ${f.number(63.5, 1)}°:n kaltevuus on niin sanottu kriittinen kaltevuus: J2-vaikutus ei silloin siirrä radan lähintä kohtaa, vaan periapsis pysyy paikallaan.` },
      sso: { name: 'Aurinkosynkronisen radan esimerkki (laskeva solmu klo 10.30)', description: 'Ympyrärata 800 km Maan yläpuolella. Sen ratataso kääntyy itään samaa tahtia kuin keskimääräinen Aurinko, joten rata ylittää päiväntasaajan etelään mennessä klo 10.30 ja pohjoiseen mennessä klo 22.30 paikallista keskiaurinkoaikaa. Kaltevuus lasketaan radan korkeudesta, ja nousevan solmun pituus lasketaan tuosta ylitysajasta sillä hetkellä, kun lisäät radan. Siksi eri päivänä lisätty rata saa eri nousevan solmun pituuden.' },
    },

    notes: {
      default: 'Ihanteellisen kahden kappaleen radan esittely',
      tle: 'Todellinen TLE-rata, laskettu SGP4/SDP4-mallilla',
      omm: 'Todellinen OMM-rata, laskettu SGP4/SDP4-mallilla',
      catalogue: 'Todellinen luettelotietue, laskettu SGP4/SDP4-mallilla',
    },

    names: {
      defaultOrbit: 'Tutkimusrata',
      first: [
        'Rohkea', 'Nopea', 'Iloinen', 'Utelias', 'Kirkas', 'Hiljainen', 'Sininen', 'Kultainen', 'Hopeinen', 'Uljas',
        'Reipas', 'Ketterä', 'Leppoisa', 'Pieni', 'Suuri', 'Vilkas', 'Uninen', 'Viisas', 'Valpas', 'Hohtava',
        'Loistava', 'Säkenöivä', 'Tuikkiva', 'Hurja', 'Rauhallinen', 'Sitkeä', 'Kekseliäs', 'Kaukainen', 'Pyörivä', 'Hymyilevä',
        'Ahkera', 'Pirteä', 'Välkkyvä', 'Punainen', 'Vihreä', 'Tähtinen', 'Lempeä', 'Ovela', 'Sievä', 'Tarkka',
        'Leikkisä', 'Ujo', 'Vauhdikas', 'Hauska', 'Pehmeä', 'Hellä', 'Mahtava', 'Kiltti', 'Sinnikäs', 'Pöllö',
      ] as readonly string[],
      second: [
        'Tutkija', 'Kulkija', 'Vartija', 'Lähetti', 'Retkeilijä', 'Etsijä', 'Tähystäjä', 'Matkaaja', 'Kiertäjä', 'Airut',
        'Majakka', 'Luotain', 'Seikkailija', 'Liitäjä', 'Pyörijä', 'Kartoittaja', 'Tiedustelija', 'Vaeltaja', 'Merenkulkija', 'Havaitsija',
        'Välittäjä', 'Löytäjä', 'Kurkkija', 'Hyppijä', 'Pomppija', 'Kellija', 'Uneksija', 'Tuumailija', 'Näpertäjä', 'Leijailija',
        'Pyrähtäjä', 'Kiitäjä', 'Pyöräilijä', 'Kulkuri', 'Sukkula', 'Tuulispää', 'Kolibri', 'Siili', 'Orava', 'Kettu',
        'Ilves', 'Pöllö', 'Tiainen', 'Pääsky', 'Majava', 'Kurki', 'Joutsen', 'Hirvi', 'Karhu', 'Saukko',
      ] as readonly string[],
      compose: (first: string, second: string) => `${first} ${second}`,
    },

    inspector: {
      emptyTitle: 'Valitse kohde, niin näet sen tiedot',
      emptyText: 'Valitse kohde olemassa olevien kohteiden luettelosta.',
      bulkDisplay: 'Näytä kaikille valituille',
      layers: {
        orbitPath: 'Radan reitti', groundTrack: 'Maareitti',
        groundTrackHistory: 'Tallenna maareitin historia', sensorGeometry: 'Sensorin geometria',
      },
      layersForAll: {
        orbitPath: 'Radan reitti kaikille valituille kohteille', groundTrack: 'Maareitti kaikille valituille kohteille',
        groundTrackHistory: 'Maareitin historian tallennus kaikille valituille kohteille', sensorGeometry: 'Sensorin geometria kaikille valituille kohteille',
      },
      colour: 'Väri',
      colourForAll: 'Väri kaikille valituille kohteille',
      orbitColour: 'Radan väri',
      revealSelected: 'Näytä valitut',
      fitSelected: 'Sovita valitut näkymään',
      removeSelected: 'Poista valitut',
      clearSelection: 'Poista valinta',
      confirmRemoval: 'Vahvista poisto',
      remove: 'Poista',
      cancel: 'Peruuta',
      bulkNote: 'Radan muokkaus, sensorin asetukset ja merkin koko koskevat yhtä kohdetta kerrallaan.',
      bulkCount: (value: number) => `${objects(value)} valittuna`,
      bulkNames: (names: readonly string[], more: number) => more > 0 ? `${names.join(', ')} ja ${more} muuta` : names.join(', '),
      nameLabel: 'Nimi',
      nameAccessible: 'Kohteen nimi',
      reveal: 'Näytä',
      focus: 'Käännä näkyviin',
      focusTitle: 'Kääntää kameraa niin, että tämä kohde tulee kameran puolelle. Etäisyys pysyy samana.',
      sourceWithGroups: (source: string, groups: readonly string[]) => `${source} · ${groups.join(', ')}`,
      display: 'Näyttö',
      markerTitle: 'Merkit on piirretty tarkoituksella suuriksi, jotta ne näkyvät hyvin.',
      markerSize: 'Merkin koko',
      showOrbitPath: 'Näytä radan reitti',
      showGroundTrack: 'Näytä maareitti',
      historyTitle: 'Tallentaa maareitin, joka jää näkyviin.',
      earthRelativeHeading: 'Sijainti Maan pinnalla',
      earthRelativeHint: 'nykyinen kohta',
      geocentricLatitude: 'Leveysaste',
      eastLongitude: 'Pituusaste',
      trackWindow: 'Maareitin jakso',
      windowNominal: 'Edellinen ja seuraava kierros',
      windowRecording: 'Tallennettu päälle laitosta asti',
      groundTrackModelNote: 'Leveys on laskettu Maan keskipisteestä, ja pituus kasvaa itään päin piirretyllä pallonmuotoisella Maalla. Edelliset kohdat on laskettu mallista, eivät tallennetusta historiasta.',
      longitudeUndefined: 'Ei määritelty navalla',
      sensorReadouts: 'Sensorin lukemat',
      sensorReadoutsHint: 'tällä hetkellä',
      fieldOfViewHalfAngle: 'Näkökentän puolikulma',
      fullConeAngle: 'Koko kartion kulma',
      pointing: 'Suuntaus',
      nadir: 'Suoraan alas',
      steeringLimit: 'Kääntöraja',
      horizonHalfAngle: 'Horisontin puolikulma',
      minimumGroundElevation: 'Pienin korkeuskulma',
      elevationReached: (elevation: string, offNadir: string) => `${elevation}, saavutetaan ${offNadir} päässä suoraan alas osoittavasta suunnasta`,
      noElevationLimit: 'Ei rajaa (geometrinen horisontti)',
      caps: {
        footprint: {
          surfaceRadius: 'Peittoalueen säde', centralAngle: 'Peittoalueen keskuskulma', area: 'Peittoalueen pinta-ala',
          edgeElevation: 'Peittoalueen reunan korkeuskulma', slantRange: 'Viistoetäisyys peittoalueen reunaan', highestLatitude: 'Peittoalueen suurin leveysaste', limitedBy: 'Peittoalueen rajaa',
        },
        fieldOfRegard: {
          surfaceRadius: 'Tavoitettavan alueen säde', centralAngle: 'Tavoitettavan alueen keskuskulma', area: 'Tavoitettavan alueen pinta-ala',
          edgeElevation: 'Tavoitettavan alueen reunan korkeuskulma', slantRange: 'Viistoetäisyys tavoitettavan alueen reunaan', highestLatitude: 'Tavoitettavan alueen suurin leveysaste', limitedBy: 'Tavoitettavaa aluetta rajaa',
        },
      },
      capArea: (area: string, percent: string) => `${area} (${percent} Maan pinnasta)`,
      limitedBy: { sensor: 'sensorin kulma', elevation: 'pienin korkeuskulma', horizon: 'horisontti' },
      liveReadouts: 'Lukemat nyt',
      live: 'NYT',
      period: 'Kiertoaika',
      periapsisAltitude: 'Periapsisin korkeus',
      apoapsisAltitude: 'Apoapsisin korkeus',
      currentAltitude: 'Korkeus',
      currentSpeed: 'Nopeus',
      speed: (value: string) => `${value} km/s`,
      sgp4Heading: 'SGP4-lähtötiedot',
      sgp4Hint: 'keskiarvot epookissa',
      metadata: {
        format: 'Muoto', name: 'Nimi', catalogueId: 'Luettelotunnus', internationalDesignator: 'Kansainvälinen tunnus',
        classification: 'Luokitus', epoch: 'Epookki', ephemerisType: 'Efemeridityyppi', elementSet: 'Ratatietojen numero',
        revolution: 'Kierros epookissa', nominalPeriod: 'Kiertoaika', inclination: 'Radan kaltevuus', eccentricity: 'Radan soikeus',
        raan: 'Nousevan solmun pituus', argumentOfPerigee: 'Periapsisin argumentti', meanAnomaly: 'Keskianomalia', source: 'Lähde', snapshot: 'Luetteloversio',
        sourceRetrieved: 'Lähdetiedot haettu', cataloguePublication: 'Luettelo julkaistu',
      },
      formats: { tle: 'TLE / 3LE', omm: 'OMM (JSON)' },
      manualTle: 'Käsin liitetty TLE / 3LE',
      manualOmm: 'Käsin liitetty OMM (JSON)',
      noradName: (catalogId: string) => `NORAD ${catalogId}`,
      modelNote: 'Auringon suunta ja Maan asento lasketaan simulaation ajasta.',
      sgp4ModelNote: 'SGP4-laskennan tulos on TEME-koordinaatistossa, ja se muunnetaan Orbitinin avaruuskoordinaatistoon. Ratatietojen ikä on vain suuntaa-antava varoitus, ei virheen yläraja.',
      propagationError: (message: string) => `Laskentavirhe: ${message}`,
      noSgp4State: 'Tälle hetkelle ei ole SGP4-sijaintia.',
      elementAge: {
        near: 'Lähellä epookkia: tämä kertoo vain ajallisesta etäisyydestä, ei sijainnin tarkkuudesta.',
        caution: 'Huomio: valittu hetki on yli kolmen päivän päässä ratatietojen epookista. Epävarmuus riippuu kappaleesta ja olosuhteista.',
        strong: 'Vahva ikävaroitus: valittu hetki on yli neljäntoista päivän päässä ratatietojen epookista. SGP4-lähtötiedoille ei ole yleistä virherajaa.',
      },
    },

    drift: {
      heading: 'Ratatason siirtymä',
      hint: 'arvot nyt, ei epookissa',
      nodalDrift: 'Solmun siirtymä',
      apsidalDrift: 'Apsidien siirtymä',
      solarTimeAscending: 'Paikallinen aurinkoaika, nouseva solmu',
      solarTimeDescending: 'Paikallinen aurinkoaika, laskeva solmu',
      betaAngle: 'Beetakulma',
      angleReadouts: {
        raan: 'Nousevan solmun pituus nyt', argOfPeriapsis: 'Periapsisin argumentti nyt', argOfLatitude: 'Leveysargumentti nyt',
        longitudeOfPeriapsis: 'Periapsisin pituus nyt', meanLongitude: 'Keskipituus nyt',
      },
      substitutedQuantities: {
        raan: 'nousevan solmun pituus', argOfPeriapsis: 'periapsisin argumentti', argOfLatitude: 'leveysargumentti',
        longitudeOfPeriapsis: 'periapsisin pituus', meanLongitude: 'keskipituus',
      },
      betaNote: 'Beetakulma kertoo, kuinka korkealla Aurinko on ratatasosta katsottuna. Se ratkaisee, kuinka suuri osa kierroksesta on auringonvalossa ja milloin kappale on Maan varjossa. Aurinkosynkroninen rata pitää ylitysaikansa mutta ei valaistustaan: beetakulma vaihtelee vuodenaikojen mukaan.',
      nodalSignNote: 'Negatiivinen solmun siirtymä tarkoittaa, että nouseva solmu siirtyy länteen.',
      equatorialDriftNote: `Kun radan koko on kahden kappaleen mallin mukainen synkroninen koko, tämä keskipituus siirtyy itään noin ${f.number(0.027, 3)}${finnishUnits.degreesPerDay}, eli asteen noin 37 simuloidussa vuorokaudessa. Litistynyt Maa vetää voimakkaammin kuin pistemäinen massa, joten tässä mallissa synkronisen radan koon on oltava noin ${f.number(2.1, 1)} km suurempi. Tämä ei ole radanpitomalli: oikean geostationaarisen satelliitin itä–länsi-ajelehtiminen johtuu tekijöistä, joita tässä mallissa ei ole.`,
      nodeSingular: 'Päiväntasaajan radalla ei ole yksiselitteistä nousevaa solmua, joten sillä ei ole solmun siirtymää eikä paikallista ylitysaikaa.',
      nodeIllConditioned: (thresholdDegrees: string) => `Nousevan solmun pituutta ei näytetä, kun kaltevuus on alle ${thresholdDegrees}°. Silloin solmun suunta on huonosti määritelty: solmu on olemassa, mutta tämä malli ei osaa sijoittaa sitä asteen tarkkuudella.`,
      periapsisSingular: 'Ympyräradalla ei ole yksiselitteistä lähintä kohtaa (periapsis), joten sillä ei ole apsidien siirtymää.',
      periapsisIllConditioned: (threshold: string) => `Periapsisin argumenttia ei näytetä, kun soikeus on alle ${threshold}. Silloin keskiradan lähin kohta ei ole tämän mallin tarkkuudella tunnistettava piste: se on olemassa, mutta mallista puuttuvat lyhytjaksoiset vaihtelut siirtäisivät sitä.`,
      meaningfulQuantity: (quantity: string) => `Tässä merkityksellinen suure on radan ${quantity}.`,
      modelNotes: {
        j2Secular: 'Maan litistyneisyyden (J2) aiheuttama ratatason hidas siirtymä keskiarvoilla laskettuna. Ei ilmanvastusta, ei Auringon tai Kuun vaikutusta eikä lyhytjaksoisia vaihteluita. Keskiarvot ja hetkelliset rata-arvot ovat eri suureita, eikä tämä malli muunna niitä toisikseen. Negatiivinen solmun siirtymä tarkoittaa siirtymää länteen.',
        sgp4: 'SGP4/SDP4-laskenta TLE- tai OMM-tiedoista. Lähdetiedot ovat keskiarvoja epookissaan, eivät muokattava tavallinen rata.',
        idealTwoBody: 'Ihanteellinen kahden kappaleen rata. Ratataso pysyy paikallaan avaruudessa.',
      },
      lockApplied: (inclination: string) => `Aurinkosynkroninen: kaltevuudeksi laskettiin ${inclination}° radan koosta ja muodosta, jotta solmu siirtyy ${f.number(0.99, 2)}${finnishUnits.degreesPerDay}. Nousevan solmun pituuteen ei kosketa, koska se määrää paikallisen ylitysajan.`,
      lockUnattainable: (semiMajorAxisKm: string, altitudeKm: string) => `Mikään kaltevuus ei pidä tämän radan tasoa Auringon tahdissa, kun radan koko on yli ${semiMajorAxisKm} km (${altitudeKm} km korkeudella): Maan litistyneisyyden vaikutus heikkenee nopeammin kuin tarvittava siirtymä pienenee. Asettamasi arvo pidetään, ja lukitus on pois päältä.`,
      lockReleasedByInclination: 'Aurinkosynkroninen lukitus vapautui: asetit kaltevuuden itse, joten solmu siirtyy nyt sen mukaan, ja paikallinen ylitysaika muuttuu sen myötä.',
      lockReleasedByPropagation: 'Aurinkosynkroninen lukitus vapautui: ihanteellisessa kahden kappaleen mallissa solmu ei siirry, joten lukittavaa ei ole.',
      lockRequiresJ2: 'Pidä aurinkosynkronisena toimii vain J2-siirtymän mallissa. Vaihda ensin radan malli.',
    },

    sensor: {
      heading: 'Sensorin geometria',
      hint: 'yksinkertaistettu, tällä hetkellä',
      toggle: 'Sensorin geometria',
      show: 'Näytä sensorin geometria',
      viewHalfAngle: 'Näkökentän puolikulma',
      steeringLimit: 'Kääntöraja',
      reachHeading: 'Näkyvyysraja maasta katsottuna',
      minimumGroundElevation: 'Pienin korkeuskulma',
      fieldOfViewHint: 'Pyöreän näkökentän puolikulma suoraan alaspäin osoittavasta suunnasta mitattuna. Se on sensorin ominaisuus: 5°:n sensori on 5° kaikilla korkeuksilla, ja vain sen tuottama peittoalue muuttuu. Kirjoita tarkka arvo tai vedä liukusäädintä (engl. field of view).',
      steeringHint: 'Suurin kulma, jonka verran sensoria voi kääntää pois suoraan alas osoittavasta suunnasta. Tavoitettava alue ulottuu näkökentän puolikulman ja tämän kääntörajan summaan asti (engl. steering limit).',
      elevationHint: 'Tämä ei ole sensorin ominaisuus. Se jättää pois paikat, joista katsottuna kappale on tätä matalammalla horisontin yläpuolella. 0° on pelkkä geometrinen näkyvyys; 5–10° kuvaa tavallista pienintä käyttökelpoista korkeuskulmaa maa-asemayhteydelle. Arvo on sama kaikkiin suuntiin, eikä se ota huomioon sadetta, heijastuksia, maastoa tai antennia (engl. elevation angle).',
      keplerianNote: 'Yksinkertaistettu pyöreä sensori. Nykyinen peittoalue on suoraan kappaleen alla; ulompi tavoitettava alue näyttää, minne sensorin voi kääntää, ei kertynyttä peittoa.',
      realObjectNote: 'Yksinkertaistettu pyöreä sensori. Nämä asetukset ovat tutkimista varten, eivätkä ne tule kohteen TLE-, OMM- tai luettelotiedoista.',
      degreesValue: (value: string) => `${value} astetta`,
      limitLabels: { horizon: 'Horisontti', elevation: 'Pienin korkeuskulma', sensor: 'Sensorin kulma' },
      nearPeriapsis: 'periapsisin lähellä',
      atThisOrbit: 'tällä radalla',
      minimumElevationLimit: 'pienimmän korkeuskulman rajan',
      theHorizon: 'horisontin',
      usefulRange: (where: string, limit: string) => `Hyödyllinen alue ${where}: 0–${limit}.`,
      pastLimit: (angle: string, limitName: string) => `${angle} ulottuu ${limitName} yli, joten peittoalue loppuu siihen; leveämpi kulma ei lisää aluetta.`,
      steeringBlocked: (limitName: string, where: string) => `Näkökentän puolikulma yltää ${where} jo ${limitName} kohdalle, joten kääntäminen ei laajenna tavoitettavaa aluetta.`,
      usefulSteering: (where: string, limit: string) => `Hyödyllinen kääntö ${where}: 0–${limit}.`,
      steeringPastLimit: (angle: string, limitName: string) => `${angle} ulottuu ${limitName} yli, joten tavoitettava alue loppuu siihen.`,
    },

    time: {
      expand: 'Laajenna ajan säätimet',
      collapse: 'Pienennä ajan säätimet',
      controls: 'Ajan säätimet',
      currentTime: 'Simulaation aika nyt',
      pauseSimulation: 'Pysäytä simulaatio',
      playSimulation: 'Käynnistä simulaatio',
      pause: 'Pysäytä',
      play: 'Käynnistä',
      speedSteps: { 1: '1×', 60: '1 min/s', 600: '10 min/s', 3600: '1 h/s' },
      speedCycle: (current: string, next: string) => `Toistonopeus ${current}. Vaihda nopeuteen ${next}`,
      setSpeed: (label: string) => `Aseta toistonopeudeksi ${label}`,
      simulationTime: 'Simulaation aika',
      dateTimeUtc: 'Päivä ja aika (UTC)',
      now: 'Nyt',
      reset: 'Palauta oletus',
      supportedRange: 'Tuettu aikaväli: 1950–2050.',
      limitReached: 'Tuetun aikavälin raja tuli vastaan. Toista aikaa taaksepäin tai valitse toinen UTC-päivä.',
      invalidInput: 'Anna täydellinen UTC-päivä ja -aika vuosilta 1950–2050.',
      animation: 'Animaatio',
      animationHint: 'keskianomalia',
      animationHintRealObjects: 'SGP4-sijainnit',
      live: 'Reaaliaika',
      liveTitle: 'Kello seuraa todellista aikaa.',
      goLive: 'Siirry nykyhetkeen normaalinopeudella',
      currentSpeed: 'Nopeus',
      reverse: 'Taaksepäin',
      reversePlayback: 'Toista taaksepäin',
      speedTitle: 'Toistonopeus muuttaa ajan kulkua, ei radan muotoa.',
      playbackSpeed: 'Toistonopeus',
      speedRange: (max: string) => `1× — ${max}`,
      environment: 'Ympäristö',
      subSolarPoint: 'Auringon alapiste',
      subSolarValue: (latitude: string, latitudeHemisphere: string, longitude: string, longitudeHemisphere: string) => `${latitude}° ${latitudeHemisphere}, ${longitude}° ${longitudeHemisphere}`,
      samplingSampled: 'Kappaleen paikka lasketaan kerran jokaista piirrettyä kuvaa kohden, ja tällä nopeudella peräkkäiset kuvat ovat kaukana toisistaan radalla. Jokainen piirretty paikka on oikein omalla hetkellään.',
      samplingPlaneOnly: 'Tällä nopeudella kappale ehtii kuvien välillä yli kuudesosan kierroksestaan, joten sen merkki on himmennetty. Nyt rata, ratataso ja siirtymälukemat havainnollistavat liikettä. Näkymään ei piirretä paikkaa, jota simulaatio ei ole laskenut.',
    },

    view: {
      expand: 'Laajenna näytön säätimet',
      collapse: 'Pienennä näytön säätimet',
      controls: 'Näytön säätimet',
      kicker: 'Näyttö',
      fitVisible: 'Sovita näkyvät radat',
      openMap: 'Avaa 2D-maareittikartta',
      markerScalingTitle: 'Kaukana olevat merkit kasvavat, jotta ne näkyvät eivätkä katoa radan reitin sisään.',
      markerScaling: 'Muuta merkkien kokoa zoomatessa',
      allOrbitPaths: 'Kaikki radat',
      showAllOrbitPaths: 'Näytä kaikkien kohteiden radat',
      allHistories: 'Kaikki maareittien historiat',
      showAllHistories: 'Näytä kaikkien kohteiden maareittien historiat',
      allSensors: 'Kaikki sensorit',
      showAllSensors: 'Näytä kaikkien kohteiden sensorin geometria',
    },

    look: {
      heading: 'Ulkoasu',
      mapEarth: 'Karttamaapallo',
      mapEarthTitle: 'Karttapallo valtioiden rajoineen satelliittikuvan sijaan. Rajat ovat Natural Earthin tosiasiallisia rajoja; kiistanalaiset näkyvät katkoviivana.',
      lab: 'Laboratoriotausta',
      labTitle: 'Vaalea näkymä, jossa pelkistetty maapallo on ruudukkolaatikon sisällä.',
      notInLab: 'Laboratoriotaustan pallo on aina pelkistetty.',
      mapUnavailable: 'Karttamaapalloa ei voitu ladata; maapallo näytetään kuvana.',
      bordersUnavailable: 'Valtioiden rajoja ei voitu ladata.',
      gridLegend: (spacingRadii: number) => `Ruudukko: 1 ruutu = ${spacingRadii === 1 ? '1 maapallon säde' : `${f.exact(spacingRadii)} maapallon sädettä`} (${f.integer(spacingRadii * 6378)} km)`,
      gridBeyond: 'Jokin rata ulottuu laatikon ulkopuolelle.',
    },

    map: {
      title: '2D-kartta',
      close: 'Sulje kartta',
      maximize: 'Suurenna kartta',
      restore: 'Palauta kartan koko',
      description: `Maailmankartta, jossa näkyvät ${S.gen} kohteet, maareitit ja sensorien hetkelliset peittoalueet`,
      emptyPrompt: 'Yhdelläkään kohteella ei ole vielä näytettävää paikkaa. Kohteet näkyvät tässä merkkeinä; laita Maareitti tai Sensorin geometria päälle, niin kartalle piirtyy enemmän.',
      coastlineUnavailable: 'Rantaviivoja ei ole saatavilla, joten kartalla näkyy vain koordinaattiruudukko. Maareitit näkyvät silti.',
      canvasUnavailable: 'Tämä selain ei tarjonnut 2D-piirtopintaa, joten kartta ei ole käytettävissä. 3D-näkymä toimii silti.',
      lineKey: 'Piste: nykyinen paikka. Yhtenäinen viiva: jo kuljettu maareitti. Katkoviiva: ennustettu seuraava kierros. Tallennettu reitti korvaa molemmat, kun maareitin historia on päällä.',
      sensorKey: 'Täytetty alue: nykyinen peittoalue suoraan alapuolella. Ulompi katkoviiva: alue, jonka sensori tavoittaa kääntörajan sisällä.',
      surfaceNote: 'Kartan leveysasteet ovat WGS-84-geodeettisia. Sensorien alueet ovat hetkellisiä peittoalueita pallon pinnalla; 3D-maapallo ja sijainti Maan pinnalla lasketaan Maan keskipisteestä pallon pinnalla.',
      legendSummary: (objectCount: number, tracks: number, sensors: number) => `${objects(objectCount)}, maareitti ${tracks} kohteella, sensorin geometria ${sensors} kohteella`,
      selectedName: (name: string) => `${name} (valittu)`,
      more: (value: number) => `ja ${value} muuta`,
      canvas: 'Vuorovaikutteinen näkymä Maasta ja kiertoradoista',
      hoverMore: (name: string, more: number) => `${name} ja ${more} muuta`,
    },

    realObjects: {
      emptyTitle: 'Ei näytettäviä kappaleita',
      emptyText: 'Ota luettelo käyttöön löytääksesi julkaistuja kohteita, tai liitä TLE- tai OMM-tietue.',
      inThisScene: `${S.ine}`,
      manualHeading: 'TLE / OMM käsin',
      manualHint: 'vain tällä laitteella',
      recordFormat: 'Tietueen muoto',
      recordFormatAccessible: 'Käsin liitettävän tietueen muoto',
      formats: { tle: 'TLE / 3LE', omm: 'OMM (JSON)' },
      tlePlaceholder: '0 ISS\n1 ...\n2 ...',
      ommPlaceholder: '{"OBJECT_NAME":"Esimerkki", ...}',
      tleHelp: 'Liitä kaksi tarkkaa, 69 merkin pituista riviä. Niiden edellä voi olla nimirivi. Tietue pysyy vain tässä selainistunnossa.',
      ommHelp: 'Liitä yksi OMM-kenttiä käyttävä JSON-olio. Palveluntarjoajan taulukoita ja XML:ää ei hyväksytä.',
      goToEpoch: 'Siirry epookkiin lisäyksen jälkeen',
      goToEpochHint: 'Epookki on hetki, jota ratatiedot kuvaavat. Sijainti on tarkimmillaan epookin lähellä, ja virhe kasvaa, mitä kauemmas siitä siirrytään (engl. epoch).',
      addRecord: 'Lisää tietue',
      sceneFull: (max: number, record: 'tle' | 'omm') => `${cap(S.ine)} on jo ${max} kohdetta. Poista jokin kohde ennen kuin lisäät ${record === 'tle' ? 'TLE-tietueen' : 'OMM-tietueen'}.`,
    },

    errors: {
      tle: (error: TleValidationError) => tleError(error),
      omm: (error: OmmValidationError) => ommError(error),
      propagation: (code: OrbitPropagationErrorCode) => propagationError(code),
      catalogue: (failure: CatalogueFailure) => catalogueError(failure),
      catalogueDefaults: {
        load: 'Julkaistua luetteloa ei voitu ladata.',
        record: 'Tietuetta ei voitu ladata.',
        add: 'Luettelotietuetta ei voitu lisätä.',
        addMany: 'Luettelotietueita ei voitu lisätä.',
      },
      addFailed: {
        sceneChanged: `${cap(S.nom)} muuttui, kun tietueita vielä ladattiin.`,
        recordNotAdded: 'Luettelotietuetta ei voitu lisätä.',
        recordInvalid: (catalogId: string) => `Luettelotietuetta ${catalogId} ei voitu lukea.`,
        groupUnavailable: 'Tämä ryhmä ei ole käytettävissä tässä versiossa.',
        notReady: 'Orbitin ei ole vielä valmis.',
        waitForOpen: `Odota, että jaettu ${S.nom} on avautunut, ja lisää kohteet sitten uudelleen.`,
      },
    },

    catalogue: {
      providers: { 'space-track': 'Space-Track.org', fixture: 'Paikallinen testiaineisto' },
      sourceLabel: (provider: string) => `Julkaistu luettelo · ${provider}`,
      educationalWarning: 'Vain opetus- ja havainnollistuskäyttöön. Älä käytä tätä luetteloa törmäysvaaran arviointiin, törmäysten välttämiseen, navigointiin, seurantaan tai mihinkään operatiiviseen päätökseen. Ratatiedot ovat havainnollistavia, ja ne voivat olla puutteellisia tai vanhentuneita. Kohteen näkyminen luettelossa ei tarkoita, että se on toiminnassa.',
      educationalUse: 'Vain opetuskäyttöön; ei törmäysvaaran arviointiin eikä operatiivisiin päätöksiin.',
      derivedData: 'Johdetut luokitukset ja laskelmat ovat Orbitinin tuottamia.',
      citation: (sourceAuthority: string, provider: string) => `Ratatiedot: ${sourceAuthority}, lähde ${provider}`,
      retrievedBetween: (start: string, end: string) => `Lähdetiedot haettu ${start} – ${end}`,
      retrievedAt: (at: string) => `Lähdetiedot haettu ${at}`,
      typeCategories: { payload: 'Hyötykuorma', 'rocket-body': 'Kantoraketin osa', debris: 'Avaruusromu', unknown: 'Tuntematon tyyppi' },
      orbitClasses: {
        geosynchronous: 'Lähes geosynkroninen kiertoaika', 'highly-elliptical': 'Hyvin soikea rata', 'low-earth': 'Matalan radan korkeus',
        'medium-earth': 'Keskikorkean radan korkeus', 'high-earth': 'Korkean radan korkeus', 'crossing-bands': 'Ylittää korkeusvyöhykkeitä',
      },
      orbitFlags: {
        nearPolar: 'Lähes polaarinen', nearEquatorial: 'Lähes päiväntasaajan suuntainen', highEccentricity: 'Hyvin soikea',
        nearGeosynchronous: 'Lähes geosynkroninen kiertoaika', geoLike: 'GEO-radan kaltainen',
      },
      sgp4Regimes: { 'near-earth': 'Lähiavaruus', 'deep-space': 'Kaukoavaruus' },
      sortLabels: {
        relevance: 'Osuvuus', name: 'Nimi', 'catalog-id': 'Luettelotunnus',
        'launch-newest': 'Laukaisupäivä (uusin ensin)', 'launch-oldest': 'Laukaisupäivä (vanhin ensin)', 'epoch-newest': 'Epookki (uusin ensin)',
      },
      facetCountExplanation: 'Kohdetyypin, ratatyypin, SGP4-alueen ja maa- tai lähdekoodin kohdalla luku kertoo, montako tietuetta vastaa valintaa, kun muiden ryhmien suodattimet ovat voimassa. Radan geometrian luvut kertovat, montako tulosta jää, kun sekä tämä ominaisuus että jo valitut ominaisuudet vaaditaan.',
      addToScene,
      sceneFull,
      alreadyInScene: `Jo ${S.ine}`,
      inScene: `${cap(S.ine)}`,
      compare: 'Vertaa',
      removeFromComparison: 'Poista vertailusta',
      comparisonFull: 'Vertailu täynnä',
      noMatches: 'Yksikään luettelon kohde ei vastaa nykyistä hakua ja suodattimia.',
      showingSome: (shown: number, total: number) => `Näytetään ${f.integer(shown)} / ${count(total, 'osuva kohde', 'osuvaa kohdetta')}`,
      showingAll: (total: number) => `Näytetään ${count(total, 'osuva kohde', 'osuvaa kohdetta')}`,
      allObjects: 'Kaikki luettelon kohteet',
      kinds: { 'educational-view': 'Laaja opetusnäkymä', 'official-system': 'Virallinen järjestelmä' },
      legacyIntro: 'Tämä luetteloversio ei julkaise kohdetyyppi- ja ratatyyppitietoja, joita Tutki-sivut käyttävät. Selaa kaikkia kohteita tai hae nimellä, NORAD-tunnuksella tai kansainvälisellä tunnuksella.',
      provenance: { authority: 'Jäsenyyden tarkisti', source: 'Jäsenyyden lähde', reviewed: 'Tarkistettu', revision: 'Määrittelyn versio' },
      provenanceDate: (date: string) => `${date} (UTC)`,
      provenanceSource: 'Jäsenyyden lähdeviite',
      groupAdd: (present: number) => `Lisää kaikki ${present} jäsentä ${S.ill}`,
      groupAddCapacity: (newMembers: number, slots: number) => `${newMembers} uutta jäsentä tarvitsee ${newMembers} paikkaa, mutta ${S.ine} on tilaa ${slots} kohteelle. Poista kohteita ${S.ela} tai lisää jäsenet yksitellen.`,
      groupAddConfirmation: (newMembers: number) => `Lisätäänkö ${newMembers} kohdetta ${S.ill}? Radat tulevat näkyviin; maareitit, historia ja sensorit ovat pois päältä.`,
      groupAddPreview: { present: 'Jäseniä luettelossa', inScene: `Jo ${S.ine}`, toAdd: 'Uusia lisättäviä', slots: `Vapaita paikkoja ${S.ine}` },
      confirmGroupAdd: 'Vahvista ryhmän lisäys',
      add: 'Lisää',
      cancel: 'Peruuta',
      missingMembers: (missing: number, listed: readonly string[], more: number) => `${missing === 1 ? 'Tarkistettu jäsen puuttuu' : `${f.integer(missing)} tarkistettua jäsentä puuttuu`} nykyisestä luettelosta, joten ${missing === 1 ? 'sitä' : 'niitä'} ei näytetä: ${listed.join(', ')}${more > 0 ? ` ja ${f.integer(more)} muuta` : ''}.`,
      noradId: (catalogId: string) => `NORAD ${catalogId}`,
      discoveryUnavailable: 'Tämä tutkimussivu ei ole käytettävissä nykyisessä luetteloversiossa.',
      workingSelectionCleared: 'Luettelo päivittyi; työvalinta tyhjennettiin.',
      objectCount: (value: number) => objects(value),
      scopePage: (title: string) => `Tutkimussivu: ${title}`,
      scopeLegacy: (label: string) => `Vanha ryhmä: ${label}`,
      compareTab: (compared: number, max: number) => `Vertaa (${compared}/${max})`,
      comparisonCleared: 'Vertailu tyhjennettiin.',
      comparing: (compared: number, max: number) => `Vertaillaan ${f.integer(compared)}/${f.integer(max)} kohdetta.`,
      comparisonLoadFailed: (name: string) => `Kohdetta ${name} ei voitu ladata vertailuun. Käytä Vertaa-välilehden Yritä uudelleen -painiketta.`,
      workingSelection,
      removeFromWorkingSelection: 'Poista työvalinnasta',
      clearWorkingSelection: 'Tyhjennä työvalinta',
      addSelected: `Lisää valitut ${S.ill}`,
      addingSelected: `Lisätään ${S.ill}…`,
      viewScene: `Palaa ${S.ill}`,
      workingSelectionEmpty: `Rastita tuloksista kohteita, niin ne pysyvät tässä, kun haet, suodatat ja selaat. Rastittaminen ei lataa tietueita eikä muuta ${S.par}.`,
      workingSelectionButton: (value: number) => `${workingSelection} (${f.integer(value)})`,
      keepInWorkingSelection: (name: string) => `Pidä ${name} työvalinnassa`,
      workingSelectionStatus: (value: number) => `Työvalinta: ${objects(value)}.`,
      workingSelectionCapacity: (newRecords: number, slots: number) => `${objects(newRecords)} olisi uusia, mutta ${S.ine} on tilaa enää ${f.integer(slots)} kohteelle. Poista työvalinnasta ${f.integer(newRecords - slots)} tai poista kohteita ${S.ela}.`,
      workingSelectionFits: (newRecords: number) => newRecords === 1 ? `Uusi kohde mahtuu ${S.ill}.` : `Kaikki ${f.integer(newRecords)} uutta kohdetta mahtuvat ${S.ill}.`,
      workingSelectionAllInScene: `Kaikki työvalinnan kohteet ovat jo ${S.ine}.`,
      workingSelectionFacts: { total: 'Valittuna', present: `Jo ${S.ine}`, new: 'Uusia lisättäviä', slots: `Vapaita paikkoja ${S.ine}` },
      remove: 'Poista',
      quickSearch: 'Hae luettelosta',
      quickSearchResults: 'Pikahaun tulokset',
      quickSearchNoMatch: (query: string) => `Mikään luettelon kohde ei vastaa hakua ”${query}”.`,
      quickSearchRefreshFailed: (message: string) => `Luettelon päivitys epäonnistui: ${message} Pikahaku käyttää viimeksi ladattua luetteloa.`,
      quickSearchViewAll: (total: number) => `Näytä kaikki ${f.integer(total)} tulosta luettelossa`,
      quickSearchNone: 'Ei osumia luettelosta.',
      quickSearchOne: '1 osuma luettelosta.',
      quickSearchSome: (total: number, shown: number) => `${f.integer(total)} osumaa luettelosta; näytetään ensimmäiset ${f.integer(shown)}.`,
      quickSearchAll: (total: number) => `${f.integer(total)} osumaa luettelosta.`,
      openCatalogue: 'Avaa luettelo',
      details: 'Tiedot',
      detailsFor: (name: string) => `Kohteen ${name} tiedot`,
      selectInScene: `Valitse ${S.ine}`,
      adding: 'Lisätään…',
      selectNamedInScene: (name: string) => `Valitse ${name} ${S.ine}`,
      cannotAdd: (name: string) => `${sceneFull}: kohdetta ${name} ei voi lisätä`,
      actionOn: (action: string, name: string) => `${action}: ${name}`,
      labelledAction: (action: string, name: string) => `${action}: ${name}`,
      enable: 'Ota luettelo käyttöön',
      enabling: 'Otetaan luetteloa käyttöön…',
      retry: 'Yritä luetteloa uudelleen',
      settings: 'Luettelon asetukset',
      freshness: { current: 'Ajantasainen', delayed: 'Viivästynyt', stale: 'Vanhentunut' },
      snapshotStatus: (freshness: string, entryCount: number, published: string, updated: boolean) => `${freshness} luettelo · ${objects(entryCount)} · julkaistu ${published}${updated ? ' · Luettelo päivittyi; tiedot ja vertailu tyhjennettiin.' : ''}`,
      close: 'Sulje luettelo',
      heading: 'Luettelo',
      load: 'Lataa luettelo',
      refresh: 'Tarkista uudempi luettelo',
      explore: 'Tutki luetteloa',
      aboutHeading: 'Tietoja tästä luettelosta',
      review: 'Tarkastelu',
      loading: catalogueLoading,
      unavailable: catalogueUnavailable,
      refreshFailed: catalogueRefreshFailed,
      membershipProvenance: 'Jäsenyyden alkuperä',
      exploreHeading: 'Tutki',
      exploreGroups: 'Satelliittiryhmät',
      browseAll: 'Selaa kaikkia kohteita',
      legacyGroup: 'Vanha ryhmä',
      cardSummary: (kind: string, summary: string) => `${kind}. ${summary}`,
      compositionTypes: { payload: 'Hyötykuorma', 'rocket-body': 'Kantoraketin osa', debris: 'Avaruusromu', unknown: 'Tuntematon' },
      compositionClasses: {
        'low-earth': 'Matala', 'medium-earth': 'Keskikorkea', 'high-earth': 'Korkea',
        geosynchronous: 'Geosynkroninen', 'highly-elliptical': 'Hyvin soikea', 'crossing-bands': 'Vyöhykkeitä ylittävä',
      },
      typeComposition: 'Kohdetyypit',
      classComposition: 'Ratatyypit',
      factItem: (label: string, value: number) => `${label} ${f.integer(value)}`,
      inCurrentCatalogue: (value: number) => `${objects(value)} nykyisessä luettelossa`,
      searchAll: 'Hae kaikista luettelon kohteista',
      searchPlaceholder: 'Hae nimellä, NORAD-tunnuksella tai tunnuksella',
      objectTypeFilter: 'Kohdetyyppi (lähteen mukaan)',
      orbitClassFilter: 'Ratatyyppi (laskettu)',
      sortBy: 'Järjestä',
      allFilters: 'Kaikki suodattimet',
      allFiltersActive: (active: number) => `Kaikki suodattimet (${active} käytössä)`,
      clearFilters: 'Tyhjennä suodattimet',
      regimeFilter: 'SGP4-alue (laskettu)',
      geometryFilter: 'Radan geometria (laskettu)',
      geometryFilterNote: 'Näytä vain kohteet, joilla on kaikki rastitetut ominaisuudet.',
      countryFilter: 'Maa- tai lähdekoodi (lähteen mukaan)',
      countryFilterAccessible: 'Maa- tai lähdekoodi',
      launchYearFilter: 'Laukaisuvuosi (lähteen mukaan)',
      from: 'Alkaen',
      to: 'Asti',
      elementAgeFilter: 'Ratatietojen ikä',
      results: 'Tulokset',
      any: 'Mikä tahansa',
      anyCode: 'Mikä tahansa koodi',
      optionCount: (label: string, value: number) => `${label} (${f.integer(value)})`,
      elementAges: { any: 'Mikä tahansa', 1: 'Enintään 1 vrk', 3: 'Enintään 3 vrk', 7: 'Enintään 7 vrk' },
      columns: {
        select: workingSelection, name: 'Nimi', 'catalog-id': 'NORAD-tunnus', 'object-type': 'Kohdetyyppi (lähde)',
        'orbit-class': 'Ratatyyppi (laskettu)', 'launch-date': 'Laukaisupäivä (lähde)', epoch: 'Epookki (UTC)', status: 'Tila ja toiminnot',
      },
      detailsEmpty: 'Valitse kohteen nimi tuloksista, niin sen tiedot näkyvät tässä. Vain sen kohteen tietue ladataan.',
      compareEmpty: (max: number) => `Vertaile enintään ${max} kohdetta rinnakkain. Käytä Vertaa-painiketta tulosrivillä tai tiedoissa.`,
      goToEpoch: 'Siirry epookkiin lisäyksen jälkeen',
      goToEpochHint: 'Epookki on hetki, jota ratatiedot kuvaavat. Sijainti on tarkimmillaan epookin lähellä, ja virhe kasvaa, mitä kauemmas siitä siirrytään (engl. epoch).',
      focusedObject: 'Valittu kohde',
      loadingRecord: 'Ladataan tietuetta…',
      retryRecord: 'Yritä uudelleen',
      closeDetails: 'Sulje tiedot',
      loadingDetails: (name: string) => `Ladataan kohteen ${name} tietoja.`,
      showingDetails: (name: string) => `Näytetään kohteen ${name} tiedot.`,
      comparedObjects: 'Vertaillut luettelon kohteet',
      retryLoading: (name: string) => `Yritä ladata ${name} uudelleen`,
      clearComparison: 'Tyhjennä vertailu',
    },

    discovery: {
      'low-earth-orbit': {
        title: 'Matala Maan kiertorata',
        summary: 'Tutki kohteita, jotka kulkevat melko lähellä Maata. Siellä kierros kestää vain vähän aikaa, ja luettelossa on erityisen paljon kohteita.',
        whyItMatters: 'Matalalla radalla kulkee monia havainto-, tiede- ja tietoliikennelaitteita.',
      },
      'medium-earth-orbit': {
        title: 'Keskikorkea Maan kiertorata',
        summary: 'Selaa aluetta matalan radan ja geosynkronisen radan välissä. Siellä kulkee pitkäikäisiä paikannus- ja tietoliikenneratoja.',
        whyItMatters: null,
      },
      'geosynchronous-orbit': {
        title: 'Geosynkroninen kiertorata',
        summary: 'Etsi kohteita, joiden kierros kestää suunnilleen yhtä kauan kuin Maan pyörähdys, esimerkiksi geostationaarisia avaruusaluksia.',
        whyItMatters: 'Geosynkroninen kohde voi palata saman pituuspiirin kohdalle ennustettavin väliajoin.',
      },
      'highly-elliptical-orbits': {
        title: 'Hyvin soikeat radat',
        summary: 'Vertaa kohteita, jotka viettävät pitkillä radoillaan hyvin eri pituisia aikoja lähellä ja kaukana Maasta.',
        whyItMatters: null,
      },
      'rocket-bodies': {
        title: 'Kantoraketin osat',
        summary: 'Selaa laukaisuissa käytettyjä osia, jotka ovat yhä seurattujen kohteiden luettelossa tehtävänsä jälkeen.',
        whyItMatters: null,
      },
      debris: {
        title: 'Avaruusromu',
        summary: 'Tutki luetteloitua avaruusromua ja vertaa, millä ratojen alueilla sitä nyt on.',
        whyItMatters: null,
      },
      'gps-operational': {
        title: 'GPS-satelliitit',
        summary: 'Tarkistetussa GPS-järjestelmän luettelossa olevat paikannussatelliitit. Jäsenyys perustuu tarkistettuun luetteloon, ei satelliitin kuntoon juuri nyt: luettelossa oleva satelliitti voi olla merkitty käyttökelvottomaksi.',
        whyItMatters: 'Keskikorkealla radalla kiertää satelliitteja kuudessa ratatasossa, joten vastaanotin näkee lähes missä tahansa niitä tarpeeksi monta sijaintinsa laskemiseen.',
      },
      'galileo-operational': {
        title: 'Galileo-satelliitit',
        summary: 'Euroopan paikannussatelliitit, jotka kuuluvat Galileon tarkistettuun viralliseen kokoonpanoon. Jäsenyys perustuu tarkistettuun luetteloon, ei satelliitin kuntoon juuri nyt: luettelossa oleva satelliitti voi olla merkitty käyttökelvottomaksi.',
        whyItMatters: 'Kolme ratatasoa keskikorkealla radalla antaa Euroopalle oman maailmanlaajuisen paikannusjärjestelmän. Kun vastaanotin käyttää sitä yhdessä GPS:n kanssa, se näkee kerralla paljon useampia satelliitteja.',
      },
      'glonass-operational': {
        title: 'GLONASS-satelliitit',
        summary: 'Venäjän paikannussatelliitit, jotka GLONASS-järjestelmän tarkistettu luettelo laskee mukaan. Jäsenyys perustuu tarkistettuun luetteloon, ei satelliitin kuntoon juuri nyt: luettelossa oleva satelliitti voi olla tarkastettavana eikä lähetä paikannussignaalia.',
        whyItMatters: 'Ratatasot ovat jyrkemmin kallellaan kuin GPS:llä, joten näitä keskikorkean radan satelliitteja näkyy kaukana pohjoisessa korkeammalla taivaalla.',
      },
      'beidou-operational': {
        title: 'BeiDou-satelliitit',
        summary: 'Kiinan paikannussatelliitit, jotka BeiDou-järjestelmän tarkistettu luettelo merkitsee käytössä oleviksi. Ne kiertävät kolmenlaisilla radoilla. Jäsenyys perustuu tarkistettuun luetteloon, ei satelliitin kuntoon juuri nyt.',
        whyItMatters: 'BeiDou yhdistää keskikorkeat radat, jotka kattavat koko maapallon, sekä geostationaariset ja kallistetut geosynkroniset radat, joiden satelliitit pysyvät korkealla Aasian yllä.',
      },
      'crewed-space-stations': {
        title: 'Miehitetyt avaruusasemat',
        summary: 'Kiertoradalla olevat miehitetyt avaruusasemat: kansainvälinen avaruusasema ISS ja Kiinan Tiangong. Kumpaakin edustaa sen keskusmoduuli.',
        whyItMatters: 'Kumpikin asema kiertää matalalla, lähes ympyränmuotoisella radalla, jolla astronautit asuvat ja työskentelevät kiertäen Maan monta kertaa päivässä.',
      },
      'geostationary-weather': {
        title: 'Geostationaariset sääsatelliitit',
        summary: 'Geostationaarisen kehän tärkeimmät säätä kuvaavat satelliitit, yksi kutakin maailman sääpalvelujen yhteistä paikkaa kohden. Varalla olevat satelliitit on jätetty pois.',
        whyItMatters: 'Geostationaariselta radalta satelliitti näkee koko ajan saman puolen Maasta, joten sääennustajat voivat seurata myrskyjen kasvua.',
      },
      'copernicus-sentinels': {
        title: 'Copernicuksen Sentinel-satelliitit',
        summary: 'Euroopan unionin Copernicus-maanhavainto-ohjelman käytössä olevat satelliitit tutkakuvaajista merenpinnan korkeutta mittaaviin.',
        whyItMatters: 'Useimmat Sentinelit kiertävät aurinkosynkronisella radalla, joten ne ohittavat kunkin paikan samaan paikalliseen aikaan ja näkevät sen samanlaisessa valossa.',
      },
      'arctic-heo': {
        title: 'Norjan arktiset HEO-satelliitit',
        summary: 'Space Norwayn kaksi satelliittia, jotka tuovat laajakaistayhteydet arktisille alueille hyvin soikeilta radoilta.',
        whyItMatters: 'Hyvin soikea rata viipyy tuntikausia korkealla pohjoisen yllä, missä geostationaariset satelliitit näkyvät matalalla horisontissa tai eivät lainkaan.',
      },
    },

    groups: {
      official: {
        'gps-operational': {
          title: 'GPS-satelliitit',
          sourceDescription: 'Satelliitit, jotka NAVCENin GPS Constellation Status -sivu listaa. Ne on tunnistettu NORAD-luettelotunnuksella CelesTrakin gps-ops-ratatietojen avulla. Versio gps-operational-2026-09-24.',
        },
        'galileo-operational': {
          title: 'Galileo-satelliitit',
          sourceDescription: 'Satelliitit, jotka European GNSS Service Centre sijoittaa Galileon viralliseen kokoonpanoon (24 varsinaista ja 6 lisäpaikkaa) niiden signaalin tilasta riippumatta. Ne on tunnistettu NORAD-luettelotunnuksella CelesTrakin galileo-ratatietojen avulla. Versio galileo-operational-2026-09-26.',
        },
        'glonass-operational': {
          title: 'GLONASS-satelliitit',
          sourceDescription: 'Satelliitit, jotka Information and Analysis Center for PNT laskee GLONASS-järjestelmään (käytössä tai pääurakoitsijan tarkastettavana). Ne on tunnistettu NORAD-luettelotunnuksella COSMOS-numeron ja CelesTrakin glo-ops-ratatietojen avulla. Versio glonass-operational-2026-09-26.',
        },
        'beidou-operational': {
          title: 'BeiDou-satelliitit',
          sourceDescription: 'BeiDou-satelliitit, jotka China Satellite Navigation Officen Test and Assessment Research Center merkitsee tilasivullaan käytössä oleviksi (Operational). Ne on tunnistettu sivulla julkaistulla NORAD-luettelotunnuksella ja tarkistettu CelesTrakista. Versio beidou-operational-2026-09-26.',
        },
        'crewed-space-stations': {
          title: 'Miehitetyt avaruusasemat',
          sourceDescription: 'Kunkin käytössä olevan miehitetyn avaruusaseman keskusmoduuli (kansainvälinen avaruusasema NASAn mukaan, Kiinan avaruusasema China Manned Space Agencyn mukaan). Ne on tunnistettu NORAD-luettelotunnuksella CelesTrakin avulla. Versio space-stations-2026-09-26.',
        },
        'geostationary-weather': {
          title: 'Geostationaariset sääsatelliitit',
          sourceDescription: 'WMO OSCAR/Space -palvelun geostationaarisen perusjärjestelmän kunkin paikan ensisijainen säätä kuvaava satelliitti, kun se on OSCARissa käytössä ja sen luettelorata vahvistaa paikan. Ne on tunnistettu NORAD-luettelotunnuksella CelesTrakin avulla. Versio geo-weather-2026-09-26.',
        },
        'copernicus-sentinels': {
          title: 'Copernicuksen Sentinel-satelliitit',
          sourceDescription: 'Copernicus-ohjelman itsenäiset Sentinel-satelliitit, jotka ESA tai EUMETSAT ilmoittaa kiertoradalla ja käytössä oleviksi (varsinaisessa käytössä, jatkokäytössä tai käyttöönotossa). Ne on tunnistettu NORAD-luettelotunnuksella CelesTrakin avulla. Käytöstä poistetut Sentinel-1A ja Sentinel-1B sekä muihin satelliitteihin sijoitetut Sentinel-4- ja Sentinel-5-laitteet eivät kuulu ryhmään. Versio copernicus-sentinels-2026-09-26.',
        },
        'arctic-heo': {
          title: 'Norjan arktiset HEO-satelliitit',
          sourceDescription: 'Space Norwayn Arctic Satellite Broadband Mission -tehtävän kaksi satelliittia (ASBM 1 ja ASBM 2), jotka Space Norwayn tehtäväsivu luettelee. Ne on tunnistettu NORAD-luettelotunnuksella CelesTrakin satelliittiluettelon avulla. Versio arctic-heo-2026-09-26.',
        },
      },
      legacy: {
        'space-stations': 'Miehitetyt avaruusasemat',
        navigation: 'Paikannusjärjestelmät',
        'earth-observation': 'Maan havainnointi ja sää',
        'space-science': 'Avaruustieteen observatoriot',
      },
    },

    /** The education page of each official group.
     *  `lead` is the first sentence, which also shows under the group on
     *  mobile; the live facts come from the loaded catalogue. */
    groupPages: {
      open: 'Tietoa ryhmästä',
      openNamed: (title: string) => `Tietoa: ${title}`,
      close: 'Sulje',
      whatItIs: 'Mikä se on',
      orbitDesign: 'Millainen rata on',
      liveFacts: 'Ladatusta luettelosta',
      tryThis: 'Kokeile Orbitinissa',
      sources: 'Lähteet ja jäsenyys',
      facts: { members: 'Jäseniä luettelossa', inclination: 'Kaltevuuden mediaani', period: 'Kiertoajan mediaani', altitude: 'Korkeusalue' },
      altitudeRange: (low: string, high: string) => `${low}–${high}`,
      loadingFacts: 'Lasketaan jäsenten radoista…',
      factsFailed: 'Jäsenten ratatietoja ei voitu ladata.',
      noMembers: 'Yksikään jäsen ei ole nykyisessä luettelossa.',
      reviewed: (authority: string, date: string, revision: string) => `Jäsenyys tarkistettu lähteestä ${authority} ${date} (versio ${revision}). Uudet laukaisut ja käytöstä poistot lisätään uudessa tarkistuksessa, ei koskaan automaattisesti.`,
      tryExample: (example: string) => `Kokeile osiossa ${M.orbitLab}: ${example}`,
      groups: {
        'gps-operational': {
          lead: 'GPS on Yhdysvaltojen satelliittipaikannusjärjestelmä, jota Yhdysvaltain avaruusvoimat ylläpitävät.',
          whatItIs: 'Ensimmäinen satelliitti laukaistiin vuonna 1978. Vastaanotin mittaa, kauanko useiden satelliittien signaalit kulkevat perille, ja laskee niistä sijainnin ja tarkan ajan.',
          orbitDesign: 'Satelliitit kiertävät kuudessa ratatasossa keskikorkealla radalla ja kiertävät Maan kahdesti tähtivuorokaudessa, joten kunkin maareitti toistuu joka päivä. Siltä korkeudelta yksi satelliitti näkee lähes puolet Maasta, ja kuusi ratatasoa pitää lähes jokaisen horisontin yllä vähintään neljä satelliittia.',
          tryThis: ['Lisää kaikki ja avaa 2D-kartta: jokainen maareitti piirtää saman reitin uudelleen kahden kierroksen jälkeen.', 'Nopeuta aika 1 h/s:iin ja katso, miten kuusi ratatasoa pysyy paikallaan Maan pyöriessä niiden alla.'],
        },
        'galileo-operational': {
          lead: 'Galileo on Euroopan unionin maailmanlaajuinen satelliittipaikannusjärjestelmä, jota hallitsevat siviiliviranomaiset.',
          whatItIs: 'Ensimmäiset varsinaiset satelliitit laukaistiin vuonna 2011. Galileo toimii GPS:n rinnalla, ja useimmat puhelimet käyttävät molempia.',
          orbitDesign: 'Satelliitit kiertävät kolmessa ratatasossa keskikorkealla radalla, hieman GPS:ää korkeammalla. Niiden maareitit toistuvat vasta kymmenen päivän ja seitsemäntoista kierroksen välein: korkeus on valittu niin, ettei Maan painovoima pääse vähitellen vääristämään ratoja, joten satelliittien ratoja tarvitsee korjata vain vähän. Kaksi varhaista satelliittia jäi laukaisuvian takia soikealle radalle, ja niitäkin käytetään yhä.',
          tryThis: ['Lisää kaikki ja avaa 2D-kartta. Lisää sitten GPS ja vertaa, miten järjestelmät täyttävät taivaan yhdessä.', 'Valitse jompikumpi soikealla radalla kiertävistä satelliiteista ja katso, miten sen korkeus muuttuu kierroksen aikana.'],
        },
        'glonass-operational': {
          lead: 'GLONASS on Venäjän maailmanlaajuinen satelliittipaikannusjärjestelmä, jota Roscosmos ylläpitää.',
          whatItIs: 'Ensimmäinen satelliitti laukaistiin vuonna 1982. GPS:n tavoin se antaa sijainnin ja ajan kaikkialla maailmassa, ja monet vastaanottimet käyttävät molempia.',
          orbitDesign: 'Kolmessa ratatasossa kiertää kahdeksan satelliittia kussakin, hieman GPS:ää matalammalla ja jyrkemmin kallellaan. Jyrkempi kaltevuus pitää useampia satelliitteja korkealla taivaalla pohjoisilla leveysasteilla, kuten Venäjällä. Sama satelliitti palaa samaan kohtaan taivaalla kahdeksan tähtivuorokauden välein.',
          tryThis: ['Lisää kaikki yhdessä GPS:n kanssa ja avaa 2D-kartta: GLONASSin maareitit ulottuvat pohjoisemmaksi.', 'Valitse yksi satelliitti kummastakin ryhmästä ja vertaa niiden radan kaltevuutta Tiedot-paneelissa.'],
        },
        'beidou-operational': {
          lead: 'BeiDou on Kiinan satelliittipaikannusjärjestelmä.',
          whatItIs: 'Se kasvoi vuonna 2000 käyttöön otetusta alueellisesta palvelusta maailmanlaajuiseksi vuonna 2020, ja sen kautta voi lähettää myös lyhyitä tekstiviestejä.',
          orbitDesign: 'BeiDou yhdistää kolmenlaisia ratoja. Keskikorkean radan satelliitit kattavat koko maapallon, geostationaariset satelliitit pysyvät paikallaan Aasian yllä ja kallistetut geosynkroniset satelliitit piirtävät kahdeksikon muotoisia maareittejä Aasian ja Australian ylle. Kun alueen yllä on korkealla enemmän satelliitteja, vastaanottimet näkevät niitä tarpeeksi myös korkeiden rakennusten ja vuorten välissä.',
          tryThis: ['Lisää kaikki, avaa 2D-kartta ja nopeuta aika 1 h/s:iin: kallistettujen geosynkronisten satelliittien maareitit piirtävät kahdeksikkoja.', 'Etsi geostationaariset satelliitit: niiden merkit tuskin liikkuvat kartalla.'],
        },
        'crewed-space-stations': {
          lead: 'Kansainvälinen avaruusasema ISS ja Kiinan Tiangong ovat kiertoradan kaksi miehitettyä avaruusasemaa.',
          whatItIs: 'Yhdysvaltojen, Venäjän, Euroopan, Japanin ja Kanadan rakentamalla ISS:llä on ollut ihmisiä yhtäjaksoisesti marraskuusta 2000 lähtien. Tiangongin keskusmoduuli laukaistiin vuonna 2021.',
          orbitDesign: 'Kumpikin asema kiertää matalalla, lähes ympyränmuotoisella radalla muutaman sadan kilometrin korkeudessa ja kiertää Maan noin kuusitoista kertaa päivässä. Ratojen kaltevuus sopii paikkoihin, joista miehistöt ja tarvikkeet laukaistaan. Ohut yläilmakehä jarruttaa asemia hitaasti, joten niiden rataa nostetaan aika ajoin moottoreilla tai vierailevilla aluksilla.',
          tryThis: ['Lisää molemmat ja avaa 2D-kartta: jokainen uusi maareitti on edellistä lännempänä, koska Maa pyörii aseman kiertäessä.', 'Ota Sensorin geometria käyttöön ja katso, kuinka ison osan Maasta asemalla oleva kamera näkisi kerralla.'],
        },
        'geostationary-weather': {
          lead: 'Geostationaariset sääsatelliitit katsovat koko ajan samaa puolta Maasta, joten sääennustajat voivat seurata myrskyjä ja pilviä minuutti minuutilta.',
          whatItIs: 'Ensimmäinen varsinainen geostationaarinen sääsatelliitti laukaistiin vuonna 1974. Nykyään usean maan sääpalvelut jakavat niiden kehän tropiikin ja keskileveysasteiden yllä.',
          orbitDesign: 'Geostationaarinen rata on ympyrä päiväntasaajan yllä, ja yksi kierros kestää tähtivuorokauden, joten satelliitti pysyy saman pituusasteen yllä. Kiinteällä näkymällä on hintansa: kaukana pohjoisessa tai etelässä satelliitit näkyvät matalalla horisontissa, eikä napojen lähellä niitä näe lainkaan. Vanhempia satelliitteja ei enää pidetä tarkasti päiväntasaajan yllä, ja ne liikkuvat hitaasti sen pohjois- ja eteläpuolelle.',
          tryThis: ['Lisää kaikki ja avaa 2D-kartta: merkit pysyvät lähes paikallaan päiväntasaajalla.', 'Nopeuta aika 1 h/s:iin: vanhemmat satelliitit piirtävät pieniä kahdeksikkoja liikkuessaan pohjoiseen ja etelään.'],
        },
        'copernicus-sentinels': {
          lead: 'Sentinelit ovat Euroopan unionin Copernicus-ohjelman maanhavaintosatelliitteja.',
          whatItIs: 'ESA rakentaa ne, ja ESA ja EUMETSAT ohjaavat niitä. Ensimmäinen laukaistiin vuonna 2014. Niiden kuvat ja mittaukset maasta, merestä, jäästä ja ilmasta ovat kaikkien vapaasti käytettävissä.',
          orbitDesign: 'Useimmat Sentinelit kiertävät aurinkosynkronisella radalla. Ratataso on kallistettu hieman napojen yli, ja se kääntyy vuoden mittaan Auringon mukana, joten satelliitti ohittaa kunkin paikan samaan paikalliseen aurinkoaikaan ja näkee sen samanlaisessa valossa. Sentinel-6 on poikkeus: se mittaa merenpinnan korkeutta korkeammalta radalta, joka ei ole aurinkosynkroninen, ja jatkaa vuonna 1992 alkanutta mittaussarjaa.',
          tryThis: ['Lisää kaikki, avaa 2D-kartta ja nopeuta aika 10 min/s:iin: aurinkosynkroniset maareitit ylittävät päiväntasaajan aina yhtä kaukana päivän ja yön rajasta.', 'Etsi Sentinel-6: sen maareitti pysyy kaukana navoista.'],
        },
        'arctic-heo': {
          lead: 'ASBM 1 ja ASBM 2 tuovat satelliittilaajakaistan laivoille, lentokoneille ja ihmisille arktisilla alueilla.',
          whatItIs: 'Niitä ylläpitää Space Norway, ja ne laukaistiin yhdessä vuonna 2024. Geostationaariset satelliitit eivät palvele kaukaista pohjoista hyvin, joten nämä kaksi kiertävät toisenlaisella radalla.',
          orbitDesign: 'Kumpikin satelliitti kiertää hyvin soikealla radalla, jonka kaukaisin kohta on korkealla pohjoisen yllä. Siellä satelliitti liikkuu hitaasti ja pysyy näkyvissä tuntikausia, ja satelliitit vuorottelevat, joten arktisella alueella on aina yhteys. Radan kaltevuus on lähellä kriittistä arvoa, jolla Maan litistyneisyys ei käännä radan kaukaisinta kohtaa pois pohjoisesta.',
          tryThis: ['Lisää molemmat, avaa 2D-kartta ja nopeuta aika 1 h/s:iin: satelliitit viipyvät arktisen alueen yllä ja kiitävät nopeasti etelän kautta.', 'Lisää myös geostationaariset sääsatelliitit ja katso, kuinka etelässä ne pysyvät.'],
        },
      } as Readonly<Record<string, { readonly lead: string; readonly whatItIs: string; readonly orbitDesign: string; readonly tryThis: readonly string[] }>>,
    },

    featured: {
      heading: 'Aloita näistä',
      lines: {
        iss: 'Miehitetty avaruusasema', tiangong: 'Kiinan miehitetty avaruusasema', hubble: 'Avaruusteleskooppi',
        'landsat-9': 'Maankuvaus, polaarirata', 'sentinel-2c': 'Maankuvaus, aurinkosynkroninen rata', 'goes-19': 'Sää, geostationaarinen rata',
        'molniya-3-50': 'Hyvin soikea 12 tunnin rata', 'vanguard-1': 'Vanhin kiertoradalla oleva satelliitti, vuodesta 1958',
      },
      addNamed: (name: string, line: string) => `Lisää ${name}: ${line}`,
      showNamed: (name: string) => `Näytä ${name}, joka on jo näkymässä`,
    },

    examples: {
      heading: 'Esimerkit',
      menu: 'Esimerkit…',
      intro: 'Valmiita näkymiä. Esimerkki korvaa oman osionsa näkymän; toisen osion näkymä säilyy.',
      close: 'Sulje esimerkit',
      names: {
        'gps-now': 'GPS juuri nyt', 'navigation-systems': 'GPS, Galileo ja GLONASS', 'space-stations': 'Avaruusasemat kartalla',
        'geostationary-ring': 'Geostationaarinen kehä', 'arctic-orbits': 'Radat arktiselle alueelle', 'orbit-shapes': 'Neljä radan muotoa',
      },
      lines: {
        'gps-now': 'GPS-satelliitit siellä, missä ne ovat juuri nyt',
        'navigation-systems': 'Kolme paikannusjärjestelmää keskikorkealla radalla',
        'space-stations': 'ISS ja Tiangong maareitteineen',
        'geostationary-ring': 'Sääsatelliitit paikallaan päiväntasaajan yllä',
        'arctic-orbits': 'Norjan ASBM-satelliitit ja Molnija viipyvät pohjoisen yllä',
        'orbit-shapes': 'LEO, MEO, GEO ja hyvin soikea rata rinnakkain',
      },
    },

    recordDetails: {
      altitudeBands: {
        'low-earth': 'Matalan radan korkeus', 'medium-earth': 'Keskikorkean radan korkeus', 'high-earth': 'Korkean radan korkeus', 'crossing-bands': 'Ylittää korkeusvyöhykkeitä',
      },
      identity: 'Tunnistetiedot',
      name: 'Nimi',
      noradId: 'NORAD-luettelotunnus',
      internationalDesignator: 'Kansainvälinen tunnus',
      classification: 'Luokitus',
      elementSet: 'Ratatiedot',
      elementSetNote: 'Keskiarvoiset rata-arvot lähteen tietueesta.',
      elementEpoch: 'Epookki (UTC)',
      elementAge: 'Ratatietojen ikä',
      inclination: 'Radan kaltevuus (astetta)',
      eccentricity: 'Radan soikeus',
      meanMotion: 'Keskiliike (kierrosta/vrk)',
      revolution: 'Kierroksen numero epookissa',
      elementSetNumber: 'Ratatietojen numero',
      providerHeading: (provider: string) => `Lähteen ${provider} tiedot`,
      providerNote: 'Lähteen toimittamat tiedot. Koodit näytetään sellaisinaan.',
      objectType: 'Kohdetyyppi',
      country: 'Maa- tai lähdekoodi',
      launchDate: 'Laukaisupäivä',
      launchSite: 'Laukaisupaikan koodi',
      decayDate: 'Putoamispäivä',
      rcs: 'Tutkapoikkipinnan kokoluokka',
      providerSemimajorAxis: 'Lähteen radan koko (km)',
      providerPeriod: 'Lähteen kiertoaika (min)',
      providerApogee: 'Lähteen apogeum (km)',
      providerPerigee: 'Lähteen perigeum (km)',
      recordCreated: 'Tietue luotu (UTC)',
      derivedHeading: 'Orbitinin laskemat',
      derivedNote: (rulesVersion: string) => `Laskettu SGP4-rata-arvoista sääntöversiolla ${rulesVersion}.`,
      recoveredPeriod: 'Laskettu kiertoaika (min)',
      semimajorAxis: 'Radan koko (km)',
      perigeeAltitude: 'Perigeumin korkeus (km)',
      apogeeAltitude: 'Apogeumin korkeus (km)',
      sgp4Regime: 'SGP4-alue',
      altitudeBand: 'Korkeusvyöhyke',
      primaryOrbitClass: 'Pääasiallinen ratatyyppi',
      orbitGeometry: 'Radan geometria',
      launchYear: 'Laukaisuvuosi',
      timeSinceLaunch: 'Aikaa laukaisusta',
      metadata: 'Luettelon lisätiedot',
      metadataMissing: 'Ei julkaistu tässä luetteloversiossa',
      kilometres: (value: string) => `${value} km`,
      minutes: (value: string) => `${value} min`,
      daysBefore: (days: string) => `${days} vrk ennen nykyhetkeä`,
      daysAfter: (days: string) => `${days} vrk nykyhetken jälkeen`,
      notYetLaunched: 'Ei vielä laukaistu vertailuhetkellä',
      aboutDays: (days: number) => `Noin ${count(days, 'vuorokausi', 'vuorokautta')}`,
      aboutYears: (years: number) => `Noin ${count(years, 'vuosi', 'vuotta')}`,
      noFlags: 'ei mitään luetelluista ominaisuuksista',
    },

    comparison: {
      objectType: 'Kohdetyyppi (lähde)',
      country: 'Maa- tai lähdekoodi (lähde)',
      launchDate: 'Laukaisupäivä (lähde)',
      primaryOrbitClass: 'Pääasiallinen ratatyyppi (laskettu)',
      perigeeAltitude: 'Perigeumin korkeus (laskettu)',
      apogeeAltitude: 'Apogeumin korkeus (laskettu)',
      recoveredPeriod: 'Laskettu kiertoaika',
      inclination: 'Radan kaltevuus (lähde)',
      eccentricity: 'Radan soikeus (lähde)',
      elementEpoch: 'Epookki (lähde)',
    },

    sceneObjects: {
      search: `Hae ${S.ela}`,
      searchAccessible: `Hae ${S.gen} kohteita nimellä, NORAD-tunnuksella tai ryhmällä`,
      rows: `${cap(S.gen)} kohteet`,
      confirmRemoval: 'Vahvista poisto',
      remove: 'Poista',
      cancel: 'Peruuta',
      toggle: (active: string) => `${cap(S.gen)} kohteet, aktiivinen: ${active}`,
      include: (name: string) => `Ota ${name} mukaan valintaan`,
      rowState: (name: string, state: string) => `${name}, ${state}`,
      removeNamed: (name: string) => `Poista ${name}`,
      removeObject: 'Poista kohde',
      states: { selected: 'valittu', primary: 'päävalinta' },
      deselectMatching: (value: number) => `Poista valinta ${value} osumalta`,
      selectMatching: (value: number) => `Valitse ${value} osumaa`,
      deselectAll: 'Poista kaikki valinnat',
      selectAll: (value: number) => `Valitse kaikki ${value} kohdetta`,
      count: (value: number, capacity: number) => `${value} / ${capacity} kohdetta`,
      selected: (value: number) => `${value} valittuna`,
      noMatch: (query: string) => `Mikään kohde ei vastaa hakua ”${query}”.`,
      noActive: 'Ei valittua kohdetta',
      activeWithMore: (name: string, more: number) => `${name} +${more}`,
      collapse: `Pienennä ${S.gen} kohteet`,
      expand: `Laajenna ${S.gen} kohteet`,
      removeConfirmation: (value: number) => `Poistetaanko ${objects(value)} ${S.ela}?`,
      removeSelected: (value: number) => `Poista valitut (${value})`,
      chooserHeading: 'Valitse kohde',
      chooserKinds: { marker: 'merkki', mapMarker: 'merkki', path: 'radan reitti', mapTrack: 'maareitti' },
      chooserSelection: { primary: 'päävalinta', selected: 'valittu' },
      chooserEntry: (kind: string, selection: string) => `${kind} · ${selection}`,
      chooserMore: (value: number) => `ja ${value} muuta – käytä ${S.gen} kohteiden hakua`,
    },

    colours: {
      names: {
        0xff4d4f: 'Punainen', 0xd55e00: 'Kinaverinpunainen', 0xe69f00: 'Oranssi', 0xffc857: 'Kulta', 0xf0e442: 'Keltainen', 0xa3e635: 'Limenvihreä',
        0x4fd18b: 'Vihreä', 0x009e73: 'Merenvihreä', 0x22d3ee: 'Syaani', 0x56b4e9: 'Taivaansininen', 0x3b82f6: 'Sininen', 0x6f7cf2: 'Indigo',
        0x9b6bff: 'Violetti', 0xb05bd6: 'Purppura', 0xe040fb: 'Magenta', 0xcc79a7: 'Malva', 0xff8fab: 'Ruusu', 0xffb38a: 'Persikka',
        0xe8d5a3: 'Hiekka', 0xa7f3d0: 'Minttu', 0xbfe3ff: 'Jäänsininen', 0xd0bcff: 'Laventeli', 0xb8c2cc: 'Hopea', 0xffffff: 'Valkoinen',
      },
      custom: 'Oma',
      customFor: (paletteLabel: string) => `Oma väri: ${paletteLabel}`,
      mixed: 'Kohteet pitävät omat värinsä',
    },

    status: {
      addedOne: (name: string) => `${name} lisättiin ${S.ill}.`,
      addedOneWithPresent: (name: string, present: number, total: number) => `${name} lisättiin ${S.ill}; ${present === 1 ? '1 pyydetty kohde oli' : `${present} pyydettyä kohdetta oli`} siellä jo valmiiksi. Kaikki ${total} ovat valittuina.`,
      addedMany: (added: number, present: number, total: number) => `${added} kohdetta lisättiin ${S.ill}${present > 0 ? `; ${present === 1 ? '1 pyydetty kohde oli' : `${present} pyydettyä kohdetta oli`} siellä jo valmiiksi` : ''}. Kaikki ${total} ovat valittuina.`,
      alreadyPresentOne: (name: string) => `${name} on jo ${S.ine}, ja se on nyt valittuna.`,
      alreadyPresentMany: (value: number) => `Kaikki ${value} pyydettyä kohdetta ovat jo ${S.ine}, ja ne ovat nyt valittuina.`,
      inProgress: 'Mitään uutta ei lisätty: pyydettyä tietuetta lisätään vielä.',
      refusedCapacity: (available: number, requested: number) => `Mitään ei lisätty: ${S.ine} on tilaa enää ${available} kohteelle, ja pyydettyjä oli ${requested}.`,
      missingRecords: (missing: number) => `Mitään ei lisätty: ${missing === 1 ? 'pyydettyä tietuetta ei ole' : `${missing} pyydettyä tietuetta ei ole`} nykyisessä luettelossa.`,
      failed: (reason: string) => `Mitään ei lisätty. ${reason}`,
      quickSearchSelected: (name: string) => `${name} valittiin ${S.ine}.`,
    },

    sharing: {
      share: 'Jaa',
      shareScene: `Jaa ${S.nom}`,
      title: `Jaa ${S.nom}`,
      copyLink: 'Kopioi linkki',
      downloadFile: `Lataa ${S.compound}tiedosto`,
      close: 'Sulje',
      linkCopied: 'Linkki kopioitiin.',
      copyFallback: 'Kopioi alla oleva linkki.',
      linkField: `${cap(S.gen)} linkki`,
      fileDownloaded: `${cap(S.compound)}tiedosto ladattiin.`,
      catalogueNote: `Luettelon kohteet jaetaan NORAD-luettelotunnuksella. Kun ${S.nom} avataan, jokaiselle kohteelle ladataan uusimmat julkaistut ratatiedot.`,
      privacyNote: `Kuka tahansa, jolla on linkki tai tiedosto, voi avata tämän ${S.gen}. Siinä on vain ${S.nom}: sen kohteet, niiden asetukset ja kuvakulma.`,
      openSceneFile: `Avaa ${S.compound}tiedosto…`,
      openTitle: `Avataanko ${S.nom}?`,
      openConfirm: `Avaa ${S.nom}`,
      cancel: 'Peruuta',
      retry: 'Yritä uudelleen',
      dismiss: 'Sulje ilmoitus',
      sharedScene: `Jaettu ${S.nom}`,
      waitForAdd: `Odota, että kohteiden lisäys on valmis, ja avaa ${S.nom} sitten uudelleen.`,
      linkInvalid: `Tässä linkissä ei ole kelvollista Orbitinin ${S.par}.`,
      fileInvalid: `Tämä tiedosto ei ole kelvollinen Orbitinin ${S.compound}tiedosto.`,
      fileTooLarge: `Tämä tiedosto on liian suuri Orbitinin ${S.compound}tiedostoksi.`,
      linkNewer: 'Tämä linkki on tehty Orbitinin uudemmalla versiolla.',
      fileNewer: 'Tämä tiedosto on tehty Orbitinin uudemmalla versiolla.',
      unsupportedBrowser: `Tämä selain ei pysty avaamaan tätä linkkiä. Kokeile Chromen, Edgen, Firefoxin tai Safarin uutta versiota.`,
      catalogueOpenFailed: `Luetteloa ei voitu ladata, joten ${S.par} ei avattu.`,
      catalogueChanged: `Luettelo päivittyi, kun ${S.nom} oli vielä avautumassa.`,
      summaryEmpty: (mode: ProductMode) => `${cap(S.nom)} ${inMode(mode)} on tyhjä.`,
      summary: (mode: ProductMode, objectCount: number) => `Jaetaan ${S.nom} ${fromMode(mode)}: ${sceneObjectCount(mode, objectCount)}.`,
      timeNoteOrbitLab: (start: string) => `${cap(S.nom)} avautuu Orbitinin alkuhetkeen ${start}, ja toisto on pysäytetty.`,
      timeNoteRealObjects: `${cap(S.nom)} avautuu nykyhetkeen, ja toisto on käynnissä.`,
      linkTooLong: `${cap(S.ine)} on kohde, jonka nimi tai tietue on liian pitkä linkkiin. Lataa ${S.compound}tiedosto sen sijaan.`,
      linkOrbitLabLimit: (max: number, objectCount: number) => `Linkkiin mahtuu enintään ${max} rataa. ${cap(S.ine)} on ${f.integer(objectCount)}. Lataa ${S.compound}tiedosto sen sijaan.`,
      linkRealObjectsLimit: (max: number, manualMax: number, objectCount: number | null, manualCount: number) => `Linkkiin mahtuu enintään ${max} kohdetta, joista enintään ${manualMax} käsin syötettyä TLE- tai OMM-tietuetta. ${cap(S.ine)} on ${objectCount !== null ? objects(objectCount) : count(manualCount, 'käsin syötetty kohde', 'käsin syötettyä kohdetta')}. Lataa ${S.compound}tiedosto sen sijaan.`,
      openConfirmation: (mode: ProductMode, replaced: number) => {
        const other: ProductMode = mode === 'orbitLab' ? 'realObjects' : 'orbitLab'
        const clock = mode === 'orbitLab' ? 'Kello siirtyy Orbitinin alkuhetkeen ja pysähtyy.' : 'Kello siirtyy nykyhetkeen ja käy.'
        return `Tämän ${S.gen} avaaminen korvaa nykyisen ${S.gen} ${inMode(mode)} (${sceneObjectCount(mode, replaced)}). ${cap(S.nom)} ${inMode(other)} säilyy. ${clock}`
      },
      openIncoming: (mode: ProductMode, objectCount: number) => `${M[mode]}: ${sceneObjectCount(mode, objectCount)}`,
      openProgress: (catalogueObjects: number) => `Avataan jaettua ${S.par}… Ladataan luettelotietueita: ${objects(catalogueObjects)}.`,
      opened: (mode: ProductMode, objectCount: number) => `Jaettu ${S.nom} avattiin ${toMode(mode)}: ${sceneObjectCount(mode, objectCount)}.`,
      missing: (missing: number, listed: readonly string[], more: number) => missing === 1
        ? `1 kohde ei ole enää luettelossa, joten se jätettiin pois: ${listed.join(', ')}.`
        : `${missing} kohdetta ei ole enää luettelossa, joten ne jätettiin pois: ${listed.join(', ')}${more > 0 ? ` ja ${more} muuta` : ''}.`,
      changed: (changed: number) => changed === 1 ? `1 luettelon kohde käyttää nyt uudempia ratatietoja kuin ${S.gen} jakamisen aikaan.` : `${changed} luettelon kohdetta käyttää nyt uudempia ratatietoja kuin ${S.gen} jakamisen aikaan.`,
      unreadable: (invalid: number) => invalid === 1 ? 'Kohdetta ei voitu lukea, joten se jätettiin pois.' : `${invalid} kohdetta ei voitu lukea, joten ne jätettiin pois.`,
      capacity: (max: number, dropped: number) => `${cap(S.ine)} voi olla enintään ${max} kohdetta; ${dropped === 1 ? '1 jätettiin pois' : `${dropped} jätettiin pois`}.`,
      layerBudget: (layer: BudgetedLayer, budget: number, changed: number) => `${layerSubjects[layer]} enintään ${budget} kohteelle; se otettiin pois päältä ${changed === 1 ? '1 kohteelta' : `${changed} kohteelta`}.`,
    },

    /** Puhelinnäkymän lyhyet tekstit. */
    mobile: {
      modes: { orbitLab: 'Radat', realObjects: 'Satelliitit' },
      modeSwitch: 'Osio',
      mark: 'Orbitin',
      menuButton: 'Valikko',
      close: 'Sulje',
      controls: 'Säätimet',
      dock: {
        newOrbit: 'Uusi', newOrbitName: 'Uusi rata',
        edit: 'Muokkaa', editName: 'Muokkaa rataa',
        add: 'Lisää', addName: 'Lisää kappaleita',
        timeName: (time: string) => `Simulaation aika ${time}. Avaa ajan säätimet`,
      },
      view: {
        region: 'Näkymän työkalut',
        map: '2D', mapName: '2D-kartta',
        globe: '3D', globeName: '3D-näkymä',
        layers: 'Tasot',
        fit: 'Sovita',
      },
      time: {
        heading: 'Aika',
        clock: (time: string) => `${time} UTC`,
        now: 'Nyt',
        reset: 'Oletus', resetName: 'Palauta oletus',
        reverse: 'Taaksepäin',
        faded: 'Tällä nopeudella merkki himmenee.',
      },
      layers: {
        heading: 'Tasot',
        orbitPaths: 'Radan reitit',
        groundTracks: 'Maareitit',
        myPlace: 'Näytä oma paikkani',
        mapKey: 'Kartan selitys',
        keyPoint: 'Kohta kappaleen alla',
        keyLast: 'Edellinen kierros',
        keyNext: 'Seuraava kierros',
      },
      shape: {
        region: 'Muokkaa rataa',
        chips: { size: 'Koko', shape: 'Soikeus', tilt: 'Kaltevuus', node: 'Solmu', periapsis: 'Periapsis', position: 'Paikka', drift: 'Siirtymä' },
        terms: {
          size: 'Isoakselin puolikas', shape: 'Eksentrisyys', tilt: 'Inklinaatio', node: 'Nousevan solmun pituus',
          periapsis: 'Periapsisin argumentti', position: 'Luonnollinen anomalia', drift: 'Radan malli',
        },
        circular: (altitude: string, period: string) => `Korkeus ${altitude} · Kiertoaika ${period}`,
        elliptical: (lowest: string, highest: string) => `Alin ${lowest} · Ylin ${highest}`,
        isCircular: 'Ympyrärata',
        atPeriapsis: 'Radan lähimmässä kohdassa',
        atApoapsis: 'Radan kaukaisimmassa kohdassa',
        minPeriapsis: 'Alin kohta on vähintään 200 km.',
        maxApoapsis: 'Kaukaisin kohta on enintään 60 000 km Maan keskipisteestä.',
        noPeriapsis: 'Ympyräradalla ei ole lähintä kohtaa.',
        noNode: 'Päiväntasaajan radalla ei ole solmua.',
        lockOn: (inclination: string) => `Aurinkosynkroninen: kaltevuus ${inclination}.`,
        lockOff: 'Liian korkea pysyäkseen aurinkosynkronisena.',
        lockReleased: 'Aurinkosynkronisuus pois: muutit kaltevuutta.',
        lockReleasedByModel: 'Aurinkosynkronisuus pois: ideaaliradan taso ei siirry.',
        lockRequiresJ2: 'Valitse ensin J2-siirtymä.',
        ideal: 'Ideaali',
        j2: 'J2-siirtymä',
        lock: 'Pidä aurinkosynkronisena',
        decrease: 'Pienennä',
        increase: 'Suurenna',
        valueText: (value: string, snap: string) => snap ? `${value}, ${snap}` : value,
        snaps: {
          spaceStation: 'Avaruusasema', earthObservation: 'Maan kuvaus', gps: 'GPS', geostationary: 'Geostationaarinen',
          circular: 'Ympyrä', equatorial: 'Päiväntasaaja', polar: 'Polaarinen', retrograde: 'Päiväntasaajalla vastapäiväisesti',
          critical: 'Kriittinen', sunSynchronous: 'Aurinkosynkroninen', periapsis: 'Periapsis', apoapsis: 'Apoapsis',
        },
        noOrbit: 'Ratoja ei vielä ole.',
        selectOrbit: 'Valitse muokattava rata napauttamalla.',
        notEditable: 'Todellisia kappaleita ei voi muokata.',
      },
      newOrbit: {
        heading: 'Uusi rata',
        examples: 'Esimerkit',
        full: (max: number) => `Näkymä on täynnä: ${max} rataa.`,
        exampleNames: { leo: 'LEO', meo: 'MEO', geo: 'GEO', polar: 'Polaarirata', elliptical: 'Hyvin soikea', sso: 'Aurinkosynkroninen' },
        exampleLines: {
          leo: 'Matala ja nopea kuin avaruusasema', meo: 'Paikannussatelliittien korkeudella', geo: 'Pysyy saman paikan yllä',
          polar: 'Kulkee molempien napojen yli', elliptical: 'Kaukana hidas, lähellä nopea', sso: 'Ohittaa aina samaan kellonaikaan',
        },
      },
      add: {
        heading: 'Lisää kappaleita',
        loadSentence: 'Lataa julkaistu satelliittiluettelo, niin voit hakea siitä.',
        load: 'Lataa satelliittiluettelo',
        loading: 'Haetaan satelliittiluetteloa…',
        failed: 'Satelliittiluetteloa ei voitu ladata.',
        retry: 'Yritä uudelleen',
        search: 'Hae satelliitteja',
        rowLine: (orbit: string, type: string) => orbit && type ? `${orbit} · ${type}` : orbit || type,
        orbitClasses: {
          geosynchronous: 'Geosynkroninen', 'highly-elliptical': 'Hyvin soikea rata', 'low-earth': 'Matala rata',
          'medium-earth': 'Keskikorkea rata', 'high-earth': 'Korkea rata', 'crossing-bands': 'Ylittää ratavyöhykkeitä',
        },
        types: { payload: 'hyötykuorma', 'rocket-body': 'kantoraketin osa', debris: 'avaruusromu', unknown: 'tuntematon tyyppi' },
        inScene: 'Näkymässä',
        adding: 'Lisätään…',
        full: 'Näkymä täynnä',
        addNamed: (name: string) => `Lisää ${name}`,
        selectNamed: (name: string) => `Näytä ${name}, joka on jo näkymässä`,
        typeMore: 'Kirjoita lisää, niin haku tarkentuu.',
        noMatch: (query: string) => `Hakua "${query}" vastaavia satelliitteja ei löytynyt.`,
        results: 'Hakutulokset',
        groups: 'Ryhmät',
        groupTitles: {
          'gps-operational': 'GPS-satelliitit', 'galileo-operational': 'Galileo-satelliitit', 'glonass-operational': 'GLONASS-satelliitit', 'beidou-operational': 'BeiDou-satelliitit', 'crewed-space-stations': 'Avaruusasemat', 'geostationary-weather': 'Sääsatelliitit', 'copernicus-sentinels': 'Sentinel-satelliitit', 'arctic-heo': 'Arktiset satelliitit',
        },
        groupCountedTitles: {
          'gps-operational': 'GPS-satelliittia', 'galileo-operational': 'Galileo-satelliittia', 'glonass-operational': 'GLONASS-satelliittia', 'beidou-operational': 'BeiDou-satelliittia', 'crewed-space-stations': 'avaruusasemaa', 'geostationary-weather': 'sääsatelliittia', 'copernicus-sentinels': 'Sentinel-satelliittia', 'arctic-heo': 'arktista satelliittia',
        },
        groupTile: (title: string, count: number) => `${title} · ${count}`,
        addAll: 'Lisää kaikki',
        addingGroup: 'Lisätään…',
        groupInScene: 'Näkymässä',
        groupFull: 'Tila ei riitä. Poista ensin kohteita.',
        addGroupNamed: (title: string, count: number) => `Lisää kaikki ${title} (${count})`,
        showGroupNamed: (title: string) => `Näytä ${title}, jotka ovat jo näkymässä`,
      },
      card: {
        sourceLab: 'Oma rata',
        sourceReal: 'Todellinen kappale',
        altitude: 'Korkeus',
        speed: 'Nopeus',
        period: 'Kiertoaika',
        speedValue: (value: string) => `${value} km/s`,
        orbit: 'Rata',
        groundTrack: 'Maareitti',
        focus: 'Kohdista',
        focusName: 'Käännä näkymä kohteeseen',
        edit: 'Muokkaa',
        remove: 'Poista',
        removeNamed: (name: string) => `Poista ${name}`,
        previous: 'Edellinen kohde',
        next: 'Seuraava kohde',
        more: 'Lisää tietoja',
        less: 'Vähemmän tietoja',
        position: 'Kohta alla',
        lowest: 'Alin',
        highest: 'Ylin',
        inclination: 'Kaltevuus',
        norad: 'NORAD-tunnus',
        designator: 'Kansainvälinen tunnus',
        epoch: 'Epookki',
        age: (days: string) => `Ratatiedot ovat ${days} päivää vanhoja.`,
      },
      chip: {
        region: 'Valittu kohde',
        count: (value: number) => `${value} ${value === 1 ? 'kohde' : 'kohdetta'} näkymässä. Avaa luettelo`,
        open: (name: string) => `${name}. Avaa tiedot`,
        clear: 'Poista valinta',
      },
      list: {
        heading: 'Kohteet',
        count: (value: number, max: number) => `${value} / ${max}`,
        filter: 'Hae näkymästä',
        removeAll: 'Poista kaikki',
        noMatch: (query: string) => `Hakua "${query}" vastaavia kohteita ei ole.`,
        select: (name: string) => `Näytä ${name}`,
      },
      menu: {
        heading: 'Valikko',
        share: 'Jaa näkymä',
        help: 'Käyttöohje',
        about: 'Tietoja Orbitinista',
      },
      share: {
        copied: 'Linkki kopioitiin.',
        tooLarge: 'Näkymä on liian suuri linkiksi.',
        download: 'Lataa näkymätiedosto',
        downloaded: 'Näkymätiedosto ladattiin.',
        failed: 'Linkkiä ei voitu jakaa.',
        title: 'Orbitin',
      },
      about: {
        larger: 'Suuremmalla näytöllä Orbitinissa on enemmän työkaluja.',
      },
      help: {
        heading: 'Käyttöohje',
        lines: [
          'Käännä Maata vetämällä yhdellä sormella.',
          'Zoomaa nipistämällä kahdella sormella.',
          'Valitse rata tai satelliitti napauttamalla sitä.',
          'Napauta tyhjää kohtaa, niin säätimet piiloutuvat. Uusi napautus tuo ne takaisin.',
          'Takaisin-ele sulkee avoimen paneelin.',
        ],
      },
      notice: {
        added: (name: string) => `Lisätty: ${name}`,
        addedGroup: (count: number, title: string) => `Lisätty ${count} ${title}`,
        created: (name: string) => `Luotu: ${name}`,
        removed: (name: string) => `Poistettu: ${name}`,
        removedAll: 'Kaikki kohteet poistettu',
        undo: 'Kumoa',
        undone: 'Kumottu.',
      },
      hint: 'Käännä Maata vetämällä · Zoomaa nipistämällä',
      hintRealObjects: 'Lataa satelliittiluettelo ja etsi sitten satelliitti, esimerkiksi ISS',
      chooser: 'Mikä kohde?',
      myPlace: {
        locating: 'Etsitään sijaintiasi…',
        failed: 'Sijaintisi ei ole saatavilla.',
        above: (angle: string) => `Horisonttisi yläpuolella · ${angle}`,
        below: 'Horisonttisi alapuolella',
      },
    },
  }
}

function tleError(error: TleValidationError): string {
  const line = error.line
  switch (error.code) {
    case 'inputTooLarge': return 'TLE-tiedon on oltava enintään 4 KiB.'
    case 'recordShape': return line === 3 ? 'Kohteen nimi ei voi olla tyhjä.' : 'Liitä TLE (kaksi riviä) tai nimetty 3LE-tietue (kolme riviä).'
    case 'blankLine': return 'Tyhjiä rivejä saa olla vain koko tietueen ympärillä.'
    case 'lineLength': return `Rivillä ${line ?? ''} on oltava täsmälleen 69 merkkiä.`
    case 'nonAscii': return `Rivillä ${line ?? ''} on merkki, joka ei ole tavallinen ASCII-merkki.`
    case 'lineNumber': return `Rivin ${line ?? ''} on alettava rivinumerolla ${line ?? ''}.`
    case 'fieldCharacters': return 'Jossakin kiinteän paikan kentässä on virheellinen merkki.'
    case 'catalogueMismatch': return 'Luettelotunnuksen on oltava sama molemmilla riveillä.'
    case 'checksum': return `Rivin ${line ?? ''} tarkistussumma on virheellinen.`
    case 'numericField': return 'Jokin TLE:n numerokentistä ei ole kelvollinen luku.'
    case 'epoch': return 'TLE:n epookki ei ole tuetulla välillä 1950–2050, tai vuoden päivä on virheellinen.'
    case 'range': return line === 3 ? 'Kohteen nimi on liian pitkä.' : 'Jokin ratakenttä on tuetun alueen ulkopuolella.'
    case 'initialization': return 'Ratatietoja ei voitu käyttää SGP4-laskentaan.'
  }
}

function ommError(error: OmmValidationError): string {
  const field = error.field
  switch (error.code) {
    case 'inputTooLarge': return 'OMM-tieto on liian suuri.'
    case 'json': return 'OMM-tieto ei ole kelvollista JSONia.'
    case 'recordShape': return 'OMM-tietueen on oltava yksi JSON-olio.'
    case 'missing': return `Kenttä ${field ?? ''} puuttuu.`
    case 'type': return `Kentän ${field ?? ''} tyyppi on väärä.`
    case 'number': return `Kentän ${field ?? ''} on oltava kelvollinen luku.`
    case 'epoch': return 'Kentän EPOCH on oltava kelvollinen UTC-aika väliltä 1950–2050.'
    case 'range': return field ? `Kentän ${field} arvo on tuetun alueen ulkopuolella.` : 'Jokin arvo on tuetun alueen ulkopuolella.'
    case 'contract': return `Kentän ${field ?? ''} arvo ei ole sallittu.`
    case 'initialization': return 'OMM-tietoja ei voitu käyttää SGP4-laskentaan.'
  }
}

function propagationError(code: OrbitPropagationErrorCode): string {
  switch (code) {
    case 'decayed':
    case 'communityDecayDetected': return 'Mallin mukaan kappale on jo pudonnut ilmakehään.'
    case 'meanMotionNonPositive':
    case 'meanEccentricityOutOfRange':
    case 'perturbedEccentricityOutOfRange':
    case 'semiLatusRectumNegative': return 'Rata-arvot ovat tällä hetkellä mallin sallitun alueen ulkopuolella.'
    case 'nonFiniteState': return 'Laskenta ei tuottanut tälle hetkelle kelvollista sijaintia.'
    case 'adapterEpochMismatch':
    case 'initialization':
    case 'unknown': return 'Rataa ei voitu laskea tälle hetkelle.'
  }
}

function catalogueError(failure: CatalogueFailure): string {
  switch (failure.kind) {
    case 'unavailable':
    case 'http': return 'Satelliittiluetteloa ei voitu ladata. Tarkista verkkoyhteys ja yritä uudelleen.'
    case 'refresh-failed': return 'Uudempaa luetteloa ei voitu ladata. Viimeisin toimiva luettelo on yhä käytössä.'
    case 'invalid': return 'Luettelon tiedot eivät ole kelvollisia.'
    case 'not-loaded': return 'Lataa luettelo ennen kuin pyydät sen tietueita.'
    case 'not-indexed': return 'Tietuetta ei ole nykyisessä luettelossa.'
    case 'disposed':
    case 'closed': return 'Luettelo on suljettu.'
    case 'snapshot-changed': return 'Luettelo päivittyi kesken latauksen. Yritä uudelleen.'
    case 'unknown': return 'Satelliittiluetteloa ei voitu ladata. Tarkista verkkoyhteys ja yritä uudelleen.'
  }
}
