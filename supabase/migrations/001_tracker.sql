-- Technology Problem Tracker beta. All application access goes through the API.
-- Apply with a database owner; never expose the service-role key to the browser.
begin;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table public.tracker_version(singleton boolean primary key default true check(singleton), version bigint not null default 0);
insert into public.tracker_version values(true,0);
create table public.categories(name text primary key);
insert into public.categories values('Computers'),('Software'),('Networking');
create table public.profiles(
 id text primary key, payload jsonb not null,
 auth_user_id uuid generated always as (id::uuid) stored references auth.users(id) on delete restrict,
 username text generated always as (lower(payload->>'username')) stored unique,
 role text generated always as (payload->>'role') stored not null check(role in ('member','moderator','admin')),
 check(payload->>'id'=id),check(length(payload->>'displayName') between 2 and 80)
);
create table public.problems(
 id text primary key,payload jsonb not null,
 author_id text generated always as (payload->>'authorId') stored not null references public.profiles(id),
 category text generated always as (payload->>'category') stored not null references public.categories(name),
 canonical_id text generated always as (payload->>'canonicalId') stored references public.problems(id) deferrable initially deferred,
 status text generated always as (payload->>'status') stored not null check(status in ('Reported','Needs information','Confirmed','Investigating','Partially solved','Resolved','Reopened','Duplicate','Closed')),
 hidden boolean generated always as ((payload->>'hidden')::boolean) stored not null,
 search_document tsvector generated always as (to_tsvector('english'::regconfig,coalesce(payload->>'title','')||' '||coalesce(payload->>'description','')||' '||coalesce(payload->>'product','')||' '||coalesce(payload->>'tags',''))) stored,
 check(payload->>'id'=id),check(canonical_id is null or canonical_id<>id),check((status='Duplicate')=(canonical_id is not null))
);
create index problems_search on public.problems using gin(search_document);
create index problems_title_similarity on public.problems using gin((payload->>'title') extensions.gin_trgm_ops);
create index problems_category on public.problems(category) where not hidden and canonical_id is null;
create table public.tags(name text primary key);
create table public.problem_tags(problem_id text not null references public.problems(id) on delete cascade,tag text not null references public.tags(name),primary key(problem_id,tag));
create table public.participation(
 id text primary key,payload jsonb not null,
 problem_id text generated always as (payload->>'problemId') stored not null references public.problems(id),
 user_id text generated always as (payload->>'userId') stored not null references public.profiles(id),
 kind text generated always as (payload->>'kind') stored not null check(kind in ('affected','vote','follow')),
 unique(problem_id,user_id,kind),check(payload->>'id'=id),check(kind<>'affected' or length(payload->>'setup')>=3)
);
create index participation_problem on public.participation(problem_id);
create table public.solutions(
 id text primary key,payload jsonb not null,
 problem_id text generated always as (payload->>'problemId') stored not null references public.problems(id),
 author_id text generated always as (payload->>'authorId') stored not null references public.profiles(id),
 hidden boolean generated always as ((payload->>'hidden')::boolean) stored not null,check(payload->>'id'=id)
);
create index solutions_problem on public.solutions(problem_id);
create table public.revisions(
 id text primary key,payload jsonb not null,
 solution_id text generated always as (payload->>'solutionId') stored not null references public.solutions(id),
 revision_number integer generated always as ((payload->>'number')::integer) stored not null check(revision_number>0),
 unique(solution_id,revision_number),check(payload->>'id'=id)
);
create table public.tests(
 id text primary key,payload jsonb not null,
 revision_id text generated always as (payload->>'revisionId') stored not null references public.revisions(id),
 user_id text generated always as (payload->>'userId') stored not null references public.profiles(id),
 outcome text generated always as (payload->>'outcome') stored not null check(outcome in ('Worked','Did not work','Partially worked','Not applicable')),
 unique(revision_id,user_id),check(payload->>'id'=id),check(length(payload->>'setup')>=3)
);
create table public.verifications(
 id text primary key,payload jsonb not null,
 revision_id text generated always as (payload->>'revisionId') stored not null references public.revisions(id),
 reviewer_id text generated always as (payload->>'reviewerId') stored not null references public.profiles(id),
 decision text generated always as (payload->>'decision') stored not null check(decision in ('verified','revoked')),
 sequence bigint generated always as identity,check(payload->>'id'=id)
);
create table public.comments(
 id text primary key,payload jsonb not null,
 problem_id text generated always as (payload->>'problemId') stored not null references public.problems(id),
 author_id text generated always as (payload->>'authorId') stored not null references public.profiles(id),
 hidden boolean generated always as ((payload->>'hidden')::boolean) stored not null,check(payload->>'id'=id)
);
create table public.timeline(
 id text primary key,payload jsonb not null,
 problem_id text generated always as (payload->>'problemId') stored not null references public.problems(id),
 actor_id text generated always as (payload->>'actorId') stored references public.profiles(id),check(payload->>'id'=id)
);
create table public.reports(
 id text primary key,payload jsonb not null,
 reporter_id text generated always as (payload->>'reporterId') stored not null references public.profiles(id),
 state text generated always as (payload->>'state') stored not null check(state in ('open','resolved')),
 check(payload->>'targetType' in ('problem','solution','comment','profile')),check(payload->>'id'=id)
);
create unique index reports_open_user_target on public.reports(reporter_id,(payload->>'targetType'),(payload->>'targetId')) where state='open';
create table public.audit(
 id text primary key,payload jsonb not null,
 actor_id text generated always as (payload->>'actorId') stored not null references public.profiles(id),check(payload->>'id'=id)
);
create table public.notifications(
 id text primary key,payload jsonb not null,
 user_id text generated always as (payload->>'userId') stored not null references public.profiles(id),
 problem_id text generated always as (payload->>'problemId') stored references public.problems(id),check(payload->>'id'=id)
);
create index notifications_user on public.notifications(user_id);
create table public.attachments(
 id text primary key,payload jsonb not null,
 owner_id text generated always as (payload->>'ownerId') stored not null references public.profiles(id),
 target_type text generated always as (payload->>'targetType') stored not null check(target_type in ('problem','solution')),
 target_id text generated always as (payload->>'targetId') stored not null,
 check((payload->>'size')::integer between 1 and 512000),check(payload->>'mimeType' in ('image/jpeg','image/png','image/webp')),
 check(payload->>'id'=id),check(not (payload ? 'data'))
);
create table public.limits(
 id text primary key,payload jsonb not null,
 user_id text generated always as (payload->>'userId') stored not null references public.profiles(id),
 window_id bigint generated always as ((payload->>'window')::bigint) stored not null,
 unique(user_id,window_id),check((payload->>'count')::integer between 0 and 40),check(payload->>'id'=id)
);

create function public.tracker_verify_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare author text; solution text; revision_number integer; reviewer public.profiles;
begin
 select s.author_id,s.id,r.revision_number into author,solution,revision_number from public.revisions r join public.solutions s on s.id=r.solution_id where r.id=new.payload->>'revisionId';
 select * into reviewer from public.profiles where id=new.payload->>'reviewerId';
 if reviewer.role not in ('moderator','admin') or coalesce((reviewer.payload->>'restricted')::boolean,true) then raise exception 'Moderator permission required' using errcode='42501';end if;
 if author=new.payload->>'reviewerId' then raise exception 'Self verification prohibited' using errcode='42501';end if;
 if revision_number<>(select max(r.revision_number) from public.revisions r where r.solution_id=solution) then raise exception 'Only current revision can be reviewed' using errcode='23514';end if;
 if new.payload->>'decision'='verified' and not exists(select 1 from public.tests t where t.revision_id=new.payload->>'revisionId' and t.user_id<>author and t.outcome in ('Worked','Partially worked')) then raise exception 'Independent test evidence required' using errcode='23514';end if;
 return new;
end;$$;
create trigger verification_guard before insert or update on public.verifications for each row execute function public.tracker_verify_guard();

-- Server-only bounded snapshot. Public feeds use tracker_feed instead; details scope
-- reads to one problem and three related problems. Full snapshots are write-only
-- domain input for a deliberately capped 500-report public beta.
create function public.tracker_snapshot(p_problem_id text default null) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with wanted as (
  select id from public.problems where p_problem_id is null or id=p_problem_id
  union select id from (select p.id from public.problems p where p_problem_id is not null and p.category=(select category from public.problems where id=p_problem_id) and not p.hidden and p.canonical_id is null and p.id<>p_problem_id order by p.payload->>'createdAt' desc limit 3) related
 ), sols as(select id from public.solutions where problem_id in(select id from wanted)), revs as(select id from public.revisions where solution_id in(select id from sols))
 select jsonb_build_object(
  'version',(select version from public.tracker_version where singleton),
  'profiles',coalesce((select jsonb_agg(payload) from public.profiles),'[]'::jsonb),
  'problems',coalesce((select jsonb_agg(payload) from public.problems where id in(select id from wanted)),'[]'::jsonb),
  'participation',coalesce((select jsonb_agg(payload) from public.participation where problem_id in(select id from wanted)),'[]'::jsonb),
  'solutions',coalesce((select jsonb_agg(payload) from public.solutions where id in(select id from sols)),'[]'::jsonb),
  'revisions',coalesce((select jsonb_agg(payload) from public.revisions where id in(select id from revs)),'[]'::jsonb),
  'tests',coalesce((select jsonb_agg(payload) from public.tests where revision_id in(select id from revs)),'[]'::jsonb),
  'verifications',coalesce((select jsonb_agg(payload order by sequence) from public.verifications where revision_id in(select id from revs)),'[]'::jsonb),
  'comments',coalesce((select jsonb_agg(payload) from public.comments where problem_id in(select id from wanted)),'[]'::jsonb),
  'timeline',coalesce((select jsonb_agg(payload) from public.timeline where problem_id in(select id from wanted)),'[]'::jsonb),
  'reports',case when p_problem_id is null then coalesce((select jsonb_agg(payload) from public.reports),'[]'::jsonb) else '[]'::jsonb end,
  'audit',case when p_problem_id is null then coalesce((select jsonb_agg(payload) from public.audit),'[]'::jsonb) else '[]'::jsonb end,
  'notifications',case when p_problem_id is null then coalesce((select jsonb_agg(payload) from public.notifications),'[]'::jsonb) else '[]'::jsonb end,
  'attachments',coalesce((select jsonb_agg(payload) from public.attachments where (target_type='problem' and target_id in(select id from wanted)) or (target_type='solution' and target_id in(select id from sols))),'[]'::jsonb),
  'limits',case when p_problem_id is null then coalesce((select jsonb_agg(payload) from public.limits),'[]'::jsonb) else '[]'::jsonb end
 );$$;

create function public.tracker_commit(p_expected bigint,p_changes jsonb) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare current_version bigint; name text; changes jsonb; problem jsonb;
begin
 select version into current_version from public.tracker_version where singleton for update;
 if current_version<>p_expected then return false;end if;
 if exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('profiles','problems','participation','solutions','revisions','tests','verifications','comments','timeline','reports','audit','notifications','attachments','limits')) then raise exception 'Unknown collection';end if;
 -- Delete first so deduplicated participation can move to the canonical problem.
 foreach name in array array['limits','attachments','notifications','audit','reports','timeline','comments','verifications','tests','revisions','solutions','participation','problems','profiles'] loop
  changes=p_changes->name;
  if changes is not null then execute format('delete from public.%I where id in(select jsonb_array_elements_text($1))',name) using coalesce(changes->'remove','[]'::jsonb);end if;
 end loop;
 foreach name in array array['profiles','problems','participation','solutions','revisions','tests','verifications','comments','timeline','reports','audit','notifications','attachments','limits'] loop
  changes=p_changes->name;
  if changes is not null then execute format('insert into public.%I(id,payload) select x->>''id'',x from jsonb_array_elements($1) x on conflict(id) do update set payload=excluded.payload',name) using coalesce(changes->'upsert','[]'::jsonb);end if;
 end loop;
 if (select count(*) from public.problems)>500 then raise exception 'Beta reporting capacity reached' using errcode='54000';end if;
 if (select coalesce(sum(jsonb_array_length(value->'upsert')),0) from jsonb_each(p_changes))>20000 then raise exception 'Mutation too large';end if;
 -- Revisions, visibility, and verification can change without a problem upsert.
 -- Validate the final state so every solved record retains a current visible fix.
 for problem in select payload from public.problems loop
  if problem->>'status' in ('Resolved','Partially solved') and not exists(
    select 1 from public.solutions s join lateral(select r.id from public.revisions r where r.solution_id=s.id order by revision_number desc limit 1) r on true
    join lateral(select v.decision from public.verifications v where v.revision_id=r.id order by v.sequence desc limit 1) v on v.decision='verified'
    where s.problem_id=problem->>'id' and not s.hidden
  ) then raise exception 'Current verification required for solved status' using errcode='23514';end if;
  if problem->>'status'='Confirmed' and (select count(*) from public.participation where problem_id=problem->>'id' and kind='affected')<2 then raise exception 'Two affected accounts required' using errcode='23514';end if;
  if problem->>'canonicalId' is not null and exists(select 1 from public.problems p where p.id=problem->>'canonicalId' and p.canonical_id is not null) then raise exception 'Canonical merge target cannot be duplicate' using errcode='23514';end if;
 end loop;
 for problem in select value from jsonb_array_elements(coalesce(p_changes->'problems'->'upsert','[]'::jsonb)) loop
  insert into public.tags(name) select distinct value from jsonb_array_elements_text(coalesce(problem->'tags','[]'::jsonb)) on conflict do nothing;
  delete from public.problem_tags where problem_id=problem->>'id';
  insert into public.problem_tags select problem->>'id',value from jsonb_array_elements_text(coalesce(problem->'tags','[]'::jsonb)) on conflict do nothing;
 end loop;
 update public.tracker_version set version=version+1 where singleton;
 return true;
end;$$;

create function public.tracker_search(p_query text) returns table(id text) language sql stable security definer set search_path=public,extensions,pg_temp as $$
 select p.id from public.problems p where not p.hidden and p.canonical_id is null and (p.search_document@@websearch_to_tsquery('english',left(p_query,180)) or extensions.similarity(p.payload->>'title',left(p_query,180))>0.15) order by ts_rank(p.search_document,websearch_to_tsquery('english',left(p_query,180))) desc limit 50;
$$;

create function public.tracker_feed(p_sort text default 'trending',p_category text default null,p_query text default null,p_viewer text default null,p_offset integer default 0) returns jsonb language sql stable security definer set search_path=public,extensions,pg_temp as $$
 with candidates as (
 select p.*,
  (select count(*) from public.participation x where x.problem_id=p.id and x.kind='affected') as affected_count,
  (select count(*) from public.participation x where x.problem_id=p.id and x.kind='vote') as vote_count,
  (select count(*) from public.participation x where x.problem_id=p.id and x.kind='follow') as follower_count,
  (select count(*) from public.participation x where x.problem_id=p.id and x.kind='affected' and x.payload->>'createdAt'>to_char(now()-interval '7 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as recent_affected,
  (select count(*) from public.participation x where x.problem_id=p.id and x.kind='vote' and x.payload->>'createdAt'>to_char(now()-interval '7 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as recent_votes
 from public.problems p where not p.hidden and p.canonical_id is null and (p_category is null or p.category=p_category)
  and (p_sort<>'unsolved' or p.status not in ('Resolved','Closed')) and (p_sort<>'solved' or p.status='Resolved')
  and (p_query is null or p_query='' or p.search_document@@websearch_to_tsquery('english',left(p_query,180)) or extensions.similarity(p.payload->>'title',left(p_query,180))>0.15)
 ), page as(
 select * from candidates order by
  case when p_sort='trending' then recent_affected end desc nulls last,
  case when p_sort='trending' then recent_votes end desc nulls last,
  case when p_sort='affected' then affected_count end desc nulls last,
  case when p_sort='solved' then payload->>'resolvedAt' end desc nulls last,
  payload->>'createdAt' desc limit 50 offset greatest(0,least(p_offset,500))
 ), hydrated as(
 select p.payload||jsonb_build_object(
 'author',(select jsonb_build_object('id',id,'username',payload->>'username','displayName',payload->>'displayName','bio',payload->>'bio','expertise',payload->'expertise','role',role,'createdAt',payload->>'createdAt')||case when payload ? 'avatarUrl' then jsonb_build_object('avatarUrl',payload->>'avatarUrl') else '{}'::jsonb end from public.profiles where id=p.author_id),
 'affectedCount',p.affected_count,'voteCount',p.vote_count,'followerCount',p.follower_count,
 'recentAffectedCount',p.recent_affected,'recentVoteCount',p.recent_votes,
 'solutionCount',(select count(*) from public.solutions s where s.problem_id=p.id and not s.hidden),
 'verifiedCount',(select count(*) from public.solutions s join lateral(select r.id from public.revisions r where r.solution_id=s.id order by revision_number desc limit 1) r on true join lateral(select v.decision from public.verifications v where v.revision_id=r.id order by sequence desc limit 1) v on v.decision='verified' where s.problem_id=p.id and not s.hidden),
 'viewer',jsonb_build_object('affected',exists(select 1 from public.participation x where x.problem_id=p.id and x.user_id=p_viewer and x.kind='affected'),'voted',exists(select 1 from public.participation x where x.problem_id=p.id and x.user_id=p_viewer and x.kind='vote'),'following',exists(select 1 from public.participation x where x.problem_id=p.id and x.user_id=p_viewer and x.kind='follow'),'setup',coalesce((select x.payload->>'setup' from public.participation x where x.problem_id=p.id and x.user_id=p_viewer and x.kind='affected'),'')),
 'attachments',coalesce((select jsonb_agg(a.payload-'storagePath') from public.attachments a where a.target_type='problem' and a.target_id=p.id),'[]'::jsonb)
 ) as payload from page p
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(payload) from hydrated),'[]'::jsonb),'total',(select count(*) from candidates));
$$;

create function public.tracker_health() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from public.tracker_version where singleton);$$;

-- Browser roles receive neither table privileges nor function execution rights.
do $$declare name text;begin
 foreach name in array array['tracker_version','categories','tags','problem_tags','profiles','problems','participation','solutions','revisions','tests','verifications','comments','timeline','reports','audit','notifications','attachments','limits'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on table public.%I from anon,authenticated',name);
  execute format('grant all on table public.%I to service_role',name);
 end loop;
end;$$;
grant usage,select on all sequences in schema public to service_role;
revoke all on function public.tracker_snapshot(text),public.tracker_commit(bigint,jsonb),public.tracker_search(text),public.tracker_feed(text,text,text,text,integer),public.tracker_health(),public.tracker_verify_guard() from public,anon,authenticated;
grant execute on function public.tracker_snapshot(text),public.tracker_commit(bigint,jsonb),public.tracker_search(text),public.tracker_feed(text,text,text,text,integer),public.tracker_health() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('tracker-images','tracker-images',false,512000,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
commit;
