import React, { useState, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  GeoJSON,
  useMap,
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

// Create a custom icon for current location
const createLocationIcon = () => {
  return L.divIcon({
    html: `
      <div style="
        width: 20px;
        height: 20px;
        background: #3b82f6;
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

// Toast component
const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
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

// Toast Container
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

// Component to handle map updates
const MapController = ({ position, setMap }) => {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.setView([position.lat, position.lng], 16);
    }
    setMap(map);
  }, [position, map, setMap]);

  return null;
};

const App = () => {
  const [position, setPosition] = useState(null);
  const [geoJsonData, setGeoJsonData] = useState(null);
  const [currentPolygon, setCurrentPolygon] = useState(null);
  const [previousPolygon, setPreviousPolygon] = useState(null);
  const [map, setMap] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [permissionStatus, setPermissionStatus] = useState("unknown");
  const [error, setError] = useState(null);
  const [isTestMode, setIsTestMode] = useState(false);
  const watchId = useRef(null);

  // Test location within one of the polygons
  const testLocation = {
    lat: 16.6955,
    lng: 74.2445,
    accuracy: 10,
  };

  // Set test location
  const setTestLocation = () => {
    setIsTestMode(true);
    setPosition(testLocation);
    setError(null);
    addToast("Test location set (inside zones)", "info");

    // Check polygon containment for test location
    const polygonIndex = checkPolygonContainment(
      testLocation.lat,
      testLocation.lng,
    );
    setCurrentPolygon(polygonIndex);

    if (polygonIndex !== null) {
      addToast(`Test location is in Zone ${polygonIndex + 1}`, "success");
    } else {
      addToast("Test location is outside all zones", "warning");
    }
  };

  // Toast functions
  const addToast = (message, type = "info") => {
    const newToast = {
      id: Date.now() + Math.random(),
      message,
      type,
    };
    setToasts((prev) => [...prev, newToast]);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  // Load GeoJSON data
  useEffect(() => {
    const loadGeoJson = () => {
      try {
        // Embedded GeoJSON data from the uploaded file
        const data = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
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
              properties: {},
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
              properties: {},
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
        console.log("GeoJSON loaded:", data);
        addToast("Zone data loaded successfully", "success");
      } catch (error) {
        console.error("Error loading GeoJSON:", error);
        setError("Failed to load GeoJSON data");
        addToast("Failed to load zone data", "error");
      }
    };

    loadGeoJson();
  }, []);

  // Check which polygon contains the point
  const checkPolygonContainment = (lat, lng) => {
    if (!geoJsonData || !geoJsonData.features) return null;

    const point = turf.point([lng, lat]);

    for (let i = 0; i < geoJsonData.features.length; i++) {
      const feature = geoJsonData.features[i];
      if (feature.geometry.type === "Polygon") {
        const polygon = turf.polygon(feature.geometry.coordinates);
        if (turf.booleanPointInPolygon(point, polygon)) {
          return i; // Return polygon index
        }
      }
    }
    return null; // Outside all polygons
  };

  // Handle position updates
  const handlePositionUpdate = (position) => {
    const newPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };

    console.log("Position update:", {
      lat: newPosition.lat,
      lng: newPosition.lng,
      accuracy: newPosition.accuracy,
      timestamp: new Date().toISOString(),
    });

    setPosition(newPosition);

    // Check polygon containment
    const polygonIndex = checkPolygonContainment(
      newPosition.lat,
      newPosition.lng,
    );

    // Compare with previous state
    if (polygonIndex !== previousPolygon) {
      setPreviousPolygon(currentPolygon);
      setCurrentPolygon(polygonIndex);

      // Generate appropriate toast message
      if (polygonIndex === null) {
        if (previousPolygon !== null) {
          addToast(`You have exited Zone ${previousPolygon + 1}`, "warning");
        } else {
          addToast("You are outside the monitored zones", "info");
        }
      } else {
        if (previousPolygon === null) {
          addToast(`You have entered Zone ${polygonIndex + 1}`, "success");
        } else {
          addToast(
            `You moved from Zone ${previousPolygon + 1} to Zone ${polygonIndex + 1}`,
            "info",
          );
        }
      }
    }
  };

  // Handle geolocation errors
  const handleError = (error) => {
    console.error("Geolocation error:", error);
    let message = "Location access failed";

    switch (error.code) {
      case error.PERMISSION_DENIED:
        message = "Location access denied by user";
        setPermissionStatus("denied");
        break;
      case error.POSITION_UNAVAILABLE:
        message = "Location information is unavailable";
        break;
      case error.TIMEOUT:
        message = "Location request timed out";
        break;
      default:
        message = "An unknown error occurred";
    }

    setError(message);
    addToast(message, "error");
  };

  // Request location permission and start watching
  const requestLocationPermission = async () => {
    if (!navigator.geolocation) {
      const message = "Geolocation is not supported by this browser";
      setError(message);
      addToast(message, "error");
      return;
    }

    // Check if permission API is available
    if (navigator.permissions) {
      try {
        const permission = await navigator.permissions.query({
          name: "geolocation",
        });
        setPermissionStatus(permission.state);

        if (permission.state === "denied") {
          const message =
            "Location permission denied. Please enable location access in your browser settings.";
          setError(message);
          addToast(message, "error");
          return;
        }
      } catch (error) {
        console.log("Permission API not fully supported:", error);
      }
    }

    // Request current position first
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setError(null);
        setPermissionStatus("granted");
        handlePositionUpdate(position);
      },
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );

    // Start watching position
    if (watchId.current) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    watchId.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 30000,
      },
    );
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchId.current) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, []);

  // Start location tracking on mount
  useEffect(() => {
    requestLocationPermission();
  }, []);

  // GeoJSON style
  const geoJsonStyle = (feature) => {
    return {
      color: "#3388ff",
      weight: 3,
      opacity: 0.8,
      fillOpacity: 0.2,
      fillColor: "#3388ff",
    };
  };

  // Popup content for each feature
  const onEachFeature = (feature, layer) => {
    const index = geoJsonData.features.indexOf(feature);
    layer.bindPopup(`Zone ${index + 1}`);
  };

  const defaultCenter = [16.695, 74.244]; // Default to the area of the GeoJSON

  return (
    <div className="app">
      <div className="header">
        <h1>GeoFence Monitor</h1>
        <div className="status">
          <span
            className={`status-indicator ${permissionStatus === "granted" ? "granted" : "denied"}`}
          >
            {permissionStatus === "granted"
              ? "● Location Active"
              : "● Location Disabled"}
          </span>
          {currentPolygon !== null ? (
            <span className="zone-status">In Zone {currentPolygon + 1}</span>
          ) : (
            <span className="zone-status">Outside Zone</span>
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
              Retry Location Access
            </button>
            <button onClick={setTestLocation} className="test-button">
              Use Test Location
            </button>
          </div>
          <small>
            Note: Desktop/laptop location is often inaccurate.
            {navigator.userAgent.includes("Mobile")
              ? " Mobile devices provide better GPS accuracy."
              : " Try on mobile for better results."}
          </small>
        </div>
      )}

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

          <MapController position={position} setMap={setMap} />

          {position && (
            <Marker
              position={[position.lat, position.lng]}
              icon={createLocationIcon()}
            >
              <Popup>
                <div>
                  <strong>Your Location</strong>
                  <br />
                  Lat: {position.lat.toFixed(6)}
                  <br />
                  Lng: {position.lng.toFixed(6)}
                  <br />
                  Accuracy:{" "}
                  {position.accuracy
                    ? `${Math.round(position.accuracy)}m`
                    : "Unknown"}
                  <br />
                  Status:{" "}
                  {currentPolygon !== null
                    ? `In Zone ${currentPolygon + 1}`
                    : "Outside Zone"}
                  <br />
                  <small>
                    Device:{" "}
                    {/Mobi|Android/i.test(navigator.userAgent)
                      ? "Mobile"
                      : "Desktop"}
                  </small>
                  {isTestMode && <br />}
                  <small>{isTestMode ? "Test Location" : ""}</small>
                </div>
              </Popup>
            </Marker>
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
