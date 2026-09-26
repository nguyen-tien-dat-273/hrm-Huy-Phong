// Tuỳ chọn cho các ô lọc Phòng ban / Nhân sự (Dropdown có ô gõ lọc) ở màn duyệt đơn.
// Danh sách chỉ gồm người đang có mặt trong dữ liệu đã nạp, nên chọn xong luôn ra kết quả.

import type { DropdownOption } from '@/components/ui/Dropdown';

export interface FilterPerson {
  id: string;
  name: string;
  department?: string | null;
}

type MaybePerson = FilterPerson | null | undefined;

const unique = (people: MaybePerson[]) => {
  const byId = new Map<string, FilterPerson>();
  for (const person of people) if (person?.id && !byId.has(person.id)) byId.set(person.id, person);
  return [...byId.values()];
};

export function departmentOptions(people: MaybePerson[], allLabel = 'Tất cả phòng ban'): DropdownOption[] {
  const names = [...new Set(unique(people).map((person) => person.department?.trim()).filter(Boolean) as string[])]
    .sort((a, b) => a.localeCompare(b, 'vi'));
  return [{ value: '', label: allLabel }, ...names.map((name) => ({ value: name, label: name }))];
}

/** Nhân sự theo phòng ban đang chọn (rỗng = tất cả). */
export function personOptions(people: MaybePerson[], department: string, allLabel = 'Tất cả nhân sự'): DropdownOption[] {
  const list = unique(people)
    .filter((person) => !department || (person.department?.trim() ?? '') === department)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return [{ value: '', label: allLabel }, ...list.map((person) => ({ value: person.id, label: person.name }))];
}

/** Dòng này có qua bộ lọc phòng ban + nhân sự không. */
export const passesPeopleFilter = (person: MaybePerson, userId: string | undefined, department: string, personId: string) =>
  (!department || (person?.department?.trim() ?? '') === department) && (!personId || userId === personId);
