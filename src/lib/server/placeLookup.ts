/**
 * 자리 등록이 한 권을 찍을 때 필요한 **읽기를 한 번의 왕복으로** 가져옵니다.
 *
 * ── 왜 이렇게 바꿨는가 ──────────────────────────────────────────────────────
 * "또 느려졌어"가 반복된 이유를 재어 보니, 느린 것은 질의가 아니라 **왕복 횟수**였습니다.
 * Supabase 로 한 번 다녀오는 비용은 무엇을 묻든 거의 같습니다(응답 헤더
 * x-envoy-upstream-service-time 로 잰 값):
 *
 *     아무 질의 없는 요청 30~40ms · 칸 1줄 30~38ms · isbn 으로 책 32~34ms
 *     title 로 책(인덱스 없이 전수) 31~40ms · 자리 기록 652줄 전체 35~41ms
 *
 * 질의 자체는 1ms 도 안 됩니다. 30~40ms 는 요청 한 번의 고정 비용이고, Vercel↔Supabase
 * 망 왕복까지 더하면 한 번이 55~90ms 입니다. 그런데 한 권을 찍으면 이렇게 다녀왔습니다:
 *
 *     ① 로그인 ∥ 칸  ② isbn 으로 책  ③ 이 책의 자리 기록  ④ 쓰기  ⑤ 같은 제목·시리즈  ⑥ 그 책들의 자리
 *
 * 다섯~여섯 번 = 300~500ms. 실제로 없는 ISBN 하나를 찍는 것(①②만)도 250~330ms 가
 * 나왔습니다. 기능을 더할 때마다 왕복이 하나 늘었으니 느려지는 것이 당연했습니다.
 *
 * 그래서 ①②③⑤⑥ 을 Postgres 함수(lib_place_lookup) 한 번으로 모읍니다. 안에서는 질의
 * 여섯 개가 돌지만 전부 데이터베이스 안이라 합쳐 2~3ms 입니다. 남는 왕복은 쓰기 하나입니다.
 *
 * ── 판단은 여기로 옮기지 않았습니다 ────────────────────────────────────────
 * 묻느냐 세느냐(shelfCount.ts), ISBN 10↔13 바꿈(scan.ts) 은 검사가 붙어 있는 그 자리에
 * 그대로 둡니다. 같은 규칙을 SQL 로 한 번 더 적으면 언젠가 두 쪽이 다른 말을 합니다.
 * 그래서 ISBN 변형은 **여기서 계산해 넘겨주고**, 함수는 찾아서 모아 주기만 합니다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isbnVariants, isIsbn, isItemCode } from "@/lib/scan";
import type { LibBookWithShelf, LibLocation } from "@/lib/types";

/** 한 책이 어느 칸에 몇 권 세어져 있는지. */
export type LookupCheck = {
  id: string;
  book_id: string;
  location_id: string;
  copies: number;
  location: { code: string; sort_order: number } | null;
};

/** 같은 제목·같은 시리즈로 걸린 이웃 줄. */
export type LookupRelBook = {
  id: string;
  title: string;
  series: string | null;
  label_level: number | null;
  total_copies: number;
};

export type PlaceLookup = {
  location: LibLocation | null;
  /** 찍힌 값으로 정해진 줄. 앱의 findBooksByIsbn → findBook 과 같은 순서로 고릅니다. */
  book: LibBookWithShelf | null;
  /** 같은 ISBN 으로 들어 있는 줄들(등급별로 갈라져 있을 수 있습니다). */
  sameIsbn: LibBookWithShelf[];
  /** 그 책의 자리 기록 전부. 이 칸에 있나 · 다른 칸에 몇 권 · 원래 칸이 어디인가가 다 여기서 나옵니다. */
  checks: LookupCheck[];
  relBooks: LookupRelBook[];
  relChecks: Omit<LookupCheck, "id">[];
  /** 이 칸에 지금까지 세어진 종수 · 권수. 찍은 뒤 화면 숫자를 맞추는 데 씁니다. */
  shelfTitles: number;
  shelfCopies: number;
};

type RawLookup = {
  location: LibLocation | null;
  book: LibBookWithShelf | null;
  same_isbn: LibBookWithShelf[] | null;
  checks: LookupCheck[] | null;
  rel_books: LookupRelBook[] | null;
  rel_checks: Omit<LookupCheck, "id">[] | null;
  shelf_titles: number | string | null;
  shelf_copies: number | string | null;
};

export async function placeLookup(
  supabase: SupabaseClient,
  args: { locationId: string; code: string; bookId?: string | null }
): Promise<PlaceLookup> {
  const code = args.code ?? "";
  const variants = isbnVariants(code);
  /*
    옛 번호(lib_book_aliases)를 찾을 때 쓰는 번호들. 앱의 findByAlias 와 같습니다 - 찍힌
    값 자체와 그 ISBN 변형들입니다. 합치면서 주인을 잃은 라벨이 아직 책에 붙어 있어서,
    맨 끝에서 한 번은 봐 줘야 멀쩡한 책이 "등록되지 않은 책"으로 보이지 않습니다.
  */
  const aliasCodes = Array.from(new Set([code, ...variants].filter(Boolean)));

  const { data, error } = await supabase.rpc("lib_place_lookup", {
    p_location_id: args.locationId,
    p_code: code || null,
    p_book_id: args.bookId ?? null,
    p_isbns: variants,
    p_alias_codes: aliasCodes,
    p_is_isbn: isIsbn(code),
    p_is_item_code: isItemCode(code),
  });

  /*
    거절당한 것과 "그런 책이 없는 것"은 전혀 다른 일입니다. 묶어서 빈 값으로 돌려주면 화면에
    "아직 등록되지 않은 책입니다"가 떠서, 멀쩡히 꽂혀 있는 책이 사라진 것처럼 보이고 원인을
    짐작할 수조차 없습니다. 예전에 구역 붙여오기가 거절당했을 때 실제로 그랬습니다.
  */
  if (error) throw new Error(`책을 찾는 중 오류: ${error.message}`);

  const raw = (data ?? null) as RawLookup | null;
  return {
    location: raw?.location ?? null,
    book: raw?.book ?? null,
    sameIsbn: raw?.same_isbn ?? [],
    checks: raw?.checks ?? [],
    relBooks: raw?.rel_books ?? [],
    relChecks: raw?.rel_checks ?? [],
    // count/sum 은 bigint 라 문자열로 올 수 있습니다.
    shelfTitles: Number(raw?.shelf_titles ?? 0),
    shelfCopies: Number(raw?.shelf_copies ?? 0),
  };
}
