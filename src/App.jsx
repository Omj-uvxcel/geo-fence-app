import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  GeoJSON,
  useMap,
  Circle,
} from "react-leaflet";
import * as turf from "@turf/turf";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix for default markers in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Enhanced location icon with accuracy indicator
const createLocationIcon = (accuracy) => {
  const color =
    accuracy < 20 ? "#10b981" : accuracy < 50 ? "#f59e0b" : "#ef4444";
  return L.divIcon({
    html: `
      <div style="
        width: 20px;
        height: 20px;
        background: ${color};
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        animation: pulse 2s infinite;
      "></div>
      <style>
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
      </style>
    `,
    className: "location-marker",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
};

// Enhanced Toast component with auto-cleanup
const Toast = ({ message, type, onClose }) => {
  const timeoutRef = useRef(null);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      onClose();
    }, 4000);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [onClose]);

  const typeClasses = {
    info: "border-l-4 border-blue-500",
    success: "border-l-4 border-green-500",
    warning: "border-l-4 border-yellow-500",
    error: "border-l-4 border-red-500",
  };

  return (
    <div
      className={`bg-white rounded-lg shadow-lg overflow-hidden cursor-pointer transform translate-x-full animate-slide-in min-w-[300px] ${typeClasses[type]}`}
      onClick={onClose}
    >
      <div className="p-4 flex justify-between items-center">
        <span className="text-sm text-gray-700 flex-1">{message}</span>
        <button className="bg-transparent border-none text-xl text-gray-400 cursor-pointer p-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors hover:bg-gray-100 hover:text-gray-700">
          ×
        </button>
      </div>
    </div>
  );
};

// Toast Container with improved management
const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="fixed top-[100px] right-5 z-[10000] flex flex-col gap-2.5 max-w-[400px] md:top-[120px] md:right-2.5 md:left-2.5 md:max-w-none">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
};

// Loading indicator component
const LoadingIndicator = ({ message }) => (
  <div className="flex items-center justify-center gap-2.5 p-4 bg-blue-50 border-b border-blue-200 text-blue-700 md:p-3">
    <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-700 rounded-full animate-spin"></div>
    <span>{message}</span>
  </div>
);

// Component to handle map updates with smooth transitions
const MapController = ({ position }) => {
  const map = useMap();
  const prevPositionRef = useRef(null);

  useEffect(() => {
    if (position && map) {
      const prevPosition = prevPositionRef.current;

      if (prevPosition) {
        const distance = turf.distance(
          [prevPosition.lng, prevPosition.lat],
          [position.lng, position.lat],
          { units: "meters" },
        );

        if (distance > 50) {
          map.panTo([position.lat, position.lng]);
        }
      } else {
        map.setView([position.lat, position.lng], 16);
      }

      prevPositionRef.current = position;
    }
  }, [position, map]);

  return null;
};

// Enhanced location filter class (unchanged)
class LocationFilter {
  constructor() {
    this.readings = [];
    this.maxReadings = 5;
    this.accuracyThreshold = 100;
  }

  addReading(position) {
    this.readings.push({
      ...position,
      timestamp: Date.now(),
    });

    if (this.readings.length > this.maxReadings) {
      this.readings.shift();
    }

    const now = Date.now();
    this.readings = this.readings.filter((r) => now - r.timestamp < 30000);
  }

  getFilteredPosition() {
    if (this.readings.length === 0) return null;

    const goodReadings = this.readings.filter(
      (r) => r.accuracy <= this.accuracyThreshold,
    );

    if (goodReadings.length === 0) {
      const bestReading = this.readings.reduce((best, current) =>
        current.accuracy < best.accuracy ? current : best,
      );
      return bestReading;
    }

    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    let bestAccuracy = Math.min(...goodReadings.map((r) => r.accuracy));

    goodReadings.forEach((reading) => {
      const weight = 1 / (reading.accuracy + 1);
      totalWeight += weight;
      weightedLat += reading.lat * weight;
      weightedLng += reading.lng * weight;
    });

    return {
      lat: weightedLat / totalWeight,
      lng: weightedLng / totalWeight,
      accuracy: bestAccuracy,
      timestamp: Date.now(),
    };
  }

  getAccuracyQuality() {
    const filtered = this.getFilteredPosition();
    if (!filtered) return "unknown";

    if (filtered.accuracy < 20) return "excellent";
    if (filtered.accuracy < 50) return "good";
    if (filtered.accuracy < 100) return "fair";
    return "poor";
  }
}

const App = () => {
  const [position, setPosition] = useState(null);
  const [geoJsonData, setGeoJsonData] = useState(null);
  const [currentPolygon, setCurrentPolygon] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [permissionStatus, setPermissionStatus] = useState("unknown");
  const [error, setError] = useState(null);
  const [geoJsonLoaded, setGeoJsonLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [accuracyQuality, setAccuracyQuality] = useState("unknown");
  const [locationHistory, setLocationHistory] = useState([]);

  const watchId = useRef(null);
  const locationFilter = useRef(new LocationFilter());
  const toastIdCounter = useRef(0);

  // Enhanced geolocation options for mobile
  const geoOptions = useMemo(
    () => ({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000,
    }),
    [],
  );

  const watchOptions = useMemo(
    () => ({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 2000,
    }),
    [],
  );

  // Toast functions with improved management
  const addToast = useCallback((message, type = "info") => {
    const newToast = {
      id: ++toastIdCounter.current,
      message,
      type,
    };
    setToasts((prev) => [...prev, newToast]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  // Memoized polygon checking function
  const checkPolygonContainment = useCallback(
    (lat, lng) => {
      if (!geoJsonData?.features) return null;

      const point = turf.point([lng, lat]);

      for (let i = 0; i < geoJsonData.features.length; i++) {
        const feature = geoJsonData.features[i];
        if (feature.geometry.type === "Polygon") {
          try {
            const polygon = turf.polygon(feature.geometry.coordinates);
            if (turf.booleanPointInPolygon(point, polygon)) {
              return i;
            }
          } catch (error) {
            console.error(`Error checking polygon ${i}:`, error);
          }
        }
      }
      return null;
    },
    [geoJsonData],
  );

  // Enhanced polygon status update with debouncing
  const updatePolygonStatus = useCallback(
    (positionData) => {
      if (!positionData || !geoJsonLoaded) return;

      const polygonIndex = checkPolygonContainment(
        positionData.lat,
        positionData.lng,
      );

      if (polygonIndex !== currentPolygon) {
        const prevPolygon = currentPolygon;
        setCurrentPolygon(polygonIndex);

        if (polygonIndex === null) {
          if (prevPolygon !== null) {
            addToast(`You have exited Zone ${prevPolygon + 1}`, "warning");
          } else if (geoJsonLoaded !== null) {
            addToast("You are outside the monitored zones", "info");
          }
        } else {
          if (prevPolygon === null) {
            addToast(`You have entered Zone ${polygonIndex + 1}`, "success");
          } else if (prevPolygon !== polygonIndex) {
            addToast(
              `You moved from Zone ${prevPolygon + 1} to Zone ${polygonIndex + 1}`,
              "info",
            );
          }
        }
      }
    },
    [currentPolygon, geoJsonLoaded, checkPolygonContainment, addToast],
  );

  // Enhanced position update handler
  const handlePositionUpdate = useCallback(
    (positionData) => {
      const newPosition = {
        lat: positionData.coords.latitude,
        lng: positionData.coords.longitude,
        accuracy: positionData.coords.accuracy,
        timestamp: positionData.timestamp,
      };

      console.log("Raw position update:", {
        lat: newPosition.lat,
        lng: newPosition.lng,
        accuracy: newPosition.accuracy,
        timestamp: new Date(newPosition.timestamp).toISOString(),
      });

      setLocationHistory((prev) => [...prev.slice(-19), newPosition]);

      locationFilter.current.addReading(newPosition);

      const filteredPosition = locationFilter.current.getFilteredPosition();

      if (filteredPosition) {
        setPosition(filteredPosition);
        setAccuracyQuality(locationFilter.current.getAccuracyQuality());
        updatePolygonStatus(filteredPosition);
      }

      setIsLoading(false);
    },
    [updatePolygonStatus],
  );

  // Enhanced error handling
  const handleError = useCallback(
    (error) => {
      console.error("Geolocation error:", error);
      setIsLoading(false);

      let message = "Location access failed";
      let suggestion = "";

      switch (error.code) {
        case error.PERMISSION_DENIED:
          message = "Location access denied";
          suggestion = "Please enable location in browser settings";
          setPermissionStatus("denied");
          break;
        case error.POSITION_UNAVAILABLE:
          message = "Location unavailable";
          suggestion = "Check GPS signal or try moving to open area";
          break;
        case error.TIMEOUT:
          message = "Location request timed out";
          suggestion = "Poor signal. Trying again...";
          setTimeout(() => requestLocationPermission(), 2000);
          break;
        default:
          message = "Unknown location error";
      }

      setError(message);
      addToast(`${message}. ${suggestion}`, "error");
    },
    [addToast],
  );

  // Enhanced location permission request
  const requestLocationPermission = useCallback(async () => {
    if (!navigator.geolocation) {
      const message = "Geolocation not supported";
      setError(message);
      addToast(message, "error");
      return;
    }

    setIsLoading(true);
    setError(null);

    if (navigator.permissions) {
      try {
        const permission = await navigator.permissions.query({
          name: "geolocation",
        });
        setPermissionStatus(permission.state);

        if (permission.state === "denied") {
          setIsLoading(false);
          const message =
            "Location permission denied. Please enable in browser settings.";
          setError(message);
          addToast(message, "error");
          return;
        }
      } catch (error) {
        console.log("Permission API not supported:", error);
      }
    }

    if (watchId.current) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPermissionStatus("granted");
        handlePositionUpdate(position);
        addToast("Location tracking started", "success");
      },
      handleError,
      geoOptions,
    );

    watchId.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      handleError,
      watchOptions,
    );
  }, [handlePositionUpdate, handleError, geoOptions, watchOptions, addToast]);

  // Load GeoJSON data
  useEffect(() => {
    const loadGeoJson = () => {
      try {
        const data = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { name: "Zone 1" },
              geometry: {
                coordinates: [
                  [
                    [74.24006611534955, 16.69505639266292],
                    [74.2404150186068, 16.694480831953754],
                    [74.24873054623046, 16.696281774203882],
                    [74.2485754781163, 16.69691302829385],
                    [74.24006611534955, 16.69505639266292],
                  ],
                ],
                type: "Polygon",
              },
            },
            {
              type: "Feature",
              properties: { name: "Zone 2" },
              geometry: {
                coordinates: [
                  [
                    [74.24039407113312, 16.69449486015705],
                    [74.24095213390189, 16.694002243787253],
                    [74.24888537912818, 16.695794522781497],
                    [74.24873218542578, 16.696276653441714],
                    [74.24039407113312, 16.69449486015705],
                  ],
                ],
                type: "Polygon",
              },
            },
            {
              type: "Feature",
              properties: { name: "Zone 3" },
              geometry: {
                coordinates: [
                  [
                    [74.24095213390189, 16.694002243787253],
                    [74.24161962074032, 16.693488663666102],
                    [74.24906045764351, 16.695239022902655],
                    [74.24888537912818, 16.695805003895018],
                    [74.24095213390189, 16.694002243787253],
                  ],
                ],
                type: "Polygon",
              },
            },
          ],
        };

        setGeoJsonData(data);
        setGeoJsonLoaded(true);
        console.log("GeoJSON loaded successfully");
        addToast("Zone data loaded", "success");
      } catch (error) {
        console.error("Error loading GeoJSON:", error);
        setError("Failed to load zone data");
        addToast("Failed to load zone data", "error");
      }
    };

    loadGeoJson();
  }, [addToast]);

  // Start location tracking after GeoJSON loads
  useEffect(() => {
    if (geoJsonLoaded) {
      requestLocationPermission();
    }
  }, [geoJsonLoaded, requestLocationPermission]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchId.current) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, []);

  // GeoJSON styling function
  const geoJsonStyle = useCallback(
    (feature) => {
      const index = geoJsonData?.features?.indexOf(feature) || 0;
      const colors = ["#3388ff", "#ff6b6b", "#4ecdc4"];

      return {
        color: colors[index % colors.length],
        weight: 3,
        opacity: 0.8,
        fillOpacity: 0.2,
        fillColor: colors[index % colors.length],
      };
    },
    [geoJsonData],
  );

  // Enhanced popup content
  const onEachFeature = useCallback(
    (feature, layer) => {
      const index = geoJsonData?.features?.indexOf(feature) || 0;
      const zoneName = feature.properties?.name || `Zone ${index + 1}`;
      layer.bindPopup(`<strong>${zoneName}</strong><br/>Monitoring Area`);
    },
    [geoJsonData],
  );

  const defaultCenter = [16.695, 74.244];

  const getAccuracyColor = (accuracy) => {
    if (accuracy < 20) return "#10b981";
    if (accuracy < 50) return "#f59e0b";
    return "#ef4444";
  };

  const getAccuracyClasses = (quality) => {
    const classes = {
      excellent: "text-green-500",
      good: "text-yellow-500",
      fair: "text-orange-500",
      poor: "text-red-500",
      unknown: "text-gray-500",
    };
    return classes[quality] || classes.unknown;
  };

  const getStatusIndicatorClasses = (status) => {
    return status === "granted" ? "text-green-400" : "text-red-400";
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-4 flex justify-between items-center shadow-lg z-[1000] md:flex-col md:gap-2 md:text-center">
        <h1 className="text-2xl font-semibold md:text-xl">GeoFence Monitor</h1>
        <div className="flex items-center gap-4 md:flex-col md:gap-2">
          <span
            className={`flex items-center text-sm px-3 py-1 bg-white/20 rounded-full backdrop-blur-sm ${getStatusIndicatorClasses(permissionStatus)}`}
          >
            {isLoading
              ? "⏳ Loading..."
              : permissionStatus === "granted"
                ? "● Location Active"
                : "● Location Disabled"}
          </span>
          <span className="text-sm px-3 py-1 bg-white/20 rounded-full backdrop-blur-sm">
            {currentPolygon !== null
              ? `In Zone ${currentPolygon + 1}`
              : "Outside Zone"}
          </span>
          {position && (
            <span
              className={`text-xs px-2 py-1 rounded-xl bg-white/20 backdrop-blur-sm ${getAccuracyClasses(accuracyQuality)} md:text-xs md:px-2 md:py-1`}
            >
              {accuracyQuality} ({Math.round(position.accuracy)}m)
            </span>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && !position && (
        <div className="bg-red-50 text-red-700 p-4 text-center border-b border-red-200">
          <p>{error}</p>
          <div className="flex gap-2 justify-center mt-2">
            <button
              onClick={requestLocationPermission}
              className="border-none px-4 py-2 rounded-md cursor-pointer text-sm bg-red-700 text-white transition-colors hover:bg-red-800"
            >
              Retry Location
            </button>
          </div>
          <small className="block mt-2 text-xs opacity-80">
            For best results: Enable high accuracy GPS, ensure good signal, and
            use on mobile device.
          </small>
        </div>
      )}

      {/* Loading Indicator */}
      {isLoading && <LoadingIndicator message="Getting your location..." />}

      {/* Map Container */}
      <div className="flex-1 relative">
        <MapContainer
          center={position ? [position.lat, position.lng] : defaultCenter}
          zoom={16}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />

          <MapController position={position} />

          {position && (
            <>
              <Marker
                position={[position.lat, position.lng]}
                icon={createLocationIcon(position.accuracy)}
              >
                <Popup>
                  <div>
                    <strong>Your Location</strong>
                    <br />
                    Lat: {position.lat.toFixed(6)}
                    <br />
                    Lng: {position.lng.toFixed(6)}
                    <br />
                    Accuracy: {Math.round(position.accuracy)}m
                    <br />
                    Quality:{" "}
                    <span
                      className={`font-semibold ${getAccuracyClasses(accuracyQuality)}`}
                    >
                      {accuracyQuality}
                    </span>
                    <br />
                    Status:{" "}
                    {currentPolygon !== null
                      ? `In Zone ${currentPolygon + 1}`
                      : "Outside Zone"}
                    <br />
                    Readings: {locationHistory.length}
                  </div>
                </Popup>
              </Marker>

              <Circle
                center={[position.lat, position.lng]}
                radius={position.accuracy}
                color={getAccuracyColor(position.accuracy)}
                fillColor={getAccuracyColor(position.accuracy)}
                fillOpacity={0.1}
                weight={1}
              />
            </>
          )}

          {geoJsonData && (
            <GeoJSON
              data={geoJsonData}
              style={geoJsonStyle}
              onEachFeature={onEachFeature}
            />
          )}
        </MapContainer>
      </div>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
};

export default App;
