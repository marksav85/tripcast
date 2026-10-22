import { createContext, useState } from 'react';
import PropTypes from 'prop-types';
import useWeatherData from '../hooks/useWeatherData';
import useCurrentLocation from '../hooks/useCurrentLocation';
import { todayDate } from '../lib/calendar';
import { validateLookup } from '../lib/locations';

const WeatherContext = createContext();

export function WeatherProvider({ children }) {
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const weather = useWeatherData(setSelectedLocation);
  const geolocation = useCurrentLocation((location) => {
    setCity(location.name);
    setSelectedLocation(location);
    setFieldErrors({});
  });

  const changeCity = (value) => {
    geolocation.cancel();
    weather.cancelPending();
    setSelectedLocation(null);
    setCity(value);
    setFieldErrors((errors) => ({ ...errors, city: undefined }));
  };
  const changeDate = (value) => {
    geolocation.cancel();
    weather.cancelPending();
    setDate(value);
    setFieldErrors((errors) => ({ ...errors, date: undefined }));
  };
  const submit = () => {
    geolocation.cancel();
    const { query, errors } = validateLookup(city, date);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      weather.cancelPending();
      return errors;
    }
    void weather.run({ city: query, date, location: selectedLocation });
    return errors;
  };
  const resetAll = () => {
    geolocation.cancel();
    weather.reset();
    setCity('');
    setDate('');
    setSelectedLocation(null);
    setFieldErrors({});
  };
  const handleUseCurrentLocation = () => {
    weather.cancelPending();
    setSelectedLocation(null);
    geolocation.locate();
  };
  const retry = () => {
    geolocation.cancel();
    if (!weather.query) return;
    setCity(weather.query.city);
    setDate(weather.query.date);
    setSelectedLocation(weather.query.location ?? null);
    setFieldErrors({});
    weather.retry();
  };

  return (
    <WeatherContext.Provider
      value={{
        city,
        date,
        changeCity,
        changeDate,
        selectedLocation,
        fieldErrors,
        submit,
        resetAll,
        handleUseCurrentLocation,
        setToday: () => changeDate(todayDate()),
        weather,
        geolocation,
        retry,
      }}
    >
      {children}
    </WeatherContext.Provider>
  );
}
WeatherProvider.propTypes = { children: PropTypes.node.isRequired };
export default WeatherContext;
