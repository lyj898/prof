import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { INSTITUTION_TYPES, type UniversityFormValues } from '../lib/types';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const EMPTY: UniversityFormValues = {
  name: '',
  type: 'Universitas',
  city: '',
  province: '',
  website: '',
};

// Modal form for the university-level fields. Writes straight to Supabase.
export default function UniversityForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [values, setValues] = useState<UniversityFormValues>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set<K extends keyof UniversityFormValues>(key: K, value: UniversityFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');

    const { error: insertError } = await supabase.from('universities').insert({
      slug: slugify(values.name),
      name: values.name.trim(),
      type: values.type,
      city: values.city.trim(),
      province: values.province.trim(),
      website: values.website.trim() || null,
    });

    setSaving(false);
    if (insertError) {
      setError(
        insertError.code === '23505'
          ? 'A university with this name (slug) already exists.'
          : insertError.message,
      );
      return;
    }
    onCreated();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add university</h2>
        <div className="modal-sub">
          University-level details. Add professors afterward from the university row.
        </div>

        {error && <div className="notice notice-err">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="u-name">Name</label>
              <input
                id="u-name"
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Universitas Indonesia"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="u-type">Type</label>
              <select
                id="u-type"
                className="select-native"
                value={values.type}
                onChange={(e) => set('type', e.target.value as UniversityFormValues['type'])}
              >
                {INSTITUTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="u-city">City</label>
              <input
                id="u-city"
                value={values.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="Depok"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="u-prov">Province</label>
              <input
                id="u-prov"
                value={values.province}
                onChange={(e) => set('province', e.target.value)}
                placeholder="Jawa Barat"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="u-web">Website</label>
              <input
                id="u-web"
                type="url"
                value={values.website}
                onChange={(e) => set('website', e.target.value)}
                placeholder="https://www.ui.ac.id"
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-gold" disabled={saving}>
              {saving ? 'Saving…' : 'Add university'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
