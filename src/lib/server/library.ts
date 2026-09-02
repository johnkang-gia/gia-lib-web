import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_MAP,
  DEFAULT_SETTINGS,
  type LibBookWithShelf,
  type LibLoanWithBook,
  type LibLocation,
  type LibMap,
  type LibSettings,
  type LibStudent,
} from "@/lib/types";
import { isItemCode, isbnVariants, normalizeIsbn } from "@/lib/scan";

/**
 * 목록 화면과 스캔 처리에서 공통으로 쓰는 책 컬럼.
 * 구역(lib_locations)을 함께 붙여옵니다 - lib_books에 location(글자) 칸이 따로 있어서
 * 붙여오는 쪽 이름은 shelf로 씁니다.
 */
export const BOOK_FIELDS =
  "id,title,author,isbn,item_code,cover_url,location_id,shelf:lib_locations(*)";

/** 대출 규칙. 아직 설정 행이 없으면 기본값(2주·3권)을 씁니다. */
export async function getSettings(supabase: SupabaseClient): Promise<LibSettings> {
  const { data } = await supabase.from("lib_settings").select("*").eq("id", 1).maybeSingle();
  return (data as LibSettings | null) ?? DEFAULT_SETTINGS;
}

/** 도서관 평면도 격자 설정. */
export async function getMap(supabase: SupabaseClient): Promise<LibMap> {
  const { data } = await supabase.from("lib_map").select("*").eq("id", 1).maybeSingle();
  return (data as LibMap | null) ?? DEFAULT_MAP;
}

/** 구역 목록(정렬순 → 코드순). */
export async function getLocations(supabase: SupabaseClient): Promise<LibLocation[]> {
  const { data } = await supabase
    .from("lib_locations")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("code", { ascending: true });
  return (data ?? []) as LibLocation[];
}

/** 구역마다 지금 몇 종이 배정되어 있는지 세어 돌려줍니다. */
export async function countBooksByLocation(supabase: SupabaseClient) {
  const { data } = await supabase.from("lib_books").select("location_id").limit(5000);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { location_id: string | null }[]) {
    const key = row.location_id ?? "none";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** 고유번호(GIA-2026-0001)로 학생 찾기. 도서관 앱은 lib_students 뷰만 볼 수 있습니다. */
export async function findStudent(
  supabase: SupabaseClient,
  studentNo: string
): Promise<LibStudent | null> {
  const { data } = await supabase
    .from("lib_students")
    .select("id,student_no,name,name_en,grade,class_name,department,status,photo_path")
    .eq("student_no", studentNo)
    .maybeSingle();
  return (data as LibStudent | null) ?? null;
}

/** 한 학생이 지금 빌리고 있는 책들(반납예정일 빠른 순). */
export async function findActiveLoans(
  supabase: SupabaseClient,
  studentNo: string
): Promise<LibLoanWithBook[]> {
  const { data } = await supabase
    .from("lib_loans")
    .select(`*, book:lib_books(${BOOK_FIELDS})`)
    .eq("student_no", studentNo)
    .eq("status", "대출중")
    .order("due_date", { ascending: true });
  return (data ?? []) as unknown as LibLoanWithBook[];
}

/** 스캔한 값으로 책 찾기 - 자체 라벨(GIA-B-00001) 또는 ISBN. 구역 정보도 함께 가져옵니다. */
export async function findBook(
  supabase: SupabaseClient,
  code: string
): Promise<LibBookWithShelf | null> {
  const select = "*, shelf:lib_locations(*)";

  if (isItemCode(code)) {
    const { data } = await supabase
      .from("lib_books")
      .select(select)
      .eq("item_code", code)
      .maybeSingle();
    return (data as unknown as LibBookWithShelf | null) ?? null;
  }

  // 오래된 책은 표지에 10자리, 바코드에 13자리가 적혀 있어서 같은 책이 두 번호를 가집니다.
  // 어느 쪽으로 찍든 찾히도록 둘 다 확인합니다.
  const variants = isbnVariants(code);
  if (variants.length > 0) {
    const { data } = await supabase
      .from("lib_books")
      .select(select)
      .in("isbn", variants)
      .limit(1);
    const rows = (data ?? []) as unknown as LibBookWithShelf[];
    if (rows[0]) return rows[0];
  }

  // 라벨 형식이 아닌 자체 코드를 쓴 경우까지 한 번 더 확인합니다.
  const { data: byItem } = await supabase
    .from("lib_books")
    .select(select)
    .eq("item_code", code)
    .maybeSingle();
  return (byItem as unknown as LibBookWithShelf | null) ?? null;
}

/** 구역 코드(A-1)로 구역 찾기 - 대소문자를 가리지 않습니다. */
export async function findLocation(
  supabase: SupabaseClient,
  code: string
): Promise<LibLocation | null> {
  const { data } = await supabase.from("lib_locations").select("*").ilike("code", code).limit(1);
  const rows = (data ?? []) as LibLocation[];
  return rows[0] ?? null;
}
