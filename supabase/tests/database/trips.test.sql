begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
-- Administrative fixture setup only. Assertions below switch to real Data API roles.
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','pgtap-a@example.test'),
 ('00000000-0000-4000-8000-000000000002','pgtap-b@example.test');
create function pg_temp.as_app(who uuid, role_name text, query text) returns text
language plpgsql as $$
declare result text; original_role text := current_user;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',who,'role',role_name)::text,true);
 execute 'set local role '||quote_ident(role_name);
 begin execute query into result;
 exception when others then result:='error:'||sqlstate||':'||sqlerrm; end;
 execute 'set local role '||quote_ident(original_role);
 return result;
end $$;
create function pg_temp.draft(start_day text default '2027-06-01',end_day text default '2027-06-03',n integer default 1) returns jsonb
language sql as $$
 select jsonb_build_object('title','Summer','startDate',start_day,'endDate',end_day,'destinations',jsonb_build_array(
 jsonb_build_object('position',0,'cityName','Paris','countryCode','FR','lat',0,'lon',0,'timeZone','UTC','arrivalDate',start_day,'departureDate',end_day)));
$$;
create function pg_temp.call_save(expected jsonb,draft jsonb) returns text language sql as $$
 select pg_temp.as_app('00000000-0000-4000-8000-000000000001','authenticated',
 format('select public.save_trip(%L,%L::jsonb,%L::jsonb)->>''revision''','00000000-0000-4000-8000-000000000010',expected,draft));
$$;
select is(pg_temp.call_save('0',pg_temp.draft()),'1','owner creates complete trip');
select is(pg_temp.call_save('0',pg_temp.draft()),'1','identical create retry keeps revision');
select is(pg_temp.as_app('00000000-0000-4000-8000-000000000001','authenticated','select count(*)::text from public.trips'),'1','owner reads parent');
select is(pg_temp.as_app('00000000-0000-4000-8000-000000000002','authenticated','select count(*)::text from public.trips'),'0','other owner cannot read parent');
select is(pg_temp.as_app('00000000-0000-4000-8000-000000000002','authenticated','select count(*)::text from public.trip_destinations'),'0','other owner cannot read children');
select alike(pg_temp.as_app(null,'anon','select count(*)::text from public.trips'),'error:42501:%','anonymous read denied');
select alike(pg_temp.as_app(null,'authenticated',format('select public.save_trip(%L,''0'',%L::jsonb)','00000000-0000-4000-8000-000000000010',pg_temp.draft())),'error:42501:AUTH_REQUIRED','missing subject denied inside privileged function');
select alike(pg_temp.as_app(null,'anon',format('select public.save_trip(%L,''0'',%L::jsonb)','00000000-0000-4000-8000-000000000010',pg_temp.draft())),'error:42501:%','anon RPC execute denied');
select alike(pg_temp.as_app('00000000-0000-4000-8000-000000000001','authenticated','update public.trips set title=''Forbidden'''),'error:42501:%','direct update denied');
select alike(pg_temp.as_app('00000000-0000-4000-8000-000000000001','authenticated','delete from public.trip_destinations'),'error:42501:%','direct child delete denied');
select alike(pg_temp.as_app('00000000-0000-4000-8000-000000000001','authenticated','insert into public.trips default values'),'error:42501:%','direct insert denied');
select ok(not has_function_privilege('authenticated','tripcast_private.normalize_draft(jsonb)','execute'),'private helper not executable by client');
select ok(not has_schema_privilege('authenticated','tripcast_private','usage'),'private schema inaccessible');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.save_trip(uuid,jsonb,jsonb)'::regprocedure,'public.delete_trip(uuid,jsonb)'::regprocedure)),'RPC definer search paths empty');
select alike(pg_temp.call_save('1',pg_temp.draft('2027-06-01','2027-07-14')),'error:22023:INVALID_TRIP','43 covered days rejected');
select alike(pg_temp.call_save('1',pg_temp.draft('2027-02-29','2027-03-01')),'error:22023:INVALID_TRIP','nonleap day rejected');
select alike(pg_temp.call_save('1',pg_temp.draft('1900-02-29','1900-03-01')),'error:22023:INVALID_TRIP','century exception enforced');
select alike(pg_temp.call_save('1',pg_temp.draft('0000-01-01','0001-01-01')),'error:22023:INVALID_TRIP','year zero rejected');
select alike(pg_temp.call_save('1',pg_temp.draft('2027-06-01','infinity')),'error:22023:INVALID_TRIP','infinite dates rejected');
select alike(pg_temp.call_save('1',jsonb_set(pg_temp.draft(),'{destinations,0,lat}','"0"')),'error:22023:INVALID_TRIP','numeric strings rejected');
select alike(pg_temp.call_save('1',jsonb_set(pg_temp.draft(),'{destinations,0,lat}','91')),'error:22023:INVALID_TRIP','out-of-range latitude rejected');
select alike(pg_temp.call_save('1',jsonb_set(pg_temp.draft(),'{destinations,0,timeZone}','"PST"')),'error:22023:INVALID_TRIP','abbreviated zone rejected');
select alike(pg_temp.call_save('1',jsonb_set(pg_temp.draft(),'{destinations,0,position}','1')),'error:22023:INVALID_TRIP','nonconsecutive position rejected');
select alike(pg_temp.call_save('1',pg_temp.draft()||'{"user_id":"forbidden"}'),'error:22023:INVALID_TRIP','unknown owner field rejected');
select alike(pg_temp.call_save('"1"',pg_temp.draft()),'error:22023:INVALID_REVISION','revision string rejected');
select alike(pg_temp.call_save('9007199254740992',pg_temp.draft()),'error:22023:INVALID_REVISION','unsafe revision rejected');
select alike(pg_temp.call_save('1.5',pg_temp.draft()),'error:22023:INVALID_REVISION','fractional revision rejected');
select is((select revision::text from public.trips),'1','failed saves leave revision intact');
select is((select count(*)::text from public.trip_destinations),'1','failed saves leave complete children intact');
select is(pg_temp.call_save('1',pg_temp.draft('0001-01-01','0001-01-02')),'2','earliest calendar boundary accepted');
select is(pg_temp.call_save('2',pg_temp.draft('9999-12-30','9999-12-31')),'3','upper exclusive calendar boundary accepted');
select is(pg_temp.call_save('3',pg_temp.draft('2000-02-28','2000-03-01')),'4','2000 leap year accepted');
-- Actual database coverage for duration/cardinality/contiguity, not just JS rules.
select is(pg_temp.call_save('4',pg_temp.draft('2027-06-01','2027-07-13')),'5','42 covered dates accepted');
create function pg_temp.eight() returns jsonb language sql as $$
 select jsonb_set(pg_temp.draft('2027-06-01','2027-06-09'),'{destinations}',
 (select jsonb_agg((pg_temp.draft()->'destinations'->0)||jsonb_build_object('position',i,
 'arrivalDate',to_char(date '2027-06-01'+i,'YYYY-MM-DD'),
 'departureDate',to_char(date '2027-06-02'+i,'YYYY-MM-DD')) order by i) from generate_series(0,7) i));
$$;
select is(pg_temp.call_save('5',pg_temp.eight()),'6','eight contiguous repeated-city destinations accepted');
select is((select count(*)::text from public.trip_destinations),'8','atomic replacement produced exactly eight children');
select alike(pg_temp.call_save('6',jsonb_set(pg_temp.eight(),'{destinations,1,position}','0')),'error:22023:INVALID_TRIP','duplicate positions rejected');
select alike(pg_temp.call_save('6',jsonb_set(pg_temp.eight(),'{destinations,1,arrivalDate}','"2027-06-01"')),'error:22023:INVALID_TRIP','overlap rejected');
select alike(pg_temp.call_save('6',jsonb_set(pg_temp.eight(),'{destinations,1,arrivalDate}','"2027-06-03"')),'error:22023:INVALID_TRIP','gap or zero duration rejected');
select alike(pg_temp.call_save('6',jsonb_set(pg_temp.eight(),'{destinations,0,departureDate}','"2027-06-01"')),'error:22023:INVALID_TRIP','zero duration rejected');
select alike(pg_temp.call_save('6',jsonb_set(pg_temp.eight(),'{destinations,0,position}','null')),'error:22023:INVALID_TRIP','null position rejected');
select is((select count(*)::text from public.trip_destinations),'8','invalid replacements leave eight children intact');
select is((select count(*)::text from public.trip_destinations where arrival_date<=date '2027-06-02' and departure_date>date '2027-06-02'),'1','exactly one destination owns transfer date');
select is((select sort_order::text from public.trip_destinations where arrival_date<=date '2027-06-02' and departure_date>date '2027-06-02'),'1','transfer date belongs to arriving position');
select is(pg_temp.call_save('6',pg_temp.draft('2000-02-28','2000-03-01')),'7','replacement restores leap interval');
select throws_ok($$update public.trips set user_id='00000000-0000-4000-8000-000000000002'$$,'23514','IMMUTABLE_OWNER','ownership immutable even for trusted write paths');
select throws_ok($$update public.trip_destinations set latitude='NaN'::double precision$$,'23514',null,'NaN coordinate constraint');
select throws_ok($$update public.trip_destinations set longitude='Infinity'::double precision$$,'23514',null,'infinite coordinate constraint');
select throws_ok($$do $b$ begin update public.trips set end_date=end_date+1; set constraints all immediate; end $b$;$$,'23514','INVALID_ITINERARY','parent date changes validated at transaction boundary');
select throws_ok($$do $b$ begin delete from public.trip_destinations; set constraints all immediate; end $b$;$$,'23514','INVALID_ITINERARY','empty final itinerary prevented');
select is((select count(*)::text from public.trip_destinations),'1','failed integrity transaction rolls back child delete');
select is(pg_temp.as_app('00000000-0000-4000-8000-000000000001','authenticated',
 $$select public.delete_trip('00000000-0000-4000-8000-000000000010','7')->>'deleted'$$),'true','owner delete cascades');
select is((select count(*)::text from public.trip_destinations),'0','cascade removed children');
select * from finish();
rollback;
