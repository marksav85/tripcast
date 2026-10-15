import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import TripEditor from '../src/client/components/trip/TripEditor.jsx';
import { allocateTripDates } from '../src/shared/trip.js';
const place = { cityName: 'Paris', countryCode: 'FR', region: null, lat: 48.8566, lon: 2.3522, timeZone: 'Europe/Paris' };
const draft = () => ({ title: 'Summer', startDate: '2027-06-01', endDate: '2027-06-05', destinations: [
  { ...place, position: 0, arrivalDate: '2027-06-01', departureDate: '2027-06-03' },
  { ...place, cityName: 'Rome', countryCode: 'IT', lat: 41.9028, lon: 12.4964, timeZone: 'Europe/Rome', position: 1, arrivalDate: '2027-06-03', departureDate: '2027-06-05' },
] });
const change = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
it('starts empty and limits incomplete rows to eight', () => {
  const submit = vi.fn(); render(<TripEditor onSubmit={submit} />);
  expect(screen.getByRole('button', { name: 'Review validated draft' })).toBeDisabled();
  for (let i=0;i<8;i++) fireEvent.click(screen.getByRole('button', { name: 'Add destination' }));
  expect(screen.getByRole('button', { name: 'Add destination' })).toBeDisabled();
  expect(screen.getAllByRole('region', { name: /^Destination \d/ })).toHaveLength(8);
  expect(submit).not.toHaveBeenCalled();
});
it('hydrates an existing draft and submits normalized data with shared transfer-day allocation', () => {
  const initial = draft(); const onSubmit = vi.fn(); const onChange = vi.fn(); render(<TripEditor initialDraft={initial} onSubmit={onSubmit} onChange={onChange} />);
  expect(screen.getByText('4 weather days across 2 destinations.')).toBeInTheDocument();
  const result = onChange.mock.calls.at(-1)[0]; expect(result).toEqual(allocateTripDates(initial));
  expect(result.allocations.find(x=>x.date==='2027-06-03').position).toBe(1);
  expect(result.allocations.some(x=>x.date==='2027-06-05')).toBe(false);
  change('Trip title', '  Updated  '); fireEvent.click(screen.getByRole('button', { name: 'Review validated draft' }));
  expect(onSubmit).toHaveBeenCalledWith({ ...initial, title: 'Updated' }); expect(initial.title).toBe('Summer');
  expect(screen.getByText(/Nothing has been saved/)).toBeInTheDocument();
});
it('keeps internal timezones when unrelated title or date fields change', () => {
  const onChange = vi.fn(); render(<TripEditor initialDraft={draft()} onChange={onChange} />);
  change('Trip title', 'New title'); change('Destination 1 departure', '2027-06-02');
  expect(screen.getByLabelText('Destination 2 arrival')).toHaveValue('2027-06-03');
  expect(screen.getByRole('button', { name: 'Review validated draft' })).toBeDisabled();
  change('Destination 1 departure', '2027-06-03');
  expect(onChange.mock.calls.at(-1)[0].trip.destinations.map(d => d.timeZone)).toEqual(['Europe/Paris', 'Europe/Rome']);
  expect(screen.queryByText(/timezone/i)).not.toBeInTheDocument();
});
it.each(['2027-06-02','2027-06-04','2027-06-01'])('rejects gaps, overlaps and zero stays %s without shifting neighbors', (value) => {
  render(<TripEditor initialDraft={draft()} />); change('Destination 1 departure', value);
  expect(screen.getByLabelText('Destination 2 arrival')).toHaveValue('2027-06-03');
  expect(screen.getByRole('button', { name: 'Review validated draft' })).toBeDisabled();
  expect(screen.queryByText('4 weather days across 2 destinations.')).not.toBeInTheDocument();
});
it('reorders stable cards and recalculates positions without shifting dates', () => {
  const onChange = vi.fn(); render(<TripEditor initialDraft={draft()} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move destination 2 up' }));
  expect(screen.getByLabelText('Destination 1 arrival')).toHaveValue('2027-06-03');
  expect(within(screen.getByRole('region', { name: 'Destination 1' })).getByText(/Selected city: Rome/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review validated draft' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Move destination 1 down' }));
  expect(onChange.mock.calls.at(-1)[0].trip.destinations.map(x=>x.position)).toEqual([0,1]);
});
it('removes without stretching neighbors and permits removal of all rows', () => {
  render(<TripEditor initialDraft={draft()} />); fireEvent.click(screen.getByRole('button', { name: 'Remove destination 1' }));
  expect(screen.getByLabelText('Destination 1 arrival')).toHaveValue('2027-06-03');
  expect(screen.getByRole('button', { name: 'Review validated draft' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove destination 1' }));
  expect(screen.queryByLabelText('Timezone')).not.toBeInTheDocument();
});
it('changing overall bounds never rewrites destination dates', () => {
  render(<TripEditor initialDraft={draft()} />); change('Trip arrival date','2027-05-31'); change('Trip departure date','2027-06-06');
  expect(screen.getByLabelText('Destination 1 arrival')).toHaveValue('2027-06-01');
  expect(screen.getByLabelText('Destination 2 departure')).toHaveValue('2027-06-05');
  expect(screen.getByRole('button', { name: 'Review validated draft' })).toBeDisabled();
});
it('accepts 42 days and rejects 43 days through shared validation', () => {
  const initial=draft(); initial.endDate='2027-07-13'; initial.destinations=[{...initial.destinations[0],departureDate:initial.endDate}];
  render(<TripEditor initialDraft={initial} />); expect(screen.getByText('42 weather days across 1 destination.')).toBeInTheDocument();
  change('Trip departure date','2027-07-14'); change('Destination 1 departure','2027-07-14');
  expect(screen.getByRole('button', { name: 'Review validated draft' })).toBeDisabled();
});
it('discard restores the complete initial snapshot, including cleared location selection', () => {
  const onCancel=vi.fn(); const onChange=vi.fn(); render(<TripEditor initialDraft={draft()} onCancel={onCancel} onChange={onChange} />);
  change('Trip title','Edited'); fireEvent.change(screen.getAllByLabelText('Search city')[0],{target:{value:'Barcelona'}});
  fireEvent.click(screen.getByRole('button',{name:'Remove destination 2'})); fireEvent.click(screen.getByRole('button',{name:'Discard changes'}));
  expect(screen.getByLabelText('Trip title')).toHaveValue('Summer'); expect(screen.getAllByLabelText('Search city')[0]).toHaveValue('Paris');
  expect(onChange.mock.calls.at(-1)[0].trip).toEqual(draft());
  expect(screen.getByText('4 weather days across 2 destinations.')).toBeInTheDocument(); expect(onCancel).toHaveBeenCalledOnce();
});
it('clears an existing location on city replacement while retaining arrival/departure', () => {
  const onChange=vi.fn(); render(<TripEditor initialDraft={draft()} onChange={onChange} />);
  fireEvent.change(screen.getAllByLabelText('Search city')[0],{target:{value:'Barcelona'}});
  expect(screen.getByLabelText('Destination 1 arrival')).toHaveValue('2027-06-01');
  expect(onChange.mock.calls.at(-1)[0].trip).toBeNull(); expect(screen.getByRole('button',{name:'Review validated draft'})).toBeDisabled();
});

it('creates a complete new draft through the actual selector and resolver', async () => {
  const { fetchMock, apiResponse } = await import('./fixtures/api');
  const onSubmit=vi.fn(); render(<TripEditor onSubmit={onSubmit} />);
  change('Trip title','Paris weekend'); change('Trip arrival date','2027-06-01'); change('Trip departure date','2027-06-03');
  fireEvent.click(screen.getByRole('button',{name:'Add destination'}));
  fetchMock.mockResolvedValueOnce(apiResponse([{name:'Paris',country:'FR',lat:48.8566,lon:2.3522}]));
  change('Search city','Paris'); fireEvent.click(screen.getByRole('button',{name:'Search'}));
  fireEvent.click(await screen.findByRole('button',{name:'Paris, FR'}));
  change('Destination 1 arrival','2027-06-01'); change('Destination 1 departure','2027-06-03');
  expect(screen.getByText('2 weather days across 1 destination.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Review validated draft'}));
  expect(onSubmit).toHaveBeenCalledWith({title:'Paris weekend',startDate:'2027-06-01',endDate:'2027-06-03',destinations:[{...place,position:0,arrivalDate:'2027-06-01',departureDate:'2027-06-03'}]});
});

it('preserves public weather lookup while the local editor preview is open', async () => {
  const {default:Preview}=await import('../src/client/components/trip/TripEditorPreview.jsx');
  const {default:App}=await import('../src/client/App.jsx');
  const {WeatherProvider}=await import('../src/client/context/WeatherContextProvider.jsx');
  const {fetchMock,apiResponse}=await import('./fixtures/api'); const {berlin,daySummary}=await import('./fixtures/weather');
  render(<><Preview /><WeatherProvider><App /></WeatherProvider></>);
  fireEvent.click(screen.getByRole('button',{name:'Open local trip editor'}));
  expect(screen.getByRole('region',{name:'Trip editor'})).toBeInTheDocument();
  fetchMock.mockResolvedValueOnce(apiResponse([berlin])).mockResolvedValueOnce(apiResponse(daySummary));
  change('City:','Berlin'); change('Date of travel:',daySummary.date); fireEvent.click(screen.getByRole('button',{name:'Submit'}));
  await screen.findByText('Weather loaded.');
});
