import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PROFESSOR_TITLES, type Professor, type ProfessorFormValues } from '../lib/types';
import { PlusIcon, EditIcon, TrashIcon } from './icons';

const EMPTY_FORM: ProfessorFormValues = {
  name: '',
  department: '',
  title: 'Dosen',
  research_area: '',
  email: '',
  phone: '',
  linkedin: '',
  google_scholar: '',
  website: '',
  notes: '',
};

function toForm(p: Professor): ProfessorFormValues {
  return {
    name: p.name,
    department: p.department ?? '',
    title: p.title,
    research_area: p.research_area ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    linkedin: p.linkedin ?? '',
    google_scholar: p.google_scholar ?? '',
    website: p.website ?? '',
    notes: p.notes ?? '',
  };
}

function asUrl(value: string): string {
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

// ── Inline add/edit form ───────────────────────────────────────────────────
function ProfessorForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: ProfessorFormValues;
  onSave: (v: ProfessorFormValues) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [values, setValues] = useState<ProfessorFormValues>(initial);

  function set<K extends keyof ProfessorFormValues>(key: K, value: ProfessorFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return (
    <form
      className="prof-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values);
      }}
    >
      <div className="form-grid">
        <div className="field full">
          <label>Name</label>
          <input
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Dr. Nama Lengkap"
            required
          />
        </div>

        <div className="field">
          <label>Department / faculty</label>
          <input
            value={values.department}
            onChange={(e) => set('department', e.target.value)}
            placeholder="Fakultas Ilmu Komputer"
          />
        </div>

        <div className="field">
          <label>Title</label>
          <select
            value={values.title}
            onChange={(e) => set('title', e.target.value as ProfessorFormValues['title'])}
          >
            {PROFESSOR_TITLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="field full">
          <label>Research area</label>
          <input
            value={values.research_area}
            onChange={(e) => set('research_area', e.target.value)}
            placeholder="Machine learning, distributed systems"
          />
        </div>

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="name@cs.ui.ac.id"
          />
        </div>

        <div className="field">
          <label>Phone</label>
          <input
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="+62…"
          />
        </div>

        <div className="field">
          <label>LinkedIn</label>
          <input
            value={values.linkedin}
            onChange={(e) => set('linkedin', e.target.value)}
            placeholder="linkedin.com/in/…"
          />
        </div>

        <div className="field">
          <label>Google Scholar</label>
          <input
            value={values.google_scholar}
            onChange={(e) => set('google_scholar', e.target.value)}
            placeholder="scholar.google.com/citations?user=…"
          />
        </div>

        <div className="field full">
          <label>Website</label>
          <input
            value={values.website}
            onChange={(e) => set('website', e.target.value)}
            placeholder="personal or faculty page"
          />
        </div>

        <div className="field full">
          <label>Notes</label>
          <textarea
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Source / verification notes"
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-gold" disabled={saving}>
          {saving ? 'Saving…' : 'Save professor'}
        </button>
      </div>
    </form>
  );
}

// ── Section: list + CRUD for one university's professors ───────────────────
export default function ProfessorSection({
  universityId,
  titleFilter = 'All',
  departmentFilter = 'All',
  onCountChange,
}: {
  universityId: string;
  titleFilter?: string;
  departmentFilter?: string;
  onCountChange: (count: number) => void;
}) {
  const [professors, setProfessors] = useState<Professor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('professors')
      .select('*')
      .eq('university_id', universityId)
      .order('created_at', { ascending: true });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    const list = (data ?? []) as Professor[];
    setProfessors(list);
    onCountChange(list.length);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universityId]);

  function formToRow(v: ProfessorFormValues) {
    return {
      university_id: universityId,
      name: v.name.trim(),
      department: v.department.trim() || null,
      title: v.title,
      research_area: v.research_area.trim() || null,
      email: v.email.trim() || null,
      phone: v.phone.trim() || null,
      linkedin: v.linkedin.trim() || null,
      google_scholar: v.google_scholar.trim() || null,
      website: v.website.trim() || null,
      notes: v.notes.trim() || null,
    };
  }

  async function handleAdd(v: ProfessorFormValues) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('professors').insert(formToRow(v));
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAdding(false);
    await load();
  }

  async function handleUpdate(id: string, v: ProfessorFormValues) {
    if (!supabase) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase
      .from('professors')
      .update(formToRow(v))
      .eq('id', id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingId(null);
    await load();
  }

  async function handleDelete(id: string) {
    if (!supabase) return;
    if (!window.confirm('Delete this professor? This cannot be undone.')) return;
    const { error: err } = await supabase.from('professors').delete().eq('id', id);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  // Apply the Title/Department filters to what's displayed (counts stay on the full set).
  const shown = professors.filter((p) => {
    if (titleFilter !== 'All' && p.title !== titleFilter) return false;
    if (departmentFilter !== 'All' && (p.department ?? '') !== departmentFilter) return false;
    return true;
  });

  return (
    <div>
      <div className="detail-head">
        <h3>Professors</h3>
        {!adding && (
          <button
            className="btn btn-sm btn-ocean"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
          >
            <PlusIcon size={13} /> Add professor
          </button>
        )}
      </div>

      {error && <div className="notice notice-err">{error}</div>}

      {adding && (
        <ProfessorForm
          initial={EMPTY_FORM}
          saving={saving}
          onSave={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}

      {loading ? (
        <div className="empty-note">
          <span className="spinner" /> Loading professors…
        </div>
      ) : shown.length === 0 && !adding ? (
        <div className="empty-note">
          {professors.length === 0
            ? 'No professors recorded yet.'
            : 'No professors match this filter.'}
        </div>
      ) : (
        <div className="prof-list">
          {shown.map((p) =>
            editingId === p.id ? (
              <ProfessorForm
                key={p.id}
                initial={toForm(p)}
                saving={saving}
                onSave={(v) => handleUpdate(p.id, v)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="prof-item" key={p.id}>
                <div className="prof-main">
                  <span className="prof-name">{p.name}</span>
                  <span className="prof-meta">
                    <span className="prof-title-tag">{p.title}</span>
                    {p.department && <span>{p.department}</span>}
                    {p.research_area && <span>· {p.research_area}</span>}
                    {p.email && (
                      <span>
                        <a className="prof-contact" href={`mailto:${p.email}`}>
                          {p.email}
                        </a>
                      </span>
                    )}
                    {p.phone && <span className="prof-contact">{p.phone}</span>}
                    {p.linkedin && (
                      <a
                        className="prof-contact"
                        href={asUrl(p.linkedin)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        LinkedIn
                      </a>
                    )}
                    {p.google_scholar && (
                      <a
                        className="prof-contact"
                        href={asUrl(p.google_scholar)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Scholar
                      </a>
                    )}
                    {p.website && (
                      <a
                        className="prof-contact"
                        href={asUrl(p.website)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Website
                      </a>
                    )}
                  </span>
                  {p.notes && <span className="prof-notes">{p.notes}</span>}
                </div>
                <div className="prof-actions">
                  <button
                    className="btn btn-sm btn-ghost"
                    title="Edit"
                    onClick={() => {
                      setEditingId(p.id);
                      setAdding(false);
                    }}
                  >
                    <EditIcon />
                  </button>
                  <button
                    className="btn btn-sm btn-ghost btn-danger"
                    title="Delete"
                    onClick={() => handleDelete(p.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
