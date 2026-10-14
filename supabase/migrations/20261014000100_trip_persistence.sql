begin;
create schema tripcast_private;
revoke all on schema tripcast_private from public, anon, authenticated;

-- Match ECMAScript trim whitespace; C0 and DEL are rejected before normalization.
create function tripcast_private.label(value text) returns text
language plpgsql immutable set search_path = '' as $$
declare trimmed text;
begin
  if value is null or char_length(value) > 100 or value ~ '[\x01-\x1f\x7f]' then
    raise exception using errcode='22023', message='INVALID_TRIP';
  end if;
  trimmed := btrim(value, U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if char_length(trimmed) = 0 then raise exception using errcode='22023', message='INVALID_TRIP'; end if;
  return trimmed;
end $$;
create function tripcast_private.zone(value text) returns boolean
language sql stable set search_path = '' as $$
 select value is not null and char_length(value) between 1 and 100
 and (value = 'UTC' or value ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$')
 and value not like 'posix/%' and value not like 'right/%'
 and exists (select 1 from pg_catalog.pg_timezone_names where lower(name)=lower(value));
$$;
create function tripcast_private.calendar(value text) returns date
language plpgsql immutable set search_path = '' as $$
declare result date;
begin
  if value is null or length(value) <> 10 or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode='22023', message='INVALID_TRIP';
  end if;
  result := value::date;
  if not isfinite(result) or result < date '0001-01-01' or result > date '9999-12-31' then
    raise exception using errcode='22023', message='INVALID_TRIP';
  end if;
  return result;
exception when data_exception then raise exception using errcode='22023', message='INVALID_TRIP';
end $$;
create function tripcast_private.revision(value jsonb, minimum bigint) returns bigint
language plpgsql immutable set search_path = '' as $$
declare n numeric;
begin
  if jsonb_typeof(value) is distinct from 'number' then raise exception using errcode='22023', message='INVALID_REVISION'; end if;
  n := value::text::numeric;
  if n <> trunc(n) or n < minimum or n > 9007199254740991 then raise exception using errcode='22023', message='INVALID_REVISION'; end if;
  return n::bigint;
end $$;

create table public.trips (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 title text not null check (title = tripcast_private.label(title)),
 start_date date not null check (isfinite(start_date) and start_date between date '0001-01-01' and date '9999-12-31'),
 end_date date not null check (isfinite(end_date) and end_date between date '0001-01-01' and date '9999-12-31'),
 revision bigint not null default 1 check (revision between 1 and 9007199254740991),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (end_date - start_date between 1 and 42)
);
create table public.trip_destinations (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 sort_order smallint not null check (sort_order between 0 and 7),
 city_name text not null check (city_name = tripcast_private.label(city_name)),
 country_code text not null check (length(country_code)=2 and country_code ~ '^[A-Z]{2}$'),
 region text check (region is null or region = tripcast_private.label(region)),
 latitude double precision not null check (latitude between -90 and 90),
 longitude double precision not null check (longitude between -180 and 180),
 timezone text not null check (tripcast_private.zone(timezone)),
 arrival_date date not null check (isfinite(arrival_date) and arrival_date between date '0001-01-01' and date '9999-12-31'),
 departure_date date not null check (isfinite(departure_date) and departure_date between date '0001-01-01' and date '9999-12-31'),
 check (departure_date > arrival_date), unique (trip_id,sort_order)
);
alter table public.trips enable row level security;
alter table public.trip_destinations enable row level security;
revoke all on public.trips,public.trip_destinations from public,anon,authenticated,service_role;
grant select on public.trips,public.trip_destinations to authenticated;
create policy owner_read on public.trips for select to authenticated
 using ((select auth.uid()) is not null and user_id=(select auth.uid()));
create policy owner_read on public.trip_destinations for select to authenticated
 using (exists(select 1 from public.trips t where t.id=trip_id and t.user_id=(select auth.uid())));

create function tripcast_private.assert_itinerary(target uuid) returns void
language plpgsql set search_path = '' as $$
declare t public.trips; n integer; first_arrival date; last_departure date;
begin
 select * into t from public.trips where id=target for update;
 if not found then return; end if; -- cascade deletion
 select count(*),min(arrival_date),max(departure_date) into n,first_arrival,last_departure from public.trip_destinations where trip_id=target;
 if n not between 1 and 8 or first_arrival <> t.start_date or last_departure <> t.end_date
 or exists(select 1 from (
   select sort_order,arrival_date,departure_date,row_number() over(order by sort_order)-1 expected,
     lag(departure_date) over(order by sort_order) previous
   from public.trip_destinations where trip_id=target
 ) s where sort_order<>expected or (sort_order>0 and arrival_date<>previous)
   or arrival_date<t.start_date or departure_date>t.end_date) then
   raise exception using errcode='23514', message='INVALID_ITINERARY';
 end if;
end $$;
create function tripcast_private.guard_parent() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.id <> old.id or new.user_id <> old.user_id then raise exception using errcode='23514',message='IMMUTABLE_OWNER'; end if;
 return new;
end $$;
create trigger immutable_owner before update on public.trips for each row execute function tripcast_private.guard_parent();
create function tripcast_private.guard_child() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op='UPDATE' and (new.trip_id<>old.trip_id or new.id<>old.id) then raise exception using errcode='23514',message='IMMUTABLE_PARENT'; end if;
 if tg_op='DELETE' then
   perform 1 from public.trips where id=old.trip_id for update; return old;
 else
   perform 1 from public.trips where id=new.trip_id for update; return new;
 end if;
end $$;
create trigger lock_parent before insert or update or delete on public.trip_destinations for each row execute function tripcast_private.guard_child();
create function tripcast_private.final_state() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_table_name='trips' then perform tripcast_private.assert_itinerary(new.id);
 elsif tg_op='DELETE' then perform tripcast_private.assert_itinerary(old.trip_id);
 else perform tripcast_private.assert_itinerary(new.trip_id); end if;
 return null;
end $$;
create constraint trigger valid_trip after insert or update on public.trips deferrable initially deferred
 for each row execute function tripcast_private.final_state();
create constraint trigger valid_destinations after insert or update or delete on public.trip_destinations deferrable initially deferred
 for each row execute function tripcast_private.final_state();

create function tripcast_private.normalize_draft(value jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare item jsonb; items jsonb := '[]'; i integer := 0; arrival date; departure date;
 start_day date; end_day date; previous date; title text; region text; lat numeric; lon numeric;
begin
 if jsonb_typeof(value) is distinct from 'object'
 or (select count(*) from jsonb_object_keys(value))<>4
 or not value ?& array['title','startDate','endDate','destinations']
 or jsonb_typeof(value->'title') is distinct from 'string'
 or jsonb_typeof(value->'startDate') is distinct from 'string'
 or jsonb_typeof(value->'endDate') is distinct from 'string'
 or jsonb_typeof(value->'destinations') is distinct from 'array' then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
 if octet_length(value::text)>16384 or jsonb_array_length(value->'destinations') not between 1 and 8 then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
 title:=tripcast_private.label(value->>'title'); start_day:=tripcast_private.calendar(value->>'startDate'); end_day:=tripcast_private.calendar(value->>'endDate');
 if end_day-start_day not between 1 and 42 then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
 previous:=start_day;
 for item in select * from jsonb_array_elements(value->'destinations') loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['position','cityName','countryCode','lat','lon','timeZone','arrivalDate','departureDate']
  or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['position','cityName','countryCode','region','lat','lon','timeZone','arrivalDate','departureDate']))
  or jsonb_typeof(item->'position') is distinct from 'number' or (item->>'position')::numeric<>i
  or jsonb_typeof(item->'lat') is distinct from 'number' or jsonb_typeof(item->'lon') is distinct from 'number'
  or jsonb_typeof(item->'cityName') is distinct from 'string' or jsonb_typeof(item->'countryCode') is distinct from 'string'
  or jsonb_typeof(item->'timeZone') is distinct from 'string' or jsonb_typeof(item->'arrivalDate') is distinct from 'string'
  or jsonb_typeof(item->'departureDate') is distinct from 'string' then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
  if length(item->>'countryCode')<>2 or (item->>'countryCode')!~'^[A-Z]{2}$' or not tripcast_private.zone(item->>'timeZone') then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
  lat:=(item->>'lat')::numeric;lon:=(item->>'lon')::numeric;
  if lat not between -90 and 90 or lon not between -180 and 180 then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
  region:=null;
  if item ? 'region' and item->'region'<>'null'::jsonb then
   if jsonb_typeof(item->'region')<>'string' then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
   region:=tripcast_private.label(item->>'region');
  end if;
  arrival:=tripcast_private.calendar(item->>'arrivalDate');departure:=tripcast_private.calendar(item->>'departureDate');
  if arrival<>previous or departure<=arrival or departure>end_day then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
  previous:=departure;
  items:=items||jsonb_build_array(jsonb_build_object('position',i,'cityName',tripcast_private.label(item->>'cityName'),
   'countryCode',item->>'countryCode','region',region,'lat',lat::double precision,'lon',lon::double precision,'timeZone',item->>'timeZone','arrivalDate',item->>'arrivalDate','departureDate',item->>'departureDate'));
  i:=i+1;
 end loop;
 if previous<>end_day then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
 return jsonb_build_object('title',title,'startDate',value->>'startDate','endDate',value->>'endDate','destinations',items);
exception when data_exception then raise exception using errcode='22023',message='INVALID_TRIP';
end $$;
create function tripcast_private.read_draft(target uuid) returns jsonb
language sql stable set search_path = '' as $$
 select jsonb_build_object('title',t.title,'startDate',to_char(t.start_date,'YYYY-MM-DD'),'endDate',to_char(t.end_date,'YYYY-MM-DD'),
 'destinations',(select jsonb_agg(jsonb_build_object('position',d.sort_order,'cityName',d.city_name,'countryCode',d.country_code,
 'region',d.region,'lat',d.latitude,'lon',d.longitude,'timeZone',d.timezone,'arrivalDate',to_char(d.arrival_date,'YYYY-MM-DD'),
 'departureDate',to_char(d.departure_date,'YYYY-MM-DD')) order by d.sort_order) from public.trip_destinations d where d.trip_id=t.id))
 from public.trips t where t.id=target;
$$;
create function public.save_trip(p_trip_id uuid,p_expected_revision jsonb,p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid; expected bigint; canonical jsonb; t public.trips; item jsonb;
begin
 subject:=auth.uid();
 if subject is null or auth.role() is distinct from 'authenticated' then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
 if p_trip_id is null then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(subject::text,0));
 expected:=tripcast_private.revision(p_expected_revision,0);canonical:=tripcast_private.normalize_draft(p_draft);
 select * into t from public.trips where user_id=subject for update;
 if not found then
  if expected<>0 then raise exception using errcode='P0001',message='TRIP_CONFLICT'; end if;
  begin
   insert into public.trips(id,user_id,title,start_date,end_date) values(p_trip_id,subject,canonical->>'title',(canonical->>'startDate')::date,(canonical->>'endDate')::date) returning * into t;
  exception when unique_violation then
   select * into t from public.trips where user_id=subject for update;
   if not found or t.id<>p_trip_id or t.revision<>1 or tripcast_private.read_draft(t.id)<>canonical then raise exception using errcode='P0001',message='TRIP_CONFLICT'; end if;
   return jsonb_build_object('id',t.id,'revision',t.revision,'draft',canonical);
  end;
 else
  if t.id<>p_trip_id then raise exception using errcode='P0001',message='TRIP_CONFLICT'; end if;
  if t.revision=expected+1 and tripcast_private.read_draft(t.id)=canonical then
   return jsonb_build_object('id',t.id,'revision',t.revision,'draft',canonical);
  end if;
  if t.revision<>expected or expected=0 or t.revision>=9007199254740991 then raise exception using errcode='P0001',message='TRIP_CONFLICT'; end if;
  update public.trips set title=canonical->>'title',start_date=(canonical->>'startDate')::date,end_date=(canonical->>'endDate')::date,
   revision=revision+1,updated_at=clock_timestamp() where id=p_trip_id and user_id=subject returning * into t;
  delete from public.trip_destinations where trip_id=p_trip_id;
 end if;
 for item in select * from jsonb_array_elements(canonical->'destinations') loop
  insert into public.trip_destinations(trip_id,sort_order,city_name,country_code,region,latitude,longitude,timezone,arrival_date,departure_date)
  values(t.id,(item->>'position')::smallint,item->>'cityName',item->>'countryCode',item->>'region',(item->>'lat')::double precision,
   (item->>'lon')::double precision,item->>'timeZone',(item->>'arrivalDate')::date,(item->>'departureDate')::date);
 end loop;
 perform tripcast_private.assert_itinerary(t.id);
 return jsonb_build_object('id',t.id,'revision',t.revision,'draft',canonical);
end $$;
create function public.delete_trip(p_trip_id uuid,p_expected_revision jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid; expected bigint; t public.trips;
begin
 subject:=auth.uid();
 if subject is null or auth.role() is distinct from 'authenticated' then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
 if p_trip_id is null then raise exception using errcode='22023',message='INVALID_TRIP'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(subject::text,0));
 expected:=tripcast_private.revision(p_expected_revision,1);
 select * into t from public.trips where id=p_trip_id and user_id=subject for update;
 if not found then return jsonb_build_object('id',p_trip_id,'deleted',true); end if;
 if t.revision<>expected then raise exception using errcode='P0001',message='TRIP_CONFLICT'; end if;
 delete from public.trips where id=p_trip_id and user_id=subject;
 return jsonb_build_object('id',p_trip_id,'deleted',true);
end $$;
revoke all on all functions in schema tripcast_private from public,anon,authenticated,service_role;
revoke all on function public.save_trip(uuid,jsonb,jsonb),public.delete_trip(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_trip(uuid,jsonb,jsonb),public.delete_trip(uuid,jsonb) to authenticated;
commit;
