/**
 * 표 전체를 **끝까지** 들고 옵니다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * `.limit(5000)` 이라고 적어도 실제로는 **1000줄만** 옵니다. Supabase(PostgREST)에는 한 번에
 * 돌려주는 줄 수의 상한이 따로 있고, 코드에 적은 숫자가 그 상한보다 크면 상한이 이깁니다.
 * 넘친 만큼은 **아무 오류 없이 조용히 잘려** 나갑니다.
 *
 * 그래서 장서가 1000종을 넘은 날부터, 장서 관리 화면은 1000종만 보여주면서 "1000종"이라고
 * 적어 두고 있었습니다. 더 나쁜 것은 화면마다 정렬이 달라서(등록순 / 제목순) **각자 다른
 * 1000종**을 보고 있었다는 점입니다 - 같은 책이 한 화면에는 있고 다른 화면에는 없었습니다.
 * 상품코드 책 확인 목록과 장서 관리의 숫자가 13종과 14종으로 어긋나면서 드러났습니다.
 *
 * ── 어떻게 하는가 ───────────────────────────────────────────────────────────
 * 1000줄씩 끊어서 더 이상 안 나올 때까지 가져옵니다. 마지막 묶음이 1000줄보다 적으면 끝입니다.
 *
 * **정렬을 반드시 하나로 못박아 주세요.** 같은 값이 여럿인 칸(예: created_at)으로만 정렬하면
 * 묶음 사이에서 순서가 흔들려 어떤 줄은 두 번 오고 어떤 줄은 빠집니다. 마지막 정렬 기준으로
 * id 처럼 겹치지 않는 칸을 하나 더 붙이면 됩니다.
 */

/*
  data 를 unknown 으로 받는 이유: 이 앱의 Supabase 클라이언트에는 표 구조 타입이 들어 있지
  않아서, select("a,b,c") 의 결과 타입이 실제 칸과 무관하게 나옵니다. 원래도 부르는 쪽에서
  `as LibBook[]` 로 적어 주고 있었으므로, 그 한 번의 단언을 여기 T 로 모읍니다.
*/
type Page = { data: unknown; error: { message: string } | null };

export async function fetchAll<T>(
  /** from~to(둘 다 포함) 줄을 가져오는 질의를 만들어 주는 함수. `.range(from, to)` 를 붙입니다. */
  page: (from: number, to: number) => PromiseLike<Page>,
  options: { pageSize?: number; max?: number } = {}
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000;
  // 안전장치. 여기에 걸릴 만큼 커졌다면 화면이 아니라 집계로 풀어야 할 자료입니다.
  const max = options.max ?? 50_000;

  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    /*
      오류는 **던집니다**. 예전에 구역 붙여오기 질의가 거부당했는데 그 오류를 빈 값으로 삼키는
      바람에, 장서에 멀쩡히 있는 책이 "등록되지 않은 책"으로 보이고도 기록 한 줄 남지 않은
      일이 있었습니다. 반쪽짜리 목록을 전체인 척 돌려주느니 화면이 오류를 보는 편이 낫습니다.
    */
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
