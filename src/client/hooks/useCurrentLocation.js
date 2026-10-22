import { useEffect, useRef, useState } from 'react';
import { reverseLookup, requestError } from '../api/openWeather';

export default function useCurrentLocation(onLocation) {
  const [state, setState] = useState({ status: 'idle', message: '' });
  const current = useRef({ generation: 0, controller: null });
  const cancel = () => {
    current.current.generation += 1;
    current.current.controller?.abort();
    current.current.controller = null;
    setState({ status: 'idle', message: '' });
  };
  useEffect(
    () => () => {
      current.current.generation += 1;
      current.current.controller?.abort();
    },
    [],
  );

  const locate = () => {
    cancel();
    const generation = current.current.generation;
    const active = () => generation === current.current.generation;
    if (!navigator.geolocation) {
      setState({ status: 'error', message: 'Geolocation is not supported. Enter a city instead.' });
      return;
    }
    setState({ status: 'loading', message: 'Getting your location…' });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (!active()) return;
        const controller = new AbortController();
        current.current.controller = controller;
        try {
          const location = await reverseLookup(
            position.coords.latitude,
            position.coords.longitude,
            controller.signal,
          );
          if (!active() || controller.signal.aborted) return;
          if (!location) {
            setState({
              status: 'empty',
              message: 'No city found near your location. Enter a city instead.',
            });
            return;
          }
          onLocation(location);
          setState({
            status: 'success',
            message: 'Current location selected. Choose a date and submit.',
          });
        } catch (error) {
          if (active() && !controller.signal.aborted)
            setState({ status: 'error', message: requestError(error, 'Location lookup') });
        }
      },
      (error) => {
        if (!active()) return;
        const message =
          error.code === 1
            ? 'Location permission denied. Enter a city instead.'
            : error.code === 3
              ? 'Getting your location timed out. Try again or enter a city.'
              : 'Your location is unavailable. Enter a city instead.';
        setState({ status: 'error', message });
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false },
    );
  };
  return { ...state, locate, cancel };
}
