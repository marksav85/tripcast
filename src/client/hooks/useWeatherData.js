import { useState, useEffect } from "react";
import axios from "axios";

// Import weather icons for different conditions
import overcastIcon from "/media/weather-icons/overcast.svg";
import partCloudIcon from "/media/weather-icons/partly-cloudy-day.svg";
import rainIcon from "/media/weather-icons/rain.svg";
import partRainIcon from "/media/weather-icons/partly-cloudy-day-rain.svg";
import snowIcon from "/media/weather-icons/snow.svg";
import partSnowIcon from "/media/weather-icons/partly-cloudy-day-snow.svg";
import sunIcon from "/media/weather-icons/sun.svg";

import hotIcon from "/media/weather-icons/thermometers/thermometer-hot.svg";
import warmIcon from "/media/weather-icons/thermometers/thermometer-warm.svg";
import mildIcon from "/media/weather-icons/thermometers/thermometer-mild.svg";
import coldIcon from "/media/weather-icons/thermometers/thermometer-cold.svg";
import freezingIcon from "/media/weather-icons/thermometers/thermometer-freezing.svg";

// Function to return a string description based on cloud cover percentage
const getCloudCover = (cloudCover) => {
  if (cloudCover >= 0 && cloudCover <= 20) return "Clear"; // Return "Sunny/Clear" if cloud cover is between 0% and 10%
  if (cloudCover > 20 && cloudCover <= 30) return "Mostly Sunny"; // Return "Mostly Sunny" if cloud cover is between 21% and 30%
  if (cloudCover > 30 && cloudCover <= 60) return "Partly Cloudy"; // Return "Partly Cloudy" if cloud cover is between 31% and 60%
  if (cloudCover > 60 && cloudCover <= 70) return "Partly Sunny"; // Return "Partly Sunny" if cloud cover is between 61% and 70%
  if (cloudCover > 70 && cloudCover <= 90) return "Mostly Cloudy"; // Return "Mostly Cloudy" if cloud cover is between 71% and 90%
  if (cloudCover > 90 && cloudCover <= 100) return "Overcast"; // Return "Overcast" if cloud cover is between 91% and 100%
  return "No data"; // Return an error message if the input is out of bounds
};

// Function to return a string description based on total rainfall in a day in mm
const getRainfall = (rainfall) => {
  if (rainfall < 0.1) return "No Rain"; // Return 0 if rainfall is less than 0.1 mm
  if (rainfall >= 0.1 && rainfall < 1) return "Very Light Rain"; // Return "Very Light Rain" if rainfall is between 0.1mm and 1mm
  if (rainfall >= 1 && rainfall < 10) return "Light Rain"; // Return "Light Rain" if rainfall is between 1mm and 10mm
  if (rainfall >= 10 && rainfall < 30) return "Moderate Rain"; // Return "Moderate Rain" if rainfall is between 10mm and 30mm
  if (rainfall >= 30 && rainfall < 70) return "Heavy Rain"; // Return "Heavy Rain" if rainfall is between 30mm and 70mm
  if (rainfall >= 70 && rainfall < 150) return "Very Heavy Rain"; // Return "Very Heavy Rain" if rainfall is between 70mm and 150mm
  return "Extreme Rain"; // Return "Extreme Rain" if rainfall is above 150mm
};

// Function to determine the appropriate weather icon based on weather conditions
const getWeatherIcon = (cloudCover, rainfall, temperatureCelsius) => {
  // Cloud cover but no rain or snow
  if (cloudCover > 70 && rainfall <= 0.1) return overcastIcon; // Overcast weather
  if (cloudCover > 20 && rainfall <= 0.1) return partCloudIcon; // Partly cloudy weather
  // Cloud cover with rain
  if (cloudCover > 70 && rainfall > 0.1 && temperatureCelsius >= 0)
    return rainIcon; // Cloudy with rain above freezing
  if (cloudCover > 20 && rainfall > 0.1 && temperatureCelsius >= 0)
    return partRainIcon; // Partly cloudy with rain above freezing
  // Cloud cover with snow
  if (cloudCover > 70 && rainfall > 0.1 && temperatureCelsius < 0)
    return snowIcon; // Cloudy with snow below freezing
  if (cloudCover > 20 && rainfall > 0.1 && temperatureCelsius < 0)
    return partSnowIcon; // Partly cloudy with snow below freezing
  return sunIcon; // Default to sunny weather
};

// Function to determine the appropriate temperature icon based on temperature in Celsius
const getTempIcon = (temperatureCelsius) => {
  if (temperatureCelsius >= 30) return hotIcon; // Hot weather
  if (temperatureCelsius >= 20) return warmIcon; // Warm weather
  if (temperatureCelsius >= 10) return mildIcon; // Mild weather
  if (temperatureCelsius >= 0) return coldIcon; // Cold weather
  return freezingIcon; // Freezing weather
};

// Custom hook to fetch and process weather data
const useWeatherData = (city, date, submitted) => {
  // State to store the fetched weather data
  const [weatherData, setWeatherData] = useState(null);
  // State to store the temperature in Celsius
  const [temperatureCelsius, setTemperatureCelsius] = useState(null);
  // State to store the weather icon URL
  const [weatherIcon, setWeatherIcon] = useState("");
  // State to store the temperature icon URL
  const [tempIcon, setTempIcon] = useState("");
  // State to store any error messages
  const [errorMessage, setErrorMessage] = useState("");
  // State to track the loading status
  const [loading, setLoading] = useState(true);

  // Effect hook to fetch weather data when the city, date, and submitted state change
  useEffect(() => {
    // Check if all required conditions are met to fetch weather data
    if (city && date && submitted) {
      const fetchWeather = async () => {
        try {
          setLoading(true); // Set loading state to true before starting the fetch
          setErrorMessage(""); // Clear any previous error messages

          const apiKey = import.meta.env.VITE_API_KEY; // API key for OpenWeatherMap

          // Fetch geocoding data to get latitude and longitude based on city name
          const geocodingUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${city}&appid=${apiKey}`;
          const geocodingResponse = await axios.get(geocodingUrl);
          const { lat, lon } = geocodingResponse.data[0]; // Extract latitude and longitude

          // Fetch weather data using latitude, longitude, and date
          const weatherUrl = `https://api.openweathermap.org/data/3.0/onecall/day_summary?lat=${lat}&lon=${lon}&date=${date}&appid=${apiKey}`;
          const weatherResponse = await axios.get(weatherUrl);
          const data = weatherResponse.data; // Extract weather data

          // Calculate the average temperature in Celsius
          const temperatureMin = data.temperature.min;
          const temperatureMax = data.temperature.max;
          const averageTemperature = (temperatureMin + temperatureMax) / 2;
          const tempCelsius = Math.round(averageTemperature - 273.15); // Convert Kelvin to Celsius
          setTemperatureCelsius(tempCelsius);

          // Determine the appropriate icons based on weather conditions
          const tempIcon = getTempIcon(tempCelsius);
          const cloudCover = data.cloud_cover.afternoon;
          const rainfall = data.precipitation.total;
          const weatherIcon = getWeatherIcon(cloudCover, rainfall, tempCelsius);

          // Update states with the fetched weather data and icons
          setWeatherData(data);
          console.log("Weather Data: ", data);
          setWeatherIcon(weatherIcon);
          setTempIcon(tempIcon);
          setErrorMessage(""); // Clear any previous error messages
        } catch {
          setErrorMessage("Error fetching weather data"); // Set error message if fetching fails
        } finally {
          setLoading(false); // Set loading state to false once fetching is complete
        }
      };

      fetchWeather(); // Call the fetch function
    }
  }, [city, date, submitted]); // Dependencies to trigger the effect

  // Function to reset the weather data and related states
  const resetWeatherData = () => {
    setWeatherData(null);
    setTemperatureCelsius(null);
    setWeatherIcon("");
    setTempIcon("");
    setErrorMessage("");
  };

  // Return the weather data, icons, and states
  return {
    weatherData,
    getCloudCover,
    getRainfall,
    temperatureCelsius,
    tempIcon,
    weatherIcon,
    errorMessage,
    loading,
    resetWeatherData,
  };
};

export default useWeatherData;
