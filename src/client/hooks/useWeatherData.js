import { useEffect, useRef, useState } from 'react';
import { lookupCities, lookupWeather, requestError } from '../api/openWeather';

const idle = { status: 'idle', message: '', result: null, query: null, candidates: [] };

export default function useWeatherData(onSelectedLocation) {
  const [state, setState] = useState(idle);
  const current = useRef({ generation: 0, controller: null });
  const lastQuery = useRef(null);

  const invalidate = () => {
    current.current.controller?.abort();
    current.current.generation += 1;
    current.current.controller = null;
  };
  useEffect(
    () => () => {
      current.current.controller?.abort();
      current.current.generation += 1;
    },
    [],
  );

  const run = async (query) => {
    invalidate();
    const controller = new AbortController();
    current.current.controller = controller;
    const generation = current.current.generation;
    const active = () => generation === current.current.generation && !controller.signal.aborted;
    lastQuery.current = query;
    setState({
      ...idle,
      status: 'loading',
      message: query.location ? 'Loading weather…' : 'Finding cities…',
      query,
    });
    let service = query.location ? 'Weather lookup' : 'City lookup';
    try {
      let location = query.location;
      if (!location) {
        const candidates = await lookupCities(query.city, controller.signal);
        if (!active()) return;
        if (!candidates.length) {
          setState({
            ...idle,
            status: 'empty',
            message: 'No matching city. Check the spelling or add a country.',
            query,
          });
          return;
        }
        if (candidates.length > 1) {
          setState({
            ...idle,
            status: 'selecting',
            message: 'Choose a matching city below.',
            candidates,
            query,
          });
          return;
        }
        location = candidates[0];
      }
      const selectedQuery = { ...query, location: { ...location } };
      lastQuery.current = selectedQuery;
      onSelectedLocation(location);
      service = 'Weather lookup';
      if (active())
        setState({ ...idle, status: 'loading', message: 'Loading weather…', query: selectedQuery });
      const { model, available } = await lookupWeather(selectedQuery, controller.signal);
      if (!active()) return;
      setState({
        ...idle,
        status: available ? 'success' : 'unavailable',
        message: available
          ? 'Weather loaded.'
          : 'Weather is unavailable for this location and date.',
        result: model,
        query: selectedQuery,
      });
    } catch (error) {
      if (!active()) return;
      setState({
        ...idle,
        status: 'error',
        message: requestError(error, service),
        query: lastQuery.current,
      });
    }
  };

  const chooseCity = (location) => {
    if (state.status !== 'selecting' || !state.candidates.some((item) => item.id === location.id))
      return;
    void run({ ...state.query, location });
  };
  const cancelPending = () => {
    invalidate();
    setState((previous) => (['loading', 'selecting'].includes(previous.status) ? idle : previous));
  };
  const reset = () => {
    invalidate();
    lastQuery.current = null;
    setState(idle);
  };
  const retry = () => {
    if (lastQuery.current) void run(lastQuery.current);
  };
  return { ...state, run, chooseCity, cancelPending, reset, retry };
}
