// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
import luck from "./luck.ts";

// Constants
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// State
let playerCoins = 0;

// Initialize map
const map = initMap();
const statusPanel = initStatusPanel();
//const playerMarker = 
createPlayerMarker();

// Cache Flyweight Factory
const cacheFlyweightFactory = createCacheFlyweightFactory({
  tileDegrees: TILE_DEGREES,
  spawnProbability: CACHE_SPAWN_PROBABILITY,
});

// Generate the caches
for (let i = -NEIGHBORHOOD_SIZE; i <= NEIGHBORHOOD_SIZE; i++) {
  for (let j = -NEIGHBORHOOD_SIZE; j <= NEIGHBORHOOD_SIZE; j++) {
    const { lat, lng } = OAKES_CLASSROOM;
    const { i: gridI, j: gridJ } = latLongToGrid(
      lat + i * TILE_DEGREES,
      lng + j * TILE_DEGREES,
    );
    if (cacheFlyweightFactory.shouldSpawnCache(gridI, gridJ)) {
      spawnCache(gridI, gridJ);
    }
  }
}

/**
 * Initializes the Leaflet map.
 */
function initMap(): leaflet.Map {
  const map = leaflet.map(document.getElementById("map")!, {
    center: OAKES_CLASSROOM,
    zoom: GAMEPLAY_ZOOM_LEVEL,
    minZoom: GAMEPLAY_ZOOM_LEVEL,
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    zoomControl: false,
    scrollWheelZoom: false,
  });

  leaflet
    .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    })
    .addTo(map);

  return map;
}

/**
 * Initializes the status panel.
 */
function initStatusPanel(): HTMLDivElement {
  const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
  statusPanel.innerHTML = "Player Coins: 0";
  return statusPanel;
}

/**
 * Creates the player marker on the map.
 */
function createPlayerMarker(): leaflet.Marker {
  const marker = leaflet.marker(OAKES_CLASSROOM);
  marker.bindTooltip("That's you!");
  marker.addTo(map);
  return marker;
}

/**
 * Converts latitude and longitude to global grid indices anchored at Null Island.
 */
function latLongToGrid(lat: number, lng: number): { i: number; j: number } {
  const i = Math.floor(lat / TILE_DEGREES);
  const j = Math.floor(lng / TILE_DEGREES);
  return { i, j };
}

/**
 * Generates a unique coin identifier based on its cache location and serial number.
 */
function createCoinId(i: number, j: number, serial: number): string {
  return `${i}:${j}#${serial}`;
}

/**
 * Factory function for cache flyweight, optimizing tile calculations and spawn probability.
 */
function createCacheFlyweightFactory({
  tileDegrees,
  spawnProbability,
}: {
  tileDegrees: number;
  spawnProbability: number;
}) {
  function calculateBounds(i: number, j: number): leaflet.LatLngBounds {
    const lat1 = i * tileDegrees;
    const lat2 = (i + 1) * tileDegrees;
    const long1 = j * tileDegrees;
    const long2 = (j + 1) * tileDegrees;

    return leaflet.latLngBounds([[lat1, long1], [lat2, long2]]);
  }

  function shouldSpawnCache(i: number, j: number): boolean {
    return luck([i, j].toString()) < spawnProbability;
  }

  return { calculateBounds, shouldSpawnCache };
}

/**
 * Spawns a cache marker on the map with a popup for collecting coins.
 */
function spawnCache(i: number, j: number): void {
  const bounds = cacheFlyweightFactory.calculateBounds(i, j);
  const rect = leaflet.rectangle(bounds).addTo(map);

  rect.bindPopup(() => createCachePopup(i, j));
}

/**
 * Creates a popup element for a cache with coin collection functionality.
 */
function createCachePopup(i: number, j: number): HTMLDivElement {
  const initialCoinCount = Math.floor(
    luck([i, j, "initialValue"].toString()) * 100,
  );
  let coinCount = initialCoinCount;
  const coins = Array.from(
    { length: initialCoinCount },
    (_, serial) => createCoinId(i, j, serial),
  );

  const popUpDiv = document.createElement("div");
  popUpDiv.innerHTML = `
    <div>Cache at "${i}, ${j}". Coins: <span id="value">${coinCount}</span>.</div>
    <button id="collect">Collect</button>
    <button id="deposit">Deposit</button>
  `;

  popUpDiv.querySelector<HTMLButtonElement>("#collect")!.addEventListener(
    "click",
    () => {
      if (coinCount > 0) {
        const coinId = coins.pop();
        console.log(`Collected coin: ${coinId}`);
        playerCoins += 1;
        coinCount -= 1;
        updateCoinDisplay(popUpDiv, coinCount);
      }
    },
  );

  popUpDiv.querySelector<HTMLButtonElement>("#deposit")!.addEventListener(
    "click",
    () => {
      if (playerCoins > 0) {
        const serial = initialCoinCount - coinCount;
        const coinId = createCoinId(i, j, serial);
        console.log(`Deposited coin: ${coinId}`);
        playerCoins -= 1;
        coinCount += 1;
        coins.push(coinId);
        updateCoinDisplay(popUpDiv, coinCount);
      }
    },
  );

  return popUpDiv;
}

/**
 * Updates the coin count display in the popup and the player coins display.
 */
function updateCoinDisplay(popUpDiv: HTMLDivElement, coinCount: number): void {
  popUpDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = coinCount
    .toString();
  statusPanel.innerHTML = `Player Coins: ${playerCoins}`;
}
