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
import { fetchAll } from "@/lib/server/fetchAll";
import { withDepartment } from "@/lib/department";

/**
 * 목록 화면과 스캔 처리에서 공통으로 쓰는 책 컬럼.
 * 구역(lib_locations)을 함께 붙여옵니다 - lib_books에 location(글자) 칸이 따로 있어서
 * 붙여오는 쪽 이름은 shelf로 씁니다.
 */
/*
  ── 구역을 붙여올 때 **어느 칸을 따라갈지** 반드시 적습니다 ─────────────────
  lib_books 에는 구역을 가리키는 칸이 둘입니다.
    · location_id        - 지금 꽂혀 있는 자리
    · target_location_id - 정리 계획상 옮겨 갈 자리
  그래서 따라갈 칸을 적지 않으면 데이터베이스가 "둘 중 어느 쪽이냐"며 **질의 전체를
  거부합니다.** 그런데 조회하는 쪽 코드가 오류를 보지 않고 있어서, 거부당한 결과가 "그런 책
  없음"으로 둔갑했습니다 - 장서에 멀쩡히 있는 책을 찍어도 "아직 등록되지 않은 책입니다"가
  떴습니다. 바코드를 찍는 화면 전체가 그렇게 멈췄는데 오류는 한 줄도 남지 않았습니다.

  `!location_id` 로 따라갈 칸을 못박아 둡니다. 빼먹으면 빌드가 막습니다
  (scripts/check-embeds.mjs).
*/
export const BOOK_FIELDS =
  "id,title,author,isbn,item_code,cover_url,location_id,shelf:lib_locations!location_id(*)";

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
  // 끝까지 셉니다. 1000종에서 잘리면 뒤쪽 칸들이 통째로 빈 것처럼 보입니다.
  const rows = await fetchAll<{ location_id: string | null }>((from, to) =>
    supabase.from("lib_books").select("location_id,id").order("id", { ascending: true }).range(from, to)
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
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
  const row = (data as LibStudent | null) ?? null;
  // 부서는 운영앱과 같은 규칙으로(@/lib/department). 명부 칸을 그대로 쓰면 두 앱이 다른 부서를 말합니다.
  return row ? withDepartment([row])[0] : null;
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
  const select = "*, shelf:lib_locations!location_id(*)";

  if (isItemCode(code)) {
    const { data, error } = await supabase
      .from("lib_books")
      .select(select)
      .eq("item_code", code)
      .maybeSingle();
    // 질의가 거부당한 것과 "그런 책이 없는 것"은 전혀 다른 일입니다. 묶어서 null 로
    // 돌려주면 화면에 "아직 등록되지 않은 책입니다"가 떠서, 원인을 짐작할 수조차 없습니다.
    if (error) throw new Error(`책을 찾는 중 오류: ${error.message}`);
    if (data) return data as unknown as LibBookWithShelf;
    /*
      도서관 라벨 번호인데 그런 줄이 없습니다. 여기서 바로 포기하면 안 됩니다 - 겹치는 두 줄을
      합치면서 사라진 번호가 바로 이 모양(GIA-B-00001)이고, 그 라벨은 아직 책에 붙어 있습니다.
    */
    return findByAlias(supabase, code, select);
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
  const { data: byItem, error: itemError } = await supabase
    .from("lib_books")
    .select(select)
    .eq("item_code", code)
    .maybeSingle();
  if (itemError) throw new Error(`책을 찾는 중 오류: ${itemError.message}`);
  if (byItem) return byItem as unknown as LibBookWithShelf;

  /*
    ── 마지막으로 '옛 번호'를 봅니다 ────────────────────────────────────────
    겹치는 두 줄을 합치면 한쪽 번호가 주인을 잃습니다. 그런데 그 번호는 **이미 책에 붙어
    있는 라벨**입니다. 여기서 받아주지 않으면, 멀쩡히 꽂혀 있는 책을 찍었는데 "아직 등록되지
    않은 책입니다"가 떠서 책이 사라진 것처럼 보입니다.

    맨 끝에서만 봅니다 - 지금 쓰는 번호가 언제나 먼저입니다.
  */
  return findByAlias(supabase, code, select);
}

/** 합치면서 사라진 옛 번호로 책을 찾습니다(lib_book_aliases). */
async function findByAlias(
  supabase: SupabaseClient,
  code: string,
  select: string
): Promise<LibBookWithShelf | null> {
  const codes = Array.from(new Set([code, ...isbnVariants(code)]));
  const { data } = await supabase
    .from("lib_book_aliases")
    .select("book_id")
    .in("code", codes)
    .limit(1);
  const bookId = ((data ?? []) as { book_id: string }[])[0]?.book_id;
  if (!bookId) return null;
  const { data: book } = await supabase.from("lib_books").select(select).eq("id", bookId).maybeSingle();
  return (book as unknown as LibBookWithShelf | null) ?? null;
}

/**
 * 이 ISBN으로 들어 있는 줄들을 **전부** 찾습니다.
 *
 * 같은 책이라도 라벨 등급이 다르면 따로 한 줄입니다(2등급 「강아지똥」과 4등급 「강아지똥」).
 * 그런데 책 뒤표지의 바코드는 **두 권이 똑같습니다** - 그 바코드만으로는 어느 등급 칸에서
 * 꺼낸 책인지 알 수 없습니다. 그래서 여럿이면 사람에게 고르게 합니다.
 *
 * (등급마다 도서관 라벨을 붙여 두면 그 라벨을 찍는 쪽이 빠릅니다 - 한 번에 정해집니다.)
 */
export async function findBooksByIsbn(
  supabase: SupabaseClient,
  code: string
): Promise<LibBookWithShelf[]> {
  const variants = isbnVariants(code);
  if (variants.length === 0) return [];
  const { data } = await supabase
    .from("lib_books")
    .select("*, shelf:lib_locations!location_id(*)")
    .in("isbn", variants)
    .order("label_level", { ascending: true, nullsFirst: true })
    .limit(20);
  return (data ?? []) as unknown as LibBookWithShelf[];
}

/**
 * 상품코드로 책들을 찾습니다 - **여러 권이 나올 수 있습니다.**
 *
 * 전집·학습만화는 시리즈 전체가 같은 상품코드를 씁니다. 그래서 이 번호로는 어느 권인지
 * 알 수 없고, 하나를 골라 돌려주면 늘 1권만 나옵니다. 나온 만큼 그대로 돌려주고, 여럿이면
 * 화면에서 사람이 고르게 합니다.
 */
export async function findBooksByProductCode(
  supabase: SupabaseClient,
  code: string
): Promise<LibBookWithShelf[]> {
  const digits = code.replace(/[^0-9A-Za-z-]/g, "");
  if (!digits) return [];
  const { data } = await supabase
    .from("lib_books")
    .select("*, shelf:lib_locations!location_id(*)")
    .or(`product_code.eq.${digits},item_code.eq.${digits}`)
    .order("series_no", { ascending: true, nullsFirst: false })
    .limit(30);
  return (data ?? []) as unknown as LibBookWithShelf[];
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
