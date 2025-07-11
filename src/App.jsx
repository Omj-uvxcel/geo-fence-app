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

  return (
    <div className={`toast ${type}`} onClick={onClose}>
      <div className="toast-content">
        <span className="toast-message">{message}</span>
        <button className="toast-close">×</button>
      </div>
    </div>
  );
};

// Toast Container with improved management
const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="toast-container">
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
  <div className="loading-indicator">
    <div className="spinner"></div>
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

      // Smooth pan if position changed significantly
      if (prevPosition) {
        const distance = turf.distance(
          [prevPosition.lng, prevPosition.lat],
          [position.lng, position.lat],
          { units: "meters" },
        );

        if (distance > 50) {
          // Only pan if moved more than 50m
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

// Enhanced location filter class
class LocationFilter {
  constructor() {
    this.readings = [];
    this.maxReadings = 5;
    this.accuracyThreshold = 100; // meters
  }

  addReading(position) {
    this.readings.push({
      ...position,
      timestamp: Date.now(),
    });

    // Keep only recent readings
    if (this.readings.length > this.maxReadings) {
      this.readings.shift();
    }

    // Clean old readings (older than 30 seconds)
    const now = Date.now();
    this.readings = this.readings.filter((r) => now - r.timestamp < 30000);
  }

  getFilteredPosition() {
    if (this.readings.length === 0) return null;

    // Filter out readings with poor accuracy
    const goodReadings = this.readings.filter(
      (r) => r.accuracy <= this.accuracyThreshold,
    );

    if (goodReadings.length === 0) {
      // If no good readings, use the best available
      const bestReading = this.readings.reduce((best, current) =>
        current.accuracy < best.accuracy ? current : best,
      );
      return bestReading;
    }

    // Use weighted average based on accuracy (better accuracy = higher weight)
    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    let bestAccuracy = Math.min(...goodReadings.map((r) => r.accuracy));

    goodReadings.forEach((reading) => {
      const weight = 1 / (reading.accuracy + 1); // Higher weight for better accuracy
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
      timeout: 15000, // Increased timeout for mobile
      maximumAge: 5000, // Reduced max age for fresher readings
    }),
    [],
  );

  const watchOptions = useMemo(
    () => ({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 2000, // Very fresh readings for continuous tracking
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

        // Generate appropriate toast message
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

      // Add to location history
      setLocationHistory((prev) => [...prev.slice(-19), newPosition]); // Keep last 20 positions

      // Add to filter
      locationFilter.current.addReading(newPosition);

      // Get filtered position
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
          // Auto-retry on timeout
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

    // Check permission status
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

    // Clear existing watch
    if (watchId.current) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    // Get initial position
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPermissionStatus("granted");
        handlePositionUpdate(position);
        addToast("Location tracking started", "success");
      },
      handleError,
      geoOptions,
    );

    // Start continuous watching
    watchId.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      handleError,
      watchOptions,
    );
  }, [handlePositionUpdate, handleError, geoOptions, watchOptions, addToast]);

  // Fetch all GeoJSON data from API
  const fetchGeoJsonData = useCallback(async () => {
    try {
      const response = await fetch(
        `https://twelve-highly-align-later.trycloudflare.com/api/features`,
      );

      if (!response.ok) {
        throw new Error("Cannot reach server");
      }

      const data = await response.json();

      if (data && data.features) {
        setGeoJsonData(data);
        setGeoJsonLoaded(true);
        console.log("GeoJSON loaded successfully from API");
        addToast("Zone data loaded", "success");
      } else {
        throw new Error("Invalid data format");
      }
    } catch (error) {
      console.error("Error fetching GeoJSON:", error);
      setError("Cannot reach server");
      addToast("Cannot reach server", "error");
    }
  }, [addToast]);

  // Load GeoJSON data once on component mount
  useEffect(() => {
    if (!geoJsonLoaded) {
      fetchGeoJsonData();
    }
  }, [geoJsonLoaded, fetchGeoJsonData]);

  // Start location tracking on mount
  useEffect(() => {
    requestLocationPermission();
  }, [requestLocationPermission]);

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
  const onEachFeature = useCallback((feature, layer) => {
    const zoneName = feature.properties?.name || `Zone ${feature.id}`;
    const description = feature.properties?.description || "";
    layer.bindPopup(`<strong>${zoneName}</strong><br/>${description}`);
  }, []);

  const defaultCenter = [16.695, 74.244];

  const getAccuracyColor = (accuracy) => {
    if (accuracy < 20) return "#10b981";
    if (accuracy < 50) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <div className="app">
      <div className="header">
        <h1>🌍 GeoFence </h1>
        <div className="status">
          <span
            className={`status-indicator ${permissionStatus === "granted" ? "granted" : "denied"}`}
          >
            {isLoading
              ? "⏳ Loading..."
              : permissionStatus === "granted"
                ? "● Location Active"
                : "● Location Disabled"}
          </span>
          <span className="zone-status">
            {currentPolygon !== null
              ? `In Zone ${currentPolygon + 1}`
              : "Outside Zone"}
          </span>
          {position && (
            <span className={`accuracy-indicator ${accuracyQuality}`}>
              {accuracyQuality} ({Math.round(position.accuracy)}m)
            </span>
          )}
        </div>
      </div>

      {error && !position && (
        <div className="error-message">
          <p>{error}</p>
          <div className="error-actions">
            <button
              onClick={requestLocationPermission}
              className="retry-button"
            >
              Retry Location
            </button>
          </div>
          <small>
            For best results: Enable high accuracy GPS, ensure good signal, and
            use on mobile device.
          </small>
        </div>
      )}

      {isLoading && <LoadingIndicator message="Getting your location..." />}

      <div className="map-container">
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
                    <span className={`quality-${accuracyQuality}`}>
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

              {/* Accuracy circle */}
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
