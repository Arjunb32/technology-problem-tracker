import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Flame,
  Monitor,
  Search,
  Users,
  Clock3,
  Sparkles,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { categories, type FeedResult, type FeedSort } from '@tracker/contracts';
import { api } from '../api';
import { useSession } from '../context';
import { useLoad, Loading, ErrorState, Empty, ProblemCard } from '../ui';

const tabs: { id: FeedSort; label: string; icon: typeof Flame }[] = [
  { id: 'trending', label: 'Trending', icon: Flame },
  { id: 'affected', label: 'Most affected', icon: Users },
  { id: 'unsolved', label: 'Unsolved', icon: Clock3 },
  { id: 'solved', label: 'Recently solved', icon: CheckCircle2 },
  { id: 'new', label: 'New', icon: Sparkles },
];
export default function FeedPage() {
  const [params, setParams] = useSearchParams();
  const sort = (
    tabs.some((tab) => tab.id === params.get('sort')) ? params.get('sort') : 'trending'
  ) as FeedSort;
  const category = params.get('category') || '';
  const query = params.get('q') || '';
  const [search, setSearch] = useState(query);
  const { profile } = useSession();
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const offset = (page - 1) * 50;
  const result = useLoad(
    () =>
      api<FeedResult>(
        `/problems?${new URLSearchParams({ sort, offset: String(offset), ...(category ? { category } : {}), ...(query ? { q: query } : {}) })}`,
      ),
    [sort, category, query, page, profile?.id],
  );
  useEffect(() => setSearch(query), [query]);
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (key !== 'page') next.delete('page');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    if (key === 'page') window.scrollTo({ top: 0 });
  }
  const visible = result.data?.items || [];
  return (
    <div className="feed-layout">
      <section className="feed-column">
        <div className="feed-heading">
          <div className="eyebrow">
            <span className="small-line" />
            THE COMMUNITY, AT WORK
          </div>
          <h1>
            Find the problem.
            <br />
            <span>Build a better answer.</span>
          </h1>
          <p>
            A place to report what’s broken, see who’s affected,
            <br className="desktop-break" /> and find fixes backed by real tests.
          </p>
        </div>
        <form
          className="feed-search"
          onSubmit={(event) => {
            event.preventDefault();
            change('q', search.trim());
          }}
        >
          <Search size={20} />
          <input
            type="search"
            maxLength={180}
            aria-label="Search problems"
            placeholder="Search problems, products, or symptoms…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              className="icon-button"
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setSearch('');
                change('q', '');
              }}
            >
              <X size={17} />
            </button>
          )}
          <button className="search-submit" type="submit">
            Search<span>↵</span>
          </button>
        </form>
        <div className="feed-tabs" role="tablist" aria-label="Sort problems">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={sort === tab.id}
              className={sort === tab.id ? 'active' : ''}
              onClick={() => change('sort', tab.id)}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="feed-toolbar">
          <div>
            <span className="feed-count">{result.data?.total ?? '—'}</span>{' '}
            {query
              ? 'matching problems'
              : category
                ? `${category.toLowerCase()} problems`
                : 'problems to explore'}
            {query && <span className="query-label">for “{query}”</span>}
          </div>
          <label className="category-select">
            <SlidersHorizontal size={15} />
            <span className="sr-only">Filter by category</span>
            <select value={category} onChange={(event) => change('category', event.target.value)}>
              <option value="">All categories</option>
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        {result.loading ? (
          <div className="feed-skeleton" aria-label="Loading problems" role="status">
            {[0, 1, 2].map((i) => (
              <div className="skeleton-card" key={i}>
                <span />
                <strong />
                <p />
                <p />
                <small />
              </div>
            ))}
          </div>
        ) : result.error ? (
          <ErrorState error={result.error} retry={result.reload} />
        ) : visible.length === 0 ? (
          <Empty title={query ? 'No matches for this search' : 'No problems in this view yet'}>
            <p>Try a different keyword or category, or share the issue you’re experiencing.</p>
            <button
              className="button secondary"
              onClick={() => {
                setSearch('');
                setParams({ sort: 'new' });
              }}
            >
              Show all problems
            </button>
          </Empty>
        ) : (
          <div className="problem-feed">
            {visible.map((problem) => (
              <div key={problem.id} data-testid={`problem-card-${problem.id}`}>
                <ProblemCard problem={problem} />
              </div>
            ))}
          </div>
        )}
        {visible.length > 0 && !result.loading && (
          <div className="feed-end">
            {page > 1 && (
              <button
                className="button secondary small"
                onClick={() => change('page', String(page - 1))}
              >
                Previous
              </button>
            )}
            <span>
              Showing {offset + 1}–{offset + visible.length} of {result.data?.total} problems
            </span>
            {offset + visible.length < (result.data?.total || 0) && (
              <button
                className="button secondary small"
                onClick={() => change('page', String(page + 1))}
              >
                Next
              </button>
            )}
          </div>
        )}
      </section>
      <aside className="right-rail">
        <div className="rail-heading">
          <span className="green-dot" />
          SMALL REPORTS. REAL PROGRESS.
        </div>
        <section className="rail-card how-card">
          <span className="rail-icon">
            <Users size={23} />
          </span>
          <h2>One issue. A shared effort.</h2>
          <p>Your setup might be the missing piece that helps someone find a fix.</p>
          <div className="workflow-mini">
            <span>
              <i>1</i>Report it
            </span>
            <span>
              <i>2</i>Confirm it
            </span>
            <span>
              <i>3</i>Solve it
            </span>
          </div>
          <Link className="text-link" to="/rules">
            How we work together
            <ArrowRight size={16} />
          </Link>
        </section>
        <section className="rail-card">
          <div className="rail-card-title">
            <h2>Explore categories</h2>
            <span>03</span>
          </div>
          <div className="rail-categories">
            {categories.map((item, index) => (
              <Link
                key={item}
                to={`/?category=${item}`}
                className={category === item ? 'selected' : ''}
              >
                <span className={`category-icon ${['purple', 'blue', 'teal'][index]}`}>
                  {index === 0 ? <Monitor size={17} /> : index === 1 ? '</>' : '⌘'}
                </span>
                <span>
                  <strong>{item}</strong>
                  <small>
                    {
                      [
                        'Devices, hardware & operating systems',
                        'Apps, updates & development tools',
                        'Connections, routers & infrastructure',
                      ][index]
                    }
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </Link>
            ))}
          </div>
        </section>
        <section className="rail-card activity-card">
          <div className="rail-card-title">
            <h2>Activity in this view</h2>
            <span className="green-dot" />
          </div>
          <div className="activity-row">
            <span className="activity-icon blue">
              <Users size={18} />
            </span>
            <span>
              <strong>
                {visible.reduce((sum, problem) => sum + problem.recentAffectedCount, 0)}
              </strong>
              <small>new affected confirmations</small>
            </span>
          </div>
          <div className="activity-row">
            <span className="activity-icon green">
              <CheckCircle2 size={18} />
            </span>
            <span>
              <strong>{visible.reduce((sum, problem) => sum + problem.verifiedCount, 0)}</strong>
              <small>verified solution revisions</small>
            </span>
          </div>
          <p className="fine-print">
            Confirmations from the past 7 days; verified fixes on the problems shown.{' '}
            {visible.some((problem) => problem.demo) && 'Includes labelled sample data.'}
          </p>
        </section>
        <div className="rail-note">
          <ShieldSymbol />
          <p>
            <strong>Evidence over assumptions.</strong>
            <br />
            Verified fixes are reviewed by moderators. Always check the supported setup before
            testing.
          </p>
        </div>
      </aside>
    </div>
  );
}
function ShieldSymbol() {
  return (
    <span className="shield-symbol">
      <CheckCircle2 size={20} />
    </span>
  );
}
