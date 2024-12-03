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
const CACHE_VISIBILITY_RADIUS = 0.005; // Approximately 500m radius

// Memento for Cache State
class CacheMemento {
  constructor(
    public i: number,
    public j: number,
    public coinCount: number,
    public coins: string[],
  ) {}
}

// Originator - Cache with memory capability
class Cache {
  private coinCount: number;
  private coins: string[];

  constructor(
    public i: number,
    public j: number,
  ) {
    const initialCoinCount = Math.floor(
      luck([i, j, "initialValue"].toString()) * 100,
    );
    this.coinCount = initialCoinCount;
    this.coins = Array.from(
      { length: initialCoinCount },
      (_, serial) => this.createCoinId(serial),
    );
  }

  createCoinId(serial: number): string {
    return `${this.i}:${this.j}#${serial}`;
  }

  // Create a memento of the current state
  createMemento(): CacheMemento {
    return new CacheMemento(
      this.i,
      this.j,
      this.coinCount,
      [...this.coins],
    );
  }

  // Restore state from a memento
  restoreFromMemento(memento: CacheMemento): void {
    this.coinCount = memento.coinCount;
    this.coins = memento.coins;
  }

  collect(): string | null {
    if (this.coinCount > 0) {
      const coinId = this.coins.pop()!;
      this.coinCount--;
      return coinId;
    }
    return null;
  }

  deposit(coinId: string): void {
    this.coins.push(coinId);
    this.coinCount++;
  }

  getCoinCount(): number {
    return this.coinCount;
  }
}

// Game State Manager
class GameStateManager {
  private cacheStates: Map<string, CacheMemento> = new Map();

  saveCache(cache: Cache): void {
    const key = `${cache.i}:${cache.j}`;
    this.cacheStates.set(key, cache.createMemento());
  }

  restoreCache(i: number, j: number): CacheMemento | undefined {
    const key = `${i}:${j}`;
    return this.cacheStates.get(key);
  }
}

// Main Game Class
class LocationGame {
  private map!: leaflet.Map;
  private playerMarker!: leaflet.Marker;
  private statusPanel!: HTMLDivElement;
  private playerCoins = 0;
  private playerLat!: number;
  private playerLng!: number;
  private activeCaches: Map<
    string,
    { cache: Cache; marker: leaflet.Rectangle }
  > = new Map();
  private gameStateManager: GameStateManager;

  // New properties for geolocation
  private watchId: number | null = null;
  private isAutoLocationEnabled = false;

  // Movement history properties
  private movementHistory: leaflet.LatLng[] = [];
  private movementPolyline: leaflet.Polyline | null = null;

  constructor() {
    this.gameStateManager = new GameStateManager();
    this.initMap();
    this.initStatusPanel();
    this.initPlayerMarker();
    this.initMovementHistory();
    this.initMovementControls();
    this.initGeolocationControl();
    this.initResetControl();
  }

  private initMap(): void {
    this.map = leaflet.map(document.getElementById("map")!, {
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
      .addTo(this.map);
  }

  private initStatusPanel(): void {
    this.statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
    this.updateStatusPanel();
  }

  private initPlayerMarker(): void {
    this.playerLat = OAKES_CLASSROOM.lat;
    this.playerLng = OAKES_CLASSROOM.lng;
    this.playerMarker = leaflet.marker(OAKES_CLASSROOM);
    this.playerMarker.bindTooltip("That's you!");
    this.playerMarker.addTo(this.map);
  }

  private initMovementHistory(): void {
    // Initialize with the starting point
    this.movementHistory.push(OAKES_CLASSROOM);
    this.updateMovementPolyline();
  }

  private updateMovementPolyline(): void {
    // Remove existing polyline if it exists
    if (this.movementPolyline) {
      this.movementPolyline.remove();
    }

    // Create new polyline with movement history
    if (this.movementHistory.length > 1) {
      this.movementPolyline = leaflet.polyline(this.movementHistory, {
        color: 'blue',
        weight: 3,
        opacity: 0.7
      }).addTo(this.map);
    }
  }

  private addMovementPoint(lat: number, lng: number): void {
    const newPoint = leaflet.latLng(lat, lng);
    
    // Prevent duplicate points
    const lastPoint = this.movementHistory[this.movementHistory.length - 1];
    if (lastPoint.lat === newPoint.lat && lastPoint.lng === newPoint.lng) {
      return;
    }

    this.movementHistory.push(newPoint);
    this.updateMovementPolyline();
  }

  private initMovementControls(): void {
    document.getElementById("north")?.addEventListener(
      "click",
      () => this.movePlayer(0.0001, 0),
    );
    document.getElementById("south")?.addEventListener(
      "click",
      () => this.movePlayer(-0.0001, 0),
    );
    document.getElementById("west")?.addEventListener(
      "click",
      () => this.movePlayer(0, -0.0001),
    );
    document.getElementById("east")?.addEventListener(
      "click",
      () => this.movePlayer(0, 0.0001),
    );
  }

  private initGeolocationControl(): void {
    const sensorButton = document.getElementById("sensor");
    if (!sensorButton) return;

    // Disable button to prevent spam
    const disableButton = () => {
      sensorButton.classList.remove("active");
      sensorButton.setAttribute("disabled", "true");
      setTimeout(() => {
        sensorButton.removeAttribute("disabled");
      }, 2000); // 2-second cooldown
    };

    sensorButton.addEventListener("click", () => {
      // Prevent multiple clicks
      if (sensorButton.hasAttribute("disabled")) return;

      if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser");
        disableButton();
        return;
      }

      if (this.isAutoLocationEnabled) {
        // Disable geolocation tracking
        if (this.watchId !== null) {
          navigator.geolocation.clearWatch(this.watchId);
          this.watchId = null;
        }
        this.isAutoLocationEnabled = false;
        disableButton();
        return;
      }

      // Enable geolocation tracking
      try {
        this.watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            this.updatePlayerPosition(latitude, longitude);
          },
          (error) => {
            console.error("Error getting location", error);
            alert(`Geolocation error: ${error.message}`);
            this.isAutoLocationEnabled = false;
            disableButton();
            
            if (this.watchId !== null) {
              navigator.geolocation.clearWatch(this.watchId);
              this.watchId = null;
            }
          },
          {
            enableHighAccuracy: true,
            maximumAge: 30000,
            timeout: 27000,
          }
        );

        this.isAutoLocationEnabled = true;
        sensorButton.classList.add("active");
      } catch (error) {
        console.error("Geolocation setup error", error);
        alert("Failed to start geolocation tracking");
        disableButton();
      }
    });
  }

  private initResetControl(): void {
    document.getElementById("reset")?.addEventListener("click", () => {
      // Stop geolocation if active
      if (this.isAutoLocationEnabled && this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
        this.isAutoLocationEnabled = false;
        document.getElementById("sensor")?.classList.remove("active");
      }

      // Reset to initial position
      this.updatePlayerPosition(OAKES_CLASSROOM.lat, OAKES_CLASSROOM.lng);

      // Clear active caches
      this.activeCaches.forEach((value) => {
        value.marker.remove();
      });
      this.activeCaches.clear();

      // Reset player coins
      this.playerCoins = 0;
      this.updateStatusPanel();

      // Reset movement history
      this.movementHistory = [OAKES_CLASSROOM];
      this.updateMovementPolyline();
    });
  }

  private movePlayer(latOffset: number, lngOffset: number): void {
    // Prevent manual movement during auto location
    if (this.isAutoLocationEnabled) return;

    // Update player's position
    this.playerLat += latOffset;
    this.playerLng += lngOffset;

    // Update the map and player marker
    this.playerMarker.setLatLng(leaflet.latLng(this.playerLat, this.playerLng));

    // Add to movement history
    this.addMovementPoint(this.playerLat, this.playerLng);

    // Regenerate visible caches
    this.updateVisibleCaches();
  }

  private updatePlayerPosition(lat: number, lng: number): void {
    // Update player's position
    this.playerLat = lat;
    this.playerLng = lng;

    // Update the map and player marker
    const newLatLng = leaflet.latLng(lat, lng);
    this.playerMarker.setLatLng(newLatLng);

    // Add to movement history
    this.addMovementPoint(lat, lng);

    // Center the map on the new position
    this.map.setView(newLatLng, GAMEPLAY_ZOOM_LEVEL);

    // Regenerate visible caches
    this.updateVisibleCaches();
  }

  private updateVisibleCaches(): void {
    // Remove out-of-range caches
    this.activeCaches.forEach((value, key) => {
      const [i, j] = key.split(":").map(Number);
      if (!this.isCacheInRange(i, j)) {
        value.marker.remove();
        this.activeCaches.delete(key);
      }
    });

    // Add new caches in range
    for (let i = -NEIGHBORHOOD_SIZE; i <= NEIGHBORHOOD_SIZE; i++) {
      for (let j = -NEIGHBORHOOD_SIZE; j <= NEIGHBORHOOD_SIZE; j++) {
        const cacheLat = this.playerLat + i * TILE_DEGREES;
        const cacheLng = this.playerLng + j * TILE_DEGREES;

        const gridPos = this.latLongToGrid(cacheLat, cacheLng);
        const key = `${gridPos.i}:${gridPos.j}`;

        // Skip if cache already exists or shouldn't spawn
        if (
          this.activeCaches.has(key) ||
          !this.shouldSpawnCache(gridPos.i, gridPos.j)
        ) {
          continue;
        }

        // Check if cache is in range
        if (this.isCacheInRange(gridPos.i, gridPos.j)) {
          this.spawnCache(gridPos.i, gridPos.j);
        }
      }
    }
  }

  private isCacheInRange(i: number, j: number): boolean {
    const cacheBounds = this.calculateCacheBounds(i, j);
    const cacheCenter = cacheBounds.getCenter();
    const distance = leaflet.latLng(this.playerLat, this.playerLng).distanceTo(
      cacheCenter,
    );
    return distance <= CACHE_VISIBILITY_RADIUS * 111320; // Convert degrees to meters
  }

  private calculateCacheBounds(i: number, j: number): leaflet.LatLngBounds {
    const lat1 = i * TILE_DEGREES;
    const lat2 = (i + 1) * TILE_DEGREES;
    const long1 = j * TILE_DEGREES;
    const long2 = (j + 1) * TILE_DEGREES;

    return leaflet.latLngBounds([[lat1, long1], [lat2, long2]]);
  }

  private latLongToGrid(lat: number, lng: number): { i: number; j: number } {
    const i = Math.floor(lat / TILE_DEGREES);
    const j = Math.floor(lng / TILE_DEGREES);
    return { i, j };
  }

  private shouldSpawnCache(i: number, j: number): boolean {
    return luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY;
  }

  private spawnCache(i: number, j: number): void {
    // Check if we have a saved state for this cache
    const savedState = this.gameStateManager.restoreCache(i, j);

    // Create or restore cache
    const cache = new Cache(i, j);
    if (savedState) {
      cache.restoreFromMemento(savedState);
    }

    // Create map marker
    const bounds = this.calculateCacheBounds(i, j);
    const rect = leaflet.rectangle(bounds).addTo(this.map);

    // Bind popup
    rect.bindPopup(() => this.createCachePopup(cache, rect));

    // Store cache
    this.activeCaches.set(`${i}:${j}`, { cache, marker: rect });
  }

  private createCachePopup(cache: Cache, _rect: leaflet.Rectangle): HTMLDivElement {
    const popUpDiv = this.buildCachePopupUI(cache);
    this.setupCachePopupEvents(popUpDiv, cache);
    return popUpDiv;
  }

  private buildCachePopupUI(cache: Cache): HTMLDivElement {
      const popUpDiv = document.createElement("div");
      popUpDiv.innerHTML = `
          <div>Cache at "${cache.i}, ${cache.j}". Coins: <span id="value">${cache.getCoinCount()}</span>.</div>
          <button id="collect">Collect</button>
          <button id="deposit">Deposit</button>
      `;
      return popUpDiv;
  }

  private setupCachePopupEvents(popUpDiv: HTMLDivElement, cache: Cache): void {
      const collectButton = popUpDiv.querySelector<HTMLButtonElement>("#collect")!;
      const depositButton = popUpDiv.querySelector<HTMLButtonElement>("#deposit")!;

      collectButton.addEventListener("click", () => this.handleCollectClick(cache, popUpDiv));
      depositButton.addEventListener("click", () => this.handleDepositClick(cache, popUpDiv));
  }

  private handleCollectClick(cache: Cache, popUpDiv: HTMLDivElement): void {
      const coinId = cache.collect();
      if (coinId) {
          console.log(`Collected coin: ${coinId}`);
          this.playerCoins += 1;
          this.updateStatusPanel();
          this.updateCoinDisplay(popUpDiv, cache.getCoinCount());
          this.gameStateManager.saveCache(cache);
      }
  }

  private handleDepositClick(cache: Cache, popUpDiv: HTMLDivElement): void {
      if (this.playerCoins > 0) {
          const coinId = `deposited:${cache.i}:${cache.j}:${Date.now()}`;
          cache.deposit(coinId);
          console.log(`Deposited coin: ${coinId}`);
          this.playerCoins -= 1;
          this.updateStatusPanel();
          this.updateCoinDisplay(popUpDiv, cache.getCoinCount());
          this.gameStateManager.saveCache(cache);
      }
  }


  private updateCoinDisplay(popUpDiv: HTMLDivElement, coinCount: number): void {
    popUpDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = coinCount
      .toString();
  }

  private updateStatusPanel(): void {
    this.statusPanel.innerHTML = `Player Coins: ${this.playerCoins}`;
  }
}

// Initialize the game
new LocationGame();
