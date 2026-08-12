import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { PROFESSOR_TITLES, titleLabel, type UniversityWithCount, type ProfessorTitle } from '../lib/types';
import { exportToExcel, type ProfessorExportRow } from '../lib/exportExcel';
import Login from './Login';
import UniversityForm from './UniversityForm';
import ProfessorSection from './ProfessorSection';
import { SearchIcon, ChevronRight, PlusIcon, DownloadIcon } from './icons';

const ALL = 'All';

export default function Dashboard() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Setup needed</h1>
          <div className="notice notice-warn">
            Supabase isn’t configured. Copy <code>.env.example</code> to{' '}
            <code>.env.local</code>, add your project URL and anon key, then restart{' '}
            <code>npm run dev</code>.
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="center-state">
        <span className="spinner" /> Loading…
      </div>
    );
  }

  if (!session) return <Login />;

  return <Directory session={session} />;
}

// ── Directory (authenticated) ────────────────────────────────────────────────
function Directory({ session }: { session: Session }) {
  const [universities, setUniversities] = useState<UniversityWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState<string>(ALL);
  const [departmentFilter, setDepartmentFilter] = useState<string>(ALL);
  const [titleFilter, setTitleFilter] = useState<ProfessorTitle | typeof ALL>(ALL);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Lightweight per-professor rows driving the filters and stats.
  const [profMeta, setProfMeta] = useState<
    {
      university_id: string;
      title: string;
      department: string | null;
      email: string | null;
      linkedin: string | null;
      google_scholar: string | null;
    }[]
  >([]);

  async function loadUniversities() {
    if (!supabase) return;
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase
      .from('universities')
      .select('*, professors(count)')
      .order('name', { ascending: true });
    setLoading(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    const rows: UniversityWithCount[] = (data ?? []).map((row: any) => {
      const { professors, ...university } = row;
      const professor_count = Array.isArray(professors) ? professors[0]?.count ?? 0 : 0;
      return { ...university, professor_count };
    });
    setUniversities(rows);
  }

  async function loadProfMeta() {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('professors')
      .select('university_id, title, department, email, linkedin, google_scholar');
    if (!error && data) setProfMeta(data as typeof profMeta);
  }

  useEffect(() => {
    loadUniversities();
    loadProfMeta();
  }, []);

  // Keep the table's professor count in sync when a detail panel adds/removes professors.
  function updateCount(universityId: string, count: number) {
    setUniversities((prev) =>
      prev.map((u) => (u.id === universityId ? { ...u, professor_count: count } : u)),
    );
  }

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const p of profMeta) if (p.department) set.add(p.department);
    return Array.from(set).sort();
  }, [profMeta]);

  const cities = useMemo(
    () => Array.from(new Set(universities.map((u) => u.city))).sort(),
    [universities],
  );

  // Does a professor match the current title/department filters?
  const profMatches = (p: { title: string; department: string | null }) => {
    if (titleFilter !== ALL && p.title !== titleFilter) return false;
    if (departmentFilter !== ALL && p.department !== departmentFilter) return false;
    return true;
  };

  // Count of professors matching the current filters, per university.
  const matchCountByUniversity = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of profMeta) {
      if (profMatches(p)) m.set(p.university_id, (m.get(p.university_id) ?? 0) + 1);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profMeta, titleFilter, departmentFilter]);

  const usingProfFilter = titleFilter !== ALL || departmentFilter !== ALL;

  // ── Derived: filtered + searched list ─────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return universities.filter((u) => {
      if (cityFilter !== ALL && u.city !== cityFilter) return false;
      // When filtering by title/department, only show universities with a matching professor.
      if (usingProfFilter && !(matchCountByUniversity.get(u.id) ?? 0)) return false;
      if (q) {
        const hay = `${u.name} ${u.city} ${u.province}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [universities, search, cityFilter, usingProfFilter, matchCountByUniversity]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const citiesShown = useMemo(() => new Set(filtered.map((u) => u.city)).size, [filtered]);

  const profStats = useMemo(() => {
    const ids = new Set(filtered.map((u) => u.id));
    const rows = profMeta.filter((p) => ids.has(p.university_id) && profMatches(p));
    return {
      total: rows.length,
      withEmail: rows.filter((p) => p.email).length,
      withLinkedin: rows.filter((p) => p.linkedin).length,
      withScholar: rows.filter((p) => p.google_scholar).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, profMeta, titleFilter, departmentFilter]);

  async function handleSignOut() {
    localStorage.removeItem('pd_email');
    await supabase?.auth.signOut();
  }

  // Anonymous sessions carry no email, so show the address the user typed at the gate.
  const displayEmail =
    (typeof window !== 'undefined' && localStorage.getItem('pd_email')) ||
    session.user.email ||
    'team';

  // Export the visible universities + all their professors. Professors are fetched
  // live for the filtered universities so the export reflects the current search/filters.
  async function handleExport() {
    if (!supabase || filtered.length === 0) return;
    setExporting(true);
    try {
      const ids = filtered.map((u) => u.id);
      const byId = new Map(filtered.map((u) => [u.id, u]));
      const { data, error } = await supabase
        .from('professors')
        .select('*')
        .in('university_id', ids);
      if (error) throw error;
      const professors: ProfessorExportRow[] = (data ?? [])
        .filter((p: any) => profMatches(p))
        .map((p: any) => {
          const university = byId.get(p.university_id);
          return {
            ...p,
            university_name: university?.name ?? '',
            university_city: university?.city ?? '',
          };
        });
      exportToExcel(filtered, professors);
    } catch (e) {
      console.error('Excel export failed', e);
      alert('Export failed — see console for details.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app-shell">
      {/* Top bar */}
      <header className="topbar">
        <div className="brand">
          <h1>Faculty Directory</h1>
          <div className="sub">Indonesia university faculty outreach</div>
        </div>
        <div className="topbar-actions">
          <div className="search">
            <span className="icon">
              <SearchIcon />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, city, province…"
              aria-label="Search universities"
            />
          </div>
          <button
            className="btn"
            onClick={handleExport}
            disabled={filtered.length === 0 || exporting}
            title="Export the visible universities and their professors"
          >
            <DownloadIcon /> {exporting ? 'Exporting…' : 'Download Excel'}
          </button>
          <button className="btn btn-gold" onClick={() => setShowAdd(true)}>
            <PlusIcon /> Add university
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="filters">
        <div className="filter-cluster">
          <span className="filter-label">City</span>
          <select className="select" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            <option value={ALL}>All</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-cluster">
          <span className="filter-label">Department</span>
          <select
            className="select"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value={ALL}>All</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-cluster">
          <span className="filter-label">Title</span>
          <div className="pill-group">
            <button
              className={`pill ${titleFilter === ALL ? 'active' : ''}`}
              onClick={() => setTitleFilter(ALL)}
            >
              All
            </button>
            {PROFESSOR_TITLES.map((t) => (
              <button
                key={t}
                className={`pill ${titleFilter === t ? 'active' : ''}`}
                onClick={() => setTitleFilter(t)}
              >
                {titleLabel(t)}
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn-ghost btn-sm" onClick={handleSignOut} title="Sign out">
          Sign out ({displayEmail})
        </button>
      </div>

      {/* Stats */}
      <div className="stats">
        <span>
          Showing <b>{filtered.length}</b> of <b>{universities.length}</b> universities
        </span>
        <span>
          <b>{citiesShown}</b> {citiesShown === 1 ? 'city' : 'cities'} represented
        </span>
        <span>
          <b>{profStats.total.toLocaleString('en-US')}</b> professors
        </span>
        <span>
          <b>{profStats.withEmail.toLocaleString('en-US')}</b> with email
        </span>
        <span>
          <b>{profStats.withLinkedin.toLocaleString('en-US')}</b> with LinkedIn
        </span>
        <span>
          <b>{profStats.withScholar.toLocaleString('en-US')}</b> with Scholar
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="center-state">
          <span className="spinner" /> Loading universities…
        </div>
      ) : loadError ? (
        <div className="notice notice-err">{loadError}</div>
      ) : filtered.length === 0 ? (
        <div className="center-state">No universities match the current search and filters.</div>
      ) : (
        <div className="table">
          <div className="thead">
            <div>University</div>
            <div>City</div>
            <div>Type</div>
            <div>Professors</div>
          </div>
          {filtered.map((u) => {
            const open = expandedId === u.id;
            return (
              <div key={u.id}>
                <div
                  className={`trow ${open ? 'open' : ''}`}
                  onClick={() => setExpandedId(open ? null : u.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedId(open ? null : u.id);
                    }
                  }}
                >
                  <div className="cell-name">
                    <ChevronRight className={`chev ${open ? 'open' : ''}`} />
                    {u.name}
                  </div>
                  <div className="cell-city tag">
                    {u.city}
                    <span style={{ color: 'var(--line-strong)' }}> · {u.province}</span>
                  </div>
                  <div className="cell-type tag">{u.type}</div>
                  <div className="cell-count">
                    <span className="count-badge">
                      {usingProfFilter ? matchCountByUniversity.get(u.id) ?? 0 : u.professor_count}
                    </span>
                  </div>
                </div>
                {open && (
                  <div className="detail">
                    <ProfessorSection
                      universityId={u.id}
                      titleFilter={titleFilter}
                      departmentFilter={departmentFilter}
                      onCountChange={(n) => updateCount(u.id, n)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <UniversityForm onClose={() => setShowAdd(false)} onCreated={loadUniversities} />
      )}
    </div>
  );
}
