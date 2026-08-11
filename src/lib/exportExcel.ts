import * as XLSX from 'xlsx';
import type { UniversityWithCount, Professor } from './types';

// A professor plus their university's display fields, for the export sheet.
export type ProfessorExportRow = Professor & {
  university_name: string;
  university_city: string;
};

// Client-side Excel export. Two sheets:
//   "Professors"   — one row per professor across the visible universities
//   "Universities" — one row per visible university (matches the table)
// Exports exactly what's passed in — i.e. whatever is visible after search + filters.
export function exportToExcel(
  universities: UniversityWithCount[],
  professors: ProfessorExportRow[],
): void {
  const universityData = universities.map((u) => ({
    Name: u.name,
    City: u.city,
    Province: u.province,
    Type: u.type,
    Professors: u.professor_count,
    Website: u.website ?? '',
  }));

  const professorRows = [...professors].sort(
    (a, b) =>
      a.university_name.localeCompare(b.university_name) || a.name.localeCompare(b.name),
  );
  const professorData = professorRows.map((p) => ({
    University: p.university_name,
    City: p.university_city,
    Name: p.name,
    Department: p.department ?? '',
    Title: p.title,
    'Research Area': p.research_area ?? '',
    Email: p.email ?? '',
    Phone: p.phone ?? '',
    LinkedIn: p.linkedin ?? '',
    'Google Scholar': p.google_scholar ?? '',
    Website: p.website ?? '',
    Notes: p.notes ?? '',
  }));

  // Professors first so it's the sheet that opens by default (that's the main data);
  // Universities second as a summary.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(professorData),
    'Professors',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(universityData),
    'Universities',
  );

  // Download via Blob + anchor (reliable across browsers; XLSX.writeFile fails silently
  // in some).
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'professor-directory.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
